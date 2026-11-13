import { describe, expect, it } from 'vitest'
import { publicProfile, publicProfiles, publicSubscription, redactSubscriptionUrl } from '../src/main/privacy'
import { makeProfile } from './helpers'

describe('IPC privacy helpers', () => {
  it('strips share links from every profile', () => {
    const profile = makeProfile({ raw: 'vless://secret@example.com:443' })
    expect(publicProfile(profile).raw).toBe('')
    expect(publicProfile(profile).name).toBe(profile.name)
    expect(publicProfiles([profile, profile]).every((item) => item.raw === '')).toBe(true)
    // The input object is not mutated.
    expect(profile.raw).toContain('secret')
  })

  it('redacts credentials, paths and query tokens from subscription URLs', () => {
    expect(redactSubscriptionUrl('https://user:pass@example.com/sub?token=topsecret')).toBe(
      'https://***@example.com/…'
    )
    expect(redactSubscriptionUrl('https://example.com/sub?token=topsecret')).toBe(
      'https://example.com/…'
    )
    expect(redactSubscriptionUrl('http://example.com:8080')).toBe('http://example.com:8080')
    expect(redactSubscriptionUrl('eaglet://free-public')).toBe('eaglet://free-public')
    expect(redactSubscriptionUrl('not a url')).toBe('hidden')
    expect(redactSubscriptionUrl('   ')).toBe('')
  })

  it('only exposes the redacted subscription in snapshots', () => {
    const publicView = publicSubscription({
      id: 'sub1',
      name: 'Provider',
      url: 'https://example.com/sub?token=topsecret',
      updatedAt: 1,
      count: 3
    })
    expect(publicView.url).toBe('https://example.com/…')
    expect(JSON.stringify(publicView)).not.toContain('topsecret')
  })
})
