import type {
  DnsMode,
  EngineChoice,
  EngineId,
  RoutingMode,
  Scenario,
  ScenarioIcon,
  ServerStrategy,
  Settings,
  ThemeId
} from './types'

export const ENGINE_IDS: EngineId[] = ['sing-box', 'xray', 'mihomo']
const THEMES: ThemeId[] = ['cyber', 'glass', 'minimal', 'hud', 'neon', 'aurora']
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
