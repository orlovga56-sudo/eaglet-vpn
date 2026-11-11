/**
 * Shared domain types used by the main process, the preload bridge and the renderer.
 * Keeping them in one place makes the IPC contract impossible to drift apart.
 */

export type VpnStatus = 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error'

export type ThemeId = 'cyber' | 'glass' | 'minimal' | 'hud' | 'neon' | 'aurora'

export type ProtocolId =
  | 'vless'
  | 'vmess'
  | 'trojan'
  | 'shadowsocks'
  | 'hysteria2'
  | 'tuic'
  | 'socks'
  | 'http'
  | 'direct'

export type RoutingMode = 'global' | 'smart' | 'direct'

export type DnsMode = 'auto' | 'cloudflare' | 'google' | 'custom'

export interface Profile {
  id: string
  name: string
  protocol: ProtocolId
  host: string
  port: number
  /** Original share link (vless://…, vmess://…) used to rebuild the core config. */
  raw: string
  /** Subscription this profile came from, if any. */
  sourceId: string | null
  /** Last measured TCP handshake latency in ms. */
  ping: number | null
  addedAt: number
}

export interface Subscription {
  id: string
  name: string
  url: string
  updatedAt: number
  count: number
}

export interface IpInfo {
  ip: string
  country: string
  countryCode: string
  city: string
  lat: number
  lon: number
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
  connections: number
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

export interface IpState {
  direct: IpInfo | null
  exit: IpInfo | null
  checking: boolean
  changed: boolean
  checkedAt: number | null
}

export interface CoreState {
  available: boolean
  running: boolean
  version: string | null
  path: string | null
}

export interface VpnState {
  status: VpnStatus
  profile: Profile | null
  connectedSince: number | null
  metrics: Metrics
  /** Last 60 samples, newest last. */
  history: HistoryPoint[]
  stage: string | null
  /** 0..1 progress for the connecting animation. */
  progress: number
  logs: LogEntry[]
  error: string | null
  ip: IpState
  core: CoreState
}

export interface Settings {
  theme: ThemeId
  systemProxy: boolean
  tunMode: boolean
  killSwitch: boolean
  autoConnect: boolean
  notifications: boolean
  dns: DnsMode
  customDns: string
  routingMode: RoutingMode
  mini: boolean
  launchAtStartup: boolean
  activeProfileId: string | null
}

export interface ImportResult {
  imported: number
  updated: number
  subscription: Subscription | null
  profiles: Profile[]
}

export interface Snapshot {
  state: VpnState
  settings: Settings
  profiles: Profile[]
  subscriptions: Subscription[]
  platform: string
  version: string
}

export interface EagletApi {
  snapshot: () => Promise<Snapshot>
  connect: (profileId?: string) => Promise<void>
  disconnect: () => Promise<void>
  selectProfile: (profileId: string) => Promise<void>
  importProfiles: (text: string) => Promise<ImportResult>
  updateSubscription: (subscriptionId: string) => Promise<ImportResult>
  removeSubscription: (subscriptionId: string) => Promise<void>
  removeProfile: (profileId: string) => Promise<void>
  testProfiles: (profileIds?: string[]) => Promise<Profile[]>
  checkIp: () => Promise<void>
  refreshCore: () => Promise<CoreState>
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>
  setMini: (mini: boolean) => Promise<void>
  windowMinimize: () => void
  windowClose: () => void
  windowToggleMaximize: () => void
  onState: (cb: (snapshot: Snapshot) => void) => () => void
}
