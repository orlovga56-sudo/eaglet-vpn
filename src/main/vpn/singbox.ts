import { spawn, execFile } from 'node:child_process'
import { createServer, connect as netConnect } from 'node:net'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { IpInfo, Profile, Settings } from '@shared/types'

const execFileAsync = promisify(execFile)

/**
 * sing-box integration: binary discovery/installation, config generation,
 * process lifecycle, Clash API telemetry and real IP probes.
 *
 * The same engine Happ and other modern clients use, which means every
 * mainstream share link (VLESS/Reality, VMess, Trojan, Shadowsocks, Hysteria2,
 * TUIC) works without custom protocol code.
 */

export interface CorePaths {
  binary: string | null
  version: string | null
}

export interface ClashStats {
  downTotal: number
  upTotal: number
  connections: number
}

function binaryName(): string {
  return process.platform === 'win32' ? 'sing-box.exe' : 'sing-box'
}

function candidateBinaries(): string[] {
  const name = binaryName()
  return [
    join(process.resourcesPath, 'bin', name),
    join(app.getAppPath(), 'resources', 'bin', name),
    join(app.getPath('userData'), 'bin', name)
  ]
}

export function findCore(): string | null {
  for (const candidate of candidateBinaries()) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

export async function coreVersion(binary: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binary, ['version'], { timeout: 10000, windowsHide: true })
    const match = stdout.match(/sing-box version ([\w.\-+]+)/)
    return match?.[1] ?? stdout.split(/\r?\n/)[0] ?? null
  } catch {
    return null
  }
}

/** Downloads the latest sing-box release for this platform into userData/bin. */
export async function installCore(log: (message: string) => void): Promise<string> {
  const existing = findCore()
  if (existing) return existing

  log('Downloading sing-box core…')
  const response = await fetch('https://api.github.com/repos/SagerNet/sing-box/releases/latest', {
    headers: { 'User-Agent': 'Eaglet-VPN' }
  })
  if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status})`)
  const release = (await response.json()) as { assets: Array<{ name: string; browser_download_url: string }> }
  const platformTag =
    process.platform === 'win32'
      ? `windows-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`
      : process.platform === 'darwin'
        ? `darwin-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`
        : `linux-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`
  const asset = release.assets.find(
    (item) => item.name.includes(`-${platformTag}.`) && item.name.endsWith('.zip') && !item.name.includes('legacy')
  )
  if (!asset) throw new Error('No sing-box build found for this platform')

  const archive = join(tmpdir(), `eaglet-sing-box-${Date.now()}.zip`)
  const download = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Eaglet-VPN' } })
  if (!download.ok || !download.body) throw new Error(`Core download failed (${download.status})`)

  await new Promise<void>((resolve, reject) => {
    const file = createWriteStream(archive)
    const reader = download.body!.getReader()
    const pump = async (): Promise<void> => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!file.write(Buffer.from(value))) {
            await new Promise((r) => file.once('drain', r))
          }
        }
        file.end(() => resolve())
      } catch (error) {
        reject(error)
      }
    }
    void pump()
  })

  const extracted = join(tmpdir(), `eaglet-sing-box-${Date.now()}`)
  mkdirSync(extracted, { recursive: true })
  if (process.platform === 'win32' || process.platform === 'darwin') {
    await execFileAsync('tar', ['-xf', archive, '-C', extracted])
  } else {
    await execFileAsync('unzip', ['-o', archive, '-d', extracted])
  }

  const destination = join(app.getPath('userData'), 'bin')
  mkdirSync(destination, { recursive: true })

  const walk = (dir: string): string[] => {
    const files: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) files.push(...walk(full))
      else files.push(full)
    }
    return files
  }
  for (const file of walk(extracted)) {
    const name = file.split(/[\\/]/).pop() ?? ''
    if (name.endsWith('.exe') || name.endsWith('.dll') || name === 'sing-box') {
      const target = join(destination, name)
      writeFileSync(target, readFileSync(file))
      if (process.platform !== 'win32') {
        try {
          await execFileAsync('chmod', ['+x', target])
        } catch {
          // ignore
        }
      }
    }
  }

  try {
    rmSync(archive, { force: true })
    rmSync(extracted, { recursive: true, force: true })
  } catch {
    // ignore
  }

  const binary = join(destination, binaryName())
  if (!existsSync(binary)) throw new Error('Core archive did not contain a sing-box binary')
  log('Core installed')
  return binary
}

/* ------------------------------------------------------------------ */
/*  Config                                                            */
/* ------------------------------------------------------------------ */

function tlsFromParams(uri: URL, host: string): Record<string, unknown> | undefined {
  const params = uri.searchParams
  const security = (params.get('security') ?? 'none').toLowerCase()
  if (security !== 'tls' && security !== 'reality') return undefined
  const fingerprint = params.get('fp') ?? 'chrome'
  const tls: Record<string, unknown> = {
    enabled: true,
    server_name: params.get('sni') ?? params.get('peer') ?? host,
    insecure: params.get('allowInsecure') === '1' || params.get('insecure') === '1',
    utls: { enabled: true, fingerprint }
  }
  if (security === 'reality') {
    tls.reality = {
      enabled: true,
      public_key: params.get('pbk') ?? '',
      short_id: params.get('sid') ?? ''
    }
  }
  const alpn = params.get('alpn')
  if (alpn) tls.alpn = alpn.split(',').map((item) => item.trim()).filter(Boolean)
  return tls
}

function transportFromParams(uri: URL, host: string): Record<string, unknown> | undefined {
  const params = uri.searchParams
  const type = (params.get('type') ?? params.get('net') ?? 'tcp').toLowerCase()
  const path = params.get('path') ?? '/'
  const headerHost = params.get('host') ?? params.get('sni') ?? host
  if (type === 'ws') {
    return { type: 'ws', path, headers: { Host: headerHost } }
  }
  if (type === 'grpc') {
    return { type: 'grpc', service_name: params.get('serviceName') ?? params.get('path') ?? '' }
  }
  if (type === 'http' || type === 'h2') {
    return { type: 'http', path, host: [headerHost] }
  }
  return undefined
}

function decodeB64(input: string): string {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

/** Converts a stored share link into a sing-box outbound object. */
export function outboundFor(profile: Profile): Record<string, unknown> {
  if (profile.protocol === 'direct') {
    return { type: 'direct', tag: 'proxy' }
  }

  if (profile.raw.startsWith('vmess://')) {
    const payload = JSON.parse(decodeB64(profile.raw.slice('vmess://'.length))) as Record<string, unknown>
    const tlsEnabled = String(payload.tls ?? '') === 'tls'
    const net = String(payload.net ?? 'tcp')
    let transport: Record<string, unknown> | undefined
    if (net === 'ws') transport = { type: 'ws', path: String(payload.path ?? '/'), headers: { Host: String(payload.host ?? '') } }
    else if (net === 'grpc') transport = { type: 'grpc', service_name: String(payload.path ?? '') }
    else if (net === 'h2') transport = { type: 'http', path: String(payload.path ?? '/'), host: [String(payload.host ?? '')] }
    return {
      type: 'vmess',
      tag: 'proxy',
      server: String(payload.add ?? profile.host),
      server_port: Number(payload.port ?? profile.port),
      uuid: String(payload.id ?? ''),
      security: String(payload.scy ?? 'auto'),
      alter_id: Number(payload.aid ?? 0),
      tls: tlsEnabled
        ? { enabled: true, server_name: String(payload.sni ?? payload.host ?? profile.host), insecure: false }
        : undefined,
      transport
    }
  }

  if (profile.raw.startsWith('ss://') || profile.protocol === 'shadowsocks') {
    const withoutScheme = profile.raw.slice('ss://'.length).split('#')[0]
    let userinfo = ''
    if (withoutScheme.includes('@')) {
      userinfo = withoutScheme.slice(0, withoutScheme.lastIndexOf('@'))
    } else {
      const decoded = decodeB64(withoutScheme)
      userinfo = decoded.slice(0, decoded.lastIndexOf('@'))
    }
    const decodedUser = userinfo.includes(':') ? userinfo : decodeB64(userinfo)
    const [method, ...rest] = decodedUser.split(':')
    return {
      type: 'shadowsocks',
      tag: 'proxy',
      server: profile.host,
      server_port: profile.port,
      method,
      password: rest.join(':')
    }
  }

  if (profile.protocol === 'socks' || profile.protocol === 'http') {
    const uri = new URL(profile.raw)
    return {
      type: profile.protocol,
      tag: 'proxy',
      server: profile.host,
      server_port: profile.port,
      username: decodeURIComponent(uri.username) || undefined,
      password: decodeURIComponent(uri.password) || undefined
    }
  }

  if (profile.protocol === 'hysteria2') {
    const uri = new URL(profile.raw)
    return {
      type: 'hysteria2',
      tag: 'proxy',
      server: profile.host,
      server_port: profile.port,
      password: decodeURIComponent(uri.username),
      tls: {
        enabled: true,
        server_name: uri.searchParams.get('sni') ?? profile.host,
        insecure: uri.searchParams.get('insecure') === '1'
      }
    }
  }

  if (profile.protocol === 'tuic') {
    const uri = new URL(profile.raw)
    return {
      type: 'tuic',
      tag: 'proxy',
      server: profile.host,
      server_port: profile.port,
      uuid: decodeURIComponent(uri.username),
      password: decodeURIComponent(uri.password),
      tls: {
        enabled: true,
        server_name: uri.searchParams.get('sni') ?? profile.host,
        alpn: ['h3'],
        insecure: uri.searchParams.get('insecure') === '1'
      }
    }
  }

  // VLESS and Trojan both use the URL query parameters.
  const uri = new URL(profile.raw)
  const tls = tlsFromParams(uri, profile.host)
  const transport = transportFromParams(uri, profile.host)
  if (profile.protocol === 'trojan') {
    return {
      type: 'trojan',
      tag: 'proxy',
      server: profile.host,
      server_port: profile.port,
      password: decodeURIComponent(uri.username),
      tls: tls ?? { enabled: true, server_name: profile.host, insecure: false },
      transport
    }
  }

  const flow = uri.searchParams.get('flow') ?? ''
  return {
    type: 'vless',
    tag: 'proxy',
    server: profile.host,
    server_port: profile.port,
    uuid: decodeURIComponent(uri.username),
    flow: flow || undefined,
    tls,
    transport
  }
}

function dnsFor(settings: Settings): Record<string, unknown> | undefined {
  if (settings.dns === 'auto') return undefined

  let endpoint = 'https://1.1.1.1/dns-query'
  if (settings.dns === 'google') endpoint = 'https://8.8.8.8/dns-query'
  if (settings.dns === 'custom' && settings.customDns.trim()) {
    endpoint = settings.customDns.trim()
  }
  if (!/^https?:\/\//i.test(endpoint)) endpoint = `https://${endpoint}/dns-query`

  let server = '1.1.1.1'
  let path = '/dns-query'
  let port = 443
  try {
    const url = new URL(endpoint)
    server = url.hostname
    path = url.pathname === '/' ? '/dns-query' : url.pathname
    port = Number(url.port) || 443
  } catch {
    // Keep the Cloudflare defaults.
  }

  // sing-box 1.12+ removed the legacy `address` DNS format.
  return {
    servers: [
      { type: 'local', tag: 'dns-direct' },
      {
        type: 'https',
        tag: 'dns-proxy',
        server,
        server_port: port,
        path,
        detour: 'proxy'
      }
    ],
    rules: [{ ip_is_private: true, server: 'dns-direct' }],
    final: 'dns-proxy'
  }
}

export function buildConfig(
  profile: Profile,
  settings: Settings,
  mixedPort: number,
  apiPort: number,
  apiSecret: string
): Record<string, unknown> {
  const inbounds: Record<string, unknown>[] = [
    { type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: mixedPort }
  ]
  if (settings.tunMode) {
    inbounds.push({
      type: 'tun',
      tag: 'tun-in',
      address: ['172.19.0.1/30'],
      auto_route: true,
      strict_route: true,
      stack: 'system',
      mtu: 9000
    })
  }

  const proxy = outboundFor(profile)
  const isDirect = settings.routingMode === 'direct'

  // Global sends every packet through the proxy; smart keeps the LAN direct.
  const rules =
    settings.routingMode === 'smart'
      ? [
          { ip_is_private: true, outbound: 'direct' },
          { domain_suffix: ['.local', '.lan', '.home.arpa'], outbound: 'direct' }
        ]
      : []

  const dns = dnsFor(settings)
  const useDns = Boolean(dns && !isDirect)

  const config: Record<string, unknown> = {
    log: { level: 'info', timestamp: true },
    inbounds,
    outbounds: [proxy, { type: 'direct', tag: 'direct' }],
    route: {
      rules,
      final: isDirect ? 'direct' : 'proxy',
      auto_detect_interface: true,
      ...(useDns ? { default_domain_resolver: 'dns-proxy' } : {})
    },
    experimental: {
      clash_api: {
        external_controller: `127.0.0.1:${apiPort}`,
        secret: apiSecret,
        default_mode: 'rule'
      }
    }
  }

  if (useDns) config.dns = dns
  return config
}

/* ------------------------------------------------------------------ */
/*  Process + telemetry                                               */
/* ------------------------------------------------------------------ */

export function freePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (port: number, tries: number): void => {
      const server = createServer()
      server.once('error', () => {
        server.close()
        if (tries > 25) reject(new Error('No free local port'))
        else attempt(port + 1, tries + 1)
      })
      server.once('listening', () => {
        server.close(() => resolve(port))
      })
      server.listen(port, '127.0.0.1')
    }
    attempt(start, 0)
  })
}

export function waitForPort(port: number, timeoutMs = 15000): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = netConnect({ host: '127.0.0.1', port })
      socket.setTimeout(900)
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - started > timeoutMs) reject(new Error('Core did not open the proxy port'))
        else setTimeout(attempt, 250)
      })
      socket.once('timeout', () => {
        socket.destroy()
        if (Date.now() - started > timeoutMs) reject(new Error('Core did not open the proxy port'))
        else setTimeout(attempt, 250)
      })
    }
    attempt()
  })
}

/** Runs `sing-box check` so we fail before spawning a broken process. */
export async function validateConfig(binary: string, configPath: string): Promise<void> {
  try {
    await execFileAsync(binary, ['check', '-c', configPath], { timeout: 20000, windowsHide: true })
  } catch (error) {
    const detail = (error as { stderr?: string; message?: string }).stderr?.trim()
    throw new Error(detail || (error as Error).message || 'Core rejected the generated config')
  }
}

export interface CoreProcess {
  stop: () => Promise<void>
}

export function startCore(
  binary: string,
  configPath: string,
  onLog: (level: 'info' | 'warn' | 'error', message: string) => void,
  onExit: (code: number | null) => void
): CoreProcess {
  const child = spawn(binary, ['run', '-c', configPath], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const pipe = (stream: NodeJS.ReadableStream | null, level: 'info' | 'warn' | 'error'): void => {
    if (!stream) return
    let buffer = ''
    stream.setEncoding('utf-8')
    stream.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const clean = line
          .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
          .replace(/^[+-]\d{4}\s+/, '')
          .replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+/, '')
          .replace(/^(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+/i, '')
          .trim()
        if (!clean) continue
        const mapped = /\b(FATAL|ERROR|PANIC)\b/i.test(line)
          ? 'error'
          : /\bWARN\b/i.test(line)
            ? 'warn'
            : level === 'error'
              ? 'error'
              : 'info'
        onLog(mapped, clean)
      }
    })
  }

  pipe(child.stdout, 'info')
  pipe(child.stderr, 'warn')

  let stopped = false
  child.once('exit', (code) => {
    if (!stopped) onExit(code)
  })

  return {
    stop: async () => {
      stopped = true
      if (child.pid && process.platform === 'win32') {
        try {
          await execFileAsync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
        } catch {
          child.kill()
        }
      } else {
        child.kill('SIGTERM')
      }
    }
  }
}

export async function clashStats(apiPort: number, secret: string): Promise<ClashStats | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}/connections`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(2500)
    })
    if (!response.ok) return null
    const data = (await response.json()) as {
      downloadTotal?: number
      uploadTotal?: number
      connections?: unknown[]
    }
    return {
      downTotal: data.downloadTotal ?? 0,
      upTotal: data.uploadTotal ?? 0,
      connections: data.connections?.length ?? 0
    }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/*  IP + latency probes                                               */
/* ------------------------------------------------------------------ */

function normalizeIp(payload: Record<string, unknown>): IpInfo | null {
  const ip = String(payload.query ?? payload.ip ?? '')
  if (!ip) return null
  return {
    ip,
    country: String(payload.country ?? payload.country_name ?? ''),
    countryCode: String(payload.countryCode ?? payload.country_code ?? ''),
    city: String(payload.city ?? ''),
    lat: Number(payload.lat ?? payload.latitude ?? 0),
    lon: Number(payload.lon ?? payload.longitude ?? 0)
  }
}

export async function directIp(): Promise<IpInfo | null> {
  const sources = [
    'http://ip-api.com/json/?fields=status,country,countryCode,city,query,lat,lon',
    'https://ipapi.co/json/'
  ]
  for (const source of sources) {
    try {
      const response = await fetch(source, {
        headers: { 'User-Agent': 'Eaglet-VPN' },
        signal: AbortSignal.timeout(6000)
      })
      if (!response.ok) continue
      const info = normalizeIp((await response.json()) as Record<string, unknown>)
      if (info) return info
    } catch {
      // try the next source
    }
  }
  return null
}

export async function proxiedIp(port: number): Promise<IpInfo | null> {
  const sources = [
    'http://ip-api.com/json/?fields=status,country,countryCode,city,query,lat,lon',
    'https://ipapi.co/json/'
  ]
  for (const source of sources) {
    try {
      const { stdout } = await execFileAsync(
        'curl.exe',
        ['-s', '--max-time', '12', '--proxy', `http://127.0.0.1:${port}`, source],
        { timeout: 15000, windowsHide: true }
      )
      if (!stdout.trim()) continue
      const info = normalizeIp(JSON.parse(stdout) as Record<string, unknown>)
      if (info) return info
    } catch {
      // Try the next probe.
    }
  }
  return null
}

export async function measurePing(port: number): Promise<number> {
  const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const started = Date.now()
  try {
    await execFileAsync(
      'curl.exe',
      [
        '-s',
        '-o',
        devNull,
        '--max-time',
        '8',
        '--proxy',
        `http://127.0.0.1:${port}`,
        'https://www.gstatic.com/generate_204'
      ],
      { timeout: 10000, windowsHide: true }
    )
    return Date.now() - started
  } catch {
    return 0
  }
}

/** Rough handshake latency to the node endpoint, used by the server list. */
export function tcpPing(host: string, port: number, timeoutMs = 4000): Promise<number | null> {
  if (!host || !port) return Promise.resolve(null)
  return new Promise((resolve) => {
    const started = Date.now()
    const socket = netConnect({ host, port })
    const done = (value: number | null): void => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(Date.now() - started))
    socket.once('timeout', () => done(null))
    socket.once('error', () => done(null))
  })
}
