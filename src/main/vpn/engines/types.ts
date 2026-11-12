import type { EngineId, Profile, ProtocolId, Settings } from '@shared/types'

export interface EngineBuildInput {
  profile: Profile
  settings: Settings
  mixedPort: number
  /** Clash API (or, for Xray, the native stats API) port. */
  apiPort: number
  /** Extra local listener when a core cannot combine HTTP and SOCKS in one inbound. */
  auxPort: number
  apiSecret: string
}

/**
 * Adapter contract for a tunnel core. Every adapter turns the same profile and
 * settings into a native config, knows how to validate it and how to launch it.
 * The engine manager never talks to a specific core directly.
 */
export interface EngineAdapter {
  id: EngineId
  name: string
  releaseRepo: string
  protocols: ProtocolId[]
  /** Real traffic counters are available (Clash API or a core-native stats API). */
  telemetry: boolean
  supportsTun: boolean
  /**
   * False when the engine cannot carry this exact profile (for example Xray
   * dropped legacy Shadowsocks ciphers). Protocol-level support alone is not
   * enough for such engines.
   */
  supportsProfile?: (profile: Profile) => boolean
  /** Asset matcher for the platform/arch pair used by install(). */
  assetPattern: (platform: NodeJS.Platform, arch: string) => RegExp
  /** Name of the executable inside the release archive. */
  binaryName: (platform: NodeJS.Platform) => string
  configFileName: string
  buildConfig: (input: EngineBuildInput) => string
  /** Arguments passed to the binary to validate a config file. */
  validateArgs: (configPath: string) => string[]
  versionArgs: string[]
  parseVersion: (output: string) => string | null
  runArgs: (configPath: string) => string[]
}

export function parseSemver(output: string): string | null {
  const match = output.match(/(\d+\.\d+\.\d+(?:[-+][\w.\-]+)?)/)
  return match?.[1] ?? null
}

export function splitBypass(value: string): { domains: string[]; cidrs: string[] } {
  const entries = value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().replace(/^\./, ''))
    .filter(Boolean)
    .slice(0, 120)
  const domains: string[] = []
  const cidrs: string[] = []
  for (const entry of entries) {
    const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(entry)
    const isIpv6 = /^[0-9a-f:]+(\/\d{1,3})?$/i.test(entry) && entry.includes(':')
    if (isIpv4 || isIpv6) cidrs.push(entry)
    else domains.push(entry)
  }
  return { domains, cidrs }
}

export function dohEndpoint(settings: Settings): string {
  if (settings.dns === 'google') return 'https://8.8.8.8/dns-query'
  if (settings.dns === 'custom' && settings.customDns.trim()) {
    const raw = settings.customDns.trim()
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}/dns-query`
  }
  return 'https://1.1.1.1/dns-query'
}

export function dnsEnabled(settings: Settings): boolean {
  return settings.dns !== 'auto' || settings.dnsProtection || settings.networkProtection
}
