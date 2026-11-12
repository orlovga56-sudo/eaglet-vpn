import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { KillSwitchBackend, KillSwitchContext } from './types'

const ANCHOR = 'eaglet'

interface PfBackup {
  at: number
  enabled: boolean
}

function backupPath(): string {
  return join(app.getPath('userData'), 'pf-backup.json')
}

function loadBackup(): PfBackup | null {
  try {
    if (!existsSync(backupPath())) return null
    return JSON.parse(readFileSync(backupPath(), 'utf-8')) as PfBackup
  } catch {
    return null
  }
}

function pfEnabled(): boolean {
  try {
    const output = execFileSync('pfctl', ['-s', 'info'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
    return /Status:\s+Enabled/i.test(output)
  } catch {
    return false
  }
}

function rulesFor(context: KillSwitchContext): string {
  const lines = ['pass out quick on lo0 all', 'pass out quick to 127.0.0.1 any', 'pass out quick to ::1 any']
  for (const ip of context.serverIps) {
    lines.push(`pass out quick to ${ip} any`)
  }
  // The core (and Eaglet's reconnect logic) still needs to resolve node hosts.
  lines.push('pass out quick proto { tcp udp } to any port 53')
  lines.push('block drop out all')
  return `${lines.join('\n')}\n`
}

/**
 * macOS packet filter kill switch. Rules live in a dedicated pf anchor so they
 * can be removed without touching the user's own pf configuration. Requires
 * root (`sudo`/privileged helper); the UI reports the failure honestly.
 */
export const macKillSwitch: KillSwitchBackend = {
  async enable(context: KillSwitchContext): Promise<void> {
    const backup: PfBackup = { at: Date.now(), enabled: pfEnabled() }
    mkdirSync(dirname(backupPath()), { recursive: true })
    writeFileSync(backupPath(), JSON.stringify(backup, null, 2), 'utf-8')
    try {
      execFileSync('pfctl', ['-a', ANCHOR, '-f', '-'], {
        input: rulesFor(context),
        encoding: 'utf-8',
        timeout: 10000
      })
      if (!backup.enabled) execFileSync('pfctl', ['-e'], { timeout: 8000, stdio: 'ignore' })
    } catch (error) {
      rmSync(backupPath(), { force: true })
      throw new Error(`pf rejected the kill-switch rules (run Eaglet as root): ${(error as Error).message}`)
    }
  },

  async disable(): Promise<void> {
    try {
      execFileSync('pfctl', ['-a', ANCHOR, '-F', 'rules'], { timeout: 8000, stdio: 'ignore' })
    } catch {
      // ignore
    }
    const backup = loadBackup()
    if (backup && !backup.enabled) {
      try {
        execFileSync('pfctl', ['-d'], { timeout: 8000, stdio: 'ignore' })
      } catch {
        // ignore
      }
    }
    rmSync(backupPath(), { force: true })
  },

  disableSync(): void {
    try {
      execFileSync('pfctl', ['-a', ANCHOR, '-F', 'rules'], { timeout: 5000, stdio: 'ignore' })
      rmSync(backupPath(), { force: true })
    } catch {
      // ignore
    }
  },

  recover(): void {
    if (existsSync(backupPath())) this.disableSync()
  }
}
