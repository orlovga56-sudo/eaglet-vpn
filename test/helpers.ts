import type { Profile, Settings } from '@shared/types'

export function makeSettings(patch: Partial<Settings> = {}): Settings {
  return {
    theme: 'cyber',
    systemProxy: true,
    tunMode: false,
    killSwitch: false,
    autoConnect: false,
    notifications: true,
    dns: 'auto',
    customDns: '',
    routingMode: 'smart',
    bypassList: '',
    autoReconnect: true,
    mini: false,
    launchAtStartup: false,
    activeProfileId: null,
    engine: 'auto',
    dnsProtection: false,
    ipv6: true,
    networkProtection: false,
    autoUpdateSubscriptions: false,
    subscriptionIntervalHours: 6,
    tray: true,
    closeToTray: true,
    ...patch
  }
}

export function makeProfile(patch: Partial<Profile> = {}): Profile {
  return {
    id: 'abc123',
    name: 'Test node',
    protocol: 'vless',
    host: 'example.com',
    port: 443,
    raw: 'vless://11111111-1111-4111-8111-111111111111@example.com:443',
    sourceId: null,
    ping: null,
    favorite: false,
    addedAt: 1,
    engine: null,
    geo: null,
    quality: [],
    ...patch
  }
}
