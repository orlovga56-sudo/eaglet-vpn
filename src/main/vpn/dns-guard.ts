import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
import { createServer, isIP, type Server as TcpServer } from 'node:net'
import { lookup } from 'node:dns/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { Settings } from '@shared/types'
import { t } from '../i18n'
import { dohEndpoint } from './engines/types'

const execFileAsync = promisify(execFile)
const PORT = 53
const MAX_DNS_MESSAGE = 65535
const LOOPBACK = new Set(['127.0.0.1', '::1', '0.0.0.0'])

interface DnsGuardState {
  udp: UdpSocket[]
  tcp: TcpServer[]
  endpoint: string
  ipv6: boolean
  requests: number
  failures: number
}

/**
 * How a resolver was configured before Eaglet replaced it:
 *  - `static`  — explicit addresses the user (or an admin) configured;
 *  - `auto`    — supplied by DHCP / the OS; must be reset, never frozen into
 *                permanent static addresses;
 *  - `unknown` — the origin could not be determined; only the loopback entry
 *                is removed, nothing is guessed.
 */
export type DnsMethod = 'static' | 'auto' | 'unknown'

export interface DnsServiceBackup {
  name: string
  /** Windows interface index; absent on macOS/Linux. */
  index?: number
  v4: string[]
  v6: string[]
  method: DnsMethod
}

export interface DnsBackup {
  version: 2
  platform: 'win32' | 'darwin' | 'linux'
  at: number
  services: DnsServiceBackup[]
}

export interface DnsRestoreReport {
  restored: string[]
  /** Interfaces whose DNS no longer pointed at the relay (changed by the user). */
  skipped: string[]
  mismatches: string[]
}

let state: DnsGuardState | null = null
/** Last restore failure, surfaced by diagnostics and the UI. */
let restoreFailure: string | null = null

function backupPath(): string {
  return join(app.getPath('userData'), 'dns-backup.json')
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function byFamily(servers: string[], version: 4 | 6): string[] {
  return [...new Set(servers.filter((server) => isIP(server) === version))]
}

/** True when any address still points at the local relay. */
export function hasLoopback(servers: string[]): boolean {
  return servers.some((server) => LOOPBACK.has(server))
}

function sameSet(left: string[], right: string[]): boolean {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* ------------------------------------------------------------------ */
/*  DNS-over-HTTPS relay                                              */
/* ------------------------------------------------------------------ */

export interface DohTarget {
  endpoint: string
  /** Hostname used for SNI/Host; may be an IP literal. */
  hostname: string
  /** Pinned address used for the TCP connection (never re-resolved). */
  address: string
  family: 4 | 6
  port: number
  path: string
}

/**
 * Resolves the DoH endpoint *before* the system resolver is redirected to the
 * loopback relay. Using the pinned IP with the original SNI/Host afterwards is
 * what prevents the classic recursion: the relay must not ask the resolver it
 * replaced to find itself.
 */
export async function prepareDohTarget(settings: Settings): Promise<DohTarget> {
  const endpoint = dohEndpoint(settings)
  const url = new URL(endpoint)
  if (url.protocol !== 'https:') throw new Error(t('DNS protection requires an https:// DoH endpoint'))
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (!hostname) throw new Error(t('The DoH endpoint has no hostname'))
  const port = url.port ? Number(url.port) : 443
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(t('The DoH endpoint has an invalid port'))
  const path = `${url.pathname === '/' ? '/dns-query' : url.pathname || '/dns-query'}${url.search}`

  const literal = isIP(hostname)
  if (literal !== 0) {
    return { endpoint, hostname, address: hostname, family: literal === 6 ? 6 : 4, port, path }
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true })
  const picked = addresses.find((entry) => entry.family === 4) ?? addresses[0]
  if (!picked) throw new Error(t('The DoH endpoint {host} could not be resolved', { host: hostname }))
  return {
    endpoint,
    hostname,
    address: picked.address,
    family: picked.family === 6 ? 6 : 4,
    port,
    path
  }
}

function resolveDoH(target: DohTarget, query: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: Buffer | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const request = httpsRequest(
      {
        host: target.address,
        port: target.port,
        method: 'POST',
        path: target.path,
        // Keep certificate validation tied to the original hostname even
        // though the socket is opened against a pinned IP.
        servername: isIP(target.hostname) === 0 ? target.hostname : undefined,
        headers: {
          host: isIP(target.hostname) === 6 ? `[${target.hostname}]` : target.hostname,
          'content-type': 'application/dns-message',
          accept: 'application/dns-message',
          'content-length': query.length,
          'user-agent': 'Eaglet-VPN'
        },
        timeout: 6000
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume()
          finish(null)
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_DNS_MESSAGE) {
            response.destroy()
            finish(null)
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => finish(chunks.length > 0 ? Buffer.concat(chunks) : null))
        response.on('error', () => finish(null))
      }
    )

    request.on('error', () => finish(null))
    request.on('timeout', () => {
      request.destroy()
      finish(null)
    })
    request.end(query)
  })
}

function startUdp(target: DohTarget, host: string, type: 'udp4' | 'udp6'): Promise<UdpSocket> {
  return new Promise((resolve, reject) => {
    const socket = createSocket(type)
    socket.once('error', reject)
    socket.on('message', (message, remote) => {
      if (message.length === 0 || message.length > 4096) return
      if (state) state.requests += 1
      void resolveDoH(target, message).then((answer) => {
        if (!answer) {
          if (state) state.failures += 1
          return
        }
        try {
          socket.send(answer, remote.port, remote.address)
        } catch {
          if (state) state.failures += 1
        }
      })
    })
    socket.bind(PORT, host, () => {
      socket.removeListener('error', reject)
      socket.on('error', () => undefined)
      resolve(socket)
    })
  })
}

function startTcp(target: DohTarget, host: string, ipv6Only: boolean): Promise<TcpServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      let buffer = Buffer.alloc(0)
      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])
        if (buffer.length > MAX_DNS_MESSAGE + 2) {
          socket.destroy()
          return
        }
        while (buffer.length >= 2) {
          const length = buffer.readUInt16BE(0)
          if (buffer.length < length + 2) return
          const query = buffer.subarray(2, length + 2)
          buffer = buffer.subarray(length + 2)
          if (state) state.requests += 1
          void resolveDoH(target, query).then((answer) => {
            if (!answer) {
              if (state) state.failures += 1
              return
            }
            const prefix = Buffer.alloc(2)
            prefix.writeUInt16BE(answer.length, 0)
            socket.write(Buffer.concat([prefix, answer]))
          })
        }
      })
      socket.on('error', () => undefined)
    })
    server.once('error', reject)
    server.listen({ port: PORT, host, ipv6Only }, () => {
      server.removeListener('error', reject)
      server.on('error', () => undefined)
      resolve(server)
    })
  })
}

/* ------------------------------------------------------------------ */
/*  Backup format                                                     */
/* ------------------------------------------------------------------ */

function writeBackup(backup: DnsBackup): void {
  const path = backupPath()
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, JSON.stringify(backup, null, 2), 'utf-8')
  try {
    renameSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

/**
 * Reads a backup written by this version or by the older `{items}`/`servers`
 * format. Legacy data carries no origin information, so non-empty resolvers
 * are restored as static and empty ones are reset — never the other way round.
 */
export function parseDnsBackup(raw: string): DnsBackup {
  const parsed = JSON.parse(raw) as DnsBackup & {
    items?: Array<{ index: number; alias: string; servers: string[] }>
    services?: Array<{ name: string; index?: number; servers?: string[]; v4?: string[]; v6?: string[]; method?: DnsMethod }>
  }
  const rawServices = Array.isArray(parsed.services)
    ? parsed.services
    : Array.isArray(parsed.items)
      ? parsed.items.map((item) => ({
          name: String(item.alias ?? item.index),
          index: Number(item.index),
          servers: Array.isArray(item.servers) ? item.servers : []
        }))
      : []
  const services: DnsServiceBackup[] = rawServices
    .map((service) => {
      const entry = service as {
        name?: string
        index?: number
        servers?: string[]
        v4?: string[]
        v6?: string[]
        method?: DnsMethod
      }
      const legacy = Array.isArray(entry.servers) ? entry.servers : null
      const v4 = legacy ? byFamily(legacy, 4) : byFamily(entry.v4 ?? [], 4)
      const v6 = legacy ? byFamily(legacy, 6) : byFamily(entry.v6 ?? [], 6)
      const method: DnsMethod =
        entry.method === 'static' || entry.method === 'auto' || entry.method === 'unknown'
          ? entry.method
          : legacy
            ? legacy.length > 0
              ? 'static'
              : 'auto'
            : 'unknown'
      return {
        name: typeof entry.name === 'string' ? entry.name : '',
        index: typeof entry.index === 'number' ? entry.index : undefined,
        v4,
        v6,
        method
      }
    })
    .filter((service) => service.name)
  return {
    version: 2,
    platform: parsed.platform,
    at: Number(parsed.at) || 0,
    services
  }
}

function readBackup(): DnsBackup {
  return parseDnsBackup(readFileSync(backupPath(), 'utf-8'))
}

/* ------------------------------------------------------------------ */
/*  Pure restore plans (unit-tested per platform)                     */
/* ------------------------------------------------------------------ */

export interface WindowsRestoreStep {
  /** Reset both families back to DHCP/automatic first. */
  reset: boolean
  /** Static addresses to apply after the reset. */
  addresses: string[]
}

/**
 * Windows needs a reset before static addresses because `-ServerAddresses`
 * replaces only the family it is given, leaving the other one on our loopback
 * value. `-ResetServerAddresses` clears both families.
 */
export function planWindowsRestore(service: DnsServiceBackup): WindowsRestoreStep {
  const addresses = [...byFamily(service.v4, 4), ...byFamily(service.v6, 6)]
  if (service.method === 'auto') return { reset: true, addresses: [] }
  if (service.method === 'static') return { reset: true, addresses }
  return { reset: addresses.length === 0, addresses }
}

export function windowsRestoreScript(services: DnsServiceBackup[]): string {
  const lines: string[] = []
  for (const service of services) {
    if (service.index === undefined) continue
    const plan = planWindowsRestore(service)
    if (plan.reset) {
      lines.push(
        `Set-DnsClientServerAddress -InterfaceIndex ${service.index} -ResetServerAddresses -ErrorAction Stop;`
      )
    }
    if (plan.addresses.length > 0) {
      lines.push(
        `Set-DnsClientServerAddress -InterfaceIndex ${service.index} -ServerAddresses ${plan.addresses.map(psQuote).join(',')} -ErrorAction Stop;`
      )
    }
  }
  lines.push('ipconfig /flushdns | Out-Null')
  return lines.join('\n')
}

export function planMacRestore(service: DnsServiceBackup): string[] {
  const servers = [...byFamily(service.v4, 4), ...byFamily(service.v6, 6)]
  if (service.method === 'static' && servers.length > 0) {
    return ['-setdnsservers', service.name, ...servers]
  }
  // Automatic and unknown both return the service to DHCP-provided resolvers.
  return ['-setdnsservers', service.name, 'Empty']
}

export function planLinuxRestore(service: DnsServiceBackup): string[] {
  const servers = [...byFamily(service.v4, 4), ...byFamily(service.v6, 6)]
  if (service.method === 'static' && servers.length > 0) {
    return ['dns', service.name, ...servers]
  }
  // `revert` drops the per-link override, so DHCP-provided DNS comes back.
  return ['revert', service.name]
}

/** True when the interface no longer points at the relay — the user changed it. */
export function userChangedDns(service: DnsServiceBackup, current: DnsServiceBackup): boolean {
  if (service.method === 'auto') return !hasLoopback([...current.v4, ...current.v6])
  if (service.method === 'static') {
    const sameAsOriginal = sameSet(current.v4, service.v4) && sameSet(current.v6, service.v6)
    const onRelay = hasLoopback([...current.v4, ...current.v6])
    return !onRelay && !sameAsOriginal
  }
  return !hasLoopback([...current.v4, ...current.v6])
}

/** Mismatch description, or `null` when the interface is back to its saved state. */
export function verifyRestored(
  service: DnsServiceBackup,
  current: DnsServiceBackup
): string | null {
  const addresses = [...current.v4, ...current.v6]
  if (hasLoopback(addresses)) return t('{name}: still points at the local relay', { name: service.name })
  if (service.method === 'static') {
    if (!sameSet(current.v4, byFamily(service.v4, 4)))
      return t('{name}: IPv4 resolvers differ', { name: service.name })
    if (!sameSet(current.v6, byFamily(service.v6, 6)))
      return t('{name}: IPv6 resolvers differ', { name: service.name })
  }
  return null
}

/* ------------------------------------------------------------------ */
/*  Platform implementations                                          */
/* ------------------------------------------------------------------ */

async function powershell(script: string, timeout = 20000): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout, windowsHide: true }
  )
  return stdout
}

const WINDOWS_READ = `
$ErrorActionPreference = 'Stop'
$items = @()
foreach ($adapter in @(Get-NetAdapter -Physical)) {
  if ($adapter.Status -ne 'Up') { continue }
  $idx = $adapter.ifIndex
  $v4 = @(Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction Stop | ForEach-Object { $_.ServerAddresses } | Where-Object { $_ })
  $v6 = @(Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv6 -ErrorAction Stop | ForEach-Object { $_.ServerAddresses } | Where-Object { $_ })
  $ip4 = Get-NetIPInterface -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction Stop
  $ip6 = Get-NetIPInterface -InterfaceIndex $idx -AddressFamily IPv6 -ErrorAction Stop
  $items += [pscustomobject]@{ index = $idx; name = $adapter.Name; v4 = $v4; v6 = $v6; dhcp4 = [string]$ip4.Dhcp; dhcp6 = [string]$ip6.Dhcp }
}
$items | ConvertTo-Json -Depth 4 -Compress
`

interface WindowsAdapter {
  index: number
  name: string
  v4: string[]
  v6: string[]
  dhcp4: string
  dhcp6: string
}

function classifyWindowsMethod(adapter: WindowsAdapter): DnsMethod {
  const v4 = byFamily(adapter.v4, 4)
  const v6 = byFamily(adapter.v6, 6)
  
  // If no DNS servers are configured, it's likely DHCP/auto
  if (v4.length === 0 && v6.length === 0) {
    return /enabled/i.test(adapter.dhcp4) || /enabled/i.test(adapter.dhcp6) ? 'auto' : 'unknown'
  }
  
  // Check if DHCP is enabled for IPv4 or IPv6
  const dhcp4Enabled = /enabled/i.test(adapter.dhcp4)
  const dhcp6Enabled = /enabled/i.test(adapter.dhcp6)
  
  // If DHCP is enabled for the corresponding family and no manual DNS is set,
  // it's likely auto-obtained DNS
  if ((dhcp4Enabled && v4.length === 0) || (dhcp6Enabled && v6.length === 0)) {
    return 'auto'
  }
  
  // If DNS servers are manually configured, it's static
  if (v4.length > 0 || v6.length > 0) {
    return 'static'
  }
  
  // Fallback to unknown
  return 'unknown'
}

async function readWindowsDns(): Promise<DnsServiceBackup[]> {
  const stdout = (await powershell(WINDOWS_READ)).trim()
  if (!stdout) throw new Error(t('PowerShell returned no adapter information'))
  const parsed = JSON.parse(stdout) as WindowsAdapter | WindowsAdapter[]
  const adapters = Array.isArray(parsed) ? parsed : [parsed]
  const services = adapters
    .filter((adapter) => adapter && Number.isFinite(Number(adapter.index)))
    .map<DnsServiceBackup>((adapter) => ({
      name: String(adapter.name ?? adapter.index),
      index: Number(adapter.index),
      v4: byFamily(Array.isArray(adapter.v4) ? adapter.v4 : [], 4),
      v6: byFamily(Array.isArray(adapter.v6) ? adapter.v6 : [], 6),
      method: classifyWindowsMethod(adapter)
    }))
  if (services.length === 0) throw new Error(t('No active network adapter was found'))
  return services
}

async function applyWindowsDns(services: DnsServiceBackup[], ipv6: boolean): Promise<void> {
  const commands = services.map((service) => {
    // IPv6 loopback is advertised only when the relay bound an IPv6 socket
    // *and* this interface already uses IPv6 resolvers.
    const addresses = ipv6 && byFamily(service.v6, 6).length > 0 ? ['127.0.0.1', '::1'] : ['127.0.0.1']
    return `Set-DnsClientServerAddress -InterfaceIndex ${service.index} -ServerAddresses ${addresses.map(psQuote).join(',')} -ErrorAction Stop;`
  })
  await powershell(`${commands.join('\n')}\nipconfig /flushdns | Out-Null`)
}

async function readMacDns(): Promise<DnsServiceBackup[]> {
  const { stdout } = await execFileAsync('networksetup', ['-listallnetworkservices'])
  const names = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('An asterisk') && !line.startsWith('*'))
  const services: DnsServiceBackup[] = []
  for (const name of names) {
    const current = await execFileAsync('networksetup', ['-getdnsservers', name])
      .then((result) => result.stdout)
      .catch(() => '')
    const servers = current
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/There aren't any/i.test(line) && isIP(line) !== 0)
    services.push({
      name,
      v4: byFamily(servers, 4),
      v6: byFamily(servers, 6),
      // "There aren't any DNS Servers set" means the service gets DNS
      // automatically (DHCP); it must be restored to that, not frozen.
      method: servers.length > 0 ? 'static' : 'auto'
    })
  }
  if (services.length === 0) throw new Error(t('No network services were found'))
  return services
}

async function applyMacDns(services: DnsServiceBackup[], ipv6: boolean): Promise<void> {
  for (const service of services) {
    const addresses = ipv6 && byFamily(service.v6, 6).length > 0 ? ['127.0.0.1', '::1'] : ['127.0.0.1']
    await execFileAsync('networksetup', ['-setdnsservers', service.name, ...addresses])
  }
}

async function linuxDefaultInterface(): Promise<string> {
  const { stdout } = await execFileAsync('sh', ['-c', "ip route show default | awk '{print $5; exit}'"])
  const iface = stdout.trim()
  if (!iface) throw new Error(t('Could not determine the default network interface'))
  return iface
}

/**
 * systemd-resolved does not expose where a resolver came from. A static DNS=
 * entry in systemd-networkd configuration is the only reliable signal; without
 * it the addresses may come from DHCP and the link must be reverted, not frozen.
 */
async function linuxHasStaticDns(iface: string): Promise<boolean> {
  try {
    // Check for static DNS configuration for the specific interface
    const { stdout: networkdOutput } = await execFileAsync('sh', [
      '-c',
      `find /etc/systemd/network -name '*.network' -exec grep -l "Interface=${iface}" {} \\; 2>/dev/null`
    ])
    
    if (networkdOutput.trim()) {
      // Check if there's a static DNS configuration for this interface
      const networkFiles = networkdOutput.trim().split('\n')
      for (const file of networkFiles) {
        const { stdout: dnsConfig } = await execFileAsync('sh', [
          '-c',
          `grep -s '^DNS=' "${file}" 2>/dev/null`
        ])
        if (dnsConfig.trim()) {
          return true
        }
      }
    }
    
    return false
  } catch {
    return false
  }
}

async function readLinuxDns(): Promise<DnsServiceBackup[]> {
  const iface = await linuxDefaultInterface()
  const current = await execFileAsync('resolvectl', ['dns', iface]).catch(() => ({ stdout: '' }))
  const servers = current.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(':') || line.includes('.'))
    .flatMap((line) => line.split(/\s+/).slice(1))
    .filter((value) => isIP(value) !== 0)
  const v4 = byFamily(servers, 4)
  const v6 = byFamily(servers, 6)
  
  // Check for static DNS configuration for this specific interface
  const staticConfig = await linuxHasStaticDns(iface)
  
  // Determine DNS method based on configuration
  let method: DnsMethod
  if (v4.length === 0 && v6.length === 0) {
    method = 'auto' // No DNS servers configured, likely DHCP
  } else if (staticConfig) {
    method = 'static' // Static DNS configuration found
  } else {
    method = 'unknown' // DNS servers configured but origin unknown
  }
  
  return [
    {
      name: iface,
      v4,
      v6,
      method
    }
  ]
}

async function applyLinuxDns(services: DnsServiceBackup[], ipv6: boolean): Promise<void> {
  for (const service of services) {
    const addresses = ipv6 && byFamily(service.v6, 6).length > 0 ? ['127.0.0.1', '::1'] : ['127.0.0.1']
    await execFileAsync('resolvectl', ['dns', service.name, ...addresses])
  }
  await execFileAsync('resolvectl', ['flush-caches']).catch(() => undefined)
}

async function readCurrentDns(): Promise<DnsServiceBackup[]> {
  if (process.platform === 'win32') return readWindowsDns()
  if (process.platform === 'darwin') return readMacDns()
  if (process.platform === 'linux') return readLinuxDns()
  throw new Error(t('DNS protection is not implemented on this platform'))
}

async function applySystemDns(services: DnsServiceBackup[], includeIpv6: boolean): Promise<void> {
  if (process.platform === 'win32') return applyWindowsDns(services, includeIpv6)
  if (process.platform === 'darwin') return applyMacDns(services, includeIpv6)
  if (process.platform === 'linux') return applyLinuxDns(services, includeIpv6)
  throw new Error(t('DNS protection is not implemented on this platform'))
}

async function verifyOverride(services: DnsServiceBackup[]): Promise<string[]> {
  const current = await readCurrentDns()
  const mismatches: string[] = []
  for (const service of services) {
    const live = current.find((item) =>
      item.index !== undefined && service.index !== undefined
        ? item.index === service.index
        : item.name === service.name
    )
    if (!live) {
      mismatches.push(`${service.name}: interface disappeared`)
      continue
    }
    if (!hasLoopback([...live.v4, ...live.v6])) {
      mismatches.push(`${service.name}: the system resolver did not switch to the local relay`)
    }
  }
  return mismatches
}

/**
 * Restores every changed adapter. Interfaces whose DNS no longer points at the
 * relay are left alone: the user changed them while the VPN was running, and
 * silently overwriting that would be worse than keeping the current value.
 */
export async function restoreSystemDns(): Promise<DnsRestoreReport> {
  if (!existsSync(backupPath())) return { restored: [], skipped: [], mismatches: [] }
  const backup = readBackup()
  if (backup.platform !== process.platform) {
    rmSync(backupPath(), { force: true })
    return { restored: [], skipped: [], mismatches: [] }
  }

  const current = await readCurrentDns()
  const skipped: string[] = []
  const targets: DnsServiceBackup[] = []
  for (const service of backup.services) {
    const live = current.find((item) =>
      item.index !== undefined && service.index !== undefined ? item.index === service.index : item.name === service.name
    )
    if (live && userChangedDns(service, live)) {
      skipped.push(service.name)
      continue
    }
    targets.push(service)
  }

  if (targets.length > 0) {
    if (backup.platform === 'win32') {
      await powershell(windowsRestoreScript(targets))
    } else if (backup.platform === 'darwin') {
      for (const service of targets) {
        await execFileAsync('networksetup', planMacRestore(service))
      }
    } else {
      for (const service of targets) {
        await execFileAsync('resolvectl', planLinuxRestore(service))
      }
      await execFileAsync('resolvectl', ['flush-caches']).catch(() => undefined)
    }
  }

  const after = await readCurrentDns()
  const mismatches: string[] = []
  for (const service of targets) {
    const live = after.find((item) =>
      item.index !== undefined && service.index !== undefined ? item.index === service.index : item.name === service.name
    )
    if (!live) {
      mismatches.push(`${service.name}: interface disappeared before verification`)
      continue
    }
    const mismatch = verifyRestored(service, live)
    if (mismatch) mismatches.push(mismatch)
  }

  if (mismatches.length > 0) {
    throw new Error(mismatches.join('; '))
  }

  // Only a verified restore may delete the backup.
  rmSync(backupPath(), { force: true })
  return { restored: targets.map((service) => service.name), skipped, mismatches }
}

function restoreSystemDnsSync(): void {
  if (!existsSync(backupPath())) return
  const backup = readBackup()
  if (backup.platform !== process.platform) {
    rmSync(backupPath(), { force: true })
    return
  }
  
  let restoreSuccess = false
  let currentDnsAfterRestore: DnsServiceBackup[] | null = null
  
  try {
    if (backup.platform === 'win32') {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          windowsRestoreScript(backup.services)
        ],
        { windowsHide: true, timeout: 12000 }
      )
    } else if (backup.platform === 'darwin') {
      for (const service of backup.services) {
        execFileSync('networksetup', planMacRestore(service), { timeout: 5000, stdio: 'ignore' })
      }
    } else {
      for (const service of backup.services) {
        execFileSync('resolvectl', planLinuxRestore(service), { timeout: 5000, stdio: 'ignore' })
      }
    }
    
    // Read actual DNS settings after restoration
    currentDnsAfterRestore = readCurrentDns()
    
    // Verify restoration
    let allRestored = true
    for (const service of backup.services) {
      const live = currentDnsAfterRestore.find((item) =>
        item.index !== undefined && service.index !== undefined ? item.index === service.index : item.name === service.name
      )
      if (!live || userChangedDns(service, live)) {
        allRestored = false
        break
      }
    }
    
    if (allRestored) {
      restoreSuccess = true
      // Only delete backup after successful verification
      rmSync(backupPath(), { force: true })
    }
  } catch (error) {
    console.error(`[dns] Synchronous restore failed: ${(error as Error).message}`)
  }
  
  if (!restoreSuccess) {
    // Keep backup for retry on next launch
    console.error('[dns] Synchronous restore verification failed, backup preserved')
    throw new Error(t('System DNS restore verification failed, backup preserved for retry'))
  }
}

function closeListeners(current: DnsGuardState | null): void {
  for (const socket of current?.udp ?? []) {
    try {
      socket.close()
    } catch {
      // already closed
    }
  }
  for (const server of current?.tcp ?? []) {
    try {
      server.close()
    } catch {
      // already closed
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export async function startDnsGuard(settings: Settings): Promise<void> {
  if (state) return
  // Resolve the DoH endpoint first: after the system resolver is redirected,
  // resolving a DoH hostname would recurse into this very relay.
  const target = await prepareDohTarget(settings)

  const udp: UdpSocket[] = []
  const tcp: TcpServer[] = []
  let ipv6 = false
  try {
    udp.push(await startUdp(target, '127.0.0.1', 'udp4'))
    tcp.push(await startTcp(target, '127.0.0.1', false))
    try {
      udp.push(await startUdp(target, '::1', 'udp6'))
      tcp.push(await startTcp(target, '::1', true))
      ipv6 = true
    } catch {
      // IPv6 loopback is unavailable; the IPv4 relay is still complete.
    }
  } catch (error) {
    closeListeners({ udp, tcp, endpoint: target.endpoint, ipv6, requests: 0, failures: 0 })
    throw new Error(
      t('DNS protection needs UDP/TCP port 53 on the loopback interface: {error}', {
        error: (error as Error).message
      })
    )
  }

  state = { udp, tcp, endpoint: target.endpoint, ipv6, requests: 0, failures: 0 }
  restoreFailure = null

  try {
    const services = await readCurrentDns()
    // Persist the exact pre-arm state before touching anything, atomically.
    writeBackup({ version: 2, platform: process.platform as DnsBackup['platform'], at: Date.now(), services })
    await applySystemDns(services, ipv6)
    const mismatches = await verifyOverride(services)
    if (mismatches.length > 0) throw new Error(mismatches.join('; '))
  } catch (error) {
    // A partially applied resolver override must never survive a failure.
    // The relay keeps answering until the restore is verified, otherwise the
    // machine would be left with 127.0.0.1 and no resolver.
    try {
      await restoreSystemDns()
    } catch (restoreError) {
      restoreFailure = (restoreError as Error).message
      throw new Error(
        t(
          'DNS protection failed ({error}) and the previous resolvers could not be restored ({restore}). The DoH relay stays running so DNS keeps working; disconnect and re-run Eaglet as administrator.',
          { error: (error as Error).message, restore: restoreFailure }
        )
      )
    }
    closeListeners(state)
    state = null
    throw new Error(
      t('DNS protection could not change the system resolver: {error}', {
        error: (error as Error).message
      })
    )
  }
}

/**
 * Restores the system resolver while the relay is still answering, then closes
 * the listeners. If the OS rejects the restore, the relay is deliberately kept
 * alive: closing it would leave every adapter pointing at a dead 127.0.0.1.
 */
export async function stopDnsGuard(): Promise<void> {
  const current = state
  let lastError: string | null = null
  let restoreSuccess = false
  
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await restoreSystemDns()
      lastError = null
      restoreSuccess = true
      break
    } catch (error) {
      lastError = (error as Error).message
      if (attempt === 0) await delay(300)
    }
  }

  if (lastError) {
    restoreFailure = lastError
    // Keep relay running to avoid DNS breakage
    console.error('[dns] System DNS restore failed, keeping relay active')
    throw new Error(
      t(
        'The system DNS could not be restored ({error}). The DoH relay stays active so DNS keeps working and the backup is kept for the next launch; disconnect again or restart Eaglet as administrator.',
        { error: lastError }
      )
    )
  }

  // Only close relay if DNS was successfully restored
  if (restoreSuccess) {
    restoreFailure = null
    state = null
    closeListeners(current)
  }
}

export function stopDnsGuardSync(): void {
  const current = state
  let restoreSuccess = false
  
  try {
    restoreSystemDnsSync()
    restoreSuccess = true
  } catch (error) {
    console.error(`[dns] Synchronous stop failed: ${(error as Error).message}`)
    // Keep the backup so the next launch can retry.
  } finally {
    // Only close relay if DNS was successfully restored
    if (restoreSuccess) {
      state = null
      closeListeners(current)
    } else {
      // Keep relay running to avoid DNS breakage
      console.error('[dns] Keeping relay active due to failed restore')
      restoreFailure = t('System DNS restore failed during shutdown')
    }
  }
}

/** Retries a restore left behind by a crash or a failed shutdown. */
export function recoverStaleDns(): void {
  if (existsSync(backupPath())) stopDnsGuardSync()
}

export function dnsGuardStats(): {
  requests: number
  failures: number
  endpoint: string | null
  restoreError: string | null
} {
  return {
    requests: state?.requests ?? 0,
    failures: state?.failures ?? 0,
    endpoint: state?.endpoint ?? null,
    restoreError: restoreFailure
  }
}
