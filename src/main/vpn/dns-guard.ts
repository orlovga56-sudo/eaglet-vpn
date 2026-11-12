import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server as TcpServer } from 'node:net'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { Settings } from '@shared/types'
import { dohEndpoint } from './engines/types'

const execFileAsync = promisify(execFile)
const LISTEN = '127.0.0.1'
const PORT = 53

interface DnsGuardState {
  udp: UdpSocket | null
  tcp: TcpServer | null
  endpoint: string
  requests: number
  failures: number
}

interface WindowsDnsBackup {
  platform: 'win32'
  at: number
  items: Array<{ index: number; alias: string; servers: string[] }>
}

interface UnixDnsBackup {
  platform: 'darwin' | 'linux'
  at: number
  services: Array<{ name: string; servers: string[] }>
}

type DnsBackup = WindowsDnsBackup | UnixDnsBackup

let state: DnsGuardState | null = null

function backupPath(): string {
  return join(app.getPath('userData'), 'dns-backup.json')
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/* ------------------------------------------------------------------ */
/*  DNS-over-HTTPS relay                                              */
/* ------------------------------------------------------------------ */

async function resolveDoH(endpoint: string, query: Buffer): Promise<Buffer | null> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/dns-message',
        accept: 'application/dns-message',
        'user-agent': 'Eaglet-VPN'
      },
      body: query,
      signal: AbortSignal.timeout(6000)
    })
    if (!response.ok) return null
    return Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }
}

function startUdp(endpoint: string): Promise<UdpSocket> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4')
    socket.once('error', reject)
    socket.on('message', (message, remote) => {
      if (!state) return
      state.requests += 1
      void resolveDoH(endpoint, message).then((answer) => {
        if (!answer) {
          if (state) state.failures += 1
          return
        }
        socket.send(answer, remote.port, remote.address)
      })
    })
    socket.bind(PORT, LISTEN, () => {
      socket.removeListener('error', reject)
      socket.on('error', () => undefined)
      resolve(socket)
    })
  })
}

function startTcp(endpoint: string): Promise<TcpServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      let buffer = Buffer.alloc(0)
      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])
        while (buffer.length >= 2) {
          const length = buffer.readUInt16BE(0)
          if (buffer.length < length + 2) return
          const query = buffer.subarray(2, length + 2)
          buffer = buffer.subarray(length + 2)
          if (state) state.requests += 1
          void resolveDoH(endpoint, query).then((answer) => {
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
    server.listen(PORT, LISTEN, () => {
      server.removeListener('error', reject)
      server.on('error', () => undefined)
      resolve(server)
    })
  })
}

/* ------------------------------------------------------------------ */
/*  System resolver override                                          */
/* ------------------------------------------------------------------ */

async function applySystemDns(): Promise<void> {
  if (process.platform === 'win32') {
    const script = `
$items = @();
Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
  $dns = Get-DnsClientServerAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue;
  if ($dns) { $items += [pscustomobject]@{ index = $_.ifIndex; alias = $_.Name; servers = @($dns.ServerAddresses) } }
}
$items | ConvertTo-Json -Compress
`
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 15000, windowsHide: true }
    )
    const parsed = stdout.trim() ? (JSON.parse(stdout) as Array<{ index: number; alias: string; servers: string[] }>) : []
    const items = parsed.map((item) => ({
      index: Number(item.index),
      alias: String(item.alias),
      servers: Array.isArray(item.servers) ? item.servers.filter(Boolean) : []
    }))
    mkdirSync(dirname(backupPath()), { recursive: true })
    writeFileSync(
      backupPath(),
      JSON.stringify({ platform: 'win32', at: Date.now(), items } satisfies WindowsDnsBackup, null, 2),
      'utf-8'
    )
    const set = items
      .map((item) => `Set-DnsClientServerAddress -InterfaceIndex ${item.index} -ServerAddresses 127.0.0.1 -ErrorAction Stop;`)
      .join('\n')
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `${set}\nipconfig /flushdns | Out-Null`],
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
    const services: Array<{ name: string; servers: string[] }> = []
    for (const name of names) {
      const current = await execFileAsync('networksetup', ['-getdnsservers', name])
        .then((result) => result.stdout)
        .catch(() => '')
      if (!current.trim()) continue
      services.push({
        name,
        servers: current
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !/There aren't any/i.test(line))
      })
    }
    mkdirSync(dirname(backupPath()), { recursive: true })
    writeFileSync(
      backupPath(),
      JSON.stringify({ platform: 'darwin', at: Date.now(), services } satisfies UnixDnsBackup, null, 2),
      'utf-8'
    )
    for (const service of services) {
      await execFileAsync('networksetup', ['-setdnsservers', service.name, LISTEN])
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
      .filter((line) => line.includes('.'))
      .flatMap((line) => line.split(/\s+/).slice(1))
      .filter((value) => /^\d+\.\d+\.\d+\.\d+$/.test(value))
    mkdirSync(dirname(backupPath()), { recursive: true })
    writeFileSync(
      backupPath(),
      JSON.stringify(
        { platform: 'linux', at: Date.now(), services: [{ name: iface, servers }] } satisfies UnixDnsBackup,
        null,
        2
      ),
      'utf-8'
    )
    await execFileAsync('resolvectl', ['dns', iface, LISTEN])
    await execFileAsync('resolvectl', ['flush-caches']).catch(() => undefined)
    return
  }

  throw new Error('DNS protection is not implemented on this platform')
}

async function restoreSystemDns(): Promise<void> {
  if (!existsSync(backupPath())) return
  const backup = JSON.parse(readFileSync(backupPath(), 'utf-8')) as DnsBackup
  if (backup.platform === 'win32') {
    const lines = backup.items
      .map((item) =>
        item.servers.length > 0
          ? `Set-DnsClientServerAddress -InterfaceIndex ${item.index} -ServerAddresses ${item.servers.map(psQuote).join(',')} -ErrorAction SilentlyContinue;`
          : `Set-DnsClientServerAddress -InterfaceIndex ${item.index} -ResetServerAddresses -ErrorAction SilentlyContinue;`
      )
      .join('\n')
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `${lines}\nipconfig /flushdns | Out-Null`],
      { timeout: 20000, windowsHide: true }
    )
  } else if (backup.platform === 'darwin') {
    for (const service of backup.services) {
      const args = service.servers.length > 0 ? ['-setdnsservers', service.name, ...service.servers] : ['-setdnsservers', service.name, 'Empty']
      await execFileAsync('networksetup', args).catch(() => undefined)
    }
  } else if (backup.platform === 'linux') {
    for (const service of backup.services) {
      if (service.servers.length > 0) await execFileAsync('resolvectl', ['dns', service.name, ...service.servers]).catch(() => undefined)
      else await execFileAsync('resolvectl', ['revert', service.name]).catch(() => undefined)
    }
  }
  rmSync(backupPath(), { force: true })
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export async function startDnsGuard(settings: Settings): Promise<void> {
  if (state) return
  const endpoint = dohEndpoint(settings)
  // Bind the loopback resolvers first; if port 53 is taken or not privileged,
  // do not touch the system DNS configuration.
  let udp: UdpSocket | null = null
  let tcp: TcpServer | null = null
  try {
    udp = await startUdp(endpoint)
    tcp = await startTcp(endpoint)
    state = { udp, tcp, endpoint, requests: 0, failures: 0 }
    await applySystemDns()
  } catch (error) {
    udp?.close()
    tcp?.close()
    state = null
    throw new Error(
      `DNS protection needs UDP/TCP port 53 on 127.0.0.1 and permission to change the system resolver: ${(error as Error).message}`
    )
  }
}

export async function stopDnsGuard(): Promise<void> {
  const current = state
  state = null
  current?.udp?.close()
  current?.tcp?.close()
  await restoreSystemDns().catch(() => undefined)
}

export function stopDnsGuardSync(): void {
  state?.udp?.close()
  state?.tcp?.close()
  state = null
  if (!existsSync(backupPath())) return
  try {
    const backup = JSON.parse(readFileSync(backupPath(), 'utf-8')) as DnsBackup
    if (backup.platform === 'win32') {
      const lines = backup.items
        .map((item) =>
          item.servers.length > 0
            ? `Set-DnsClientServerAddress -InterfaceIndex ${item.index} -ServerAddresses ${item.servers.map(psQuote).join(',')};`
            : `Set-DnsClientServerAddress -InterfaceIndex ${item.index} -ResetServerAddresses;`
        )
        .join('\n')
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', lines],
        { windowsHide: true, timeout: 8000 }
      )
    } else if (backup.platform === 'darwin') {
      for (const service of backup.services) {
        const args = service.servers.length > 0 ? ['-setdnsservers', service.name, ...service.servers] : ['-setdnsservers', service.name, 'Empty']
        execFileSync('networksetup', args, { timeout: 4000, stdio: 'ignore' })
      }
    } else {
      for (const service of backup.services) {
        if (service.servers.length > 0) execFileSync('resolvectl', ['dns', service.name, ...service.servers], { timeout: 4000, stdio: 'ignore' })
        else execFileSync('resolvectl', ['revert', service.name], { timeout: 4000, stdio: 'ignore' })
      }
    }
    rmSync(backupPath(), { force: true })
  } catch {
    // Keep the backup so the next launch can retry.
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
