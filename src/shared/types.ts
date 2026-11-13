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

/** Tunnel cores Eaglet can drive. */
export type EngineId = 'sing-box' | 'xray' | 'mihomo'

/** `auto` lets the engine manager pick the best installed core for the profile. */
export type EngineChoice = 'auto' | EngineId

export type ScenarioIcon = 'game' | 'speed' | 'shield' | 'manual' | 'custom'

export type ServerStrategy = 'fastest' | 'favorite' | 'selected'

/** Real coordinates resolved from the node address — never invented client-side. */
export interface GeoPoint {
  lat: number
  lon: number
  country: string
  countryCode: string
  city: string
  resolvedAt: number
}

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
  /** Starred by the user — favourites are pinned to the top of the list. */
  favorite: boolean
  addedAt: number
  /** Per-profile engine override. `null` follows the global choice. */
  engine: EngineId | null
  /** Geolocation of the endpoint, measured through DNS + ip-api. */
  geo: GeoPoint | null
  /** Last measured latency samples (newest last, max 30). */
  quality: number[]
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
  /** Mean absolute difference between consecutive latency probes, ms. */
  jitter: number
  /** Percentage of failed latency probes in the current rolling window. */
  loss: number
  /** Successful / total latency probes for the current session. */
  probes: number
  probeFailures: number
}

export interface HistoryPoint {
  t: number
  ping: number
  down: number
  up: number
  jitter: number
  loss: number
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

export interface EngineState {
  id: EngineId
  name: string
  installed: boolean
  version: string | null
  latestVersion: string | null
  updateAvailable: boolean
  path: string | null
  running: boolean
  /** Protocols this build of the core can actually carry. */
  protocols: ProtocolId[]
  /** True when real traffic counters are available (Clash API or core-native stats). */
  telemetry: boolean
  supportsTun: boolean
  /** Platform support is only claimed for implementations that exist. */
  platformSupport: 'supported' | 'experimental' | 'unsupported'
  removable: boolean
}

export interface EngineUsage {
  pid: number | null
  /** CPU percentage across all cores, measured from process CPU time deltas. */
  cpu: number
  /** Resident memory in bytes. */
  memory: number
}

export interface EngineSwitchRecord {
  id: string
  at: number
  from: EngineId | null
  to: EngineId
  reason: 'manual' | 'global' | 'profile' | 'auto' | 'scenario'
  profileName: string | null
}

export interface EngineComparison {
  engine: EngineId
  sessions: number
  downTotal: number
  upTotal: number
  avgPing: number | null
  lastUsedAt: number | null
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
  /** Engine that is actually running (or would run) the current profile. */
  engine: EngineId
  engines: EngineState[]
  usage: EngineUsage
  killSwitchActive: boolean
  dnsProtectionActive: boolean
  comparison: EngineComparison[]
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
  /** Comma/newline separated domains, IPs or CIDRs that bypass the tunnel. */
  bypassList: string
  autoReconnect: boolean
  mini: boolean
  launchAtStartup: boolean
  activeProfileId: string | null
  /** Global engine choice; profiles may override it. */
  engine: EngineChoice
  /** Force DNS through the tunnel and reject plaintext resolution. */
  dnsProtection: boolean
  /** Enable IPv6 inside the tunnel. When off, IPv6 routes are rejected. */
  ipv6: boolean
  /** Master protection switch: kill switch + DNS protection. */
  networkProtection: boolean
  /** Refresh HTTP subscriptions on a schedule. */
  autoUpdateSubscriptions: boolean
  subscriptionIntervalHours: number
  /** Keep Eaglet in the system tray instead of quitting on window close. */
  tray: boolean
  /** Minimise to the tray on close instead of quitting. */
  closeToTray: boolean
}

export interface ImportResult {
  imported: number
  updated: number
  subscription: Subscription | null
  profiles: Profile[]
}

export interface SessionRecord {
  id: string
  profileName: string
  protocol: ProtocolId
  engine: EngineId
  startedAt: number
  durationSeconds: number
  downTotal: number
  upTotal: number
  exitIp: string | null
  exitCountry: string | null
  /** Last measured latency and jitter for the session. */
  ping: number | null
  jitter: number | null
  loss: number | null
}

export interface SpeedTestResult {
  mbps: number
  bytes: number
  seconds: number
  at: number
}

export interface ProfileEvent {
  id: string
  at: number
  kind: 'import' | 'update' | 'remove' | 'subscription' | 'engine' | 'scenario'
  message: string
}

export interface Scenario {
  id: string
  name: string
  description: string
  icon: ScenarioIcon
  builtin: boolean
  engine: EngineChoice
  serverStrategy: ServerStrategy
  /** Settings written when the scenario is applied. */
  settings: Partial<Settings>
}

export interface DiagnosticCheck {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail' | 'skip'
  detail: string
}

export interface DiagnosticsResult {
  at: number
  checks: DiagnosticCheck[]
  summary: string
}

/** Where connection secrets are currently kept. */
export type SecretStorageStatus = 'encrypted' | 'unavailable' | 'corrupt'

/**
 * Honest description of the secret storage state. The renderer must be able to
 * tell the user when profiles are stored without encryption instead of
 * presenting a plaintext fallback as if it were protected.
 */
export interface SecurityState {
  secretStorage: SecretStorageStatus
  /** Profiles whose raw share link is still written to config.json. */
  plaintextProfiles: number
  /** Subscriptions whose URL is still written to config.json. */
  plaintextSubscriptions: number
  /** True when a legacy vault was rewritten with encryption this launch. */
  migrated: boolean
  warnings: string[]
}

export interface BackupPayload {
  format: 'eaglet-backup'
  version: number
  createdAt: number
  settings: Settings
  profiles: Profile[]
  subscriptions: Subscription[]
  scenarios: Scenario[]
  /**
   * True when the file contains raw share links / subscription URLs. They are
   * written in readable form, so the UI must ask the user before exporting.
   */
  includesSecrets?: boolean
}

export interface QrImportResult extends ImportResult {
  /** Number of QR payloads decoded from the image. */
  codes: number
}

export interface FreeSourceStatus {
  name: string
  url: string
  count: number
  error: string | null
}

export interface FreeDiscoveryResult {
  /** Working, latency-sorted nodes. Nothing is persisted until the user adds them. */
  profiles: Profile[]
  sources: FreeSourceStatus[]
  /** Total unique nodes found across all catalogs. */
  found: number
  /** How many nodes were actually probed. */
  tested: number
  /** How many of the probed nodes accepted a TCP connection. */
  reachable: number
  /** True when every listed node was confirmed to carry real HTTP traffic. */
  verified: boolean
  fetchedAt: number
  defaultSelection: number
}

export interface Snapshot {
  state: VpnState
  settings: Settings
  profiles: Profile[]
  subscriptions: Subscription[]
  sessions: SessionRecord[]
  scenarios: Scenario[]
  profileHistory: ProfileEvent[]
  engineHistory: EngineSwitchRecord[]
  security: SecurityState
  platform: string
  version: string
}

export interface EagletApi {
  snapshot: () => Promise<Snapshot>
  connect: (profileId?: string) => Promise<void>
  quickConnect: () => Promise<Profile>
  disconnect: () => Promise<void>
  selectProfile: (profileId: string) => Promise<void>
  setFavorite: (profileId: string, favorite: boolean) => Promise<Profile[]>
  importProfiles: (text: string) => Promise<ImportResult>
  importQr: () => Promise<QrImportResult>
  discoverFree: () => Promise<FreeDiscoveryResult>
  addFreeProfiles: (profileIds: string[]) => Promise<ImportResult>
  updateSubscription: (subscriptionId: string) => Promise<ImportResult>
  updateAllSubscriptions: () => Promise<ImportResult[]>
  removeSubscription: (subscriptionId: string) => Promise<void>
  removeProfile: (profileId: string) => Promise<void>
  testProfiles: (profileIds?: string[]) => Promise<Profile[]>
  runSpeedTest: () => Promise<SpeedTestResult>
  clearSessions: () => Promise<SessionRecord[]>
  /** Imports whatever the clipboard contains without exposing the text. */
  importClipboard: () => Promise<ImportResult>
  /** Copies a profile's share link without ever handing the link to the renderer. */
  copyProfileLink: (profileId: string) => Promise<void>
  checkIp: () => Promise<void>
  refreshCore: () => Promise<CoreState>
  refreshEngines: () => Promise<EngineState[]>
  installEngine: (engine: EngineId) => Promise<EngineState[]>
  removeEngine: (engine: EngineId) => Promise<EngineState[]>
  checkEngineUpdates: () => Promise<EngineState[]>
  setEngine: (engine: EngineChoice) => Promise<Settings>
  setProfileEngine: (profileId: string, engine: EngineId | null) => Promise<Profile[]>
  applyScenario: (scenarioId: string) => Promise<void>
  saveScenario: (scenario: Scenario) => Promise<Scenario[]>
  removeScenario: (scenarioId: string) => Promise<Scenario[]>
  diagnose: () => Promise<DiagnosticsResult>
  exportBackup: () => Promise<string | null>
  importBackup: () => Promise<Snapshot | null>
  exportConfig: () => Promise<string | null>
  clearEngineHistory: () => Promise<EngineSwitchRecord[]>
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>
  setMini: (mini: boolean) => Promise<void>
  windowMinimize: () => void
  windowClose: () => void
  windowToggleMaximize: () => void
  onState: (cb: (snapshot: Snapshot) => void) => () => void
}
