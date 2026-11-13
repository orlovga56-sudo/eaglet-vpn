import type { Profile } from '@shared/types'

/**
 * Everything the OS firewall needs to let the tunnel work without opening a
 * general-purpose hole. Every exception is scoped to an address, a port and
 * (where the platform supports it) a program.
 */
export interface KillSwitchContext {
  /** IPv4/IPv6 addresses of the selected node. */
  serverIps: string[]
  /** TCP/UDP ports the node listens on. */
  serverPorts: number[]
  /** Core executable that is allowed to dial the node. */
  corePath: string | null
  /** Eaglet itself reconnects, refreshes subscriptions and relays DoH. */
  appPath: string
  /** DoH resolvers the DNS relay must be able to reach. */
  dohIps: string[]
  dohPorts: number[]
  /**
   * Resolvers the core/app may use while DNS protection is off. When
   * `dnsProtected` is true these rules are omitted entirely: the only resolver
   * left is the loopback relay, so there is no plaintext DNS escape hatch.
   */
  dnsServers: string[]
  /** True when Eaglet's local DoH relay owns the system resolver. */
  dnsProtected: boolean
  /**
   * Resolved addresses of endpoints the Electron app must reach directly
   * (subscription servers, update checks, free catalogues). Each entry is
   * scoped to the exact ports used by that service.
   */
  appEndpoints: ResolvedEndpoint[]
}

/** A hostname/port pair that the main process may need to reach while armed. */
export interface AppEndpointSpec {
  host: string
  ports: number[]
}

export interface KillSwitchBackend {
  enable(context: KillSwitchContext): Promise<void>
  disable(): Promise<void>
  disableSync(): void
  recover(): void
}

export interface ResolvedEndpoint {
  ips: string[]
  ports: number[]
}

/** Resolves a hostname to every address family so IPv6 is never forgotten. */
export async function resolveHostIps(host: string): Promise<string[]> {
  const { isIP } = await import('node:net')
  const clean = host.replace(/^\[|\]$/g, '')
  if (!clean) return []
  if (isIP(clean)) return [clean]
  try {
    const { lookup } = await import('node:dns/promises')
    const results = await lookup(clean, { all: true, verbatim: true })
    return [...new Set(results.map((item) => item.address))]
  } catch {
    return []
  }
}

export async function resolveServer(profile: Profile | null): Promise<ResolvedEndpoint> {
  if (!profile || profile.protocol === 'direct' || !profile.host) return { ips: [], ports: [] }
  return {
    ips: await resolveHostIps(profile.host),
    ports: profile.port > 0 && profile.port <= 65535 ? [profile.port] : []
  }
}
