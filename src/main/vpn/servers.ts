import type { ServerInfo } from '@shared/types'

/**
 * Demo catalogue. Coordinates (`x`, `y`) are normalised 0..1 positions on the
 * dotted world map, roughly matching the real capitals so the arc lands in a
 * believable place.
 */
export const SERVERS: ServerInfo[] = [
  { id: 'nl-ams', country: 'Netherlands', code: 'NL', city: 'Amsterdam', ping: 12, load: 34, premium: false, x: 0.5136, y: 0.209 },
  { id: 'de-fra', country: 'Germany', code: 'DE', city: 'Frankfurt', ping: 16, load: 47, premium: false, x: 0.5241, y: 0.2217 },
  { id: 'us-nyc', country: 'United States', code: 'US', city: 'New York', ping: 18, load: 52, premium: false, x: 0.2944, y: 0.2738 },
  { id: 'sg-sin', country: 'Singapore', code: 'SG', city: 'Singapore', ping: 11, load: 41, premium: true, x: 0.7884, y: 0.4925 },
  { id: 'fr-par', country: 'France', code: 'FR', city: 'Paris', ping: 14, load: 29, premium: false, x: 0.5065, y: 0.2286 },
  { id: 'ca-tor', country: 'Canada', code: 'CA', city: 'Toronto', ping: 17, load: 23, premium: false, x: 0.2795, y: 0.2575 },
  { id: 'jp-tyo', country: 'Japan', code: 'JP', city: 'Tokyo', ping: 24, load: 58, premium: true, x: 0.888, y: 0.3017 },
  { id: 'gb-lon', country: 'United Kingdom', code: 'GB', city: 'London', ping: 19, load: 44, premium: false, x: 0.4996, y: 0.2139 },
  { id: 'ch-zrh', country: 'Switzerland', code: 'CH', city: 'Zurich', ping: 21, load: 18, premium: true, x: 0.5237, y: 0.2368 },
  { id: 'se-sto', country: 'Sweden', code: 'SE', city: 'Stockholm', ping: 26, load: 31, premium: false, x: 0.5502, y: 0.1704 },
  { id: 'au-syd', country: 'Australia', code: 'AU', city: 'Sydney', ping: 38, load: 37, premium: false, x: 0.92, y: 0.688 },
  { id: 'br-sao', country: 'Brazil', code: 'BR', city: 'São Paulo', ping: 46, load: 26, premium: false, x: 0.3705, y: 0.6308 }
]

export const DEFAULT_SERVER_ID = 'nl-ams'

export function findServer(id: string): ServerInfo {
  return SERVERS.find((server) => server.id === id) ?? SERVERS[0]
}
