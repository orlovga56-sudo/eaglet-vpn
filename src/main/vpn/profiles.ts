import { createHash } from 'node:crypto'
import type { Profile, ProtocolId } from '@shared/types'

/**
 * Share-link parser. Supports the formats Happ/Shadowrocket/v2rayN export:
 * vless://, vmess://, trojan://, ss://, hysteria2://, tuic://, socks://, http://.
 * A subscription is a base64 (or plain) list of those links.
 */

const PROTOCOLS: ProtocolId[] = [
  'vless',
  'vmess',
  'trojan',
  'shadowsocks',
  'hysteria2',
  'tuic',
  'socks',
  'http',
  'direct'
]

export function profileId(raw: string): string {
  return createHash('sha1').update(raw.trim()).digest('hex').slice(0, 12)
}

function decodeBase64(input: string): string {
  const normalized = input.trim().replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64').toString('utf-8')
}

function looksBase64(input: string): boolean {
  const compact = input.replace(/\s+/g, '')
  if (compact.length < 32 || !/^[A-Za-z0-9+/=_-]+$/.test(compact)) return false
  try {
    const decoded = decodeBase64(compact)
    return decoded.includes('://')
  } catch {
    return false
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function nameFromUri(uri: URL, fallback: string): string {
  return uri.hash ? safeDecode(uri.hash.slice(1)).trim() || fallback : fallback
}

function buildProfile(raw: string, fields: Partial<Profile> & Pick<Profile, 'name' | 'protocol' | 'host' | 'port'>): Profile {
  return {
    id: profileId(raw),
    raw: raw.trim(),
    sourceId: null,
    ping: null,
    addedAt: Date.now(),
    ...fields
  }
}

function parseVmess(raw: string): Profile | null {
  try {
    const payload = JSON.parse(decodeBase64(raw.slice('vmess://'.length)))
    const host = String(payload.add ?? payload.host ?? '')
    const port = Number(payload.port) || 443
    if (!host) return null
    return buildProfile(raw, {
      name: String(payload.ps ?? payload.remarks ?? `${host}:${port}`).trim(),
      protocol: 'vmess',
      host,
      port
    })
  } catch {
    return null
  }
}

function parseShadowsocks(raw: string): Profile | null {
  try {
    const withoutScheme = raw.slice('ss://'.length)
    const [body, hash = ''] = withoutScheme.split('#')
    let name = safeDecode(hash).trim()
    let userinfo = ''
    let endpoint = ''

    if (body.includes('@')) {
      const at = body.lastIndexOf('@')
      userinfo = body.slice(0, at)
      endpoint = body.slice(at + 1)
    } else {
      const decoded = decodeBase64(body)
      const at = decoded.lastIndexOf('@')
      if (at < 0) return null
      userinfo = decoded.slice(0, at)
      endpoint = decoded.slice(at + 1)
    }

    const decodedUser = userinfo.includes(':') ? userinfo : decodeBase64(userinfo)
    if (!decodedUser.includes(':')) return null
    endpoint = endpoint.split('?')[0]
    const colon = endpoint.lastIndexOf(':')
    if (colon < 0) return null
    const host = endpoint.slice(0, colon).replace(/^\[|\]$/g, '')
    const port = Number(endpoint.slice(colon + 1)) || 443
    if (!host) return null
    if (!name) name = `${host}:${port}`
    return buildProfile(raw, { name, protocol: 'shadowsocks', host, port })
  } catch {
    return null
  }
}

export function parseProfileUri(input: string): Profile | null {
  const raw = input.trim()
  if (!raw) return null
  const scheme = raw.slice(0, raw.indexOf('://')).toLowerCase()
  if (scheme === 'ss') return parseShadowsocks(raw)
  if (!PROTOCOLS.includes(scheme as ProtocolId)) return null

  if (scheme === 'vmess') return parseVmess(raw)
  if (scheme === 'shadowsocks') return parseShadowsocks(raw)
  if (scheme === 'direct') {
    const name = safeDecode(raw.slice('direct://'.length)) || 'Direct connection'
    return buildProfile(raw, { name, protocol: 'direct', host: 'direct', port: 0 })
  }

  try {
    const uri = new URL(raw)
    const host = uri.hostname.replace(/^\[|\]$/g, '')
    const port = Number(uri.port) || (scheme === 'http' ? 80 : 443)
    if (!host) return null
    const protocol = scheme === 'socks' ? 'socks' : (scheme as ProtocolId)
    const name = nameFromUri(uri, `${host}:${port}`)
    return buildProfile(raw, { name, protocol, host, port })
  } catch {
    return null
  }
}

export function parseProfilesPayload(text: string): Profile[] {
  let payload = text.trim()
  if (!payload) return []

  if (looksBase64(payload)) {
    try {
      payload = decodeBase64(payload)
    } catch {
      // Keep the original text.
    }
  }

  const profiles: Profile[] = []
  const seen = new Set<string>()
  for (const line of payload.split(/\r?\n/)) {
    const candidate = line.trim()
    if (!candidate || candidate.startsWith('#') || candidate.startsWith('//')) continue
    const profile = parseProfileUri(candidate)
    if (profile && !seen.has(profile.id)) {
      seen.add(profile.id)
      profiles.push(profile)
    }
  }
  return profiles
}

export function isHttpUrl(text: string): boolean {
  return /^https?:\/\//i.test(text.trim())
}

/**
 * Turns a share link or an HTTP(S) subscription into a human name.
 */
export function subscriptionName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host
  } catch {
    return 'Subscription'
  }
}
