import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { GeoPoint, Profile } from '@shared/types'

interface BatchEntry {
  query?: string
  status?: string
  country?: string
  countryCode?: string
  city?: string
  lat?: number
  lon?: number
}

const CACHE_MS = 24 * 60 * 60 * 1000

function usable(profile: Profile): boolean {
  if (profile.protocol === 'direct' || !profile.host) return false
  if (profile.geo && Date.now() - profile.geo.resolvedAt < CACHE_MS) return false
  return true
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

/**
 * Resolves node hostnames and asks ip-api for their real coordinates. A batch
 * request keeps the free endpoint's rate limit in mind (100 addresses max).
 * Nothing is invented client-side: a node without a response simply has no pin.
 */
export async function geolocateProfiles(profiles: Profile[]): Promise<Map<string, GeoPoint>> {
  const targets = profiles.filter(usable)
  const result = new Map<string, GeoPoint>()
  if (targets.length === 0) return result

  const resolved = new Map<string, string>()
  await Promise.all(
    targets.map(async (profile) => {
      try {
        if (isIP(profile.host)) {
          resolved.set(profile.id, profile.host)
          return
        }
        const records = await lookup(profile.host, { all: true, verbatim: true })
        const address = records.find((record) => record.family === 4)?.address ?? records[0]?.address
        if (address) resolved.set(profile.id, address)
      } catch {
        // Unresolvable host: no pin.
      }
    })
  )

  const uniqueAddresses = [...new Set(resolved.values())]
  const geoByAddress = new Map<string, GeoPoint>()
  for (const addresses of chunk(uniqueAddresses, 100)) {
    try {
      const response = await fetch(
        'http://ip-api.com/batch?fields=status,message,country,countryCode,city,lat,lon,query',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'Eaglet-VPN' },
          body: JSON.stringify(addresses),
          signal: AbortSignal.timeout(12000)
        }
      )
      if (!response.ok) continue
      const payload = (await response.json()) as BatchEntry[]
      for (const entry of payload) {
        if (entry.status !== 'success' || !entry.query) continue
        geoByAddress.set(entry.query, {
          lat: Number(entry.lat ?? 0),
          lon: Number(entry.lon ?? 0),
          country: String(entry.country ?? ''),
          countryCode: String(entry.countryCode ?? ''),
          city: String(entry.city ?? ''),
          resolvedAt: Date.now()
        })
      }
    } catch {
      // Rate limit or offline — keep whatever we already resolved.
    }
  }

  for (const profile of targets) {
    const address = resolved.get(profile.id)
    const geo = address ? geoByAddress.get(address) : undefined
    if (geo) result.set(profile.id, geo)
  }
  return result
}
