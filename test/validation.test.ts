import { describe, expect, it } from 'vitest'
import {
  requireId,
  requireStringArray,
  sanitizeImportedProfiles,
  sanitizeImportedScenarios,
  sanitizeImportedSubscriptions,
  sanitizeScenarioInput,
  sanitizeSettingsPatch
} from '@shared/validation'

describe('settings validation', () => {
  it('accepts a valid patch and keeps only known keys', () => {
    const patch = sanitizeSettingsPatch({
      theme: 'neon',
      systemProxy: false,
      subscriptionIntervalHours: 12
    })
    expect(patch).toEqual({ theme: 'neon', systemProxy: false, subscriptionIntervalHours: 12 })
  })

  it('rejects unknown keys instead of persisting them', () => {
    expect(() => sanitizeSettingsPatch({ evil: '<script>' })).toThrow(/Unknown setting/)
  })

  it('rejects wrong types and out-of-range values', () => {
    expect(() => sanitizeSettingsPatch({ killSwitch: 'yes' })).toThrow(/boolean/)
    expect(() => sanitizeSettingsPatch({ subscriptionIntervalHours: 0 })).toThrow(/integer/)
    expect(() => sanitizeSettingsPatch({ subscriptionIntervalHours: 1000 })).toThrow(/integer/)
    expect(() => sanitizeSettingsPatch({ theme: 'hacker' })).toThrow(/unsupported/)
  })

  it('validates activeProfileId as an id or null', () => {
    expect(sanitizeSettingsPatch({ activeProfileId: null }).activeProfileId).toBeNull()
    expect(sanitizeSettingsPatch({ activeProfileId: 'abc123' }).activeProfileId).toBe('abc123')
    expect(() => sanitizeSettingsPatch({ activeProfileId: '../../etc/passwd' })).toThrow(/invalid format/)
  })

  it('rejects non-object payloads', () => {
    expect(() => sanitizeSettingsPatch(null)).toThrow(/object/)
    expect(() => sanitizeSettingsPatch([])).toThrow(/object/)
  })
})

describe('id / array validation', () => {
  it('rejects path traversal and whitespace in ids', () => {
    expect(() => requireId('../secrets')).toThrow()
    expect(() => requireId('a b')).toThrow()
    expect(requireId('custom-123_abc:def')).toBe('custom-123_abc:def')
  })

  it('bounds arrays and their entries', () => {
    expect(requireStringArray(['a', 'b'], 'links', 2, 10)).toEqual(['a', 'b'])
    expect(() => requireStringArray(['a', 'b', 'c'], 'links', 2, 10)).toThrow(/too many/)
    expect(() => requireStringArray(['a'.repeat(11)], 'links', 2, 10)).toThrow(/longer than/)
    expect(() => requireStringArray('a', 'links', 2, 10)).toThrow(/array/)
  })
})

describe('scenario validation', () => {
  it('sanitises custom scenarios', () => {
    const scenario = sanitizeScenarioInput({
      id: 'custom-1',
      name: '  My mode  ',
      description: 'Fast',
      icon: 'speed',
      engine: 'mihomo',
      serverStrategy: 'fastest',
      settings: { tunMode: true, routingMode: 'global' }
    })
    expect(scenario.name).toBe('My mode')
    expect(scenario.engine).toBe('mihomo')
    expect(scenario.settings).toEqual({ tunMode: true, routingMode: 'global' })
  })

  it('rejects an unknown engine and an invalid settings object', () => {
    expect(() => sanitizeScenarioInput({ name: 'x', engine: 'openvpn' })).toThrow(/engine/)
    expect(() => sanitizeScenarioInput({ name: 'x', settings: { dns: 'evil' } })).toThrow(/dns/)
  })
})

describe('backup row sanitisation', () => {
  it('keeps valid profiles and drops malformed or duplicate rows', () => {
    const profiles = sanitizeImportedProfiles([
      {
        id: 'p1',
        name: 'Node one',
        protocol: 'vless',
        host: 'example.com',
        port: 443,
        raw: 'vless://...',
        favorite: true,
        quality: [10, 20]
      },
      { id: 'p1', name: 'Duplicate id', protocol: 'vless', host: 'x', port: 1 },
      { id: '../bad', name: 'Traversal', protocol: 'vless', host: 'x', port: 1 },
      { id: 'p2', name: 'Bad protocol', protocol: 'openvpn', host: 'x', port: 1 },
      null,
      'not an object'
    ])
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({ id: 'p1', name: 'Node one', port: 443, favorite: true })
    expect(profiles[0].quality).toEqual([10, 20])
  })

  it('clamps optional profile fields instead of failing the row', () => {
    const [profile] = sanitizeImportedProfiles([
      {
        id: 'p1',
        name: 'Node',
        protocol: 'trojan',
        host: 'host',
        port: 70000,
        sourceId: 'bad id',
        ping: -5,
        addedAt: Number.NaN,
        geo: { lat: 200, lon: 'x' }
      }
    ])
    expect(profile).toMatchObject({ port: 0, sourceId: null, ping: null })
    // Out-of-range coordinates fall back to 0 instead of producing an invalid point.
    expect(profile?.geo).toMatchObject({ lat: 0, lon: 0 })
  })

  it('drops rows whose required fields are invalid', () => {
    expect(sanitizeImportedProfiles([{ id: 'p1', name: 'x'.repeat(300), protocol: 'trojan', host: 'h', port: 1 }])).toEqual([])
  })

  it('sanitises subscriptions and bounds their URLs', () => {
    const subscriptions = sanitizeImportedSubscriptions([
      { id: 's1', name: 'Main', url: 'https://example.com/sub', count: 5 },
      { id: 's1', name: 'Duplicate', url: '' },
      { id: 's2', name: 'Long url', url: 'x'.repeat(5000) }
    ])
    expect(subscriptions).toHaveLength(2)
    expect(subscriptions[0].url).toBe('https://example.com/sub')
    expect(subscriptions[1].url).toHaveLength(4096)
  })

  it('sanitises scenarios and reuses the settings validator', () => {
    const scenarios = sanitizeImportedScenarios([
      { id: 'custom-1', name: 'Mode', icon: 'game', settings: { tunMode: true } },
      { id: 'custom-2', name: 'Bad', settings: { tunMode: true, evil: 1 } },
      { id: 'bad id', name: 'Bad id' }
    ])
    expect(scenarios).toHaveLength(1)
    expect(scenarios[0]).toMatchObject({ id: 'custom-1', name: 'Mode', icon: 'game' })
  })

  it('returns an empty list for non-array payloads', () => {
    expect(sanitizeImportedProfiles(undefined)).toEqual([])
    expect(sanitizeImportedSubscriptions({})).toEqual([])
    expect(sanitizeImportedScenarios('nope')).toEqual([])
  })
})
