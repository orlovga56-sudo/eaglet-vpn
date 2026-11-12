import { dohEndpoint, dnsEnabled, parseSemver, splitBypass, type EngineAdapter, type EngineBuildInput } from './types'
import type { Profile } from '@shared/types'

function decodeB64(input: string): string {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

/** YAML scalar writer: quotes strings so node names and secrets stay intact. */
function scalar(value: string | number | boolean): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function list(values: Array<string | number | boolean>): string {
  return `[${values.map((value) => scalar(value)).join(', ')}]`
}

function ssCredentials(profile: Profile): { cipher: string; password: string } {
  const withoutScheme = profile.raw.slice('ss://'.length).split('#')[0]
  let userinfo = ''
  if (withoutScheme.includes('@')) userinfo = withoutScheme.slice(0, withoutScheme.lastIndexOf('@'))
  else {
    const decoded = decodeB64(withoutScheme)
    userinfo = decoded.slice(0, decoded.lastIndexOf('@'))
  }
  const decodedUser = userinfo.includes(':') ? userinfo : decodeB64(userinfo)
  const [cipher, ...rest] = decodedUser.split(':')
  return { cipher, password: rest.join(':') }
}

type YamlMap = Record<string, string | Record<string, string>>

interface MihomoProxy {
  name: string
  type: string
  server: string
  port: number
  values: Record<string, string | number | boolean | string[] | YamlMap>
}

function proxyFor(profile: Profile): MihomoProxy | null {
  if (profile.protocol === 'direct') return null
  const base = { name: 'proxy', server: profile.host, port: profile.port }
  const uri = profile.raw.startsWith('http') ? new URL(profile.raw) : null

  if (profile.raw.startsWith('vmess://')) {
    const payload = JSON.parse(decodeB64(profile.raw.slice('vmess://'.length))) as Record<string, unknown>
    const values: MihomoProxy['values'] = {
      uuid: String(payload.id ?? ''),
      alterId: Number(payload.aid ?? 0),
      cipher: String(payload.scy ?? 'auto'),
      udp: true,
      network: String(payload.net ?? 'tcp')
    }
    if (String(payload.tls ?? '') === 'tls') {
      values.tls = true
      values.servername = String(payload.sni ?? payload.host ?? profile.host)
      values['skip-cert-verify'] = false
    }
    if (payload.net === 'ws') {
      values['ws-opts'] = {
        path: String(payload.path ?? '/'),
        headers: { Host: String(payload.host ?? '') }
      }
    } else if (payload.net === 'grpc') {
      values['grpc-opts'] = { 'grpc-service-name': String(payload.path ?? '') }
    }
    return { ...base, type: 'vmess', values }
  }

  if (profile.protocol === 'shadowsocks') {
    const { cipher, password } = ssCredentials(profile)
    return { ...base, type: 'ss', values: { cipher, password, udp: true } }
  }

  if (profile.protocol === 'hysteria2') {
    return {
      ...base,
      type: 'hysteria2',
      values: {
        password: decodeURIComponent(uri?.username ?? ''),
        sni: uri?.searchParams.get('sni') ?? profile.host,
        'skip-cert-verify': uri?.searchParams.get('insecure') === '1',
        ...(uri?.searchParams.get('obfs') ? { obfs: uri.searchParams.get('obfs')! } : {})
      }
    }
  }

  if (profile.protocol === 'tuic') {
    return {
      ...base,
      type: 'tuic',
      values: {
        uuid: decodeURIComponent(uri?.username ?? ''),
        password: decodeURIComponent(uri?.password ?? ''),
        sni: uri?.searchParams.get('sni') ?? profile.host,
        alpn: ['h3'],
        'skip-cert-verify': uri?.searchParams.get('insecure') === '1'
      }
    }
  }

  if (profile.protocol === 'socks' || profile.protocol === 'http') {
    const auth = uri
      ? {
          ...(uri.username ? { username: decodeURIComponent(uri.username) } : {}),
          ...(uri.password ? { password: decodeURIComponent(uri.password) } : {})
        }
      : {}
    return { ...base, type: profile.protocol === 'socks' ? 'socks5' : 'http', values: { ...auth, udp: true } }
  }

  if (!uri) return null
  const values: MihomoProxy['values'] = { udp: true, network: 'tcp' }
  const network = (uri.searchParams.get('type') ?? 'tcp').toLowerCase()
  if (network === 'ws' || network === 'grpc') values.network = network
  if (network === 'ws') {
    values['ws-opts'] = {
      path: uri.searchParams.get('path') ?? '/',
      headers: { Host: uri.searchParams.get('host') ?? uri.searchParams.get('sni') ?? profile.host }
    }
  } else if (network === 'grpc') {
    values['grpc-opts'] = { 'grpc-service-name': uri.searchParams.get('serviceName') ?? uri.searchParams.get('path') ?? '' }
  }
  const security = (uri.searchParams.get('security') ?? 'none').toLowerCase()
  if (security === 'tls' || security === 'reality' || profile.protocol === 'trojan') {
    values.tls = true
    values.servername = uri.searchParams.get('sni') ?? uri.searchParams.get('peer') ?? profile.host
    values['skip-cert-verify'] =
      uri.searchParams.get('allowInsecure') === '1' || uri.searchParams.get('insecure') === '1'
    const fingerprint = uri.searchParams.get('fp')
    if (fingerprint) values['client-fingerprint'] = fingerprint
    if (uri.searchParams.get('alpn')) {
      values.alpn = uri.searchParams.get('alpn')!.split(',').map((item) => item.trim()).filter(Boolean)
    }
    if (security === 'reality') {
      values['reality-opts'] = {
        'public-key': uri.searchParams.get('pbk') ?? '',
        'short-id': uri.searchParams.get('sid') ?? ''
      }
    }
  }

  if (profile.protocol === 'trojan') {
    return { ...base, type: 'trojan', values: { ...values, password: decodeURIComponent(uri.username) } }
  }

  const flow = uri.searchParams.get('flow')
  return {
    ...base,
    type: 'vless',
    values: {
      ...values,
      uuid: decodeURIComponent(uri.username),
      ...(flow ? { flow } : {})
    }
  }
}

function renderProxy(proxy: MihomoProxy): string[] {
  const lines = [`  - name: ${scalar(proxy.name)}`, `    type: ${scalar(proxy.type)}`, `    server: ${scalar(proxy.server)}`, `    port: ${proxy.port}`]
  for (const [key, value] of Object.entries(proxy.values)) {
    if (Array.isArray(value)) {
      lines.push(`    ${key}: ${list(value)}`)
    } else if (typeof value === 'object') {
      lines.push(`    ${key}:`)
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (typeof nestedValue === 'object') {
          lines.push(`      ${nestedKey}:`)
          for (const [deepKey, deepValue] of Object.entries(nestedValue)) {
            lines.push(`        ${deepKey}: ${scalar(deepValue)}`)
          }
        } else {
          lines.push(`      ${nestedKey}: ${scalar(nestedValue)}`)
        }
      }
    } else {
      lines.push(`    ${key}: ${scalar(value)}`)
    }
  }
  return lines
}

export function buildMihomoConfig({ profile, settings, mixedPort, apiPort, apiSecret }: EngineBuildInput): string {
  const proxy = proxyFor(profile)
  const isDirect = settings.routingMode === 'direct' || profile.protocol === 'direct'
  const lines: string[] = [
    '# Generated by Eaglet — do not edit while the tunnel is running.',
    `mixed-port: ${mixedPort}`,
    'allow-lan: false',
    'bind-address: 127.0.0.1',
    'mode: rule',
    'log-level: info',
    `ipv6: ${settings.ipv6 ? 'true' : 'false'}`,
    'unified-delay: true',
    'tcp-concurrent: true',
    `external-controller: ${scalar(`127.0.0.1:${apiPort}`)}`,
    `secret: ${scalar(apiSecret)}`,
    'profile:',
    '  store-selected: false',
    '  store-fake-ip: false'
  ]

  if (settings.tunMode) {
    lines.push(
      'tun:',
      '  enable: true',
      '  stack: system',
      '  device: eaglet0',
      '  auto-route: true',
      '  auto-detect-interface: true',
      "  dns-hijack:",
      '    - "any:53"'
    )
  }

  if (dnsEnabled(settings) || settings.tunMode) {
    const endpoint = new URL(dohEndpoint(settings))
    lines.push(
      'dns:',
      '  enable: true',
      `  ipv6: ${settings.ipv6 ? 'true' : 'false'}`,
      '  enhanced-mode: fake-ip',
      '  fake-ip-range: 198.18.0.1/16',
      '  fake-ip-filter:',
      '    - "*.lan"',
      '    - "*.local"',
      '  nameserver:',
      `    - ${scalar(endpoint.toString())}`,
      '  fallback:',
      '    - "tls://8.8.8.8:853"',
      // Mihomo downloads a GeoIP database when fallback-filter.geoip is true.
      // Eaglet does not ship geo assets, so the filter is IP-based only and
      // config validation never needs the network.
      '  fallback-filter:',
      '    geoip: false',
      '    ipcidr:',
      '      - "240.0.0.0/4"'
    )
  }

  if (proxy) {
    lines.push('proxies:', ...renderProxy(proxy), 'proxy-groups:', '  - name: "PROXY"', '    type: select', '    proxies:', '      - "proxy"', '      - "DIRECT"')
  }

  const rules: string[] = []
  const bypass = splitBypass(settings.bypassList)
  for (const domain of bypass.domains) rules.push(`  - "DOMAIN-SUFFIX,${domain},DIRECT"`)
  for (const cidr of bypass.cidrs) rules.push(`  - "IP-CIDR,${cidr},DIRECT,no-resolve"`)
  if (settings.routingMode === 'smart') {
    rules.push('  - "DOMAIN-SUFFIX,local,DIRECT"', '  - "DOMAIN-SUFFIX,lan,DIRECT"')
    for (const cidr of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16']) {
      rules.push(`  - "IP-CIDR,${cidr},DIRECT,no-resolve"`)
    }
  }
  if (!settings.ipv6) rules.push('  - "IP-CIDR6,::/0,REJECT"')
  if (settings.dnsProtection || settings.networkProtection) rules.push('  - "DST-PORT,53,PROXY"')
  rules.push(`  - "MATCH,${isDirect || !proxy ? 'DIRECT' : 'PROXY'}"`)
  lines.push('rules:', ...rules)
  return `${lines.join('\n')}\n`
}

export const mihomoAdapter: EngineAdapter = {
  id: 'mihomo',
  name: 'Mihomo',
  releaseRepo: 'MetaCubeX/mihomo',
  protocols: ['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria2', 'tuic', 'socks', 'http', 'direct'],
  telemetry: true,
  supportsTun: true,
  assetPattern: (platform, arch) => {
    const cpu = arch === 'arm64' ? 'arm64' : 'amd64'
    if (platform === 'win32') return new RegExp(`mihomo-windows-${cpu}-v[\\d.]+\\.zip$`)
    if (platform === 'darwin') return new RegExp(`mihomo-darwin-${cpu}-v[\\d.]+\\.zip$`)
    return new RegExp(`mihomo-linux-${cpu}-v[\\d.]+\\.(gz|zip)$`)
  },
  binaryName: (platform) => (platform === 'win32' ? 'mihomo.exe' : 'mihomo'),
  configFileName: 'config.yaml',
  buildConfig: (input) => buildMihomoConfig(input),
  validateArgs: (configPath) => ['-t', '-f', configPath],
  versionArgs: ['-v'],
  parseVersion: (output) => parseSemver(output),
  runArgs: (configPath) => ['-f', configPath]
}
