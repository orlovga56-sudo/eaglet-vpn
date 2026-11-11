import { EventEmitter } from 'node:events'
import type { HistoryPoint, LogEntry, Metrics, VpnState, VpnStatus } from '@shared/types'
import { findServer, DEFAULT_SERVER_ID } from './servers'

const STAGES = [
  'Resolving endpoint',
  'Negotiating handshake',
  'Building encrypted tunnel',
  'Verifying route'
]

const HISTORY_LIMIT = 60
const LOG_LIMIT = 80

function now(): number {
  return Date.now()
}

/**
 * Simulated tunnel engine.
 *
 * The engine owns a deterministic state machine (disconnected → connecting →
 * connected → disconnecting) plus a lightweight traffic simulator so the whole
 * UI can be exercised without a real tunnel. To ship a real client, replace the
 * `handshake()` / `teardown()` internals with a WireGuard adapter — the state
 * machine, IPC contract and renderer stay untouched. See CLAUDE.md.
 */
export class VpnEngine extends EventEmitter {
  private status: VpnStatus = 'disconnected'
  private serverId: string
  private connectedSince: number | null = null
  private stage: string | null = null
  private progress = 0
  private error: string | null = null
  private metrics: Metrics = { ping: 0, down: 0, up: 0, downTotal: 0, upTotal: 0, sessionSeconds: 0 }
  private history: HistoryPoint[] = []
  private logs: LogEntry[] = []
  private logId = 1

  private stageTimer: NodeJS.Timeout | null = null
  private handshakeTimer: NodeJS.Timeout | null = null
  private tickTimer: NodeJS.Timeout | null = null
  private peakPing = 0

  constructor(initialServerId: string = DEFAULT_SERVER_ID) {
    super()
    this.serverId = initialServerId
    this.pushLog('info', 'Eaglet core initialised')
  }

  getState(): VpnState {
    return {
      status: this.status,
      server: findServer(this.serverId),
      connectedSince: this.connectedSince,
      metrics: { ...this.metrics },
      history: [...this.history],
      stage: this.stage,
      progress: this.progress,
      logs: [...this.logs],
      error: this.error
    }
  }

  getServerId(): string {
    return this.serverId
  }

  selectServer(serverId: string): void {
    if (this.status === 'connected' || this.status === 'connecting') return
    this.serverId = serverId
    this.pushLog('info', `Selected ${findServer(serverId).city} · ${findServer(serverId).country}`)
    this.emitUpdate()
  }

  async connect(serverId?: string): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') {
      if (serverId && serverId !== this.serverId) {
        this.pushLog('warn', 'Disconnect before switching to another node')
      }
      return
    }
    this.clearTimers()
    if (serverId) this.serverId = serverId

    const server = findServer(this.serverId)
    this.status = 'connecting'
    this.error = null
    this.connectedSince = null
    this.stage = STAGES[0]
    this.progress = 0.08
    this.metrics = { ping: 0, down: 0, up: 0, downTotal: 0, upTotal: 0, sessionSeconds: 0 }
    this.history = []
    this.peakPing = 0
    this.pushLog('info', `Connecting to ${server.city}, ${server.country} (${server.code})`)
    this.emitUpdate()

    let step = 0
    const advance = (): void => {
      step += 1
      if (step < STAGES.length) {
        this.stage = STAGES[step]
        this.progress = (step + 1) / (STAGES.length + 1)
        this.emitUpdate()
        this.stageTimer = setTimeout(advance, 420)
        return
      }
      this.stage = 'Securing session'
      this.progress = 0.94
      this.emitUpdate()
      this.handshakeTimer = setTimeout(() => this.establish(), 480)
    }
    this.stageTimer = setTimeout(advance, 460)
  }

  async disconnect(): Promise<void> {
    if (this.status === 'disconnected' || this.status === 'disconnecting') return
    this.clearTimers()
    this.status = 'disconnecting'
    this.stage = 'Tearing down tunnel'
    this.progress = 0.6
    this.pushLog('info', 'Closing encrypted tunnel')
    this.emitUpdate()

    await new Promise<void>((resolve) => setTimeout(resolve, 620))
    this.status = 'disconnected'
    this.stage = null
    this.progress = 0
    this.connectedSince = null
    this.metrics = { ping: 0, down: 0, up: 0, downTotal: 0, upTotal: 0, sessionSeconds: 0 }
    this.history = []
    this.pushLog('info', 'Disconnected')
    this.emitUpdate()
  }

  private establish(): void {
    const server = findServer(this.serverId)
    if (this.status !== 'connecting') return
    this.status = 'connected'
    this.stage = null
    this.progress = 1
    this.connectedSince = now()
    this.metrics = {
      ping: server.ping,
      down: 0,
      up: 0,
      downTotal: 0,
      upTotal: 0,
      sessionSeconds: 0
    }
    this.history = []
    this.pushLog('success', `Tunnel established · ${server.city} · ${server.code}`)
    this.emitUpdate()
    this.startTicking()
  }

  private startTicking(): void {
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.tickTimer = setInterval(() => this.tick(), 1000)
  }

  private tick(): void {
    if (this.status !== 'connected') return
    const server = findServer(this.serverId)

    this.metrics.sessionSeconds += 1

    // Latency: mean-reverting random walk around the node's base ping.
    const drift = (server.ping - this.metrics.ping) * 0.25
    const jitter = (Math.random() - 0.5) * 6
    this.metrics.ping = Math.max(4, Math.round((this.metrics.ping + drift + jitter) * 10) / 10)
    this.peakPing = Math.max(this.peakPing, this.metrics.ping)

    // Throughput: eased towards a per-node target with occasional bursts.
    const busy = 1 - server.load / 160
    const targetDown = 70 * busy + Math.random() * 55 * busy + (Math.random() < 0.07 ? 60 : 0)
    const targetUp = 28 * busy + Math.random() * 22 * busy
    this.metrics.down = Math.round((this.metrics.down + (targetDown - this.metrics.down) * 0.45) * 10) / 10
    this.metrics.up = Math.round((this.metrics.up + (targetUp - this.metrics.up) * 0.45) * 10) / 10

    this.metrics.downTotal += (this.metrics.down * 1_000_000) / 8
    this.metrics.upTotal += (this.metrics.up * 1_000_000) / 8

    this.history.push({
      t: now(),
      ping: this.metrics.ping,
      down: this.metrics.down,
      up: this.metrics.up
    })
    if (this.history.length > HISTORY_LIMIT) this.history.shift()

    if (this.metrics.sessionSeconds % 90 === 0) {
      this.pushLog('info', `Keepalive ok · ${this.metrics.ping.toFixed(0)} ms`)
    }

    this.emitUpdate()
  }

  private clearTimers(): void {
    if (this.stageTimer) clearTimeout(this.stageTimer)
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.stageTimer = null
    this.handshakeTimer = null
    this.tickTimer = null
  }

  private pushLog(level: LogEntry['level'], message: string): void {
    this.logs.unshift({ id: this.logId++, time: now(), level, message })
    if (this.logs.length > LOG_LIMIT) this.logs.pop()
  }

  private emitUpdate(): void {
    this.emit('state', this.getState())
  }
}
