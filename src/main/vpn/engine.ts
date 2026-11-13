import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { lookup } from 'node:dns/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  CoreState,
  DiagnosticCheck,
  DiagnosticsResult,
  EngineChoice,
  EngineComparison,
  EngineId,
  EngineState,
  EngineSwitchRecord,
  EngineUsage,
  HistoryPoint,
  IpInfo,
  IpState,
  LogEntry,
  Metrics,
  Profile,
  Scenario,
  Settings,
  SpeedTestResult,
  VpnState,
  VpnStatus
} from '@shared/types'
import { Store } from '../store'
import {
  clashStats,
  directIp,
  downloadThroughput,
  freePort,
  measurePing,
  proxiedIp,
  tcpPing,
  waitForPort,
  type ClashStats
} from './singbox'
import { disableSystemProxy, disableSystemProxySync, enableSystemProxy, recoverStaleProxy } from './system-proxy'
import { EngineManager, type EngineProcess } from './engines/manager'
import { xrayStats } from './engines/xray-stats'
import { ProcessUsageSampler } from './process-usage'
import {
  disableKillSwitch,
  disableKillSwitchSync,
  enableKillSwitch,
  killSwitchSupported,
  recoverKillSwitch
} from './firewall'
import { dnsGuardStats, recoverStaleDns, startDnsGuard, stopDnsGuard, stopDnsGuardSync } from './dns-guard'
import { geolocateProfiles } from './geo'
import { allScenarios } from './scenarios'

const HISTORY_LIMIT = 60
const LOG_LIMIT = 160
const API_SECRET = 'eaglet-local-api'
const PROBE_WINDOW = 20
const JITTER_WINDOW = 10

const EMPTY_METRICS = (): Metrics => ({
  ping: 0,
  down: 0,
  up: 0,
  downTotal: 0,
  upTotal: 0,
  sessionSeconds: 0,
  connections: 0,
  jitter: 0,
  loss: 0,
  probes: 0,
  probeFailures: 0
})

const EMPTY_IP = (): IpState => ({ direct: null, exit: null, checking: false, changed: false, checkedAt: null })
const EMPTY_USAGE = (): EngineUsage => ({ pid: null, cpu: 0, memory: 0 })

interface Runtime {
  process: EngineProcess | null
  engine: EngineId | null
  corePath: string | null
  mixedPort: number
  apiPort: number
  configPath: string | null
  baseline: ClashStats
  lastStats: ClashStats
  /** Timestamp of the last successful traffic sample, used for rate math. */
  lastStatsAt: number
  proxyApplied: boolean
  killSwitchApplied: boolean
  dnsGuardApplied: boolean
  tickTimer: NodeJS.Timeout | null
  pingTimer: NodeJS.Timeout | null
  usageTimer: NodeJS.Timeout | null
  reconnectTimer: NodeJS.Timeout | null
  transition: boolean
  tickBusy: boolean
  /** Incremented on every unexpected drop; reset by a manual connect. */
  reconnectAttempts: number
  /** True after the user explicitly disconnects, so we don't fight them. */
  userStop: boolean
  /** Consecutive successful latency probes (for jitter). */
  pingDiffs: number[]
  lastPing: number | null
  probeWindow: boolean[]
}

function now(): number {
  return Date.now()
}

/**
 * Real tunnel engine. It is core-agnostic: the EngineManager picks sing-box,
 * Xray-core or Mihomo for the profile, and this class owns the state machine,
 * live telemetry, session history, protection layers and diagnostics.
 */
export class VpnEngine extends EventEmitter {
  private store: Store
  private manager = new EngineManager()
  private usageSampler = new ProcessUsageSampler()
  private status: VpnStatus = 'disconnected'
  private profileId: string | null
  private engineId: EngineId = 'sing-box'
  private engines: EngineState[] = []
  private usage: EngineUsage = EMPTY_USAGE()
  private killSwitchActive = false
  private dnsProtectionActive = false
  private connectedSince: number | null = null
  private stage: string | null = null
  private progress = 0
  private error: string | null = null
  private metrics: Metrics = EMPTY_METRICS()
  private history: HistoryPoint[] = []
  private logs: LogEntry[] = []
  private logId = 1
  private ip: IpState = EMPTY_IP()
  private core: CoreState = { available: false, running: false, version: null, path: null }
  private sessionSaved = true
  private runtime: Runtime
  /** One-shot override used by a live engine switch and its rollback. */
  private forcedEngine: EngineId | null = null

  constructor(store: Store) {
    super()
    this.store = store
    this.profileId = store.getSettings().activeProfileId
    this.runtime = {
      process: null,
      engine: null,
      corePath: null,
      mixedPort: 0,
      apiPort: 0,
      configPath: null,
      baseline: { downTotal: 0, upTotal: 0, connections: 0 },
      lastStats: { downTotal: 0, upTotal: 0, connections: 0 },
      lastStatsAt: 0,
      proxyApplied: false,
      killSwitchApplied: false,
      dnsGuardApplied: false,
      tickTimer: null,
      pingTimer: null,
      usageTimer: null,
      reconnectTimer: null,
      transition: false,
      tickBusy: false,
      reconnectAttempts: 0,
      userStop: false,
      pingDiffs: [],
      lastPing: null,
      probeWindow: []
    }
    this.pushLog('info', 'Eaglet engine ready · engine manager online')
  }

  /* ------------------------------------------------------------------ */
  /*  Boot                                                              */
  /* ------------------------------------------------------------------ */

  async init(): Promise<void> {
    recoverStaleProxy()
    recoverKillSwitch()
    recoverStaleDns()
    await this.manager.init()
    const settings = this.store.getSettings()
    this.profileId = this.profileId ?? this.store.getProfiles()[0]?.id ?? null
    this.engineId = this.manager.choose(this.activeProfile(), settings).id
    this.engines = this.manager.getStates(this.engineId, false)
    this.syncCore()
    const adapter = this.manager.adapter(this.engineId)
    this.pushLog(
      this.core.available ? 'success' : 'warn',
      this.core.available
        ? `${adapter.name} detected${this.core.version ? ` · ${this.core.version}` : ''}`
        : `${adapter.name} is not installed · it will be downloaded on first connect`
    )
    this.emitUpdate()
    void this.refreshDirectIp()
  }

  /** Compatibility helper used by the free-node finder (always sing-box). */
  async ensureCore(): Promise<string> {
    return this.manager.ensure('sing-box', (message) => {
      this.pushLog('info', message)
      this.emitUpdate()
    })
  }

  async refreshCore(): Promise<CoreState> {
    await this.manager.init()
    this.syncCore()
    this.emitUpdate()
    return this.core
  }

  async refreshEngines(checkUpdates = false): Promise<EngineState[]> {
    await this.manager.init()
    if (checkUpdates) await this.manager.checkUpdates()
    this.engines = this.manager.getStates(this.engineId, this.isLive())
    this.syncCore()
    this.emitUpdate()
    return this.engines
  }

  async installEngine(id: EngineId): Promise<EngineState[]> {
    await this.manager.install(id, (message) => {
      this.pushLog('info', message)
      this.emitUpdate()
    })
    this.engines = this.manager.getStates(this.engineId, this.isLive())
    if (id === this.engineId) this.syncCore()
    this.store.addProfileEvent({
      id: `${now()}-engine-${id}`,
      at: now(),
      kind: 'engine',
      message: `${this.manager.adapter(id).name} installed`
    })
    this.emitUpdate()
    return this.engines
  }

  async removeEngine(id: EngineId): Promise<EngineState[]> {
    if (this.runtime.engine === id && this.isLive()) {
      throw new Error('Disconnect before removing the engine that is currently running')
    }
    const removed = await this.manager.remove(id)
    if (!removed) throw new Error(`${this.manager.adapter(id).name} is not installed in the user data folder`)
    this.engines = this.manager.getStates(this.engineId, this.isLive())
    if (id === this.engineId) {
      this.engineId = this.manager.choose(this.activeProfile(), this.store.getSettings()).id
      this.syncCore()
    }
    this.pushLog('info', `${this.manager.adapter(id).name} removed`)
    this.emitUpdate()
    return this.engines
  }

  async checkEngineUpdates(): Promise<EngineState[]> {
    await this.manager.checkUpdates()
    this.engines = this.manager.getStates(this.engineId, this.isLive())
    const updates = this.engines.filter((engine) => engine.updateAvailable)
    this.pushLog(
      updates.length > 0 ? 'info' : 'success',
      updates.length > 0
        ? `Updates available: ${updates.map((engine) => `${engine.name} ${engine.latestVersion}`).join(', ')}`
        : 'All installed engines are up to date'
    )
    this.emitUpdate()
    return this.engines
  }

  /**
   * Changes the global engine. While a tunnel is live the old core is stopped,
   * the new one is started, and any failure rolls back to the previous engine
   * instead of leaving the user disconnected.
   */
  async setEngine(choice: EngineChoice): Promise<Settings> {
    const previousSettings = this.store.getSettings()
    const previousEngine = this.runtime.engine ?? this.engineId
    const settings = this.store.updateSettings({ engine: choice })
    const target = this.manager.choose(this.activeProfile(), settings).id
    const targetName = this.manager.adapter(target).name

    if (!this.isLive()) {
      this.engineId = target
      this.syncCore()
      this.recordEngineSwitch(target, 'manual', previousEngine)
      this.pushLog('info', `Engine set to ${targetName}`)
      this.emitUpdate()
      return settings
    }

    if (this.status !== 'connected' || this.runtime.transition) {
      this.pushLog('warn', `${targetName} selected · it applies on the next connection`)
      this.emitUpdate()
      return settings
    }

    if (this.runtime.engine === target) {
      this.pushLog('info', `${targetName} is already running`)
      this.emitUpdate()
      return settings
    }

    const profile = this.activeProfile()
    const revertChoice = (): void => {
      this.store.updateSettings({ engine: previousSettings.engine })
      this.engineId = this.manager.choose(this.activeProfile(), this.store.getSettings()).id
      this.syncCore()
    }
    if (!profile) {
      revertChoice()
      throw new Error('Select a profile before switching engines')
    }
    if (!this.manager.supportsProfile(target, profile)) {
      revertChoice()
      throw new Error(
        `${targetName} cannot carry this ${profile.protocol.toUpperCase()} profile`
      )
    }
    if (settings.tunMode && !this.manager.adapter(target).supportsTun) {
      revertChoice()
      throw new Error(`${targetName} does not support TUN mode`)
    }

    try {
      await this.manager.ensure(target, (message) => {
        this.pushLog('info', message)
        this.emitUpdate()
      })
    } catch (error) {
      revertChoice()
      throw new Error(`Could not install ${targetName}: ${(error as Error).message}`)
    }

    const previousName = this.manager.adapter(previousEngine).name
    this.pushLog('info', `Switching engine · ${previousName} → ${targetName}`)
    this.forcedEngine = target
    try {
      await this.disconnect()
      await this.connect()
      if (this.status !== 'connected' || this.runtime.engine !== target) {
        throw new Error(this.error ?? `${targetName} could not establish a tunnel`)
      }
      this.pushLog('success', `Engine switched to ${targetName}`)
    } catch (error) {
      const message = (error as Error).message
      this.pushLog('warn', `Engine switch failed · ${message} · rolling back to ${previousName}`)
      this.forcedEngine = previousEngine
      try {
        if (this.status === 'connected') await this.disconnect()
        await this.connect()
        if (this.status === 'connected' && this.runtime.engine === previousEngine) {
          this.pushLog('info', `Rolled back to ${previousName}`)
        } else {
          this.pushLog('error', `Rollback failed: ${this.error ?? 'unknown error'}`)
        }
      } catch (rollbackError) {
        this.pushLog('error', `Rollback failed: ${(rollbackError as Error).message}`)
      }
      revertChoice()
      throw new Error(`Could not switch to ${targetName}: ${message}`)
    } finally {
      this.forcedEngine = null
      this.emitUpdate()
    }
    return settings
  }

  setProfileEngine(profileId: string, engine: EngineId | null): Profile[] {
    this.store.setProfileEngine(profileId, engine)
    const profile = this.store.getProfile(profileId)
    if (profile) {
      if (engine && !this.manager.supportsProfile(engine, profile)) {
        this.pushLog(
          'warn',
          `${this.manager.adapter(engine).name} cannot carry ${profile.protocol.toUpperCase()} · Eaglet will fall back to a compatible core`
        )
      } else {
        this.pushLog(
          'info',
          engine
            ? `${profile.name} pinned to ${this.manager.adapter(engine).name}`
            : `${profile.name} follows the global engine`
        )
      }
    }
    if (profile?.id === this.profileId) {
      this.engineId = this.manager.choose(profile, this.store.getSettings()).id
      this.syncCore()
    }
    this.emitUpdate()
    return this.store.getProfiles()
  }

  /* ------------------------------------------------------------------ */
  /*  Snapshot                                                          */
  /* ------------------------------------------------------------------ */

  getState(): VpnState {
    return {
      status: this.status,
      profile: this.activeProfile(),
      connectedSince: this.connectedSince,
      metrics: { ...this.metrics },
      history: [...this.history],
      stage: this.stage,
      progress: this.progress,
      logs: [...this.logs],
      error: this.error,
      ip: { ...this.ip, direct: this.ip.direct, exit: this.ip.exit },
      core: { ...this.core },
      engine: this.engineId,
      engines: this.manager.getStates(this.engineId, this.isLive()),
      usage: { ...this.usage },
      killSwitchActive: this.killSwitchActive,
      dnsProtectionActive: this.dnsProtectionActive,
      comparison: this.compareEngines()
    }
  }

  getProfileId(): string | null {
    return this.profileId
  }

  getEngineId(): EngineId {
    return this.engineId
  }

  getConfigPath(): string | null {
    return this.runtime.configPath
  }

  getEngineStates(): EngineState[] {
    return this.engines
  }

  /** True when an engine can actually carry the profile (protocol + variant). */
  supportsProfile(id: EngineId, profileId?: string): boolean {
    const profile = profileId ? this.store.getProfile(profileId) : this.activeProfile()
    return this.manager.supportsProfile(id, profile)
  }

  getEngineHistory(): EngineSwitchRecord[] {
    return this.store.getEngineHistory()
  }

  clearEngineHistory(): EngineSwitchRecord[] {
    this.store.clearEngineHistory()
    this.emitUpdate()
    return this.store.getEngineHistory()
  }

  private isLive(): boolean {
    return this.status === 'connected' || this.status === 'connecting' || this.status === 'disconnecting'
  }

  private activeProfile(): Profile | null {
    if (!this.profileId) return null
    return this.store.getProfile(this.profileId)
  }

  private syncCore(): void {
    const path = this.manager.getPath(this.engineId)
    this.core = {
      available: Boolean(path),
      running: this.core.running,
      version: this.manager.getVersion(this.engineId),
      path
    }
  }

  private recordEngineSwitch(to: EngineId, reason: EngineSwitchRecord['reason'], from?: EngineId | null): void {
    const previous = from === undefined ? (this.runtime.engine ?? null) : from
    if (previous === to) return
    this.store.addEngineSwitch({
      id: `${now()}-${to}`,
      at: now(),
      from: previous,
      to,
      reason,
      profileName: this.activeProfile()?.name ?? null
    })
    this.usage = EMPTY_USAGE()
  }

  private compareEngines(): EngineComparison[] {
    const sessions = this.store.getSessions()
    const ids: EngineId[] = ['sing-box', 'xray', 'mihomo']
    return ids.map((engine) => {
      const rows = sessions.filter((session) => session.engine === engine)
      const pings = rows.map((row) => row.ping).filter((value): value is number => value !== null && value > 0)
      return {
        engine,
        sessions: rows.length,
        downTotal: rows.reduce((sum, row) => sum + row.downTotal, 0),
        upTotal: rows.reduce((sum, row) => sum + row.upTotal, 0),
        avgPing: pings.length > 0 ? Math.round(pings.reduce((sum, value) => sum + value, 0) / pings.length) : null,
        lastUsedAt: rows.reduce<number | null>((latest, row) => Math.max(latest ?? 0, row.startedAt), null)
      }
    })
  }

  selectProfile(id: string): void {
    if (this.status === 'connected' || this.status === 'connecting') {
      this.pushLog('warn', 'Disconnect before switching to another profile')
      this.emitUpdate()
      return
    }
    const profile = this.store.getProfile(id)
    if (!profile) return
    this.profileId = id
    this.store.updateSettings({ activeProfileId: id })
    this.engineId = this.manager.choose(profile, this.store.getSettings()).id
    this.syncCore()
    this.pushLog('info', `Selected ${profile.name} · ${profile.protocol.toUpperCase()} · ${this.manager.adapter(this.engineId).name}`)
    this.emitUpdate()
  }

  setProfile(id: string | null): void {
    this.profileId = id
    this.store.updateSettings({ activeProfileId: id })
    this.engineId = this.manager.choose(this.activeProfile(), this.store.getSettings()).id
    this.syncCore()
    this.emitUpdate()
  }

  /** Called when a profile disappears so we never point at a deleted node. */
  reconcileProfiles(): void {
    const profiles = this.store.getProfiles()
    if (this.profileId && !profiles.some((profile) => profile.id === this.profileId)) {
      this.profileId = profiles[0]?.id ?? null
      this.store.updateSettings({ activeProfileId: this.profileId })
    }
    if (!this.profileId && profiles.length > 0) {
      this.profileId = profiles[0].id
      this.store.updateSettings({ activeProfileId: this.profileId })
    }
    this.engineId = this.manager.choose(this.activeProfile(), this.store.getSettings()).id
    this.syncCore()
    this.emitUpdate()
  }

  /* ------------------------------------------------------------------ */
  /*  Connect / disconnect                                              */
  /* ------------------------------------------------------------------ */

  async connect(id?: string, automatic = false): Promise<void> {
    if (this.runtime.transition) return
    if (!automatic) {
      this.runtime.reconnectAttempts = 0
      this.runtime.userStop = false
      this.clearReconnectTimer()
    }
    if (this.status === 'connected' || this.status === 'connecting') {
      if (id && id !== this.profileId) this.pushLog('warn', 'Disconnect before switching to another node')
      return
    }
    if (id) {
      this.profileId = id
      this.store.updateSettings({ activeProfileId: id })
    }

    const profile = this.activeProfile()
    if (!profile) {
      this.error = 'No profile selected. Import a subscription or a share link first.'
      this.pushLog('error', this.error)
      this.emitUpdate()
      return
    }

    const settings = this.store.getSettings()
    // Protection that survived a crash stays armed while the automatic
    // reconnect retries. The core keeps resolving through the running relay
    // (or the already-allowed resolvers) and the previous node rule still
    // matches, so ordinary traffic cannot leak during the retry loop.
    const preserveProtection =
      automatic &&
      (settings.killSwitch || settings.networkProtection) &&
      (this.runtime.killSwitchApplied || this.runtime.dnsGuardApplied)
    const previousEngine = this.runtime.engine ?? null
    const forced = this.forcedEngine
    const choice: { id: EngineId; reason: EngineSwitchRecord['reason'] } =
      forced && this.manager.supportsProfile(forced, profile)
        ? { id: forced, reason: 'manual' }
        : this.manager.choose(profile, settings)
    const preference = profile.engine ?? (settings.engine !== 'auto' ? settings.engine : null)
    if (!forced && preference && preference !== choice.id) {
      this.pushLog(
        'warn',
        `${this.manager.adapter(preference).name} cannot carry this profile · using ${this.manager.adapter(choice.id).name}`
      )
    }
    await this.clearStaleProtection(preserveProtection)
    this.runtime.transition = true
    this.status = 'connecting'
    this.error = null
    this.connectedSince = null
    this.metrics = EMPTY_METRICS()
    this.history = []
    this.runtime.pingDiffs = []
    this.runtime.lastPing = null
    this.runtime.probeWindow = []
    this.usage = EMPTY_USAGE()
    this.ip = { ...this.ip, exit: null, checking: false, changed: false }
    this.pushLog('info', `Connecting · ${profile.name} · ${profile.protocol.toUpperCase()}`)
    this.setStage('Preparing profile', 0.06)

    try {
      // 1. Make sure the IP probe runs before the system proxy is switched on.
      if (!this.ip.direct) await this.refreshDirectIp()

      // 2. Make sure the chosen core is present.
      this.setStage(`Loading ${this.manager.adapter(choice.id).name} core`, 0.16)
      let binary = await this.prepareBinary(choice.id, profile, settings)
      const engineId = this.runtime.engine ?? choice.id
      const adapter = this.manager.adapter(engineId)
      if (settings.tunMode) {
        binary = await this.manager.ensureTun(engineId, binary, (message) => {
          this.pushLog('info', message)
          this.emitUpdate()
        })
      }
      this.recordEngineSwitch(engineId, choice.reason, previousEngine)
      this.runtime.engine = engineId
      this.runtime.corePath = binary
      this.engineId = engineId
      this.syncCore()
      this.pushLog('info', `Core: ${adapter.name}${this.core.version ? ` ${this.core.version}` : ''}`)

      // 3. Build + validate the native config.
      this.setStage('Building core configuration', 0.3)
      const mixedPort = await freePort(2080)
      const apiPort = await freePort(mixedPort + 1)
      const content = this.manager.buildConfig(engineId, {
        profile,
        settings,
        mixedPort,
        apiPort,
        auxPort: await freePort(apiPort + 1),
        apiSecret: API_SECRET
      })
      const configDir = join(app.getPath('userData'), 'core')
      mkdirSync(configDir, { recursive: true })
      const configPath = join(configDir, adapter.configFileName)
      writeFileSync(configPath, content, 'utf-8')
      await this.manager.validate(engineId, binary, configPath)
      this.pushLog('success', `${adapter.name} configuration validated`)

      // 4. Spawn the tunnel.
      this.setStage('Starting encrypted tunnel', 0.48)
      const runtime = this.runtime
      runtime.mixedPort = mixedPort
      runtime.apiPort = apiPort
      runtime.configPath = configPath
      runtime.baseline = { downTotal: 0, upTotal: 0, connections: 0 }
      runtime.lastStats = { downTotal: 0, upTotal: 0, connections: 0 }
      runtime.lastStatsAt = Date.now()
      runtime.proxyApplied = false

      runtime.process = this.manager.start(
        engineId,
        binary,
        configPath,
        (level, message) => this.onCoreLog(level, message),
        (code) => this.onCoreExit(code)
      )
      this.core = { ...this.core, running: true }
      await waitForPort(mixedPort)

      // 5. Local proxy is up — verify the tunnel really carries traffic.
      this.setStage('Verifying exit route', 0.72)
      const exit = await this.probeExit(mixedPort, 3)
      if (!exit) throw new Error('The tunnel did not respond. Check the profile and try again.')
      const direct = this.ip.direct
      const changed = Boolean(direct && direct.ip !== exit.ip)
      this.ip = { direct, exit, checking: false, changed, checkedAt: now() }
      this.pushLog(
        'success',
        changed ? `Exit IP changed · ${direct?.ip} → ${exit.ip}` : `Tunnel live · exit IP ${exit.ip}`
      )

      // 6. System routing, then protection layers.
      this.setStage('Applying system routing', 0.9)
      if (settings.systemProxy && !settings.tunMode) {
        try {
          await enableSystemProxy(mixedPort)
          runtime.proxyApplied = true
          this.pushLog('info', `System proxy routed through Eaglet (${process.platform})`)
        } catch (error) {
          this.pushLog('warn', `System proxy not applied: ${(error as Error).message}`)
        }
      } else if (settings.tunMode) {
        this.pushLog('info', 'TUN mode active · traffic captured at the adapter level')
      } else if (this.runtime.proxyApplied) {
        // The setting was turned off while protection stayed armed across a
        // reconnect; remove the stale proxy configuration.
        try {
          await disableSystemProxy()
        } catch {
          // Ignore — a missing backup simply disables the proxy.
        }
        this.runtime.proxyApplied = false
      }

      await this.applyProtection(profile, binary, settings)

      this.status = 'connected'
      this.connectedSince = now()
      this.sessionSaved = false
      this.stage = null
      this.progress = 1
      this.pushLog('success', `Tunnel established · ${profile.name} · ${adapter.name}`)
      this.startTelemetry()
      void this.sampleUsage()
    } catch (error) {
      const message = (error as Error).message || 'Unknown connection error'
      this.pushLog('error', message)
      this.error = message
      await this.teardown(preserveProtection)
      if (preserveProtection) {
        this.pushLog('warn', 'Kill switch stays armed · direct traffic is still blocked')
      }
      this.status = 'error'
      this.stage = null
      this.progress = 0
    } finally {
      this.runtime.transition = false
      this.emitUpdate()
    }
  }

  /**
   * Removes protection layers left over from a crashed session before a new
   * handshake. They are re-armed as soon as the tunnel is verified.
   */
  private async clearStaleProtection(preserve = false): Promise<void> {
    if (preserve) return
    if (this.runtime.killSwitchApplied) {
      try {
        await disableKillSwitch()
      } catch {
        // Partial rules are cleaned by the next disable attempt.
      }
      this.runtime.killSwitchApplied = false
      this.killSwitchActive = false
    }
    if (this.runtime.dnsGuardApplied) {
      await stopDnsGuard()
      this.runtime.dnsGuardApplied = false
      this.dnsProtectionActive = false
    }
    if (this.runtime.proxyApplied) {
      try {
        await disableSystemProxy()
      } catch {
        // Ignore — a missing backup simply disables the proxy.
      }
      this.runtime.proxyApplied = false
    }
  }

  /**
   * Installs the selected core when necessary. If that fails (offline or a
   * missing release) we fall back to any installed core that can carry the
   * protocol, instead of failing the whole connection.
   */
  private async prepareBinary(id: EngineId, profile: Profile, settings: Settings): Promise<string> {
    this.runtime.engine = id
    const existing = this.manager.getPath(id)
    if (existing) return existing
    try {
      return await this.manager.install(id, (message) => {
        this.pushLog('info', message)
        this.emitUpdate()
      })
    } catch (error) {
      this.pushLog('warn', `Could not install ${this.manager.adapter(id).name}: ${(error as Error).message}`)
      const fallback = (['sing-box', 'mihomo', 'xray'] as EngineId[]).find(
        (candidate) =>
          this.manager.getPath(candidate) &&
          this.manager.supportsProfile(candidate, profile) &&
          (!settings.tunMode || this.manager.adapter(candidate).supportsTun)
      )
      if (!fallback) throw error
      this.pushLog('warn', `Falling back to ${this.manager.adapter(fallback).name}`)
      this.runtime.engine = fallback
      const path = this.manager.getPath(fallback)
      if (!path) throw error
      return path
    }
  }

  private async applyProtection(profile: Profile, binary: string, settings: Settings): Promise<void> {
    if (settings.killSwitch || settings.networkProtection) {
      if (profile.protocol === 'direct') {
        this.pushLog('warn', 'Kill switch skipped · a direct profile is not a tunnel')
      } else if (!killSwitchSupported()) {
        this.pushLog('warn', 'Kill switch is not implemented on this platform')
      } else if (this.runtime.killSwitchApplied) {
        // The policy survived the crash and already permits this node. Calling
        // enable() again would overwrite the saved pre-arm state with the
        // already-blocked state (Windows) or with our own anchor rules (macOS),
        // which would make a later disable() permanent. Leave it untouched.
        this.pushLog('info', 'Kill switch already armed for this node · policy kept')
      } else {
        try {
          const subscriptionUrls = this.store
            .getSubscriptions()
            .map((subscription) => subscription.url)
            .filter((url) => /^https?:\/\//i.test(url))
          const ips = await enableKillSwitch(profile, binary, settings, subscriptionUrls)
          this.runtime.killSwitchApplied = true
          this.killSwitchActive = true
          this.pushLog(
            'success',
            `Kill switch armed · whitelisted ${ips.length > 0 ? ips.join(', ') : 'loopback and Eaglet only'}`
          )
        } catch (error) {
          this.pushLog('error', `Kill switch could not be armed: ${(error as Error).message}`)
        }
      }
    }

    if (settings.dnsProtection || settings.networkProtection) {
      try {
        await startDnsGuard(settings)
        this.runtime.dnsGuardApplied = true
        this.dnsProtectionActive = true
        const stats = dnsGuardStats()
        this.pushLog('success', `DNS protection active · DoH relay ${stats.endpoint ?? 'configured'}`)
      } catch (error) {
        this.pushLog('warn', `DNS protection could not start: ${(error as Error).message}`)
        if (this.runtime.killSwitchApplied && (settings.dnsProtection || settings.networkProtection)) {
          this.pushLog(
            'error',
            'Kill switch is armed without the DNS relay · plaintext DNS is blocked until you disconnect'
          )
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.runtime.transition) return
    if (this.status === 'disconnected' || this.status === 'disconnecting') return
    this.runtime.userStop = true
    this.clearReconnectTimer()
    this.runtime.transition = true
    this.status = 'disconnecting'
    this.stage = 'Closing tunnel'
    this.progress = 0.5
    this.pushLog('info', 'Closing the encrypted tunnel')
    this.emitUpdate()

    await this.teardown(false)
    this.finishSession()

    this.status = 'disconnected'
    this.stage = null
    this.progress = 0
    this.connectedSince = null
    this.metrics = EMPTY_METRICS()
    this.history = []
    this.error = null
    this.usage = EMPTY_USAGE()
    this.pushLog('info', 'Disconnected · direct connection restored')
    this.runtime.transition = false
    this.emitUpdate()
  }

  private async teardown(keepProtection: boolean): Promise<void> {
    // One last sample so short sessions record their real traffic instead of zero.
    await this.finalSample()
    this.stopTelemetry()

    if (this.runtime.process) {
      const proc = this.runtime.process
      this.runtime.process = null
      try {
        await proc.stop()
      } catch {
        // Process already gone.
      }
    }

    if (this.runtime.proxyApplied) {
      try {
        await disableSystemProxy()
      } catch (error) {
        this.pushLog('warn', `Could not restore the system proxy: ${(error as Error).message}`)
      }
      this.runtime.proxyApplied = false
    }

    if (!keepProtection) {
      if (this.runtime.killSwitchApplied) {
        try {
          await disableKillSwitch()
        } catch (error) {
          this.pushLog('warn', `Could not remove the kill switch: ${(error as Error).message}`)
        }
        this.runtime.killSwitchApplied = false
        this.killSwitchActive = false
      }
      if (this.runtime.dnsGuardApplied) {
        await stopDnsGuard()
        this.runtime.dnsGuardApplied = false
        this.dnsProtectionActive = false
      }
    }

    this.core = { ...this.core, running: false }
    if (!keepProtection) this.usage = EMPTY_USAGE()
  }

  /** Crash / unexpected core exit. */
  private onCoreExit(code: number | null): void {
    if (!this.runtime.process && this.status !== 'connected') return
    this.runtime.process = null
    this.core = { ...this.core, running: false }
    this.stopTelemetry()
    if (this.runtime.proxyApplied) {
      if (this.store.getSettings().killSwitch || this.store.getSettings().networkProtection) {
        // Leave the dead proxy in place so traffic cannot leak around the tunnel.
        this.pushLog('warn', 'Kill switch active · system proxy kept to block traffic')
      } else {
        this.runtime.proxyApplied = false
        void disableSystemProxy()
      }
    }
    if (this.runtime.killSwitchApplied) {
      this.pushLog('warn', 'Kill switch stays armed until the tunnel is restored')
    }
    if (this.runtime.dnsGuardApplied) {
      this.pushLog('warn', 'DNS protection stays active while reconnecting')
    }
    const message = `Core stopped unexpectedly (exit ${code ?? 'unknown'})`
    this.pushLog('error', message)
    this.status = 'error'
    this.error = message
    this.stage = null
    this.progress = 0
    this.usage = EMPTY_USAGE()
    this.finishSession()
    this.emitUpdate()
    this.scheduleReconnect()
  }

  /* ------------------------------------------------------------------ */
  /*  Sessions + resilience                                             */
  /* ------------------------------------------------------------------ */

  /** Persists the finished session exactly once, including crash paths. */
  private finishSession(): void {
    if (this.sessionSaved || !this.connectedSince) return
    const profile = this.activeProfile()
    const elapsed = Math.max(
      this.metrics.sessionSeconds,
      Math.floor((Date.now() - this.connectedSince) / 1000)
    )
    const engine = this.runtime.engine ?? this.engineId
    this.store.addSession({
      id: `${this.connectedSince}-${this.profileId ?? 'none'}`,
      profileName: profile?.name ?? 'Unknown node',
      protocol: profile?.protocol ?? 'direct',
      engine,
      startedAt: this.connectedSince,
      durationSeconds: elapsed,
      downTotal: this.metrics.downTotal,
      upTotal: this.metrics.upTotal,
      exitIp: this.ip.exit?.ip ?? null,
      exitCountry: this.ip.exit?.countryCode ?? null,
      ping: this.metrics.ping > 0 ? Math.round(this.metrics.ping) : null,
      jitter: this.metrics.ping > 0 ? Math.round(this.metrics.jitter) : null,
      loss: this.metrics.probes > 0 ? Math.round(this.metrics.loss * 10) / 10 : null
    })
    this.sessionSaved = true
  }

  private clearReconnectTimer(): void {
    if (this.runtime.reconnectTimer) clearTimeout(this.runtime.reconnectTimer)
    this.runtime.reconnectTimer = null
  }

  /** Retries an unexpected drop when the user enabled auto-reconnect. */
  private scheduleReconnect(): void {
    if (this.runtime.userStop) return
    if (!this.store.getSettings().autoReconnect) return
    if (this.runtime.reconnectAttempts >= 3) {
      this.pushLog('error', 'Auto-reconnect gave up after 3 attempts')
      if (this.runtime.killSwitchApplied || this.runtime.dnsGuardApplied) {
        this.pushLog(
          'warn',
          'Protection stays armed after the failed reconnects · disconnect to restore direct access'
        )
      }
      this.emitUpdate()
      return
    }

    this.runtime.reconnectAttempts += 1
    const attempt = this.runtime.reconnectAttempts
    const delay = attempt * 2500
    this.pushLog('warn', `Auto-reconnect ${attempt}/3 in ${Math.round(delay / 1000)}s`)
    this.emitUpdate()

    this.clearReconnectTimer()
    this.runtime.reconnectTimer = setTimeout(() => {
      this.runtime.reconnectTimer = null
      void (async () => {
        if (this.runtime.userStop) return
        // The kill switch and DNS relay stay armed on purpose: connect() with
        // `automatic` keeps them, and the existing policy already permits the
        // same node. Dropping them here would reopen direct access for the
        // whole retry loop.
        await this.connect(this.profileId ?? undefined, true)
        if (this.status === 'connected') {
          this.runtime.reconnectAttempts = 0
          this.pushLog('success', 'Auto-reconnect restored the tunnel')
          this.emitUpdate()
        } else if (this.runtime.reconnectAttempts < 3) {
          this.scheduleReconnect()
        }
      })()
    }, delay)
  }

  private setStage(stage: string, progress: number): void {
    this.stage = stage
    this.progress = progress
    this.emitUpdate()
  }

  /* ------------------------------------------------------------------ */
  /*  IP check                                                          */
  /* ------------------------------------------------------------------ */

  async refreshDirectIp(): Promise<IpInfo | null> {
    const info = await directIp()
    if (info) {
      this.ip = { ...this.ip, direct: info, checkedAt: now() }
      this.emitUpdate()
    }
    return info
  }

  /** Re-measures both the direct and the tunnel exit address. */
  async checkIp(): Promise<void> {
    this.ip = { ...this.ip, checking: true }
    this.emitUpdate()
    try {
      const direct = await this.refreshDirectIp()
      let exit: IpInfo | null = this.ip.exit
      if (this.status === 'connected' && this.runtime.mixedPort) {
        exit = await this.probeExit(this.runtime.mixedPort, 2)
      }
      if (exit) {
        this.ip = {
          direct: direct ?? this.ip.direct,
          exit,
          checking: false,
          changed: Boolean((direct ?? this.ip.direct) && (direct ?? this.ip.direct)!.ip !== exit.ip),
          checkedAt: now()
        }
      } else {
        this.ip = { ...this.ip, checking: false }
      }
      this.pushLog('info', `IP check · direct ${this.ip.direct?.ip ?? 'unknown'} · exit ${exit?.ip ?? 'unknown'}`)
    } catch (error) {
      this.pushLog('warn', `IP check failed: ${(error as Error).message}`)
      this.ip = { ...this.ip, checking: false }
    }
    this.emitUpdate()
  }

  private async probeExit(port: number, attempts: number): Promise<IpInfo | null> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const info = await proxiedIp(port)
      if (info) return info
      await new Promise((resolve) => setTimeout(resolve, 700))
    }
    return null
  }

  /* ------------------------------------------------------------------ */
  /*  Latency testing + geolocation                                     */
  /* ------------------------------------------------------------------ */

  async testProfiles(ids?: string[]): Promise<Profile[]> {
    if (this.killSwitchActive) {
      // A latency probe opens a direct TCP connection to every node. The kill
      // switch deliberately does not allow the app to reach arbitrary node
      // addresses, so report the limitation instead of appearing to "test"
      // through a blocked path.
      this.pushLog(
        'warn',
        'Latency tests are unavailable while the kill switch is armed — disconnect to measure nodes'
      )
      this.emitUpdate()
      return this.store.getProfiles()
    }
    const targets = this.store
      .getProfiles()
      .filter((profile) => !ids || ids.length === 0 || ids.includes(profile.id))
    await Promise.all(
      targets.map(async (profile) => {
        const ping =
          profile.protocol === 'direct'
            ? 0
            : profile.port > 0
              ? await tcpPing(profile.host, profile.port)
              : null
        this.store.setPing(profile.id, ping)
      })
    )
    const geo = await geolocateProfiles(targets)
    for (const [id, point] of geo) this.store.setGeo(id, point)
    this.pushLog(
      'info',
      `Latency test finished · ${targets.length} profile(s)${geo.size > 0 ? ` · ${geo.size} located` : ''}`
    )
    this.emitUpdate()
    return this.store.getProfiles()
  }

  /** Pings a bounded sample and returns the fastest node. */
  async pickFastestProfile(): Promise<Profile> {
    const profiles = this.store.getProfiles().filter((profile) => profile.protocol !== 'direct' && profile.port > 0)
    if (profiles.length === 0) {
      throw new Error('No nodes yet — import a subscription or find free servers first')
    }
    const ranked = [...profiles].sort((left, right) => {
      if (left.favorite !== right.favorite) return left.favorite ? -1 : 1
      if (left.ping === null && right.ping === null) return right.addedAt - left.addedAt
      if (left.ping === null) return -1
      if (right.ping === null) return 1
      return left.ping - right.ping
    })
    const sample = ranked.slice(0, 16)
    await this.testProfiles(sample.map((profile) => profile.id))
    const measured = this.store
      .getProfiles()
      .filter((profile) => sample.some((item) => item.id === profile.id) && profile.ping !== null)
      .sort((left, right) => (left.ping ?? Infinity) - (right.ping ?? Infinity))
    return measured[0] ?? sample[0]
  }

  /* ------------------------------------------------------------------ */
  /*  Telemetry                                                         */
  /* ------------------------------------------------------------------ */

  private startTelemetry(): void {
    this.stopTelemetry()
    this.runtime.tickTimer = setInterval(() => void this.tick(), 1000)
    this.runtime.pingTimer = setInterval(() => void this.measureLatency(), 5000)
    this.runtime.usageTimer = setInterval(() => void this.sampleUsage(), 4000)
  }

  private stopTelemetry(): void {
    if (this.runtime.tickTimer) clearInterval(this.runtime.tickTimer)
    if (this.runtime.pingTimer) clearInterval(this.runtime.pingTimer)
    if (this.runtime.usageTimer) clearInterval(this.runtime.usageTimer)
    this.runtime.tickTimer = null
    this.runtime.pingTimer = null
    this.runtime.usageTimer = null
  }

  /** Final traffic sample taken before the core is stopped. */
  private async finalSample(): Promise<void> {
    if (!this.runtime.apiPort) return
    const stats = await this.trafficStats()
    if (!stats) return
    this.metrics.downTotal = Math.max(0, stats.downTotal - this.runtime.baseline.downTotal)
    this.metrics.upTotal = Math.max(0, stats.upTotal - this.runtime.baseline.upTotal)
  }

  /** Clash API for sing-box/Mihomo, native StatsService for Xray-core. */
  private async trafficStats(): Promise<ClashStats | null> {
    const id = this.runtime.engine ?? this.engineId
    const adapter = this.manager.adapter(id)
    if (!adapter.telemetry || !this.runtime.apiPort) return null
    if (id === 'xray') {
      if (!this.runtime.corePath) return null
      return xrayStats(this.runtime.corePath, this.runtime.apiPort)
    }
    return clashStats(this.runtime.apiPort, API_SECRET)
  }

  private async sampleUsage(): Promise<void> {
    const pid = this.runtime.process?.pid ?? null
    this.usage = await this.usageSampler.sample(pid)
    this.emitUpdate()
  }

  private async tick(): Promise<void> {
    if (this.status !== 'connected') return
    const runtime = this.runtime
    if (runtime.tickBusy) return
    runtime.tickBusy = true
    try {
      // Xray's native stats service is queried through its CLI, so it is
      // sampled every other second instead of once per tick.
      const isXray = (runtime.engine ?? this.engineId) === 'xray'
      const due = !isXray || Date.now() - runtime.lastStatsAt >= 1900
      const stats = due ? await this.trafficStats() : null
      const elapsed = Math.max(1, (Date.now() - runtime.lastStatsAt) / 1000)
      this.metrics.sessionSeconds += 1

      if (stats) {
        const deltaDown = Math.max(0, stats.downTotal - runtime.lastStats.downTotal)
        const deltaUp = Math.max(0, stats.upTotal - runtime.lastStats.upTotal)
        runtime.lastStats = stats
        runtime.lastStatsAt = Date.now()
        const instantDown = (deltaDown * 8) / 1_000_000 / elapsed
        const instantUp = (deltaUp * 8) / 1_000_000 / elapsed
        this.metrics.down = Math.round((this.metrics.down * 0.45 + instantDown * 0.55) * 10) / 10
        this.metrics.up = Math.round((this.metrics.up * 0.45 + instantUp * 0.55) * 10) / 10
        this.metrics.downTotal = Math.max(0, stats.downTotal - runtime.baseline.downTotal)
        this.metrics.upTotal = Math.max(0, stats.upTotal - runtime.baseline.upTotal)
        this.metrics.connections = stats.connections
      } else if (due) {
        this.metrics.down = Math.round(this.metrics.down * 0.5 * 10) / 10
        this.metrics.up = Math.round(this.metrics.up * 0.5 * 10) / 10
        this.metrics.connections = 0
      }

      this.history.push({
        t: now(),
        ping: this.metrics.ping,
        down: this.metrics.down,
        up: this.metrics.up,
        jitter: this.metrics.jitter,
        loss: this.metrics.loss
      })
      if (this.history.length > HISTORY_LIMIT) this.history.shift()

      if (this.metrics.sessionSeconds % 120 === 0) {
        this.pushLog(
          'info',
          `Session healthy · ${Math.round(this.metrics.ping)} ms · ${this.metrics.connections} connections · ${this.metrics.loss.toFixed(1)}% loss`
        )
      }
      this.emitUpdate()
    } finally {
      runtime.tickBusy = false
    }
  }

  private async measureLatency(): Promise<void> {
    if (this.status !== 'connected' || !this.runtime.mixedPort) return
    const ping = await measurePing(this.runtime.mixedPort)
    const runtime = this.runtime
    if (ping > 0) {
      if (runtime.lastPing !== null) {
        runtime.pingDiffs.push(Math.abs(ping - runtime.lastPing))
        if (runtime.pingDiffs.length > JITTER_WINDOW) runtime.pingDiffs.shift()
      }
      runtime.lastPing = ping
      runtime.probeWindow.push(true)
      this.metrics.probes = (this.metrics.probes ?? 0) + 1
      this.metrics.ping = Math.round((this.metrics.ping || ping) * 0.4 + ping * 0.6)
      this.metrics.jitter =
        runtime.pingDiffs.length > 0
          ? Math.round(runtime.pingDiffs.reduce((sum, value) => sum + value, 0) / runtime.pingDiffs.length)
          : 0
      this.store.setPing(this.profileId ?? '', this.metrics.ping)
    } else {
      runtime.probeWindow.push(false)
      this.metrics.probeFailures = (this.metrics.probeFailures ?? 0) + 1
    }
    if (runtime.probeWindow.length > PROBE_WINDOW) runtime.probeWindow.shift()
    const failures = runtime.probeWindow.filter((ok) => !ok).length
    this.metrics.loss =
      runtime.probeWindow.length > 0 ? Math.round((failures / runtime.probeWindow.length) * 1000) / 10 : 0
    this.emitUpdate()
  }

  /** Downloads a fixed payload through the tunnel and reports real throughput. */
  async runSpeedTest(): Promise<SpeedTestResult> {
    if (this.status !== 'connected' || !this.runtime.mixedPort) {
      throw new Error('Connect to a tunnel before running a speed test')
    }
    this.pushLog('info', 'Speed test · downloading 10 MB through the tunnel')
    this.emitUpdate()
    const { bytes, seconds } = await downloadThroughput(this.runtime.mixedPort)
    const mbps = Math.round(((bytes * 8) / seconds / 1_000_000) * 10) / 10
    this.pushLog(
      'success',
      `Speed test · ${mbps} Mbps · ${(bytes / 1_000_000).toFixed(1)} MB in ${seconds.toFixed(1)}s`
    )
    this.emitUpdate()
    return { mbps, bytes, seconds: Math.round(seconds * 100) / 100, at: now() }
  }

  /** Toggles the system proxy while a tunnel is already live. */
  async setSystemProxy(enabled: boolean): Promise<void> {
    if (this.status !== 'connected' || !this.runtime.mixedPort) {
      this.pushLog('info', `System proxy ${enabled ? 'enabled' : 'disabled'} for the next session`)
      this.emitUpdate()
      return
    }
    try {
      if (enabled && !this.runtime.proxyApplied) {
        await enableSystemProxy(this.runtime.mixedPort)
        this.runtime.proxyApplied = true
        this.pushLog('success', 'System proxy enabled')
      } else if (!enabled && this.runtime.proxyApplied) {
        await disableSystemProxy()
        this.runtime.proxyApplied = false
        this.pushLog('info', 'System proxy disabled · apps go direct')
      }
    } catch (error) {
      this.pushLog('error', `System proxy change failed: ${(error as Error).message}`)
    }
    this.emitUpdate()
  }

  /* ------------------------------------------------------------------ */
  /*  Scenarios                                                         */
  /* ------------------------------------------------------------------ */

  async applyScenario(id: string): Promise<void> {
    const scenario = allScenarios(this.store.getScenarios()).find((item) => item.id === id)
    if (!scenario) throw new Error('Scenario not found')
    const connected = this.isLive()
    const previous = this.store.getSettings()
    this.store.updateSettings({ ...scenario.settings, engine: scenario.engine })
    this.store.addProfileEvent({
      id: `${now()}-scenario-${id}`,
      at: now(),
      kind: 'scenario',
      message: `Scenario applied: ${scenario.name}`
    })

    const settings = this.store.getSettings()
    const chosen = this.manager.choose(this.activeProfile(), settings).id
    this.recordEngineSwitch(chosen, 'scenario')
    this.engineId = chosen
    this.syncCore()

    if (!connected && scenario.serverStrategy !== 'selected') {
      try {
        if (scenario.serverStrategy === 'fastest') {
          const fastest = await this.pickFastestProfile()
          this.setProfile(fastest.id)
        } else {
          const favourite = this.store
            .getProfiles()
            .filter((profile) => profile.favorite && profile.protocol !== 'direct')
            .sort((left, right) => (left.ping ?? Infinity) - (right.ping ?? Infinity))[0]
          if (favourite) this.setProfile(favourite.id)
        }
      } catch (error) {
        this.pushLog('warn', `Scenario server selection: ${(error as Error).message}`)
      }
    }

    this.pushLog(
      'success',
      `Scenario «${scenario.name}» applied · ${this.manager.adapter(chosen).name} · ${settings.routingMode} routing${
        connected ? ' · reconnect to use it' : ''
      }`
    )
    if (connected) this.pushLog('warn', 'Settings changed; the live tunnel still uses the previous configuration')
    if (previous.engine !== settings.engine) this.emitUpdate()
    this.emitUpdate()
  }

  saveScenario(scenario: Scenario): Scenario[] {
    this.store.saveScenario(scenario)
    this.pushLog('info', `Scenario saved · ${scenario.name}`)
    this.emitUpdate()
    return allScenarios(this.store.getScenarios())
  }

  removeScenario(id: string): Scenario[] {
    this.store.removeScenario(id)
    this.emitUpdate()
    return allScenarios(this.store.getScenarios())
  }

  getScenarios(): Scenario[] {
    return allScenarios(this.store.getScenarios())
  }

  /* ------------------------------------------------------------------ */
  /*  Diagnostics                                                       */
  /* ------------------------------------------------------------------ */

  async diagnose(): Promise<DiagnosticsResult> {
    const checks: DiagnosticCheck[] = []
    const settings = this.store.getSettings()
    const adapter = this.manager.adapter(this.engineId)
    const binary = this.manager.getPath(this.engineId)
    checks.push({
      id: 'core',
      label: `${adapter.name} binary`,
      status: binary ? 'pass' : 'fail',
      detail: binary ? binary : 'Not installed — connect once to download it'
    })
    checks.push({
      id: 'core-version',
      label: 'Engine version',
      status: this.manager.getVersion(this.engineId) ? 'pass' : 'warn',
      detail: this.manager.getVersion(this.engineId) ?? 'Version could not be read'
    })
    checks.push({
      id: 'config',
      label: 'Validated configuration',
      status: this.runtime.configPath && existsSync(this.runtime.configPath) ? 'pass' : 'skip',
      detail: this.runtime.configPath ?? 'No configuration generated yet'
    })

    if (settings.systemProxy && !settings.tunMode) {
      checks.push({
        id: 'proxy',
        label: 'System proxy',
        status: this.runtime.proxyApplied ? 'pass' : this.status === 'connected' ? 'warn' : 'skip',
        detail: this.runtime.proxyApplied
          ? 'Applications are pointed at 127.0.0.1'
          : this.status === 'connected'
            ? 'Enabled in settings but not applied to the OS'
            : 'Applied on the next connection'
      })
    }

    if (settings.tunMode) {
      checks.push({
        id: 'tun',
        label: 'TUN capture',
        status: adapter.supportsTun ? 'pass' : 'fail',
        detail: adapter.supportsTun
          ? `Supported by ${adapter.name}; needs an administrator session`
          : `${adapter.name} has no TUN implementation`
      })
    }

    if (settings.killSwitch || settings.networkProtection) {
      checks.push({
        id: 'kill-switch',
        label: 'Kill switch',
        status: this.killSwitchActive ? 'pass' : killSwitchSupported() ? 'warn' : 'fail',
        detail: this.killSwitchActive
          ? 'OS firewall policy is armed'
          : killSwitchSupported()
            ? 'Not armed (disconnected or elevation denied)'
            : 'No implementation for this platform'
      })
    }

    if (settings.dnsProtection || settings.networkProtection) {
      const stats = dnsGuardStats()
      checks.push({
        id: 'dns',
        label: 'DNS protection',
        status: this.dnsProtectionActive ? 'pass' : 'warn',
        detail: this.dnsProtectionActive
          ? `Local DoH relay active · ${stats.requests} queries · ${stats.failures} failures`
          : 'Relay not running; system DNS is unchanged'
      })
    }

    try {
      await lookup('example.com')
      checks.push({ id: 'resolve', label: 'DNS resolution', status: 'pass', detail: 'example.com resolved' })
    } catch (error) {
      checks.push({ id: 'resolve', label: 'DNS resolution', status: 'fail', detail: (error as Error).message })
    }

    if (this.status === 'connected') {
      checks.push({
        id: 'exit',
        label: 'Exit address',
        status: this.ip.exit ? 'pass' : 'fail',
        detail: this.ip.exit ? `${this.ip.exit.ip} · ${this.ip.exit.country}` : 'Tunnel did not return an address'
      })
      checks.push({
        id: 'latency',
        label: 'Latency',
        status: this.metrics.ping > 0 ? (this.metrics.ping < 200 ? 'pass' : 'warn') : 'warn',
        detail:
          this.metrics.ping > 0
            ? `${Math.round(this.metrics.ping)} ms · jitter ${Math.round(this.metrics.jitter)} ms`
            : 'No successful probe yet'
      })
      checks.push({
        id: 'loss',
        label: 'Packet loss',
        status: this.metrics.loss < 5 ? 'pass' : this.metrics.loss < 20 ? 'warn' : 'fail',
        detail: `${this.metrics.loss.toFixed(1)}% over the last ${this.runtime.probeWindow.length} probes`
      })
    }

    const stale = this.store
      .getSubscriptions()
      .filter(
        (subscription) =>
          !subscription.url.startsWith('eaglet://') &&
          Date.now() - subscription.updatedAt > settings.subscriptionIntervalHours * 60 * 60 * 1000
      )
    checks.push({
      id: 'subscriptions',
      label: 'Subscription freshness',
      status: stale.length === 0 ? 'pass' : 'warn',
      detail:
        stale.length === 0
          ? 'No stale HTTP subscriptions'
          : `${stale.length} subscription(s) older than ${settings.subscriptionIntervalHours}h`
    })

    const updates = this.engines.filter((engine) => engine.updateAvailable)
    if (updates.length > 0) {
      checks.push({
        id: 'updates',
        label: 'Engine updates',
        status: 'warn',
        detail: updates.map((engine) => `${engine.name} → ${engine.latestVersion}`).join(', ')
      })
    }

    checks.push({
      id: 'platform',
      label: 'Platform support',
      status: this.manager.platformSupport(this.engineId) === 'supported' ? 'pass' : 'warn',
      detail:
        this.manager.platformSupport(this.engineId) === 'supported'
          ? `${process.platform} · supported and tested path`
          : `${process.platform} · experimental, not part of the verified matrix`
    })

    const failed = checks.filter((check) => check.status === 'fail').length
    const warned = checks.filter((check) => check.status === 'warn').length
    return {
      at: now(),
      checks,
      summary:
        failed > 0
          ? `${failed} problem(s), ${warned} warning(s)`
          : warned > 0
            ? `Healthy with ${warned} warning(s)`
            : 'All checks passed'
    }
  }

  /** Public log helper used by the IPC layer for import/subscription events. */
  pushExternalLog(level: LogEntry['level'], message: string): void {
    this.pushLog(level, message)
    this.emitUpdate()
  }

  /** Renders the config for the currently selected profile without connecting. */
  buildExportConfig(): { engine: EngineId; content: string; extension: string } {
    const profile = this.activeProfile()
    if (!profile) throw new Error('Select a profile before exporting a configuration')
    const settings = this.store.getSettings()
    const choice = this.manager.choose(profile, settings)
    const content = this.manager.buildConfig(choice.id, {
      profile,
      settings,
      mixedPort: 2080,
      apiPort: 2081,
      auxPort: 2082,
      apiSecret: API_SECRET
    })
    const extension = this.manager.adapter(choice.id).configFileName.split('.').pop() ?? 'json'
    return { engine: choice.id, content, extension }
  }

  /**
   * Builds the native config for one engine and lets that engine validate it.
   * Used by the diagnostics UI and by the engine test harness; connecting is
   * not required, so a broken adapter is caught before the tunnel starts.
   */
  async validateEngineConfig(
    id: EngineId
  ): Promise<{ engine: EngineId; path: string | null; configPath: string | null; valid: boolean; detail: string }> {
    const profile = this.activeProfile()
    if (!profile) throw new Error('Select a profile before validating an engine configuration')
    const settings = this.store.getSettings()
    const binary = this.manager.getPath(id)
    if (!binary) {
      return { engine: id, path: null, configPath: null, valid: false, detail: 'not installed' }
    }
    if (!this.manager.supportsProfile(id, profile)) {
      return {
        engine: id,
        path: binary,
        configPath: null,
        valid: false,
        detail: `${this.manager.adapter(id).name} cannot carry this ${profile.protocol.toUpperCase()} profile`
      }
    }
    const content = this.manager.buildConfig(id, {
      profile,
      settings,
      mixedPort: 2080,
      apiPort: 2081,
      auxPort: 2082,
      apiSecret: API_SECRET
    })
    const adapter = this.manager.adapter(id)
    const configDir = join(app.getPath('userData'), 'core')
    mkdirSync(configDir, { recursive: true })
    const configPath = join(configDir, `validate-${adapter.configFileName}`)
    writeFileSync(configPath, content, 'utf-8')
    try {
      await this.manager.validate(id, binary, configPath)
      return { engine: id, path: binary, configPath, valid: true, detail: 'configuration accepted by the core' }
    } catch (error) {
      return {
        engine: id,
        path: binary,
        configPath,
        valid: false,
        detail: (error as Error).message
      }
    }
  }

  /**
   * Prepares TUN support without opening a tunnel. Used by diagnostics and the
   * engine harness so wintun.dll problems surface before a real connection.
   */
  async prepareTun(): Promise<{ engine: EngineId; path: string; wintun: string | null }> {
    if (process.platform !== 'win32') throw new Error('TUN preparation is only implemented on Windows')
    const profile = this.activeProfile()
    if (!profile) throw new Error('Select a profile before preparing TUN mode')
    const settings = { ...this.store.getSettings(), tunMode: true }
    const choice = this.manager.choose(profile, settings)
    if (!this.manager.adapter(choice.id).supportsTun) {
      throw new Error(`${this.manager.adapter(choice.id).name} does not support TUN`)
    }
    const binary = await this.prepareBinary(choice.id, profile, settings)
    const staged = await this.manager.ensureTun(choice.id, binary, (message) => {
      this.pushLog('info', message)
      this.emitUpdate()
    })
    const wintun = join(app.getPath('userData'), 'bin', 'wintun.dll')
    return { engine: choice.id, path: staged, wintun: existsSync(wintun) ? wintun : null }
  }

  /* ------------------------------------------------------------------ */
  /*  Logs                                                              */
  /* ------------------------------------------------------------------ */

  private onCoreLog(level: 'info' | 'warn' | 'error', message: string): void {
    this.pushLog(level, message)
    this.emitUpdate()
  }

  private pushLog(level: LogEntry['level'], message: string): void {
    this.logs.unshift({ id: this.logId++, time: now(), level, message })
    if (this.logs.length > LOG_LIMIT) this.logs.pop()
  }

  /* ------------------------------------------------------------------ */
  /*  Shutdown                                                          */
  /* ------------------------------------------------------------------ */

  async shutdown(): Promise<void> {
    this.runtime.userStop = true
    this.clearReconnectTimer()
    this.stopTelemetry()
    if (this.status === 'connected') this.finishSession()
    const proc = this.runtime.process
    this.runtime.process = null
    if (proc) {
      try {
        await proc.stop()
      } catch {
        // ignore
      }
    }
    if (this.runtime.proxyApplied || this.status === 'connected') {
      disableSystemProxySync()
      this.runtime.proxyApplied = false
    }
    if (this.runtime.killSwitchApplied) {
      disableKillSwitchSync()
      this.runtime.killSwitchApplied = false
      this.killSwitchActive = false
    }
    if (this.runtime.dnsGuardApplied) {
      stopDnsGuardSync()
      this.runtime.dnsGuardApplied = false
      this.dnsProtectionActive = false
    }
    this.core = { ...this.core, running: false }
    if (this.status !== 'disconnected') {
      this.status = 'disconnected'
      this.stage = null
      this.progress = 0
      this.connectedSince = null
    }
    this.usage = EMPTY_USAGE()
    this.emitUpdate()
  }

  private emitUpdate(): void {
    this.emit('state', this.getState())
  }
}
