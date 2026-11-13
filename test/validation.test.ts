import { describe, expect, it } from 'vitest'
import {
  requireId,
  requireStringArray,
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
