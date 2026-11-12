import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  EngineId,
  EngineSwitchRecord,
  GeoPoint,
  Profile,
  ProfileEvent,
  Scenario,
  SessionRecord,
  Settings,
  Subscription
} from '@shared/types'

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
  closeToTray: true
}

const SESSION_LIMIT = 40
const EVENT_LIMIT = 120
const ENGINE_HISTORY_LIMIT = 60
const QUALITY_LIMIT = 30

interface StoreData {
  settings: Settings
  profiles: Profile[]
  subscriptions: Subscription[]
  sessions: SessionRecord[]
  scenarios: Scenario[]
  profileHistory: ProfileEvent[]
  engineHistory: EngineSwitchRecord[]
}

/** JSON-backed configuration store — no native deps, easy to inspect. */
export class Store {
  private file: string
  private data: StoreData

  constructor(file?: string) {
    this.file = file ?? join(app.getPath('userData'), 'config.json')
    this.data = this.load()
  }

  private empty(): StoreData {
    return {
      settings: { ...DEFAULT_SETTINGS },
      profiles: [],
      subscriptions: [],
      sessions: [],
      scenarios: [],
      profileHistory: [],
      engineHistory: []
    }
  }

  private load(): StoreData {
    try {
      if (!existsSync(this.file)) return this.empty()
      const raw = JSON.parse(readFileSync(this.file, 'utf-8')) as Partial<StoreData>
      return {
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
        profiles: Array.isArray(raw.profiles)
          ? raw.profiles.map((profile) => ({
              ...profile,
              favorite: Boolean(profile.favorite),
              engine: profile.engine ?? null,
              geo: profile.geo ?? null,
              quality: Array.isArray(profile.quality) ? profile.quality.slice(-QUALITY_LIMIT) : []
            }))
          : [],
        subscriptions: Array.isArray(raw.subscriptions) ? raw.subscriptions : [],
        sessions: Array.isArray(raw.sessions)
          ? raw.sessions.map((session) => ({
              ...session,
              engine: session.engine ?? 'sing-box',
              ping: session.ping ?? null,
              jitter: session.jitter ?? null,
              loss: session.loss ?? null
            }))
          : [],
        scenarios: Array.isArray(raw.scenarios) ? raw.scenarios : [],
        profileHistory: Array.isArray(raw.profileHistory) ? raw.profileHistory.slice(0, EVENT_LIMIT) : [],
        engineHistory: Array.isArray(raw.engineHistory) ? raw.engineHistory.slice(0, ENGINE_HISTORY_LIMIT) : []
      }
    } catch {
      return this.empty()
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
        const existing = this.data.profiles[index]
        // Re-importing a subscription must not drop the user's star or engine override.
        this.data.profiles[index] = {
          ...existing,
          ...profile,
          favorite: existing.favorite,
          engine: existing.engine,
          ping: null
        }
        updated += 1
      } else {
        this.data.profiles.push({
          ...profile,
          favorite: Boolean(profile.favorite),
          engine: profile.engine ?? null,
          geo: profile.geo ?? null,
          quality: Array.isArray(profile.quality) ? profile.quality : []
        })
        added += 1
      }
    }
    // Newest first.
    this.data.profiles.sort((a, b) => b.addedAt - a.addedAt)
    this.save()
    return { added, updated }
  }

  setFavorite(id: string, favorite: boolean): void {
    const profile = this.data.profiles.find((item) => item.id === id)
    if (!profile) return
    profile.favorite = favorite
    this.save()
  }

  setProfileEngine(id: string, engine: EngineId | null): void {
    const profile = this.data.profiles.find((item) => item.id === id)
    if (!profile) return
    profile.engine = engine
    this.save()
  }

  setGeo(id: string, geo: GeoPoint): void {
    const profile = this.data.profiles.find((item) => item.id === id)
    if (!profile) return
    profile.geo = geo
    this.save()
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
    if (ping !== null && ping >= 0) {
      profile.quality = [...profile.quality, ping].slice(-QUALITY_LIMIT)
    }
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

  getSessions(): SessionRecord[] {
    return [...this.data.sessions]
  }

  addSession(session: SessionRecord): void {
    this.data.sessions.unshift(session)
    this.data.sessions = this.data.sessions.slice(0, SESSION_LIMIT)
    this.save()
  }

  clearSessions(): void {
    this.data.sessions = []
    this.save()
  }

  /* ------------------------------------------------------------------ */
  /*  Scenarios, history and backup                                     */
  /* ------------------------------------------------------------------ */

  getScenarios(): Scenario[] {
    return [...this.data.scenarios]
  }

  saveScenario(scenario: Scenario): void {
    const index = this.data.scenarios.findIndex((item) => item.id === scenario.id)
    if (index >= 0) this.data.scenarios[index] = scenario
    else this.data.scenarios.push(scenario)
    this.save()
  }

  removeScenario(id: string): void {
    this.data.scenarios = this.data.scenarios.filter((scenario) => scenario.id !== id)
    this.save()
  }

  addProfileEvent(event: ProfileEvent): void {
    this.data.profileHistory.unshift(event)
    this.data.profileHistory = this.data.profileHistory.slice(0, EVENT_LIMIT)
    this.save()
  }

  getProfileHistory(): ProfileEvent[] {
    return [...this.data.profileHistory]
  }

  addEngineSwitch(record: EngineSwitchRecord): void {
    this.data.engineHistory.unshift(record)
    this.data.engineHistory = this.data.engineHistory.slice(0, ENGINE_HISTORY_LIMIT)
    this.save()
  }

  getEngineHistory(): EngineSwitchRecord[] {
    return [...this.data.engineHistory]
  }

  clearEngineHistory(): void {
    this.data.engineHistory = []
    this.save()
  }

  /** Used by Backup Manager import after validation. */
  replaceAll(payload: {
    settings: Settings
    profiles: Profile[]
    subscriptions: Subscription[]
    scenarios: Scenario[]
  }): void {
    this.data.settings = { ...DEFAULT_SETTINGS, ...payload.settings }
    this.data.profiles = payload.profiles.map((profile) => ({
      ...profile,
      favorite: Boolean(profile.favorite),
      engine: profile.engine ?? null,
      geo: profile.geo ?? null,
      quality: Array.isArray(profile.quality) ? profile.quality.slice(-QUALITY_LIMIT) : []
    }))
    this.data.subscriptions = payload.subscriptions
    this.data.scenarios = payload.scenarios
    this.save()
  }
}
