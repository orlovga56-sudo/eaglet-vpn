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
import { t } from '../i18n'

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
  /** Core binary the armed kill-switch policy was built for. */
  protectedCorePath: string | null
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
  /** Last protection-layer failure, shown instead of pretending to be protected. */
  private protectionError: string | null = null
  private killSwitchError: string | null = null
  private dnsError: string | null = null
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
      protectedCorePath: null,
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
    this.pushLog('info', t('Eaglet engine ready · engine manager online'))
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
        ? t('{name} detected{version}', {
            name: adapter.name,
            version: this.core.version ? ` · ${this.core.version}` : ''
          })
        : t('{name} is not installed · it will be downloaded on first connect', { name: adapter.name })
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
      message: t('{name} installed', { name: this.manager.adapter(id).name })
    })
    this.emitUpdate()
    return this.engines
  }

  async removeEngine(id: EngineId): Promise<EngineState[]> {
    if (this.runtime.engine === id && this.isLive()) {
      throw new Error(t('Disconnect before removing the engine that is currently running'))
    }
    const removed = await this.manager.remove(id)
    if (!removed)
      throw new Error(t('{name} is not installed in the user data folder', { name: this.manager.adapter(id).name }))
    this.engines = this.manager.getStates(this.engineId, this.isLive())
    if (id === this.engineId) {
      this.engineId = this.manager.choose(this.activeProfile(), this.store.getSettings()).id
      this.syncCore()
    }
    this.pushLog('info', t('{name} removed', { name: this.manager.adapter(id).name }))
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
        ? t('Updates available: {list}', {
            list: updates.map((engine) => `${engine.name} ${engine.latestVersion}`).join(', ')
          })
        : t('All installed engines are up to date')
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
      this.pushLog('info', t('Engine set to {name}', { name: targetName }))
      this.emitUpdate()
      return settings
    }

    if (this.status !== 'connected' || this.runtime.transition) {
      this.pushLog('warn', t('{name} selected · it applies on the next connection', { name: targetName }))
      this.emitUpdate()
      return settings
    }

    if (this.runtime.engine === target) {
      this.pushLog('info', t('{name} is already running', { name: targetName }))
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
      throw new Error(t('Select a profile before switching engines'))
    }
    if (!this.manager.supportsProfile(target, profile)) {
      revertChoice()
      throw new Error(
        t('{name} cannot carry this {protocol} profile', {
          name: targetName,
          protocol: profile.protocol.toUpperCase()
        })
      )
    }
    if (settings.tunMode && !this.manager.adapter(target).supportsTun) {
      revertChoice()
      throw new Error(t('{name} does not support TUN mode', { name: targetName }))
    }

    try {
      await this.manager.ensure(target, (message) => {
        this.pushLog('info', message)
        this.emitUpdate()
      })
    } catch (error) {
      revertChoice()
      throw new Error(t('Could not install {name}: {error}', { name: targetName, error: (error as Error).message }))
    }

    const previousName = this.manager.adapter(previousEngine).name
    this.pushLog('info', t('Switching engine · {from} → {to}', { from: previousName, to: targetName }))
    this.forcedEngine = target
    try {
      // Keep the existing firewall/DNS policy armed while the new core starts.
      // Dropping it here would open a direct-traffic window between the two
      // engines; the policy is re-armed for the new binary by applyProtection.
      await this.disconnect({ keepProtection: true })
      await this.connect(undefined, false, true)
      if (this.status !== 'connected' || this.runtime.engine !== target) {
        throw new Error(this.error ?? t('{name} could not establish a tunnel', { name: targetName }))
      }
      this.pushLog('success', t('Engine switched to {name}', { name: targetName }))
    } catch (error) {
      const message = (error as Error).message
      this.pushLog('warn', t('Engine switch failed · {error} · rolling back to {name}', { error: message, name: previousName }))
      this.forcedEngine = previousEngine
      try {
        if (this.status === 'connected') await this.disconnect({ keepProtection: true })
        await this.connect(undefined, false, true)
        if (this.status === 'connected' && this.runtime.engine === previousEngine) {
          this.pushLog('info', t('Rolled back to {name}', { name: previousName }))
        } else {
          this.pushLog('error', t('Rollback failed: {error}', { error: this.error ?? t('unknown error') }))
        }
      } catch (rollbackError) {
        this.pushLog('error', t('Rollback failed: {error}', { error: (rollbackError as Error).message }))
      }
      revertChoice()
      throw new Error(t('Could not switch to {name}: {error}', { name: targetName, error: message }))
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
          t('{name} cannot carry {protocol} · Eaglet will fall back to a compatible core', {
            name: this.manager.adapter(engine).name,
            protocol: profile.protocol.toUpperCase()
          })
        )
      } else {
        this.pushLog(
          'info',
          engine
            ? t('{name} pinned to {engine}', {
                name: profile.name,
                engine: this.manager.adapter(engine).name
              })
            : t('{name} follows the global engine', { name: profile.name })
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
      protection: this.protectionState(),
      comparison: this.compareEngines()
    }
  }

  /**
   * Honest protection status for the UI. A requested layer is never reported as
   * active just because the tunnel is up.
   */
  private protectionState(): VpnState['protection'] {
    const settings = this.store.getSettings()
    const profile = this.activeProfile()
    const wantKill = settings.killSwitch || settings.networkProtection
    const wantDns = settings.dnsProtection || settings.networkProtection
    const killSwitch: VpnState['protection']['killSwitch'] = !wantKill
      ? 'off'
      : profile?.protocol === 'direct' || !killSwitchSupported()
        ? 'unsupported'
        : this.runtime.killSwitchApplied && this.killSwitchActive
          ? 'active'
          : this.killSwitchError
            ? 'error'
            : 'off'
    const dns: VpnState['protection']['dns'] = !wantDns
      ? 'off'
      : this.runtime.dnsGuardApplied && this.dnsProtectionActive
        ? 'active'
        : this.dnsError
          ? 'error'
          : 'off'
    return { killSwitch, dns, error: this.protectionError }
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
      this.pushLog('warn', t('Disconnect before switching to another profile'))
      this.emitUpdate()
      return
    }
    const profile = this.store.getProfile(id)
    if (!profile) return
    this.profileId = id
    this.store.updateSettings({ activeProfileId: id })
    this.engineId = this.manager.choose(profile, this.store.getSettings()).id
    this.syncCore()
    this.pushLog(
      'info',
      t('Selected {name} · {protocol} · {engine}', {
        name: profile.name,
        protocol: profile.protocol.toUpperCase(),
        engine: this.manager.adapter(this.engineId).name
      })
    )
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

  async connect(id?: string, automatic = false, keepProtection = false): Promise<void> {
    if (this.runtime.transition) return
    if (!automatic) {
      this.runtime.reconnectAttempts = 0
      this.runtime.userStop = false
      this.clearReconnectTimer()
    }
    if (this.status === 'connected' || this.status === 'connecting') {
      if (id && id !== this.profileId) this.pushLog('warn', t('Disconnect before switching to another node'))
      return
    }
    if (id) {
      this.profileId = id
      this.store.updateSettings({ activeProfileId: id })
    }

    const profile = this.activeProfile()
    if (!profile) {
      this.error = t('No profile selected. Import a subscription or a share link first.')
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
      keepProtection ||
      (automatic &&
        (settings.killSwitch || settings.networkProtection) &&
        (this.runtime.killSwitchApplied || this.runtime.dnsGuardApplied))
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
        t('{name} cannot carry this profile · using {other}', {
          name: this.manager.adapter(preference).name,
          other: this.manager.adapter(choice.id).name
        })
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
    this.pushLog(
      'info',
      t('Connecting · {name} · {protocol}', { name: profile.name, protocol: profile.protocol.toUpperCase() })
    )
    this.setStage(t('Preparing profile'), 0.06)

    try {
      // 1. Make sure the IP probe runs before the system proxy is switched on.
      if (!this.ip.direct) await this.refreshDirectIp()

      // 2. Make sure the chosen core is present.
      this.setStage(t('Loading {name} core', { name: this.manager.adapter(choice.id).name }), 0.16)
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
      this.pushLog(
        'info',
        t('Core: {name}{version}', {
          name: adapter.name,
          version: this.core.version ? ` ${this.core.version}` : ''
        })
      )

      // 3. Build + validate the native config.
      this.setStage(t('Building core configuration'), 0.3)
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
      this.pushLog('success', t('{name} configuration validated', { name: adapter.name }))

      // 4. Spawn the tunnel.
      this.setStage(t('Starting encrypted tunnel'), 0.48)
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
      this.setStage(t('Verifying exit route'), 0.72)
      const exit = await this.probeExit(mixedPort, 3)
      if (!exit) throw new Error(t('The tunnel did not respond. Check the profile and try again.'))
      const direct = this.ip.direct
      const changed = Boolean(direct && direct.ip !== exit.ip)
      this.ip = { direct, exit, checking: false, changed, checkedAt: now() }
      this.pushLog(
        'success',
        changed
          ? t('Exit IP changed · {from} → {to}', { from: direct?.ip ?? '', to: exit.ip })
          : t('Tunnel live · exit IP {ip}', { ip: exit.ip })
      )

      // 6. System routing, then protection layers.
      this.setStage(t('Applying system routing'), 0.9)
      if (settings.systemProxy && !settings.tunMode) {
        try {
          await enableSystemProxy(mixedPort)
          runtime.proxyApplied = true
          this.pushLog('info', t('System proxy routed through Eaglet ({platform})', { platform: process.platform }))
        } catch (error) {
          this.pushLog('warn', t('System proxy not applied: {error}', { error: (error as Error).message }))
        }
      } else if (settings.tunMode) {
        this.pushLog('info', t('TUN mode active · traffic captured at the adapter level'))
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

      // applyProtection throws when a requested layer cannot be armed, so a
      // session only reaches this point when the protection really is live.
      if ((settings.killSwitch || settings.networkProtection) && !this.killSwitchActive) {
        throw new Error(
          t('Kill switch was enabled but could not be armed · connection aborted to avoid a leak')
        )
      }
      if ((settings.dnsProtection || settings.networkProtection) && !this.dnsProtectionActive) {
        throw new Error(
          t('DNS protection was enabled but the relay did not start · connection aborted to avoid a leak')
        )
      }

      this.status = 'connected'
      this.connectedSince = now()
      this.sessionSaved = false
      this.stage = null
      this.progress = 1
      this.pushLog(
        'success',
        t('Tunnel established · {name} · {engine}', { name: profile.name, engine: adapter.name })
      )
      this.startTelemetry()
      void this.sampleUsage()
    } catch (error) {
      const message = (error as Error).message || t('Unknown connection error')
      this.pushLog('error', message)
      this.error = message
      await this.teardown(preserveProtection)
      if (this.protectionError) this.error = this.protectionError
      if (preserveProtection) {
        this.pushLog('warn', t('Kill switch stays armed · direct traffic is still blocked'))
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
      this.pushLog(
        'warn',
        t('Could not install {name}: {error}', {
          name: this.manager.adapter(id).name,
          error: (error as Error).message
        })
      )
      const fallback = (['sing-box', 'mihomo', 'xray'] as EngineId[]).find(
        (candidate) =>
          this.manager.getPath(candidate) &&
          this.manager.supportsProfile(candidate, profile) &&
          (!settings.tunMode || this.manager.adapter(candidate).supportsTun)
      )
      if (!fallback) throw error
      this.pushLog('warn', t('Falling back to {name}', { name: this.manager.adapter(fallback).name }))
      this.runtime.engine = fallback
      const path = this.manager.getPath(fallback)
      if (!path) throw error
      return path
    }
  }

  /**
   * Arms the requested protection layers. Throws when the user asked for
   * protection that cannot be provided: the caller then tears the tunnel down
   * instead of presenting an unprotected session as a secure one.
   */
  private async applyProtection(profile: Profile, binary: string, settings: Settings): Promise<void> {
    this.protectionError = null
    this.killSwitchError = null
    this.dnsError = null

    if (settings.killSwitch || settings.networkProtection) {
      if (profile.protocol === 'direct') {
        this.killSwitchError = t(
          'Kill switch cannot protect a direct profile. Choose a tunnel profile or turn protection off.'
        )
        this.protectionError = this.killSwitchError
        throw new Error(this.killSwitchError)
      }
      if (!killSwitchSupported()) {
        this.killSwitchError = t(
          'Kill switch is not supported on this platform. Turn protection off or use a supported OS.'
        )
        this.protectionError = this.killSwitchError
        throw new Error(this.killSwitchError)
      }

      if (this.runtime.killSwitchApplied && this.runtime.protectedCorePath === binary) {
        // The policy survived a reconnect and already permits this exact core
        // and node. Re-arming would be redundant, not unsafe.
        this.pushLog('info', t('Kill switch already armed for this node · policy kept'))
      } else {
        try {
          const subscriptionUrls = this.store
            .getSubscriptions()
            .map((subscription) => subscription.url)
            .filter((url) => /^https?:\/\//i.test(url))
          const ips = await enableKillSwitch(profile, binary, settings, subscriptionUrls)
          this.runtime.killSwitchApplied = true
          this.runtime.protectedCorePath = binary
          this.killSwitchActive = true
          this.pushLog(
            'success',
            t('Kill switch armed · whitelisted {targets}', {
              targets: ips.length > 0 ? ips.join(', ') : t('loopback and Eaglet only')
            })
          )
        } catch (error) {
          this.killSwitchError = (error as Error).message
          this.protectionError = t('Kill switch could not be armed: {error}', {
            error: this.killSwitchError
          })
          this.pushLog('error', this.protectionError)
          throw new Error(this.protectionError)
        }
      }
    }

    if (settings.dnsProtection || settings.networkProtection) {
      try {
        await startDnsGuard(settings)
        this.runtime.dnsGuardApplied = true
        this.dnsProtectionActive = true
        const stats = dnsGuardStats()
        this.pushLog(
          'success',
          t('DNS protection active · DoH relay {endpoint}', {
            endpoint: stats.endpoint ?? t('configured')
          })
        )
      } catch (error) {
        const stats = dnsGuardStats()
        // A relay that is still listening (and still owns the system resolver)
        // is an active DNS layer with a pending restore, not a disabled one.
        this.runtime.dnsGuardApplied = Boolean(stats.endpoint)
        this.dnsProtectionActive = Boolean(stats.endpoint)
        this.dnsError = (error as Error).message
        this.protectionError = t('DNS protection could not start: {error}', { error: this.dnsError })
        this.pushLog('error', this.protectionError)
        throw new Error(this.protectionError)
      }
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
        this.runtime.killSwitchApplied = false
        this.runtime.protectedCorePath = null
        this.killSwitchActive = false
      } catch (error) {
        // A policy that could not be removed stays armed; the new session will
        // reuse it instead of asserting that the machine is unprotected.
        this.killSwitchError = (error as Error).message
        this.protectionError = t('The previous kill-switch policy could not be removed: {error}', {
          error: this.killSwitchError
        })
        this.pushLog('error', this.protectionError)
      }
    }
    if (this.runtime.dnsGuardApplied) {
      try {
        await stopDnsGuard()
        this.runtime.dnsGuardApplied = false
        this.dnsProtectionActive = false
      } catch (error) {
        // The relay is deliberately kept alive when the resolver cannot be
        // restored, so the layer is still active, just not removable.
        this.dnsError = (error as Error).message
        this.dnsProtectionActive = true
        this.protectionError = this.dnsError
        this.pushLog('error', this.dnsError)
      }
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

  async disconnect(options: { keepProtection?: boolean } = {}): Promise<void> {
    if (this.runtime.transition) return
    if (this.status === 'disconnected' || this.status === 'disconnecting') return
    const keepProtection = options.keepProtection === true
    this.runtime.userStop = true
    this.clearReconnectTimer()
    this.runtime.transition = true
    this.status = 'disconnecting'
    this.stage = t('Closing tunnel')
    this.progress = 0.5
    this.pushLog('info', t('Closing the encrypted tunnel'))
    this.emitUpdate()

    this.protectionError = null
    await this.teardown(keepProtection)
    this.finishSession()

    this.connectedSince = null
    this.metrics = EMPTY_METRICS()
    this.history = []
    this.usage = EMPTY_USAGE()
    this.stage = null
    this.progress = 0

    if (this.protectionError) {
      // The tunnel is down but a layer could not be removed. Report an error
      // instead of claiming that direct access was restored.
      this.status = 'error'
      this.error = this.protectionError
      this.pushLog('error', this.protectionError)
    } else {
      this.status = 'disconnected'
      this.error = null
      this.pushLog(
        'info',
        keepProtection && (this.runtime.killSwitchApplied || this.runtime.dnsGuardApplied)
          ? t('Tunnel closed · protection stays armed until the switch completes')
          : t('Disconnected · direct connection restored')
      )
    }
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
        this.pushLog('warn', t('Could not restore the system proxy: {error}', { error: (error as Error).message }))
      }
      this.runtime.proxyApplied = false
    }

    if (!keepProtection) {
      if (this.runtime.killSwitchApplied) {
        try {
          await disableKillSwitch()
          this.runtime.killSwitchApplied = false
          this.runtime.protectedCorePath = null
          this.killSwitchActive = false
        } catch (error) {
          // Keep the flags: the policy is still armed (or half restored) and
          // the UI must not pretend the machine is back to direct access.
          this.killSwitchError = (error as Error).message
          this.protectionError = t('Could not remove the kill switch: {error}', {
            error: this.killSwitchError
          })
          this.pushLog('error', this.protectionError)
        }
      }
      if (this.runtime.dnsGuardApplied) {
        try {
          await stopDnsGuard()
          this.runtime.dnsGuardApplied = false
          this.dnsProtectionActive = false
        } catch (error) {
          // The relay stays up on purpose when the resolver cannot be restored.
          this.dnsError = (error as Error).message
          this.dnsProtectionActive = true
          this.protectionError = this.dnsError
          this.pushLog('error', this.dnsError)
        }
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
        this.pushLog('warn', t('Kill switch active · system proxy kept to block traffic'))
      } else {
        this.runtime.proxyApplied = false
        void disableSystemProxy()
      }
    }
    if (this.runtime.killSwitchApplied) {
      this.pushLog('warn', t('Kill switch stays armed until the tunnel is restored'))
    }
    if (this.runtime.dnsGuardApplied) {
      this.pushLog('warn', t('DNS protection stays active while reconnecting'))
    }
    const message = t('Core stopped unexpectedly (exit {code})', { code: code ?? t('unknown') })
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
      profileName: profile?.name ?? t('Unknown node'),
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
      this.pushLog('error', t('Auto-reconnect gave up after 3 attempts'))
      if (this.runtime.killSwitchApplied || this.runtime.dnsGuardApplied) {
        this.pushLog(
          'warn',
          t('Protection stays armed after the failed reconnects · disconnect to restore direct access')
        )
      }
      this.emitUpdate()
      return
    }

    this.runtime.reconnectAttempts += 1
    const attempt = this.runtime.reconnectAttempts
    const delay = attempt * 2500
    this.pushLog(
      'warn',
      t('Auto-reconnect {attempt}/3 in {seconds}s', { attempt, seconds: Math.round(delay / 1000) })
    )
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
          this.pushLog('success', t('Auto-reconnect restored the tunnel'))
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
      this.pushLog(
        'info',
        t('IP check · direct {direct} · exit {exit}', {
          direct: this.ip.direct?.ip ?? t('unknown'),
          exit: exit?.ip ?? t('unknown')
        })
      )
    } catch (error) {
      this.pushLog('warn', t('IP check failed: {error}', { error: (error as Error).message }))
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
        t('Latency tests are unavailable while the kill switch is armed — disconnect to measure nodes')
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
      geo.size > 0
        ? t('Latency test finished · {count} profiles · {located} located', {
            count: targets.length,
            located: geo.size
          })
        : t('Latency test finished · {count} profiles', { count: targets.length })
    )
    this.emitUpdate()
    return this.store.getProfiles()
  }

  /** Pings a bounded sample and returns the fastest node. */
  async pickFastestProfile(): Promise<Profile> {
    const profiles = this.store.getProfiles().filter((profile) => profile.protocol !== 'direct' && profile.port > 0)
    if (profiles.length === 0) {
      throw new Error(t('No nodes yet — import a subscription or find free servers first'))
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
          t('Session healthy · {ping} ms · {connections} connections · {loss}% loss', {
            ping: Math.round(this.metrics.ping),
            connections: this.metrics.connections,
            loss: this.metrics.loss.toFixed(1)
          })
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
      throw new Error(t('Connect to a tunnel before running a speed test'))
    }
    this.pushLog('info', t('Speed test · downloading 10 MB through the tunnel'))
    this.emitUpdate()
    const { bytes, seconds } = await downloadThroughput(this.runtime.mixedPort)
    const mbps = Math.round(((bytes * 8) / seconds / 1_000_000) * 10) / 10
    this.pushLog(
      'success',
      t('Speed test · {mbps} Mbps · {size} MB in {seconds}s', {
        mbps,
        size: (bytes / 1_000_000).toFixed(1),
        seconds: seconds.toFixed(1)
      })
    )
    this.emitUpdate()
    return { mbps, bytes, seconds: Math.round(seconds * 100) / 100, at: now() }
  }

  /** Toggles the system proxy while a tunnel is already live. */
  async setSystemProxy(enabled: boolean): Promise<void> {
    if (this.status !== 'connected' || !this.runtime.mixedPort) {
      this.pushLog(
        'info',
        t('System proxy {state} for the next session', {
          state: enabled ? t('enabled') : t('disabled')
        })
      )
      this.emitUpdate()
      return
    }
    try {
      if (enabled && !this.runtime.proxyApplied) {
        await enableSystemProxy(this.runtime.mixedPort)
        this.runtime.proxyApplied = true
        this.pushLog('success', t('System proxy enabled'))
      } else if (!enabled && this.runtime.proxyApplied) {
        await disableSystemProxy()
        this.runtime.proxyApplied = false
        this.pushLog('info', t('System proxy disabled · apps go direct'))
      }
    } catch (error) {
      this.pushLog('error', t('System proxy change failed: {error}', { error: (error as Error).message }))
    }
    this.emitUpdate()
  }

  /* ------------------------------------------------------------------ */
  /*  Scenarios                                                         */
  /* ------------------------------------------------------------------ */

  async applyScenario(id: string): Promise<void> {
    const scenario = allScenarios(this.store.getScenarios()).find((item) => item.id === id)
    if (!scenario) throw new Error(t('Scenario not found'))
    const connected = this.isLive()
    const previous = this.store.getSettings()
    this.store.updateSettings({ ...scenario.settings, engine: scenario.engine })
    this.store.addProfileEvent({
      id: `${now()}-scenario-${id}`,
      at: now(),
      kind: 'scenario',
      message: t('Scenario applied: {name}', { name: scenario.name })
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
        this.pushLog('warn', t('Scenario server selection: {error}', { error: (error as Error).message }))
      }
    }

    const modeLabel = t(
      settings.routingMode === 'global'
        ? 'Global'
        : settings.routingMode === 'smart'
          ? 'Smart'
          : 'Direct'
    )
    this.pushLog(
      'success',
      connected
        ? t('Scenario «{name}» applied · {engine} · {mode} routing · reconnect to use it', {
            name: scenario.name,
            engine: this.manager.adapter(chosen).name,
            mode: modeLabel
          })
        : t('Scenario «{name}» applied · {engine} · {mode} routing', {
            name: scenario.name,
            engine: this.manager.adapter(chosen).name,
            mode: modeLabel
          })
    )
    if (connected) this.pushLog('warn', t('Settings changed; the live tunnel still uses the previous configuration'))
    if (previous.engine !== settings.engine) this.emitUpdate()
    this.emitUpdate()
  }

  saveScenario(scenario: Scenario): Scenario[] {
    this.store.saveScenario(scenario)
    this.pushLog('info', t('Scenario saved · {name}', { name: scenario.name }))
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
      label: t('{name} binary', { name: adapter.name }),
      status: binary ? 'pass' : 'fail',
      detail: binary ? binary : t('Not installed — connect once to download it')
    })
    checks.push({
      id: 'core-version',
      label: t('Engine version'),
      status: this.manager.getVersion(this.engineId) ? 'pass' : 'warn',
      detail: this.manager.getVersion(this.engineId) ?? t('Version could not be read')
    })
    checks.push({
      id: 'config',
      label: t('Validated configuration'),
      status: this.runtime.configPath && existsSync(this.runtime.configPath) ? 'pass' : 'skip',
      detail: this.runtime.configPath ?? t('No configuration generated yet')
    })

    if (settings.systemProxy && !settings.tunMode) {
      checks.push({
        id: 'proxy',
        label: t('System proxy'),
        status: this.runtime.proxyApplied ? 'pass' : this.status === 'connected' ? 'warn' : 'skip',
        detail: this.runtime.proxyApplied
          ? t('Applications are pointed at 127.0.0.1')
          : this.status === 'connected'
            ? t('Enabled in settings but not applied to the OS')
            : t('Applied on the next connection')
      })
    }

    if (settings.tunMode) {
      checks.push({
        id: 'tun',
        label: t('TUN capture'),
        status: adapter.supportsTun ? 'pass' : 'fail',
        detail: adapter.supportsTun
          ? t('Supported by {name}; needs an administrator session', { name: adapter.name })
          : t('{name} has no TUN implementation', { name: adapter.name })
      })
    }

    if (settings.killSwitch || settings.networkProtection) {
      checks.push({
        id: 'kill-switch',
        label: t('Kill switch'),
        status: this.killSwitchActive ? 'pass' : killSwitchSupported() ? 'warn' : 'fail',
        detail: this.killSwitchActive
          ? t('OS firewall policy is armed')
          : killSwitchSupported()
            ? t('Not armed (disconnected or elevation denied)')
            : t('No implementation for this platform')
      })
    }

    if (settings.dnsProtection || settings.networkProtection) {
      const stats = dnsGuardStats()
      checks.push({
        id: 'dns',
        label: t('DNS protection'),
        status: this.dnsProtectionActive ? 'pass' : 'warn',
        detail: this.dnsProtectionActive
          ? t('Local DoH relay active · {queries} queries · {failures} failures', {
              queries: stats.requests,
              failures: stats.failures
            })
          : t('Relay not running; system DNS is unchanged')
      })
    }

    try {
      await lookup('example.com')
      checks.push({
        id: 'resolve',
        label: t('DNS resolution'),
        status: 'pass',
        detail: t('example.com resolved')
      })
    } catch (error) {
      checks.push({
        id: 'resolve',
        label: t('DNS resolution'),
        status: 'fail',
        detail: (error as Error).message
      })
    }

    if (this.status === 'connected') {
      checks.push({
        id: 'exit',
        label: t('Exit address'),
        status: this.ip.exit ? 'pass' : 'fail',
        detail: this.ip.exit
          ? `${this.ip.exit.ip} · ${this.ip.exit.country}`
          : t('Tunnel did not return an address')
      })
      checks.push({
        id: 'latency',
        label: t('Latency'),
        status: this.metrics.ping > 0 ? (this.metrics.ping < 200 ? 'pass' : 'warn') : 'warn',
        detail:
          this.metrics.ping > 0
            ? t('{ping} ms · jitter {jitter} ms', {
                ping: Math.round(this.metrics.ping),
                jitter: Math.round(this.metrics.jitter)
              })
            : t('No successful probe yet')
      })
      checks.push({
        id: 'loss',
        label: t('Packet loss'),
        status: this.metrics.loss < 5 ? 'pass' : this.metrics.loss < 20 ? 'warn' : 'fail',
        detail: t('{loss}% over the last {count} probes', {
          loss: this.metrics.loss.toFixed(1),
          count: this.runtime.probeWindow.length
        })
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
      label: t('Subscription freshness'),
      status: stale.length === 0 ? 'pass' : 'warn',
      detail:
        stale.length === 0
          ? t('No stale HTTP subscriptions')
          : t('{count} subscription(s) older than {hours}h', {
              count: stale.length,
              hours: settings.subscriptionIntervalHours
            })
    })

    const updates = this.engines.filter((engine) => engine.updateAvailable)
    if (updates.length > 0) {
      checks.push({
        id: 'updates',
        label: t('Engine updates'),
        status: 'warn',
        detail: updates.map((engine) => `${engine.name} → ${engine.latestVersion}`).join(', ')
      })
    }

    checks.push({
      id: 'platform',
      label: t('Platform support'),
      status: this.manager.platformSupport(this.engineId) === 'supported' ? 'pass' : 'warn',
      detail:
        this.manager.platformSupport(this.engineId) === 'supported'
          ? t('{platform} · supported and tested path', { platform: process.platform })
          : t('{platform} · experimental, not part of the verified matrix', {
              platform: process.platform
            })
    })

    const failed = checks.filter((check) => check.status === 'fail').length
    const warned = checks.filter((check) => check.status === 'warn').length
    return {
      at: now(),
      checks,
      summary:
        failed > 0
          ? t('{failed} problem(s), {warned} warning(s)', { failed, warned })
          : warned > 0
            ? t('Healthy with {count} warning(s)', { count: warned })
            : t('All checks passed')
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
    if (!profile) throw new Error(t('Select a profile before exporting a configuration'))
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
    if (!profile) throw new Error(t('Select a profile before validating an engine configuration'))
    const settings = this.store.getSettings()
    const binary = this.manager.getPath(id)
    if (!binary) {
      return { engine: id, path: null, configPath: null, valid: false, detail: t('not installed') }
    }
    if (!this.manager.supportsProfile(id, profile)) {
      return {
        engine: id,
        path: binary,
        configPath: null,
        valid: false,
        detail: t('{name} cannot carry this {protocol} profile', {
          name: this.manager.adapter(id).name,
          protocol: profile.protocol.toUpperCase()
        })
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
      return { engine: id, path: binary, configPath, valid: true, detail: t('configuration accepted by the core') }
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
    if (process.platform !== 'win32') throw new Error(t('TUN preparation is only implemented on Windows'))
    const profile = this.activeProfile()
    if (!profile) throw new Error(t('Select a profile before preparing TUN mode'))
    const settings = { ...this.store.getSettings(), tunMode: true }
    const choice = this.manager.choose(profile, settings)
    if (!this.manager.adapter(choice.id).supportsTun) {
      throw new Error(t('{name} does not support TUN', { name: this.manager.adapter(choice.id).name }))
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
