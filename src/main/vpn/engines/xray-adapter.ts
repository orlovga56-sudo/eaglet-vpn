import type { EngineBuildInput, EngineAdapter } from './types'
import { dohEndpoint, dnsEnabled, parseSemver, splitBypass } from './types'
import type { Profile } from '@shared/types'

function decodeB64(input: string): string {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

function query(uri: URL): URLSearchParams {
  return uri.searchParams
}

function streamSettings(uri: URL, host: string, network?: string): Record<string, unknown> {
  const params = query(uri)
  const type = (network ?? params.get('type') ?? params.get('net') ?? 'tcp').toLowerCase()
  const security = (params.get('security') ?? 'none').toLowerCase()
  const sni = params.get('sni') ?? params.get('peer') ?? host
  const stream: Record<string, unknown> = {
    network: type === 'h2' ? 'http' : type === 'http' ? 'http' : type
  }

  if (security === 'tls') {
    stream.security = 'tls'
    stream.tlsSettings = {
      serverName: sni,
      allowInsecure: params.get('allowInsecure') === '1' || params.get('insecure') === '1',
      fingerprint: params.get('fp') ?? 'chrome',
      ...(params.get('alpn') ? { alpn: params.get('alpn')!.split(',').filter(Boolean) } : {})
    }
  } else if (security === 'reality') {
    stream.security = 'reality'
    stream.realitySettings = {
      serverName: sni,
      fingerprint: params.get('fp') ?? 'chrome',
      publicKey: params.get('pbk') ?? '',
      shortId: params.get('sid') ?? '',
      spiderX: params.get('spx') ?? ''
    }
  }

  if (type === 'ws') {
    stream.wsSettings = {
      path: params.get('path') ?? '/',
      headers: { Host: params.get('host') ?? sni }
    }
  } else if (type === 'grpc') {
    stream.grpcSettings = { serviceName: params.get('serviceName') ?? params.get('path') ?? '' }
  } else if (type === 'http' || type === 'h2') {
    const hosts = (params.get('host') ?? sni).split(',').map((item) => item.trim()).filter(Boolean)
    stream.httpSettings = { path: params.get('path') ?? '/', host: hosts }
  }
  return stream
}

function parseShadowsocks(profile: Profile): { method: string; password: string } {
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
  return { method, password: rest.join(':') }
}

/**
 * Xray-core only implements AEAD Shadowsocks ciphers. Legacy stream ciphers
 * such as aes-256-cfb are rejected at startup, so capability must be checked
 * before the engine is selected instead of failing after spawn.
 */
const XRAY_SS_CIPHERS = new Set([
  'aes-128-gcm',
  'aes-256-gcm',
  'chacha20-poly1305',
  'chacha20-ietf-poly1305',
  'xchacha20-poly1305',
  'xchacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305'
])

/** Private ranges kept direct in Smart mode without depending on geoip.dat. */
const PRIVATE_CIDRS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16']

function supportsProfile(profile: Profile): boolean {
  if (profile.protocol !== 'shadowsocks') return true
  try {
    return XRAY_SS_CIPHERS.has(parseShadowsocks(profile).method.toLowerCase())
  } catch {
    return false
  }
}

function outbound(profile: Profile): Record<string, unknown> {
  if (profile.protocol === 'direct') {
    return { protocol: 'freedom', tag: 'proxy', settings: {} }
  }

  if (profile.raw.startsWith('vmess://')) {
    const payload = JSON.parse(decodeB64(profile.raw.slice('vmess://'.length))) as Record<string, unknown>
    const uri = new URL(`https://${String(payload.add ?? profile.host)}`)
    uri.searchParams.set('type', String(payload.net ?? 'tcp'))
    uri.searchParams.set('security', String(payload.tls ?? 'none'))
    if (payload.sni) uri.searchParams.set('sni', String(payload.sni))
    if (payload.host) uri.searchParams.set('host', String(payload.host))
    if (payload.path) uri.searchParams.set('path', String(payload.path))
    return {
      protocol: 'vmess',
      tag: 'proxy',
      settings: {
        vnext: [
          {
            address: String(payload.add ?? profile.host),
            port: Number(payload.port ?? profile.port),
            users: [
              {
                id: String(payload.id ?? ''),
                alterId: Number(payload.aid ?? 0),
                security: String(payload.scy ?? 'auto')
              }
            ]
          }
        ]
      },
      streamSettings: streamSettings(uri, String(payload.sni ?? payload.host ?? profile.host), String(payload.net ?? 'tcp'))
    }
  }

  if (profile.protocol === 'shadowsocks') {
    const { method, password } = parseShadowsocks(profile)
    return {
      protocol: 'shadowsocks',
      tag: 'proxy',
      settings: { servers: [{ address: profile.host, port: profile.port, method, password }] }
    }
  }

  if (profile.protocol === 'socks' || profile.protocol === 'http') {
    const uri = new URL(profile.raw)
    const username = decodeURIComponent(uri.username)
    const password = decodeURIComponent(uri.password)
    return {
      protocol: profile.protocol,
      tag: 'proxy',
      settings: {
        servers: [
          {
            address: profile.host,
            port: profile.port,
            ...(username ? { users: [{ user: username, pass: password }] } : {})
          }
        ]
      }
    }
  }

  // VLESS and Trojan both use URL query parameters.
  const uri = new URL(profile.raw)
  if (profile.protocol === 'trojan') {
    return {
      protocol: 'trojan',
      tag: 'proxy',
      settings: { servers: [{ address: profile.host, port: profile.port, password: decodeURIComponent(uri.username) }] },
      streamSettings: streamSettings(uri, profile.host)
    }
  }

  const flow = uri.searchParams.get('flow') ?? ''
  return {
    protocol: 'vless',
    tag: 'proxy',
    settings: {
      vnext: [
        {
          address: profile.host,
          port: profile.port,
          users: [{ id: decodeURIComponent(uri.username), encryption: 'none', ...(flow ? { flow } : {}) }]
        }
      ]
    },
    streamSettings: streamSettings(uri, profile.host)
  }
}

function xrayDns(settings: EngineBuildInput['settings']): Record<string, unknown> | null {
  if (!dnsEnabled(settings)) return null
  const endpoint = new URL(dohEndpoint(settings))
  const doh = `https+local://${endpoint.hostname}${endpoint.pathname === '/' ? '/dns-query' : endpoint.pathname}`
  return {
    servers: [doh, 'localhost'],
    queryStrategy: settings.ipv6 ? 'UseIP' : 'UseIPv4'
  }
}

export function buildXrayConfig({ profile, settings, mixedPort, apiPort, auxPort }: EngineBuildInput): Record<string, unknown> {
  const inbounds = [
    {
      tag: 'http-in',
      listen: '127.0.0.1',
      port: mixedPort,
      protocol: 'http',
      settings: { allowTransparent: false }
    },
    {
      // Xray has no mixed inbound: a second listener keeps SOCKS clients working.
      tag: 'socks-in',
      listen: '127.0.0.1',
      port: auxPort,
      protocol: 'socks',
      settings: { auth: 'noauth', udp: true }
    },
    {
      // Native stats/management API queried through `xray api statsquery`.
      tag: 'api',
      listen: '127.0.0.1',
      port: apiPort,
      protocol: 'dokodemo-door',
      settings: { address: '127.0.0.1' }
    }
  ]

  const routingRules: Record<string, unknown>[] = [
    // Must be first: the API inbound is not a normal outbound.
    { type: 'field', inboundTag: ['api'], outboundTag: 'api' }
  ]
  if (settings.routingMode === 'direct') {
    routingRules.push({ type: 'field', inboundTag: ['http-in', 'socks-in'], outboundTag: 'direct' })
  }
  const bypass = splitBypass(settings.bypassList)
  if (bypass.domains.length > 0) {
    routingRules.push({
      type: 'field',
      domain: bypass.domains.map((domain) => `domain:${domain}`),
      outboundTag: 'direct'
    })
  }
  if (bypass.cidrs.length > 0) {
    routingRules.push({ type: 'field', ip: bypass.cidrs, outboundTag: 'direct' })
  }
  if (settings.routingMode === 'smart') {
    routingRules.push({ type: 'field', domain: ['domain:local', 'domain:lan'], outboundTag: 'direct' })
    routingRules.push({ type: 'field', ip: PRIVATE_CIDRS, outboundTag: 'direct' })
  }
  if (!settings.ipv6) {
    routingRules.push({ type: 'field', ip: ['::/0'], outboundTag: 'block' })
  }
  if (settings.dnsProtection || settings.networkProtection) {
    // Plaintext DNS is forced through the proxy so the ISP cannot see queries.
    routingRules.push({ type: 'field', port: '53', outboundTag: 'proxy' })
  }

  const config: Record<string, unknown> = {
    log: { loglevel: 'warning' },
    stats: {},
    api: { tag: 'api', services: ['StatsService'] },
    policy: {
      system: {
        statsInboundUplink: true,
        statsInboundDownlink: true,
        statsOutboundUplink: true,
        statsOutboundDownlink: true
      }
    },
    inbounds,
    outbounds: [
      outbound(profile),
      { protocol: 'freedom', tag: 'direct', settings: {} },
      { protocol: 'blackhole', tag: 'block', settings: {} }
    ],
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: routingRules
    }
  }

  const dns = xrayDns(settings)
  if (dns) config.dns = dns
  return config
}

export const xrayAdapter: EngineAdapter = {
  id: 'xray',
  name: 'Xray-core',
  releaseRepo: 'XTLS/Xray-core',
  protocols: ['vless', 'vmess', 'trojan', 'shadowsocks', 'socks', 'http', 'direct'],
  telemetry: true,
  supportsTun: false,
  supportsProfile,
  assetPattern: (platform, arch) => {
    const cpu = arch === 'arm64' ? 'arm64-v8a' : '64'
    const tag =
      platform === 'win32' ? `windows-${cpu}` : platform === 'darwin' ? `macos-${cpu}` : `linux-${cpu}`
    return new RegExp(`Xray-${tag}\\.zip$`)
  },
  binaryName: (platform) => (platform === 'win32' ? 'xray.exe' : 'xray'),
  configFileName: 'config.json',
  buildConfig: (input) => JSON.stringify(buildXrayConfig(input), null, 2),
  validateArgs: (configPath) => ['run', '-test', '-c', configPath],
  versionArgs: ['version'],
  parseVersion: (output) => parseSemver(output.match(/Xray\s+v?[\d.]+/i)?.[0] ?? output),
  runArgs: (configPath) => ['run', '-c', configPath]
}
