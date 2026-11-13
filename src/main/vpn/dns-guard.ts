import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
import { createServer, isIP, type Server as TcpServer } from 'node:net'
import { lookup } from 'node:dns/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { Settings } from '@shared/types'
import { dohEndpoint } from './engines/types'

const execFileAsync = promisify(execFile)
const PORT = 53
const MAX_DNS_MESSAGE = 65535

interface DnsGuardState {
  udp: UdpSocket[]
  tcp: TcpServer[]
  endpoint: string
  ipv6: boolean
  requests: number
  failures: number
}

interface DnsServiceBackup {
  name: string
  /** Windows interface index; absent on macOS/Linux. */
  index?: number
  /** IPv4 and IPv6 resolvers, combined. */
  servers: string[]
}

interface DnsBackup {
  platform: 'win32' | 'darwin' | 'linux'
  at: number
  services: DnsServiceBackup[]
}

let state: DnsGuardState | null = null

function backupPath(): string {
  return join(app.getPath('userData'), 'dns-backup.json')
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function byFamily(servers: string[], version: 4 | 6): string[] {
  return servers.filter((server) => isIP(server) === version)
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
  if (url.protocol !== 'https:') throw new Error('DNS protection requires an https:// DoH endpoint')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (!hostname) throw new Error('The DoH endpoint has no hostname')
  const port = url.port ? Number(url.port) : 443
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The DoH endpoint has an invalid port')
  const path = `${url.pathname === '/' ? '/dns-query' : url.pathname || '/dns-query'}${url.search}`

  const literal = isIP(hostname)
  if (literal !== 0) {
    return { endpoint, hostname, address: hostname, family: literal === 6 ? 6 : 4, port, path }
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true })
  const picked = addresses.find((entry) => entry.family === 4) ?? addresses[0]
  if (!picked) throw new Error(`The DoH endpoint ${hostname} could not be resolved`)
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
/*  System resolver override                                          */
/* ------------------------------------------------------------------ */

function writeBackup(backup: DnsBackup): void {
  mkdirSync(dirname(backupPath()), { recursive: true })
  writeFileSync(backupPath(), JSON.stringify(backup, null, 2), 'utf-8')
}

/**
 * Reads a backup written by this version or by the older IPv4-only format
 * (`items` instead of `services`). Older data is migrated per interface so a
 * crash from a previous build still restores cleanly.
 */
function readBackup(): DnsBackup {
  const raw = JSON.parse(readFileSync(backupPath(), 'utf-8')) as DnsBackup & {
    items?: Array<{ index: number; alias: string; servers: string[] }>
  }
  const services = Array.isArray(raw.services)
    ? raw.services
    : Array.isArray(raw.items)
      ? raw.items.map((item) => ({
          name: String(item.alias ?? item.index),
          index: Number(item.index),
          servers: Array.isArray(item.servers) ? item.servers : []
        }))
      : []
  return {
    platform: raw.platform,
    at: Number(raw.at) || 0,
    services: services.map((service) => ({
      name: String(service.name),
      index: typeof service.index === 'number' ? service.index : undefined,
      servers: Array.isArray(service.servers) ? service.servers.filter((server) => isIP(server) !== 0) : []
    }))
  }
}

async function applySystemDns(includeIpv6: boolean): Promise<void> {
  const loopback = includeIpv6 ? ['127.0.0.1', '::1'] : ['127.0.0.1']
  if (process.platform === 'win32') {
    const script = `
$items = @();
Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
  $idx = $_.ifIndex;
  $v4 = @(Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $_.ServerAddresses } | Where-Object { $_ });
  $v6 = @(Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv6 -ErrorAction SilentlyContinue | ForEach-Object { $_.ServerAddresses } | Where-Object { $_ });
  $items += [pscustomobject]@{ index = $idx; alias = $_.Name; servers = @($v4 + $v6) }
}
$items | ConvertTo-Json -Compress
`
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 15000, windowsHide: true }
    )
    const parsedRaw = stdout.trim() ? (JSON.parse(stdout) as unknown) : []
    const parsed = Array.isArray(parsedRaw)
      ? (parsedRaw as Array<{ index: number; alias: string; servers: string[] }>)
      : [parsedRaw as { index: number; alias: string; servers: string[] }]
    const services: DnsServiceBackup[] = parsed
      .filter((item) => item && Number.isFinite(Number(item.index)))
      .map((item) => ({
        index: Number(item.index),
        name: String(item.alias ?? item.index),
        servers: Array.isArray(item.servers) ? item.servers.filter((server) => isIP(server) !== 0) : []
      }))
    if (services.length === 0) throw new Error('No active network adapter was found')

    writeBackup({ platform: 'win32', at: Date.now(), services })
    const commands = services.map((service) => {
      // A single cmdlet call keeps both families in sync; setting them in two
      // calls can clear the family that was configured first. IPv6 loopback is
      // only advertised when the relay really bound an IPv6 socket *and* this
      // interface already uses IPv6 resolvers.
      const addresses =
        includeIpv6 && byFamily(service.servers, 6).length > 0 ? loopback : ['127.0.0.1']
      return `Set-DnsClientServerAddress -InterfaceIndex ${service.index} -ServerAddresses ${addresses.map(psQuote).join(',')} -ErrorAction Stop;`
    })
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `${commands.join('\n')}\nipconfig /flushdns | Out-Null`
      ],
      { timeout: 20000, windowsHide: true }
    )
    return
  }

  if (process.platform === 'darwin') {
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
      services.push({
        name,
        servers: current
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !/There aren't any/i.test(line))
      })
    }
    if (services.length === 0) throw new Error('No network services were found')
    writeBackup({ platform: 'darwin', at: Date.now(), services })
    for (const service of services) {
      const addresses =
        includeIpv6 && byFamily(service.servers, 6).length > 0 ? loopback : ['127.0.0.1']
      await execFileAsync('networksetup', ['-setdnsservers', service.name, ...addresses])
    }
    return
  }

  if (process.platform === 'linux') {
    const { stdout } = await execFileAsync('sh', ['-c', "ip route show default | awk '{print $5; exit}'"])
    const iface = stdout.trim()
    if (!iface) throw new Error('Could not determine the default network interface')
    const current = await execFileAsync('resolvectl', ['dns', iface]).catch(() => ({ stdout: '' }))
    const servers = current.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes(':') || line.includes('.'))
      .flatMap((line) => line.split(/\s+/).slice(1))
      .filter((value) => isIP(value) !== 0)
    writeBackup({ platform: 'linux', at: Date.now(), services: [{ name: iface, servers }] })
    const addresses = includeIpv6 && byFamily(servers, 6).length > 0 ? loopback : ['127.0.0.1']
    await execFileAsync('resolvectl', ['dns', iface, ...addresses])
    await execFileAsync('resolvectl', ['flush-caches']).catch(() => undefined)
    return
  }

  throw new Error('DNS protection is not implemented on this platform')
}

/** Restores both address families. Throws when the OS rejects a command so the backup survives. */
async function restoreSystemDns(): Promise<void> {
  if (!existsSync(backupPath())) return
  const backup = readBackup()
  if (backup.platform !== process.platform) {
    rmSync(backupPath(), { force: true })
    return
  }

  if (backup.platform === 'win32') {
    const lines: string[] = []
    for (const service of backup.services) {
      const v4 = byFamily(service.servers, 4)
      const v6 = byFamily(service.servers, 6)
      if (v4.length === 0 && v6.length === 0) {
        lines.push(`Set-DnsClientServerAddress -InterfaceIndex ${service.index} -ResetServerAddresses;`)
        continue
      }
      if (v4.length === 0) {
        // DHCP-provided IPv4 resolvers: a reset clears both families, then the
        // saved IPv6 servers are re-applied.
        lines.push(`Set-DnsClientServerAddress -InterfaceIndex ${service.index} -ResetServerAddresses;`)
      }
      const addresses = [...v4, ...v6]
      lines.push(
        `Set-DnsClientServerAddress -InterfaceIndex ${service.index} -ServerAddresses ${addresses.map(psQuote).join(',')};`
      )
    }
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `${lines.join('\n')}\nipconfig /flushdns | Out-Null`],
      { timeout: 20000, windowsHide: true }
    )
  } else if (backup.platform === 'darwin') {
    for (const service of backup.services) {
      const args =
        service.servers.length > 0
          ? ['-setdnsservers', service.name, ...service.servers]
          : ['-setdnsservers', service.name, 'Empty']
      await execFileAsync('networksetup', args)
    }
  } else if (backup.platform === 'linux') {
    for (const service of backup.services) {
      if (service.servers.length > 0) {
        await execFileAsync('resolvectl', ['dns', service.name, ...service.servers])
      } else {
        await execFileAsync('resolvectl', ['revert', service.name])
      }
    }
    await execFileAsync('resolvectl', ['flush-caches']).catch(() => undefined)
  }
  rmSync(backupPath(), { force: true })
}

function restoreSystemDnsSync(): void {
  if (!existsSync(backupPath())) return
  const backup = readBackup()
  if (backup.platform !== process.platform) {
    rmSync(backupPath(), { force: true })
    return
  }
  if (backup.platform === 'win32') {
    const lines: string[] = []
    for (const service of backup.services) {
      const v4 = byFamily(service.servers, 4)
      const v6 = byFamily(service.servers, 6)
      if (v4.length === 0) {
        lines.push(`Set-DnsClientServerAddress -InterfaceIndex ${service.index} -ResetServerAddresses;`)
      }
      const addresses = [...v4, ...v6]
      if (addresses.length > 0) {
        lines.push(
          `Set-DnsClientServerAddress -InterfaceIndex ${service.index} -ServerAddresses ${addresses.map(psQuote).join(',')};`
        )
      }
    }
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', lines.join('\n')],
      { windowsHide: true, timeout: 9000 }
    )
  } else if (backup.platform === 'darwin') {
    for (const service of backup.services) {
      const args =
        service.servers.length > 0
          ? ['-setdnsservers', service.name, ...service.servers]
          : ['-setdnsservers', service.name, 'Empty']
      execFileSync('networksetup', args, { timeout: 5000, stdio: 'ignore' })
    }
  } else {
    for (const service of backup.services) {
      if (service.servers.length > 0) {
        execFileSync('resolvectl', ['dns', service.name, ...service.servers], { timeout: 5000, stdio: 'ignore' })
      } else {
        execFileSync('resolvectl', ['revert', service.name], { timeout: 5000, stdio: 'ignore' })
      }
    }
  }
  rmSync(backupPath(), { force: true })
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
      `DNS protection needs UDP/TCP port 53 on the loopback interface: ${(error as Error).message}`
    )
  }

  state = { udp, tcp, endpoint: target.endpoint, ipv6, requests: 0, failures: 0 }
  try {
    await applySystemDns(ipv6)
  } catch (error) {
    // A partially applied resolver override must never survive a failure.
    try {
      await restoreSystemDns()
    } catch {
      // The backup stays on disk for the next launch.
    }
    closeListeners(state)
    state = null
    throw new Error(
      `DNS protection could not change the system resolver: ${(error as Error).message}`
    )
  }
}

/**
 * Restores the system resolver while the relay is still answering, then closes
 * the listeners. If the OS rejects the restore it is retried once and the
 * backup file is kept so the next launch can finish the job.
 */
export async function stopDnsGuard(): Promise<void> {
  const current = state
  let restored = false
  for (let attempt = 0; attempt < 2 && !restored; attempt += 1) {
    try {
      await restoreSystemDns()
      restored = true
    } catch {
      if (attempt === 0) await delay(250)
    }
  }
  if (!restored && existsSync(backupPath())) {
    console.warn('[dns-guard] resolver restore failed; the backup was kept for the next launch')
  }
  state = null
  closeListeners(current)
}

export function stopDnsGuardSync(): void {
  const current = state
  try {
    restoreSystemDnsSync()
  } catch {
    // Keep the backup so the next launch can retry.
  } finally {
    state = null
    closeListeners(current)
  }
}

export function recoverStaleDns(): void {
  if (existsSync(backupPath())) stopDnsGuardSync()
}

export function dnsGuardStats(): { requests: number; failures: number; endpoint: string | null } {
  return {
    requests: state?.requests ?? 0,
    failures: state?.failures ?? 0,
    endpoint: state?.endpoint ?? null
  }
}
