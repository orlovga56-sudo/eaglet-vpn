/**
 * Shared domain types used by the main process, the preload bridge and the renderer.
 * Keeping them in one place makes the IPC contract impossible to drift apart.
 */

export type VpnStatus = 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error'

export type ThemeId = 'cyber' | 'glass' | 'minimal' | 'hud' | 'neon' | 'aurora'

export type Protocol = 'wireguard' | 'openvpn' | 'ikev2'

export type RoutingMode = 'global' | 'smart' | 'split'

export type DnsMode = 'auto' | 'cloudflare' | 'google' | 'custom'

export interface ServerInfo {
  id: string
  country: string
  code: string
  city: string
  /** Base latency used by the simulator, in milliseconds. */
  ping: number
  /** 0..100, how busy the node is. */
  load: number
  premium: boolean
  /** Approximate normalised coordinates (0..1) used to place the node on the map. */
  x: number
  y: number
}

export interface Metrics {
  ping: number
  /** Current download speed, Mbps. */
  down: number
  /** Current upload speed, Mbps. */
  up: number
  /** Total bytes for the current session. */
  downTotal: number
  upTotal: number
  sessionSeconds: number
}

export interface HistoryPoint {
  t: number
  ping: number
  down: number
  up: number
}

export interface LogEntry {
  id: number
  time: number
  level: 'info' | 'success' | 'warn' | 'error'
  message: string
}

export interface VpnState {
  status: VpnStatus
  server: ServerInfo
  connectedSince: number | null
  metrics: Metrics
  /** Last 60 samples, newest last. */
  history: HistoryPoint[]
  stage: string | null
  /** 0..1 progress for the connecting animation. */
  progress: number
  logs: LogEntry[]
  error: string | null
}

export interface Settings {
  theme: ThemeId
  protocol: Protocol
  killSwitch: boolean
  autoConnect: boolean
  notifications: boolean
  dns: DnsMode
  customDns: string
  routingMode: RoutingMode
  mini: boolean
  launchAtStartup: boolean
  activeServerId: string
}

export interface Snapshot {
  state: VpnState
  settings: Settings
  servers: ServerInfo[]
  platform: string
  version: string
}

export interface EagletApi {
  snapshot: () => Promise<Snapshot>
  connect: (serverId?: string) => Promise<void>
  disconnect: () => Promise<void>
  selectServer: (serverId: string) => Promise<void>
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>
  setMini: (mini: boolean) => Promise<void>
  windowMinimize: () => void
  windowClose: () => void
  windowToggleMaximize: () => void
  onState: (cb: (snapshot: Snapshot) => void) => () => void
}
