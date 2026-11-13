import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
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

/**
 * pf rule set for the kill switch. Loopback, DHCP, IPv6 neighbour discovery,
 * the node address + port, the DoH resolver and the current DNS servers stay
 * reachable; everything else is dropped. The node exception is scoped to the
 * node port, so other programs cannot dial the node directly to bypass the
 * tunnel. IPv6 is dropped as well, preventing the usual IPv6 leak.
 */
export function macRules(context: KillSwitchContext): string {
  const lines = ['pass out quick on lo0 all']
  lines.push('pass out quick inet6 proto ipv6-icmp to fe80::/10')
  lines.push('pass out quick inet6 proto ipv6-icmp to ff00::/8')
  lines.push('pass out quick inet6 proto udp from any port 546 to any port 547')
  lines.push('pass out quick proto udp from any port 68 to any port 67')
  lines.push('pass out quick to 169.254.0.0/16 all')

  const ports = context.serverPorts.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
  for (const ip of context.serverIps) {
    if (ports.length === 0) continue
    const family = isIP(ip) === 6 ? 'inet6 ' : ''
    lines.push(`pass out quick ${family}proto { tcp udp } to ${ip} port { ${ports.join(', ')} }`)
  }

  const dohPorts = context.dohPorts.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
  for (const ip of context.dohIps) {
    if (dohPorts.length === 0) continue
    const family = isIP(ip) === 6 ? 'inet6 ' : ''
    lines.push(`pass out quick ${family}proto tcp to ${ip} port { ${dohPorts.join(', ')} }`)
  }

  for (const ip of context.dnsServers) {
    const family = isIP(ip) === 6 ? 'inet6 ' : ''
    lines.push(`pass out quick ${family}proto { tcp udp } to ${ip} port 53`)
  }

  lines.push('block drop out quick all')
  return `${lines.join('\n')}\n`
}

function removeAnchor(): void {
  try {
    execFileSync('pfctl', ['-a', ANCHOR, '-F', 'rules'], { timeout: 8000, stdio: 'ignore' })
  } catch {
    // ignore
  }
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
        input: macRules(context),
        encoding: 'utf-8',
        timeout: 10000
      })
      if (!backup.enabled) execFileSync('pfctl', ['-e'], { timeout: 8000, stdio: 'ignore' })
    } catch (error) {
      removeAnchor()
      rmSync(backupPath(), { force: true })
      throw new Error(`pf rejected the kill-switch rules (run Eaglet as root): ${(error as Error).message}`)
    }
  },

  async disable(): Promise<void> {
    removeAnchor()
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
    const backup = loadBackup()
    removeAnchor()
    if (backup && !backup.enabled) {
      try {
        execFileSync('pfctl', ['-d'], { timeout: 5000, stdio: 'ignore' })
      } catch {
        // ignore
      }
    }
    rmSync(backupPath(), { force: true })
  },

  recover(): void {
    if (existsSync(backupPath())) this.disableSync()
  }
}
