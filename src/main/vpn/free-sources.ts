import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FreeDiscoveryResult, FreeSourceStatus, Profile, Settings } from '@shared/types'
import { parseProfilesPayload } from './profiles'
import { buildConfig, freePort, quickProxiedIp, startCore, tcpPing, waitForPort } from './singbox'

/**
 * Public free-node catalogs.
 *
 * These are community-maintained GitHub repositories that publish collections
 * of share links. Nothing is bundled or trusted: every search re-downloads the
 * latest list, deduplicates it, TCP-tests a sample, then boots a throwaway
 * sing-box instance for the most promising nodes to confirm that HTTP traffic
 * really leaves through them.
 */
export const FREE_SOURCES: Array<{ name: string; url: string }> = [
  {
    name: 'V2RayAggregator',
    url: 'https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/sub/sub_merge.txt'
  },
  {
    name: 'NoMoreWalls',
    url: 'https://raw.githubusercontent.com/peasoft/NoMoreWalls/master/list.txt'
  },
  {
    name: 'ermaozi',
    url: 'https://raw.githubusercontent.com/ermaozi/get_subscribe/main/subscribe/v2ray.txt'
  },
  {
    name: 'ts-sf/fly',
    url: 'https://raw.githubusercontent.com/ts-sf/fly/main/v2'
  },
  {
    name: 'Pawdroid',
    url: 'https://raw.githubusercontent.com/Pawdroid/Free-servers/main/sub'
  },
  {
    name: 'freefq',
    url: 'https://raw.githubusercontent.com/freefq/free/master/v2'
  },
  {
    name: 'ripaojiedian',
    url: 'https://raw.githubusercontent.com/ripaojiedian/freenode/main/sub'
  }
]

const FETCH_TIMEOUT_MS = 20000
const PING_TIMEOUT_MS = 2200
const CANDIDATES = 140
const PING_CONCURRENCY = 24
const RESULTS = 40
const DEFAULT_SELECTION = 10
const VERIFY_LIMIT = 28
const VERIFY_TARGET = 8
const VERIFY_CONCURRENCY = 4
const VERIFY_TIMEOUT_MS = 6000

export interface FreeDiscoveryOptions {
  settings: Settings
  /** Path to sing-box; when missing, results are TCP-checked but not verified. */
  corePath: string | null
  onProgress?: (message: string) => void
}

async function fetchCatalog(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Eaglet/1.0 (public node finder)',
      Accept: 'text/plain, */*'
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap], copy[index]]
  }
  return copy
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      output[index] = await task(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return output
}

/**
 * Boots a temporary core for one node and asks it for the exit IP. Nodes that
 * cannot carry a single HTTP request are useless to the user even if the port
 * happens to accept TCP connections, so they are dropped here.
 */
async function verifyProfile(
  profile: Profile,
  settings: Settings,
  corePath: string,
  slot: number
): Promise<string | null> {
  const dir = join(tmpdir(), `eaglet-verify-${process.pid}-${slot}`)
  const configPath = join(dir, 'config.json')
  mkdirSync(dir, { recursive: true })

  const mixedPort = await freePort(2340 + slot * 8)
  const apiPort = await freePort(mixedPort + 4)
  const isolated: Settings = { ...settings, tunMode: false }

  try {
    const config = buildConfig(profile, isolated, mixedPort, apiPort, `free-check-${slot}`)
    config.log = { level: 'error', timestamp: false }
    writeFileSync(configPath, JSON.stringify(config), 'utf-8')

    const proc = startCore(
      corePath,
      configPath,
      () => undefined,
      () => undefined
    )
    try {
      await waitForPort(mixedPort, 8000)
      return await quickProxiedIp(mixedPort, VERIFY_TIMEOUT_MS)
    } finally {
      await proc.stop().catch(() => undefined)
    }
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function verifyCandidates(
  candidates: Profile[],
  settings: Settings,
  corePath: string,
  onProgress?: (message: string) => void
): Promise<Profile[]> {
  const pool = candidates.slice(0, VERIFY_LIMIT)
  const verified: Profile[] = []
  let cursor = 0

  const worker = async (slot: number): Promise<void> => {
    for (;;) {
      if (verified.length >= VERIFY_TARGET) return
      const index = cursor
      cursor += 1
      if (index >= pool.length) return
      onProgress?.(`Verifying node ${index + 1} of ${pool.length}`)
      const exit = await verifyProfile(pool[index], settings, corePath, slot)
      if (exit) verified.push(pool[index])
    }
  }

  await Promise.all(Array.from({ length: VERIFY_CONCURRENCY }, (_, slot) => worker(slot)))

  return verified
    .sort((left, right) => (left.ping ?? Infinity) - (right.ping ?? Infinity))
    .slice(0, RESULTS)
}

export async function discoverFreeProfiles(options: FreeDiscoveryOptions): Promise<FreeDiscoveryResult> {
  const { settings, corePath, onProgress } = options

  onProgress?.('Downloading community catalogs')
  const settled = await Promise.allSettled(
    FREE_SOURCES.map(async (source) => ({
      source,
      profiles: parseProfilesPayload(await fetchCatalog(source.url))
    }))
  )

  const sources: FreeSourceStatus[] = []
  const unique = new Map<string, Profile>()
  settled.forEach((result, index) => {
    const source = FREE_SOURCES[index]
    if (result.status === 'fulfilled') {
      sources.push({
        name: source.name,
        url: source.url,
        count: result.value.profiles.length,
        error: null
      })
      for (const profile of result.value.profiles) {
        if (!unique.has(profile.id)) unique.set(profile.id, profile)
      }
    } else {
      sources.push({
        name: source.name,
        url: source.url,
        count: 0,
        error: (result.reason as Error)?.message ?? 'Request failed'
      })
    }
  })

  const all = [...unique.values()].filter((profile) => profile.protocol !== 'direct' && profile.port > 0)

  let remaining = all
  let testedTotal = 0
  let reachableTotal = 0
  let profiles: Profile[] = []
  // Public lists are mostly dead nodes, so a single 140-node sample can come
  // back empty. One extra pass with fresh candidates noticeably improves the
  // odds without making the common case slower.
  const passes = corePath ? 2 : 1

  for (let pass = 0; pass < passes; pass += 1) {
    const candidates = shuffle(remaining).slice(0, CANDIDATES)
    if (candidates.length === 0) break
    onProgress?.(
      pass === 0
        ? `Checking ${candidates.length} node ports`
        : 'No working nodes in the first sample · trying another batch'
    )

    const measured = await mapLimit(candidates, PING_CONCURRENCY, async (profile) => ({
      profile,
      ping: await tcpPing(profile.host, profile.port, PING_TIMEOUT_MS)
    }))

    const reachable = measured
      .filter((item): item is { profile: Profile; ping: number } => item.ping !== null)
      .sort((left, right) => left.ping - right.ping)
      .map((item) => ({ ...item.profile, ping: Math.round(item.ping) }))

    testedTotal += candidates.length
    reachableTotal += reachable.length

    profiles = corePath
      ? await verifyCandidates(reachable, settings, corePath, onProgress)
      : reachable.slice(0, RESULTS)
    if (profiles.length > 0) break

    const checked = new Set(candidates.map((profile) => profile.id))
    remaining = remaining.filter((profile) => !checked.has(profile.id))
  }

  return {
    profiles,
    sources,
    found: all.length,
    tested: testedTotal,
    reachable: reachableTotal,
    verified: Boolean(corePath),
    fetchedAt: Date.now(),
    defaultSelection: Math.min(DEFAULT_SELECTION, profiles.length)
  }
}
