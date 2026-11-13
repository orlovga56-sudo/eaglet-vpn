import type { EngineChoice, Scenario, ScenarioIcon, ServerStrategy } from '@shared/types'
import { requireEngineChoice } from '@shared/validation'

/**
 * Built-in connection scenarios. Every field is a real setting that the engine
 * applies on the next connection — no decorative presets.
 */
export const BUILTIN_SCENARIOS: Scenario[] = [
  {
    id: 'gaming',
    name: 'Gaming',
    description: 'Stable low-latency path, IPv4 only, kill switch armed, TUN capture for games.',
    icon: 'game',
    builtin: true,
    engine: 'sing-box',
    serverStrategy: 'fastest',
    settings: {
      routingMode: 'smart',
      dns: 'cloudflare',
      dnsProtection: true,
      tunMode: true,
      systemProxy: false,
      killSwitch: true,
      networkProtection: true,
      autoReconnect: true,
      ipv6: false
    }
  },
  {
    id: 'performance',
    name: 'Performance',
    description: 'Maximum throughput: Mihomo, global routing, IPv6 enabled, full-device TUN.',
    icon: 'speed',
    builtin: true,
    engine: 'mihomo',
    serverStrategy: 'fastest',
    settings: {
      routingMode: 'global',
      dns: 'cloudflare',
      dnsProtection: true,
      tunMode: true,
      systemProxy: false,
      killSwitch: false,
      networkProtection: false,
      autoReconnect: true,
      ipv6: true
    }
  },
  {
    id: 'privacy',
    name: 'Privacy',
    description: 'Global tunnel, encrypted DNS, IPv6 leaks blocked, kill switch and strict reconnect.',
    icon: 'shield',
    builtin: true,
    engine: 'sing-box',
    serverStrategy: 'favorite',
    settings: {
      routingMode: 'global',
      dns: 'cloudflare',
      dnsProtection: true,
      tunMode: true,
      systemProxy: false,
      killSwitch: true,
      networkProtection: true,
      autoReconnect: true,
      ipv6: false
    }
  },
  {
    id: 'manual',
    name: 'Manual',
    description: 'Neutral baseline: system proxy, smart routing and automatic core selection for hand tuning.',
    icon: 'manual',
    builtin: true,
    engine: 'auto',
    serverStrategy: 'selected',
    settings: {
      routingMode: 'smart',
      dns: 'auto',
      dnsProtection: false,
      tunMode: false,
      systemProxy: true,
      killSwitch: false,
      networkProtection: false,
      autoReconnect: true,
      ipv6: true
    }
  }
]

const ICONS: ScenarioIcon[] = ['game', 'speed', 'shield', 'manual', 'custom']
const STRATEGIES: ServerStrategy[] = ['fastest', 'favorite', 'selected']

function engineChoice(value: unknown): EngineChoice {
  try {
    return requireEngineChoice(value)
  } catch {
    return 'auto'
  }
}

export function allScenarios(custom: Scenario[]): Scenario[] {
  return [...BUILTIN_SCENARIOS, ...custom.filter((scenario) => !scenario.builtin)]
}

/** Custom scenarios may only override settings the engine understands. */
export function normalizeScenario(input: Partial<Scenario>): Scenario {
  const id = input.id?.trim() || `custom-${Date.now()}`
  const name = input.name?.trim()
  if (!name) throw new Error('A scenario needs a name')
  const icon = ICONS.includes(input.icon as ScenarioIcon) ? (input.icon as ScenarioIcon) : 'custom'
  return {
    id,
    name: name.slice(0, 60),
    description: (input.description ?? '').trim().slice(0, 240),
    icon,
    builtin: false,
    engine: engineChoice(input.engine),
    serverStrategy: STRATEGIES.includes(input.serverStrategy as ServerStrategy)
      ? (input.serverStrategy as ServerStrategy)
      : 'selected',
    settings: input.settings ?? {}
  }
}
