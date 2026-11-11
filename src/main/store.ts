import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings } from '@shared/types'
import { DEFAULT_SERVER_ID } from './vpn/servers'

const DEFAULTS: Settings = {
  theme: 'cyber',
  protocol: 'wireguard',
  killSwitch: true,
  autoConnect: false,
  notifications: true,
  dns: 'auto',
  customDns: '',
  routingMode: 'smart',
  mini: false,
  launchAtStartup: false,
  activeServerId: DEFAULT_SERVER_ID
}

/** Tiny JSON-backed settings store — no native deps, easy to inspect. */
export class Store {
  private file: string
  private data: Settings

  constructor(file?: string) {
    this.file = file ?? join(app.getPath('userData'), 'settings.json')
    this.data = this.load()
  }

  private load(): Settings {
    try {
      if (!existsSync(this.file)) return { ...DEFAULTS }
      const raw = JSON.parse(readFileSync(this.file, 'utf-8')) as Partial<Settings>
      return { ...DEFAULTS, ...raw }
    } catch {
      return { ...DEFAULTS }
    }
  }

  get(): Settings {
    return { ...this.data }
  }

  update(patch: Partial<Settings>): Settings {
    this.data = { ...this.data, ...patch }
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch {
      // Persisting settings must never crash the app.
    }
    return this.get()
  }
}
