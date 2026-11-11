import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Profile, Settings, Subscription } from '@shared/types'

const DEFAULT_SETTINGS: Settings = {
  theme: 'cyber',
  systemProxy: true,
  tunMode: false,
  killSwitch: false,
  autoConnect: false,
  notifications: true,
  dns: 'auto',
  customDns: '',
  routingMode: 'smart',
  mini: false,
  launchAtStartup: false,
  activeProfileId: null
}

interface StoreData {
  settings: Settings
  profiles: Profile[]
  subscriptions: Subscription[]
}

/** JSON-backed configuration store — no native deps, easy to inspect. */
export class Store {
  private file: string
  private data: StoreData

  constructor(file?: string) {
    this.file = file ?? join(app.getPath('userData'), 'config.json')
    this.data = this.load()
  }

  private load(): StoreData {
    try {
      if (!existsSync(this.file)) return { settings: { ...DEFAULT_SETTINGS }, profiles: [], subscriptions: [] }
      const raw = JSON.parse(readFileSync(this.file, 'utf-8')) as Partial<StoreData>
      return {
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
        profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
        subscriptions: Array.isArray(raw.subscriptions) ? raw.subscriptions : []
      }
    } catch {
      return { settings: { ...DEFAULT_SETTINGS }, profiles: [], subscriptions: [] }
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch {
      // Persisting configuration must never crash the app.
    }
  }

  getSettings(): Settings {
    return { ...this.data.settings }
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.save()
    return this.getSettings()
  }

  getProfiles(): Profile[] {
    return [...this.data.profiles]
  }

  getProfile(id: string): Profile | null {
    return this.data.profiles.find((profile) => profile.id === id) ?? null
  }

  addProfiles(incoming: Profile[]): { added: number; updated: number } {
    let added = 0
    let updated = 0
    for (const profile of incoming) {
      const index = this.data.profiles.findIndex((item) => item.id === profile.id)
      if (index >= 0) {
        this.data.profiles[index] = { ...this.data.profiles[index], ...profile, ping: null }
        updated += 1
      } else {
        this.data.profiles.push(profile)
        added += 1
      }
    }
    // Newest first.
    this.data.profiles.sort((a, b) => b.addedAt - a.addedAt)
    this.save()
    return { added, updated }
  }

  removeProfile(id: string): void {
    this.data.profiles = this.data.profiles.filter((profile) => profile.id !== id)
    if (this.data.settings.activeProfileId === id) {
      this.data.settings.activeProfileId = this.data.profiles[0]?.id ?? null
    }
    this.save()
  }

  removeProfilesBySource(sourceId: string): void {
    this.data.profiles = this.data.profiles.filter((profile) => profile.sourceId !== sourceId)
    const active = this.data.settings.activeProfileId
    if (active && !this.data.profiles.some((profile) => profile.id === active)) {
      this.data.settings.activeProfileId = this.data.profiles[0]?.id ?? null
    }
    this.save()
  }

  setPing(id: string, ping: number | null): void {
    const profile = this.data.profiles.find((item) => item.id === id)
    if (!profile) return
    profile.ping = ping
    this.save()
  }

  getSubscriptions(): Subscription[] {
    return [...this.data.subscriptions]
  }

  upsertSubscription(subscription: Subscription): void {
    const index = this.data.subscriptions.findIndex((item) => item.id === subscription.id)
    if (index >= 0) this.data.subscriptions[index] = subscription
    else this.data.subscriptions.push(subscription)
    this.data.subscriptions.sort((a, b) => b.updatedAt - a.updatedAt)
    this.save()
  }

  removeSubscription(id: string): void {
    this.data.subscriptions = this.data.subscriptions.filter((item) => item.id !== id)
    this.save()
  }
}
