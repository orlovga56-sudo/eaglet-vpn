import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { promisify } from 'node:util'
import type { Profile, Settings } from '@shared/types'
import { dohEndpoint } from '../engines/types'
import { linuxKillSwitch } from './linux'
import { macKillSwitch } from './macos'
import {
  resolveHostIps,
  resolveServer,
  type AppEndpointSpec,
  type KillSwitchBackend,
  type KillSwitchContext,
  type ResolvedEndpoint
} from './types'
import { windowsKillSwitch } from './windows'

const execFileAsync = promisify(execFile)

function backend(): KillSwitchBackend | null {
  if (process.platform === 'win32') return windowsKillSwitch
  if (process.platform === 'darwin') return macKillSwitch
  if (process.platform === 'linux') return linuxKillSwitch
  return null
}

export function killSwitchSupported(): boolean {
  return backend() !== null
}

/**
 * Services the Electron main process talks to directly while the tunnel is up.
 * They are resolved to concrete IPs before the policy is armed; the rules never
 * allow port 80/443 to arbitrary addresses.
 */
const APP_ENDPOINT_HOSTS: AppEndpointSpec[] = [
  { host: 'ip-api.com', ports: [80] },
  { host: 'ipapi.co', ports: [443] },
  { host: 'api.github.com', ports: [443] },
  { host: 'github.com', ports: [443] },
  { host: 'objects.githubusercontent.com', ports: [443] },
  { host: 'raw.githubusercontent.com', ports: [443] },
  { host: 'www.wintun.net', ports: [443] }
]

function endpointSpecForUrl(raw: string): AppEndpointSpec | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const port = url.port ? Number(url.port) : url.protocol === 'http:' ? 80 : 443
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null
    const host = url.hostname.replace(/^\[|\]$/g, '')
    return host ? { host, ports: [port] } : null
  } catch {
    return null
  }
}

async function resolveAppEndpoints(subscriptionUrls: string[]): Promise<ResolvedEndpoint[]> {
  const specs = new Map<string, Set<number>>()
  for (const spec of [...APP_ENDPOINT_HOSTS, ...subscriptionUrls.map(endpointSpecForUrl)]) {
    if (!spec) continue
    const ports = specs.get(spec.host) ?? new Set<number>()
    for (const port of spec.ports) ports.add(port)
    specs.set(spec.host, ports)
  }

  const resolved = await Promise.allSettled(
    [...specs.entries()].map(async ([host, ports]) => ({
      ips: await resolveHostIps(host),
      ports: [...ports]
    }))
  )
  return resolved
    .filter((item): item is PromiseFulfilledResult<ResolvedEndpoint> => item.status === 'fulfilled')
    .map((item) => item.value)
    .filter((endpoint) => endpoint.ips.length > 0 && endpoint.ports.length > 0)
}

async function resolveDoh(settings: Settings): Promise<{ ips: string[]; ports: number[] }> {
  try {
    const url = new URL(dohEndpoint(settings))
    if (url.protocol !== 'https:') return { ips: [], ports: [] }
    const port = url.port ? Number(url.port) : 443
    const ips = await resolveHostIps(url.hostname)
    return { ips, ports: Number.isInteger(port) && port > 0 && port <= 65535 ? [port] : [] }
  } catch {
    return { ips: [], ports: [] }
  }
}

/**
 * Returns the resolvers that were configured before DNS protection changed
 * them. They are the only upstream resolvers the core may still use while the
 * DoH relay starts up.
 */
async function resolveDnsServers(): Promise<string[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          'Get-DnsClientServerAddress -ErrorAction SilentlyContinue | ForEach-Object { $_.ServerAddresses } | Sort-Object -Unique'
        ],
        { timeout: 12000, windowsHide: true }
      )
      return [...new Set(stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => isIP(line) !== 0))]
    }
    if (existsSync('/etc/resolv.conf')) {
      return [
        ...new Set(
          readFileSync('/etc/resolv.conf', 'utf-8')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => /^nameserver\s+/i.test(line))
            .map((line) => line.split(/\s+/)[1])
            .filter((address): address is string => Boolean(address && isIP(address) !== 0))
        )
      ]
    }
  } catch {
    // Best effort: without a known resolver the core still has loopback DNS.
  }
  return []
}

/**
 * Applies the OS kill switch for the active profile. The returned list holds
 * the node IPs that were whitelisted, which is useful for diagnostics.
 */
export async function enableKillSwitch(
  profile: Profile | null,
  corePath: string | null,
  settings: Settings,
  subscriptionUrls: string[] = []
): Promise<string[]> {
  const target = backend()
  if (!target) throw new Error('Kill switch is not implemented on this platform')
  if (profile?.protocol === 'direct') {
    throw new Error('A kill switch cannot protect a direct connection')
  }
  const server = await resolveServer(profile)
  if (profile && server.ips.length === 0) {
    throw new Error('The node address could not be resolved; the kill switch was not armed')
  }
  const dnsProtected = settings.dnsProtection || settings.networkProtection
  const doh = dnsProtected ? await resolveDoh(settings) : { ips: [], ports: [] }
  const context: KillSwitchContext = {
    serverIps: server.ips,
    serverPorts: server.ports,
    corePath,
    appPath: process.execPath,
    dohIps: doh.ips,
    dohPorts: doh.ports,
    dnsServers: dnsProtected ? [] : await resolveDnsServers(),
    dnsProtected,
    appEndpoints: await resolveAppEndpoints(subscriptionUrls)
  }
  await target.enable(context)
  return server.ips
}

export async function disableKillSwitch(): Promise<void> {
  await backend()?.disable()
}

export function disableKillSwitchSync(): void {
  backend()?.disableSync()
}

/** Restores a policy left behind by a crash before a new connection starts. */
export function recoverKillSwitch(): void {
  backend()?.recover()
}
