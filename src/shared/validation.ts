import type {
  DnsMode,
  EngineChoice,
  EngineId,
  GeoPoint,
  Language,
  Profile,
  ProtocolId,
  RoutingMode,
  Scenario,
  ScenarioIcon,
  ServerStrategy,
  Settings,
  Subscription,
  ThemeId
} from './types'

export const ENGINE_IDS: EngineId[] = ['sing-box', 'xray', 'mihomo']
const PROTOCOLS: ProtocolId[] = [
  'vless',
  'vmess',
  'trojan',
  'shadowsocks',
  'hysteria2',
  'tuic',
  'socks',
  'http',
  'direct'
]
const MAX_IMPORTED_RAW = 65536
const MAX_IMPORTED_URL = 4096
const MAX_QUALITY_SAMPLES = 30
const THEMES: ThemeId[] = ['cyber', 'glass', 'minimal', 'hud', 'neon', 'aurora']
const LANGUAGES: Language[] = ['en', 'ru']
const DNS_MODES: DnsMode[] = ['auto', 'cloudflare', 'google', 'custom']
const ROUTING_MODES: RoutingMode[] = ['global', 'smart', 'direct']
const SCENARIO_ICONS: ScenarioIcon[] = ['game', 'speed', 'shield', 'manual', 'custom']
const SERVER_STRATEGIES: ServerStrategy[] = ['fastest', 'favorite', 'selected']
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${field} has an unsupported value`)
  }
  return value as T
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  if (value.length > max) throw new Error(`${field} is longer than ${max} characters`)
  return value
}

export function requireId(value: unknown, field = 'id'): string {
  const id = requireString(value, field, 128)
  if (!ID_PATTERN.test(id)) throw new Error(`${field} has an invalid format`)
  return id
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`)
  return value
}

export function requireInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`)
  }
  return value
}

export function requireEngineId(value: unknown): EngineId {
  return oneOf(value, ENGINE_IDS, 'engine')
}

export function requireEngineChoice(value: unknown): EngineChoice {
  return oneOf(value, ['auto', ...ENGINE_IDS] as const, 'engine')
}

export function requireStringArray(
  value: unknown,
  field: string,
  maxItems: number,
  maxLength: number
): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  if (value.length > maxItems) throw new Error(`${field} contains too many entries`)
  return value.map((item, index) => requireString(item, `${field}[${index}]`, maxLength))
}

/**
 * Validates an IPC settings patch. Unknown keys are rejected instead of being
 * merged, so a compromised renderer cannot smuggle arbitrary data into the
 * persisted configuration.
 */
export function sanitizeSettingsPatch(value: unknown): Partial<Settings> {
  if (!isRecord(value)) throw new Error('Settings payload must be an object')
  const patch: Partial<Settings> = {}
  for (const [key, entry] of Object.entries(value)) {
    switch (key) {
      case 'theme':
        patch.theme = oneOf(entry, THEMES, 'theme')
        break
      case 'language':
        patch.language = oneOf(entry, LANGUAGES, 'language')
        break
      case 'systemProxy':
        patch.systemProxy = requireBoolean(entry, 'systemProxy')
        break
      case 'tunMode':
        patch.tunMode = requireBoolean(entry, 'tunMode')
        break
      case 'killSwitch':
        patch.killSwitch = requireBoolean(entry, 'killSwitch')
        break
      case 'autoConnect':
        patch.autoConnect = requireBoolean(entry, 'autoConnect')
        break
      case 'notifications':
        patch.notifications = requireBoolean(entry, 'notifications')
        break
      case 'dns':
        patch.dns = oneOf(entry, DNS_MODES, 'dns')
        break
      case 'customDns':
        patch.customDns = requireString(entry, 'customDns', 2048)
        break
      case 'routingMode':
        patch.routingMode = oneOf(entry, ROUTING_MODES, 'routingMode')
        break
      case 'bypassList':
        patch.bypassList = requireString(entry, 'bypassList', 20000)
        break
      case 'autoReconnect':
        patch.autoReconnect = requireBoolean(entry, 'autoReconnect')
        break
      case 'mini':
        patch.mini = requireBoolean(entry, 'mini')
        break
      case 'launchAtStartup':
        patch.launchAtStartup = requireBoolean(entry, 'launchAtStartup')
        break
      case 'activeProfileId':
        patch.activeProfileId = entry === null ? null : requireId(entry, 'activeProfileId')
        break
      case 'engine':
        patch.engine = requireEngineChoice(entry)
        break
      case 'dnsProtection':
        patch.dnsProtection = requireBoolean(entry, 'dnsProtection')
        break
      case 'ipv6':
        patch.ipv6 = requireBoolean(entry, 'ipv6')
        break
      case 'networkProtection':
        patch.networkProtection = requireBoolean(entry, 'networkProtection')
        break
      case 'autoUpdateSubscriptions':
        patch.autoUpdateSubscriptions = requireBoolean(entry, 'autoUpdateSubscriptions')
        break
      case 'subscriptionIntervalHours':
        patch.subscriptionIntervalHours = requireInteger(entry, 'subscriptionIntervalHours', 1, 168)
        break
      case 'tray':
        patch.tray = requireBoolean(entry, 'tray')
        break
      case 'closeToTray':
        patch.closeToTray = requireBoolean(entry, 'closeToTray')
        break
      default:
        throw new Error(`Unknown setting: ${key}`)
    }
  }
  return patch
}

/** Validates the editable parts of a custom scenario before normalisation. */
export function sanitizeScenarioInput(value: unknown): Partial<Scenario> {
  if (!isRecord(value)) throw new Error('Scenario payload must be an object')
  const scenario: Partial<Scenario> = {}
  if (value.id !== undefined) scenario.id = requireId(value.id, 'scenario id')
  if (value.name !== undefined) scenario.name = requireString(value.name, 'name', 60).trim()
  if (value.description !== undefined) {
    scenario.description = requireString(value.description, 'description', 240)
  }
  if (value.icon !== undefined) scenario.icon = oneOf(value.icon, SCENARIO_ICONS, 'icon')
  if (value.engine !== undefined) scenario.engine = requireEngineChoice(value.engine)
  if (value.serverStrategy !== undefined) {
    scenario.serverStrategy = oneOf(value.serverStrategy, SERVER_STRATEGIES, 'serverStrategy')
  }
  if (value.settings !== undefined) scenario.settings = sanitizeSettingsPatch(value.settings)
  return scenario
}

function finiteNumber(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

function optionalGeo(value: unknown): GeoPoint | null {
  if (!isRecord(value)) return null
  return {
    lat: finiteNumber(value.lat, 0, -90, 90),
    lon: finiteNumber(value.lon, 0, -180, 180),
    country: typeof value.country === 'string' ? value.country.slice(0, 100) : '',
    countryCode: typeof value.countryCode === 'string' ? value.countryCode.slice(0, 8) : '',
    city: typeof value.city === 'string' ? value.city.slice(0, 100) : '',
    resolvedAt: finiteNumber(value.resolvedAt, 0, 0)
  }
}

/**
 * Validates profiles read from a backup file. A backup is user-supplied JSON,
 * so one malformed row must be dropped (with its id counted as rejected) rather
 * than corrupting the profile list or crashing the import.
 */
export function sanitizeImportedProfiles(value: unknown): Profile[] {
  if (!Array.isArray(value)) return []
  const profiles = new Map<string, Profile>()
  for (const entry of value) {
    if (!isRecord(entry)) continue
    try {
      const id = requireId(entry.id, 'profile id')
      if (profiles.has(id)) continue
      const engine =
        entry.engine === null || entry.engine === undefined
          ? null
          : oneOf(entry.engine, ENGINE_IDS, 'profile engine')
      profiles.set(id, {
        id,
        name: requireString(entry.name, 'profile name', 200),
        protocol: oneOf(entry.protocol, PROTOCOLS, 'profile protocol'),
        host: requireString(entry.host, 'profile host', 1024),
        port:
          typeof entry.port === 'number' && Number.isInteger(entry.port) && entry.port >= 0 && entry.port <= 65535
            ? entry.port
            : 0,
        raw: typeof entry.raw === 'string' ? entry.raw.slice(0, MAX_IMPORTED_RAW) : '',
        sourceId:
          typeof entry.sourceId === 'string' && ID_PATTERN.test(entry.sourceId) ? entry.sourceId : null,
        ping:
          typeof entry.ping === 'number' && Number.isFinite(entry.ping) && entry.ping >= 0 ? entry.ping : null,
        favorite: entry.favorite === true,
        addedAt: finiteNumber(entry.addedAt, Date.now(), 0),
        engine,
        geo: optionalGeo(entry.geo),
        quality: Array.isArray(entry.quality)
          ? entry.quality
              .filter((sample): sample is number => typeof sample === 'number' && Number.isFinite(sample) && sample >= 0)
              .slice(-MAX_QUALITY_SAMPLES)
          : []
      })
    } catch {
      // Invalid row: skip it and keep the rest of the backup importable.
    }
  }
  return [...profiles.values()]
}

/** Validates subscription rows from a backup file (same trust model as profiles). */
export function sanitizeImportedSubscriptions(value: unknown): Subscription[] {
  if (!Array.isArray(value)) return []
  const subscriptions = new Map<string, Subscription>()
  for (const entry of value) {
    if (!isRecord(entry)) continue
    try {
      const id = requireId(entry.id, 'subscription id')
      if (subscriptions.has(id)) continue
      subscriptions.set(id, {
        id,
        name: requireString(entry.name, 'subscription name', 200),
        url: typeof entry.url === 'string' ? entry.url.slice(0, MAX_IMPORTED_URL) : '',
        updatedAt: finiteNumber(entry.updatedAt, 0, 0),
        count:
          typeof entry.count === 'number' && Number.isInteger(entry.count) && entry.count >= 0
            ? entry.count
            : 0
      })
    } catch {
      // Invalid row: skip it and keep the rest of the backup importable.
    }
  }
  return [...subscriptions.values()]
}

/** Filters scenario rows to objects with a valid id and name before normalisation. */
export function sanitizeImportedScenarios(value: unknown): Array<Partial<Scenario> & { id: string; name: string }> {
  if (!Array.isArray(value)) return []
  const scenarios: Array<Partial<Scenario> & { id: string; name: string }> = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    try {
      const id = requireId(entry.id, 'scenario id')
      const name = requireString(entry.name, 'scenario name', 60)
      scenarios.push({ ...sanitizeScenarioInput(entry), id, name })
    } catch {
      // Invalid row: skip it.
    }
  }
  return scenarios
}
