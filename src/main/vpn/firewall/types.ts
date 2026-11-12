import type { Profile } from '@shared/types'

export interface KillSwitchContext {
  /** IPs the tunnel must be able to reach while the policy is active. */
  serverIps: string[]
  /** Core executable that is allowed to reach the network. */
  corePath: string | null
  /** Eaglet itself reconnects and refreshes subscriptions. */
  appPath: string
}

export interface KillSwitchBackend {
  enable(context: KillSwitchContext): Promise<void>
  disable(): Promise<void>
  disableSync(): void
  recover(): void
}

export async function resolveServerIps(profile: Profile | null): Promise<string[]> {
  if (!profile || profile.protocol === 'direct' || !profile.host) return []
  const { isIP } = await import('node:net')
  if (isIP(profile.host)) return [profile.host]
  try {
    const { lookup } = await import('node:dns/promises')
    const results = await lookup(profile.host, { all: true, verbatim: true })
    return [...new Set(results.map((item) => item.address))]
  } catch {
    return []
  }
}
