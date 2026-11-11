import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  CoreState,
  HistoryPoint,
  IpInfo,
  IpState,
  LogEntry,
  Metrics,
  Profile,
  SessionRecord,
  SpeedTestResult,
  VpnState,
  VpnStatus
} from '@shared/types'
import { Store } from '../store'
import {
  buildConfig,
  clashStats,
  coreVersion,
  directIp,
  downloadThroughput,
  findCore,
  freePort,
  installCore,
  measurePing,
  proxiedIp,
  startCore,
  tcpPing,
  validateConfig,
  waitForPort,
  type ClashStats,
  type CoreProcess
} from './singbox'
import { disableSystemProxy, disableSystemProxySync, enableSystemProxy, recoverStaleProxy } from './system-proxy'

const HISTORY_LIMIT = 60
const LOG_LIMIT = 120
const API_SECRET = 'eaglet-local-api'

const EMPTY_METRICS = (): Metrics => ({
  ping: 0,
  down: 0,
  up: 0,
  downTotal: 0,
  upTotal: 0,
  sessionSeconds: 0,
  connections: 0
})

const EMPTY_IP = (): IpState => ({ direct: null, exit: null, checking: false, changed: false, checkedAt: null })

interface Runtime {
  process: CoreProcess | null
  mixedPort: number
  apiPort: number
  configPath: string | null
  baseline: ClashStats
  lastStats: ClashStats
  proxyApplied: boolean
  tickTimer: NodeJS.Timeout | null
  pingTimer: NodeJS.Timeout | null
  reconnectTimer: NodeJS.Timeout | null
  transition: boolean
  tickBusy: boolean
  /** Incremented on every unexpected drop; reset by a manual connect. */
  reconnectAttempts: number
  /** True after the user explicitly disconnects, so we don't fight them. */
  userStop: boolean
}

function now(): number {
  return Date.now()
}

/**
 * Real tunnel engine built on the sing-box core.
 *
 * The engine owns the state machine, generates a core config from the selected
 * profile, spawns the core, routes Windows traffic through the local mixed
 * inbound and streams live telemetry from the Clash API. It also measures the
 * real exit IP before and after connecting so the UI can prove the address
 * actually changed.
 */
export class VpnEngine extends EventEmitter {
  private store: Store
  private status: VpnStatus = 'disconnected'
  private profileId: string | null
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

  constructor(store: Store) {
    super()
    this.store = store
    this.profileId = store.getSettings().activeProfileId
    this.runtime = {
      process: null,
      mixedPort: 0,
      apiPort: 0,
      configPath: null,
      baseline: { downTotal: 0, upTotal: 0, connections: 0 },
      lastStats: { downTotal: 0, upTotal: 0, connections: 0 },
      proxyApplied: false,
      tickTimer: null,
      pingTimer: null,
      reconnectTimer: null,
      transition: false,
      tickBusy: false,
      reconnectAttempts: 0,
      userStop: false
    }
    this.pushLog('info', 'Eaglet engine ready · sing-box backend')
  }

  /* ------------------------------------------------------------------ */
  /*  Boot                                                              */
  /* ------------------------------------------------------------------ */

  async init(): Promise<void> {
    recoverStaleProxy()
    const binary = findCore()
    if (binary) {
      const version = await coreVersion(binary)
      this.core = { available: true, running: false, version, path: binary }
      this.pushLog('success', `Core detected${version ? ` · sing-box ${version}` : ''}`)
    } else {
      this.core = { available: false, running: false, version: null, path: null }
      this.pushLog('warn', 'sing-box core not found · it will be downloaded on first connect')
    }
    this.emitUpdate()
    void this.refreshDirectIp()
  }

  /** Resolves the core binary, downloading it if the app was built without it. */
  async ensureCore(): Promise<string> {
    let binary = findCore()
    if (!binary) {
      try {
        binary = await installCore((message) => {
          this.pushLog('info', message)
          this.emitUpdate()
        })
      } catch (error) {
        throw new Error(
          `Unable to install the sing-box core: ${(error as Error).message}. ` +
            'Place sing-box.exe into resources/bin or connect to the internet.'
        )
      }
    }
    const version = await coreVersion(binary)
    this.core = { available: true, running: false, version, path: binary }
    return binary
  }

  async refreshCore(): Promise<CoreState> {
    const binary = findCore()
    if (binary) {
      const version = await coreVersion(binary)
      this.core = { available: true, running: this.core.running, version, path: binary }
    } else {
      this.core = { available: false, running: false, version: null, path: null }
    }
    this.emitUpdate()
    return this.core
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
      core: { ...this.core }
    }
  }

  getProfileId(): string | null {
    return this.profileId
  }

  private activeProfile(): Profile | null {
    if (!this.profileId) return null
    return this.store.getProfile(this.profileId)
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
    this.pushLog('info', `Selected ${profile.name} · ${profile.protocol.toUpperCase()}`)
    this.emitUpdate()
  }

  setProfile(id: string | null): void {
    this.profileId = id
    this.store.updateSettings({ activeProfileId: id })
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

    this.runtime.transition = true
    this.status = 'connecting'
    this.error = null
    this.connectedSince = null
    this.metrics = EMPTY_METRICS()
    this.history = []
    this.ip = { ...this.ip, exit: null, checking: false, changed: false }
    this.pushLog('info', `Connecting · ${profile.name} · ${profile.protocol.toUpperCase()}`)
    this.setStage('Preparing profile', 0.06)

    try {
      // 1. Make sure the IP probe runs before the system proxy is switched on.
      if (!this.ip.direct) await this.refreshDirectIp()

      // 2. Core discovery.
      this.setStage('Loading sing-box core', 0.16)
      const binary = await this.ensureCore()
      this.pushLog('info', `Core: ${this.core.version ?? 'sing-box'}`)

      // 3. Build + validate the config.
      this.setStage('Building core configuration', 0.3)
      const mixedPort = await freePort(2080)
      const apiPort = await freePort(mixedPort + 1)
      const config = buildConfig(profile, this.store.getSettings(), mixedPort, apiPort, API_SECRET)
      const configDir = join(app.getPath('userData'), 'core')
      mkdirSync(configDir, { recursive: true })
      const configPath = join(configDir, 'config.json')
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
      await validateConfig(binary, configPath)
      this.pushLog('success', 'Core configuration validated')

      // 4. Spawn the tunnel.
      this.setStage('Starting encrypted tunnel', 0.48)
      const runtime = this.runtime
      runtime.mixedPort = mixedPort
      runtime.apiPort = apiPort
      runtime.configPath = configPath
      runtime.baseline = { downTotal: 0, upTotal: 0, connections: 0 }
      runtime.lastStats = { downTotal: 0, upTotal: 0, connections: 0 }
      runtime.proxyApplied = false

      runtime.process = startCore(
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
      if (!exit) {
        throw new Error('The tunnel did not respond. Check the profile and try again.')
      }
      const direct = this.ip.direct
      const changed = Boolean(direct && direct.ip !== exit.ip)
      this.ip = {
        direct,
        exit,
        checking: false,
        changed,
        checkedAt: now()
      }
      this.pushLog(
        'success',
        changed ? `Exit IP changed · ${direct?.ip} → ${exit.ip}` : `Tunnel live · exit IP ${exit.ip}`
      )

      // 6. Global system routing.
      this.setStage('Applying system routing', 0.9)
      const settings = this.store.getSettings()
      if (settings.systemProxy && !settings.tunMode) {
        await enableSystemProxy(mixedPort)
        runtime.proxyApplied = true
        this.pushLog('info', 'Windows system proxy routed through Eaglet')
      } else if (settings.tunMode) {
        this.pushLog('info', 'TUN mode active · traffic captured at the adapter level')
      }

      this.status = 'connected'
      this.connectedSince = now()
      this.sessionSaved = false
      this.stage = null
      this.progress = 1
      this.pushLog('success', `Tunnel established · ${profile.name}`)
      this.startTelemetry()
    } catch (error) {
      const message = (error as Error).message || 'Unknown connection error'
      this.pushLog('error', message)
      this.error = message
      await this.teardown()
      this.status = 'error'
      this.stage = null
      this.progress = 0
    } finally {
      this.runtime.transition = false
      this.emitUpdate()
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

    await this.teardown()
    this.finishSession()

    this.status = 'disconnected'
    this.stage = null
    this.progress = 0
    this.connectedSince = null
    this.metrics = EMPTY_METRICS()
    this.history = []
    this.error = null
    this.pushLog('info', 'Disconnected · direct connection restored')
    this.runtime.transition = false
    this.emitUpdate()
  }

  private async teardown(): Promise<void> {
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

    this.core = { ...this.core, running: false }
  }

  /** Crash / unexpected core exit. */
  private onCoreExit(code: number | null): void {
    if (!this.runtime.process && this.status !== 'connected') return
    this.runtime.process = null
    this.core = { ...this.core, running: false }
    this.stopTelemetry()
    if (this.runtime.proxyApplied) {
      if (this.store.getSettings().killSwitch) {
        // Leave the dead proxy in place so traffic cannot leak around the tunnel.
        this.pushLog('warn', 'Kill switch active · system proxy kept to block traffic')
      } else {
        this.runtime.proxyApplied = false
        void disableSystemProxy()
      }
    }
    const message = `Core stopped unexpectedly (exit ${code ?? 'unknown'})`
    this.pushLog('error', message)
    this.status = 'error'
    this.error = message
    this.stage = null
    this.progress = 0
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
    this.store.addSession({
      id: `${this.connectedSince}-${this.profileId ?? 'none'}`,
      profileName: profile?.name ?? 'Unknown node',
      protocol: profile?.protocol ?? 'direct',
      startedAt: this.connectedSince,
      durationSeconds: elapsed,
      downTotal: this.metrics.downTotal,
      upTotal: this.metrics.upTotal,
      exitIp: this.ip.exit?.ip ?? null,
      exitCountry: this.ip.exit?.countryCode ?? null
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
        // The kill switch may have kept a proxy that points at the dead core;
        // restore the user's settings before spawning a new process.
        if (this.runtime.proxyApplied) {
          try {
            await disableSystemProxy()
          } catch {
            // Ignore — a missing backup simply disables the proxy.
          }
          this.runtime.proxyApplied = false
        }
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
  /*  Latency testing                                                   */
  /* ------------------------------------------------------------------ */

  async testProfiles(ids?: string[]): Promise<Profile[]> {
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
    this.pushLog('info', `Latency test finished · ${targets.length} profile(s)`)
    this.emitUpdate()
    return this.store.getProfiles()
  }

  /* ------------------------------------------------------------------ */
  /*  Telemetry                                                         */
  /* ------------------------------------------------------------------ */

  private startTelemetry(): void {
    this.stopTelemetry()
    this.runtime.tickTimer = setInterval(() => void this.tick(), 1000)
    this.runtime.pingTimer = setInterval(() => void this.measureLatency(), 5000)
  }

  private stopTelemetry(): void {
    if (this.runtime.tickTimer) clearInterval(this.runtime.tickTimer)
    if (this.runtime.pingTimer) clearInterval(this.runtime.pingTimer)
    this.runtime.tickTimer = null
    this.runtime.pingTimer = null
  }

  /** Final Clash sample taken before the core is stopped. */
  private async finalSample(): Promise<void> {
    if (!this.runtime.apiPort) return
    const stats = await clashStats(this.runtime.apiPort, API_SECRET).catch(() => null)
    if (!stats) return
    this.metrics.downTotal = Math.max(0, stats.downTotal - this.runtime.baseline.downTotal)
    this.metrics.upTotal = Math.max(0, stats.upTotal - this.runtime.baseline.upTotal)
  }

  private async tick(): Promise<void> {
    if (this.status !== 'connected') return
    const runtime = this.runtime
    if (runtime.tickBusy) return
    runtime.tickBusy = true
    try {
      const stats = await clashStats(runtime.apiPort, API_SECRET)
      this.metrics.sessionSeconds += 1

      if (stats) {
        const deltaDown = Math.max(0, stats.downTotal - runtime.lastStats.downTotal)
        const deltaUp = Math.max(0, stats.upTotal - runtime.lastStats.upTotal)
        runtime.lastStats = stats
        const instantDown = (deltaDown * 8) / 1_000_000
        const instantUp = (deltaUp * 8) / 1_000_000
        this.metrics.down = Math.round((this.metrics.down * 0.45 + instantDown * 0.55) * 10) / 10
        this.metrics.up = Math.round((this.metrics.up * 0.45 + instantUp * 0.55) * 10) / 10
        this.metrics.downTotal = Math.max(0, stats.downTotal - runtime.baseline.downTotal)
        this.metrics.upTotal = Math.max(0, stats.upTotal - runtime.baseline.upTotal)
        this.metrics.connections = stats.connections
      } else {
        this.metrics.down = Math.round(this.metrics.down * 0.5 * 10) / 10
        this.metrics.up = Math.round(this.metrics.up * 0.5 * 10) / 10
        this.metrics.connections = 0
      }

      this.history.push({
        t: now(),
        ping: this.metrics.ping,
        down: this.metrics.down,
        up: this.metrics.up
      })
      if (this.history.length > HISTORY_LIMIT) this.history.shift()

      if (this.metrics.sessionSeconds % 120 === 0) {
        this.pushLog('info', `Session healthy · ${Math.round(this.metrics.ping)} ms · ${this.metrics.connections} connections`)
      }
      this.emitUpdate()
    } finally {
      runtime.tickBusy = false
    }
  }

  private async measureLatency(): Promise<void> {
    if (this.status !== 'connected' || !this.runtime.mixedPort) return
    const ping = await measurePing(this.runtime.mixedPort)
    if (ping > 0) {
      this.metrics.ping = Math.round((this.metrics.ping || ping) * 0.4 + ping * 0.6)
      this.store.setPing(this.profileId ?? '', this.metrics.ping)
      this.emitUpdate()
    }
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

  /** Toggles the Windows system proxy while a tunnel is already live. */
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

  /** Public log helper used by the IPC layer for import/subscription events. */
  pushExternalLog(level: LogEntry['level'], message: string): void {
    this.pushLog(level, message)
    this.emitUpdate()
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
    this.core = { ...this.core, running: false }
  }

  private emitUpdate(): void {
    this.emit('state', this.getState())
  }
}
