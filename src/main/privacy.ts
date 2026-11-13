import type { Profile, Subscription } from '@shared/types'

/**
 * Helpers that decide what may cross the IPC boundary. They are deliberately
 * pure and live outside `index.ts` so they can be unit-tested without Electron.
 */

/** Strips the share link before a profile is sent to the renderer. */
export function publicProfile(profile: Profile): Profile {
  return { ...profile, raw: '' }
}

export function publicProfiles(profiles: Profile[]): Profile[] {
  return profiles.map(publicProfile)
}

/**
 * Subscription URLs often carry a token in the path or query. The renderer
 * only needs a recognizable label, never the credential itself.
 */
export function redactSubscriptionUrl(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  // The built-in free-node pseudo subscription carries no secret.
  if (value.startsWith('eaglet://')) return value
  try {
    const url = new URL(value)
    const auth = url.username || url.password ? '***@' : ''
    const path = url.pathname && url.pathname !== '/' ? '/…' : ''
    return `${url.protocol}//${auth}${url.host}${path}`
  } catch {
    return 'hidden'
  }
}

export function publicSubscription(subscription: Subscription): Subscription {
  return { ...subscription, url: redactSubscriptionUrl(subscription.url) }
}
