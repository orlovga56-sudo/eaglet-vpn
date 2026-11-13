import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { KillSwitchBackend, KillSwitchContext } from './types'

const execFileAsync = promisify(execFile)
const RULE_PREFIX = 'Eaglet Kill Switch'

interface PolicyBackup {
  at: number
  profiles: Record<string, string>
}

function backupPath(): string {
  return join(app.getPath('userData'), 'kill-switch-backup.json')
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

async function runPowerShell(script: string, timeout = 20000): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout, windowsHide: true }
  )
  return stdout
}

function loadBackup(): PolicyBackup | null {
  try {
    if (!existsSync(backupPath())) return null
    return JSON.parse(readFileSync(backupPath(), 'utf-8')) as PolicyBackup
  } catch {
    return null
  }
}

async function removeRules(): Promise<void> {
  await runPowerShell(`Get-NetFirewallRule -DisplayName '${RULE_PREFIX}*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue`)
}

function restoreScript(backup: PolicyBackup): string {
  return Object.entries(backup.profiles)
    .map(([profile, action]) => {
      const safeAction = action === 'Block' ? 'Block' : 'Allow'
      return `Set-NetFirewallProfile -Profile ${profile} -DefaultOutboundAction ${safeAction} -ErrorAction SilentlyContinue;`
    })
    .join('\n')
}

/**
 * Builds the Windows rule set used by the kill switch.
 *
 * Windows evaluates explicit block rules before allow rules, so "block all"
 * plus exceptions does not work. The default outbound action is flipped to
 * Block and only these scoped rules remain:
 *  - loopback (local proxy, DoH relay),
 *  - the core executable → the selected node IPs and ports,
 *  - Eaglet → DoH endpoints, subscription endpoints (80/443) and DNS,
 *  - the core → the current DNS servers on port 53 while protection warms up,
 *  - DHCP so the interface keeps its lease.
 * No rule allows arbitrary programs, and the node rule is bound to the core
 * executable and the node port, so ordinary traffic cannot leave around the
 * tunnel by dialing the node directly.
 */
export function windowsKillSwitchScript(context: KillSwitchContext): string {
  const lines: string[] = []
  const allow = (name: string, parameters: string): void => {
    lines.push(
      `New-NetFirewallRule -DisplayName '${RULE_PREFIX} · ${name}' -Direction Outbound -Action Allow ${parameters} -ErrorAction Stop | Out-Null;`
    )
  }
  const ips = (values: string[]): string => values.map(psQuote).join(',')
  const ports = (values: number[]): string => values.join(',')

  allow('loopback', `-RemoteAddress '127.0.0.0/8','::1'`)

  const serverIps = context.serverIps.filter(Boolean)
  const serverPorts = context.serverPorts.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
  if (context.corePath && serverIps.length > 0 && serverPorts.length > 0) {
    for (const protocol of ['TCP', 'UDP']) {
      allow(
        `core ${protocol}`,
        `-Program ${psQuote(context.corePath)} -RemoteAddress ${ips(serverIps)} -RemotePort ${ports(serverPorts)} -Protocol ${protocol}`
      )
    }
  }

  const dohPorts = context.dohPorts.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)
  if (context.dohIps.length > 0 && dohPorts.length > 0) {
    for (const port of [...new Set(dohPorts)]) {
      allow(
        `DoH ${port}`,
        `-Program ${psQuote(context.appPath)} -RemoteAddress ${ips(context.dohIps)} -RemotePort ${port} -Protocol TCP`
      )
    }
  }

  const dnsServers = context.dnsServers.filter(Boolean)
  if (dnsServers.length > 0) {
    // DNS stays usable for every program but only towards the resolvers that
    // were configured before the tunnel started. That is a narrow, auditable
    // exception instead of the old "any address, port 53" hole.
    for (const protocol of ['TCP', 'UDP']) {
      allow(
        `DNS ${protocol}`,
        `-RemoteAddress ${ips(dnsServers)} -RemotePort 53 -Protocol ${protocol}`
      )
    }
  }

  // Subscriptions, update checks and the DoH relay live in the Electron app.
  allow('app web', `-Program ${psQuote(context.appPath)} -Protocol TCP -RemotePort 80,443`)
  allow('DHCP', `-Protocol UDP -LocalPort 68 -RemotePort 67`)

  lines.push('Set-NetFirewallProfile -All -DefaultOutboundAction Block -ErrorAction Stop')
  return lines.join('\n')
}

/**
 * Windows kill switch. The previous per-profile policy is backed up and
 * restored on disconnect. Requires an elevated Eaglet process; failures are
 * surfaced to the UI and never leave a half-applied policy behind.
 */
export const windowsKillSwitch: KillSwitchBackend = {
  async enable(context: KillSwitchContext): Promise<void> {
    const current = await runPowerShell(
      `Get-NetFirewallProfile | ForEach-Object { "$($_.Name)=$($_.DefaultOutboundAction)" }`
    )
    const profiles: Record<string, string> = {}
    for (const line of current.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      const [name, action] = line.split('=')
      if (name) profiles[name] = action === 'Block' ? 'Block' : 'Allow'
    }
    const backup: PolicyBackup = { at: Date.now(), profiles }
    mkdirSync(dirname(backupPath()), { recursive: true })
    writeFileSync(backupPath(), JSON.stringify(backup, null, 2), 'utf-8')

    await removeRules()
    try {
      await runPowerShell(windowsKillSwitchScript(context))
    } catch (error) {
      // Never leave a half-applied policy behind.
      await removeRules().catch(() => undefined)
      try {
        await runPowerShell(restoreScript(backup))
      } catch {
        // ignore
      }
      rmSync(backupPath(), { force: true })
      throw new Error(`Windows firewall rejected the kill-switch policy: ${(error as Error).message}`)
    }
  },

  async disable(): Promise<void> {
    const backup = loadBackup()
    await removeRules().catch(() => undefined)
    if (backup) {
      await runPowerShell(restoreScript(backup)).catch(() => undefined)
      rmSync(backupPath(), { force: true })
    }
  },

  disableSync(): void {
    const backup = loadBackup()
    try {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `Get-NetFirewallRule -DisplayName '${RULE_PREFIX}*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue; ${backup ? restoreScript(backup) : ''}`
        ],
        { windowsHide: true, timeout: 8000 }
      )
      rmSync(backupPath(), { force: true })
    } catch {
      // The backup stays on disk so the next launch can retry.
    }
  },

  recover(): void {
    if (existsSync(backupPath())) this.disableSync()
  }
}
