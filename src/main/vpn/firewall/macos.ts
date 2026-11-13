import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { dirname, join } from 'node:path'
import type { KillSwitchBackend, KillSwitchContext } from './types'

/**
 * Loaded inside Apple's own wildcard anchor (`anchor "com.apple/*"` in
 * /etc/pf.conf). That makes the rules active without editing or replacing the
 * user's main ruleset, and they disappear when only this anchor is flushed.
 */
const ANCHOR = 'com.apple/eaglet'

interface PfBackup {
  at: number
  enabled: boolean
  /** Rules that lived in our anchor before the kill switch was armed. */
  anchorRules: string
}

function backupPath(): string {
  return join(app.getPath('userData'), 'pf-backup.json')
}

function loadBackup(): PfBackup | null {
  try {
    if (!existsSync(backupPath())) return null
    const parsed = JSON.parse(readFileSync(backupPath(), 'utf-8')) as Partial<PfBackup>
    return {
      at: Number(parsed.at) || 0,
      enabled: Boolean(parsed.enabled),
      anchorRules: typeof parsed.anchorRules === 'string' ? parsed.anchorRules : ''
    }
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

function readAnchorRules(): string {
  try {
    return execFileSync('pfctl', ['-a', ANCHOR, '-sr'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 8000
    })
  } catch {
    return ''
  }
}

function writeAnchor(rules: string): void {
  if (rules.trim()) {
    execFileSync('pfctl', ['-a', ANCHOR, '-f', '-'], {
      input: rules,
      encoding: 'utf-8',
      timeout: 10000
    })
  } else {
    execFileSync('pfctl', ['-a', ANCHOR, '-F', 'rules'], { timeout: 8000, stdio: 'ignore' })
  }
}

function disablePf(): void {
  try {
    execFileSync('pfctl', ['-d'], { timeout: 8000, stdio: 'ignore' })
  } catch {
    // Already disabled or not permitted; the caller reports the main error.
  }
}

function validPorts(values: number[]): number[] {
  return [...new Set(values.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))]
}

/**
 * pf rule set for the kill switch. Loopback, DHCP, IPv6 neighbour discovery,
 * the node address + port, the DoH resolver, the app's resolved endpoints and
 * (only when DNS protection is off) the current DNS servers stay reachable;
 * everything else is dropped. The node exception is scoped to the node port,
 * so other programs cannot dial the node directly to bypass the tunnel. IPv6
 * is dropped as well, preventing the usual IPv6 leak.
 */
export function macRules(context: KillSwitchContext): string {
  const lines = ['pass out quick on lo0 all']
  lines.push('pass out quick inet6 proto ipv6-icmp to fe80::/10')
  lines.push('pass out quick inet6 proto ipv6-icmp to ff00::/8')
  lines.push('pass out quick inet6 proto udp from any port 546 to any port 547')
  lines.push('pass out quick proto udp from any port 68 to any port 67')
  lines.push('pass out quick to 169.254.0.0/16 all')

  const ports = validPorts(context.serverPorts)
  for (const ip of context.serverIps) {
    if (ports.length === 0) continue
    const family = isIP(ip) === 6 ? 'inet6 ' : ''
    lines.push(`pass out quick ${family}proto { tcp udp } to ${ip} port { ${ports.join(', ')} }`)
  }

  if (context.dnsProtected) {
    const dohPorts = validPorts(context.dohPorts)
    for (const ip of context.dohIps) {
      if (dohPorts.length === 0) continue
      const family = isIP(ip) === 6 ? 'inet6 ' : ''
      lines.push(`pass out quick ${family}proto tcp to ${ip} port { ${dohPorts.join(', ')} }`)
    }
  } else {
    for (const ip of context.dnsServers) {
      const family = isIP(ip) === 6 ? 'inet6 ' : ''
      lines.push(`pass out quick ${family}proto { tcp udp } to ${ip} port 53`)
    }
  }

  for (const endpoint of context.appEndpoints) {
    const endpointPorts = validPorts(endpoint.ports)
    if (endpointPorts.length === 0) continue
    for (const ip of endpoint.ips) {
      const family = isIP(ip) === 6 ? 'inet6 ' : ''
      lines.push(`pass out quick ${family}proto tcp to ${ip} port { ${endpointPorts.join(', ')} }`)
    }
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

function restoreAnchor(backup: PfBackup | null): void {
  if (backup) writeAnchor(backup.anchorRules)
  else removeAnchor()
}

/**
 * macOS packet filter kill switch. Rules live in a dedicated pf anchor so they
 * can be removed without touching the user's own pf configuration. The
 * previous anchor rules and the pf enabled/disabled state are backed up before
 * any change and restored after both a normal disconnect and a crash recovery.
 * Requires root (`sudo`/privileged helper); the UI reports the failure honestly.
 */
export const macKillSwitch: KillSwitchBackend = {
  async enable(context: KillSwitchContext): Promise<void> {
    const backup: PfBackup = {
      at: Date.now(),
      enabled: pfEnabled(),
      anchorRules: readAnchorRules()
    }
    mkdirSync(dirname(backupPath()), { recursive: true })
    writeFileSync(backupPath(), JSON.stringify(backup, null, 2), 'utf-8')
    try {
      writeAnchor(macRules(context))
      if (!backup.enabled) execFileSync('pfctl', ['-e'], { timeout: 8000, stdio: 'ignore' })
    } catch (error) {
      try {
        restoreAnchor(backup)
      } catch {
        // Best effort; the backup remains on disk for the next launch.
      }
      if (!backup.enabled) disablePf()
      rmSync(backupPath(), { force: true })
      throw new Error(`pf rejected the kill-switch rules (run Eaglet as root): ${(error as Error).message}`)
    }
  },

  async disable(): Promise<void> {
    const backup = loadBackup()
    let failure: Error | null = null
    try {
      restoreAnchor(backup)
    } catch (error) {
      failure = error as Error
    }
    if (backup && !backup.enabled) disablePf()
    if (!failure) rmSync(backupPath(), { force: true })
    if (failure) {
      throw new Error(`Could not restore the previous pf state: ${failure.message}`)
    }
  },

  disableSync(): void {
    const backup = loadBackup()
    try {
      restoreAnchor(backup)
    } catch {
      // Keep the backup so the next launch can retry.
      return
    }
    if (backup && !backup.enabled) disablePf()
    rmSync(backupPath(), { force: true })
  },

  recover(): void {
    if (existsSync(backupPath())) this.disableSync()
    else removeAnchor()
  }
}
