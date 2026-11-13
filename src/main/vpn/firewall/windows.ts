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
 *  - core/app → the current DNS servers on port 53 *only when DNS protection
 *    is off*; with the loopback DoH relay active there is no plaintext DNS
 *    exception at all,
 *  - Eaglet → the exact DoH IP/port and the resolved subscription/update
 *    endpoints on their real ports,
 *  - DHCP so the interface keeps its lease.
 * No rule allows arbitrary programs or arbitrary port 80/443 destinations,
 * and the node rule is bound to the core executable and node port, so ordinary
 * traffic cannot leave around the tunnel by dialing the node directly.
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
  const validPorts = (values: number[]): number[] =>
    [...new Set(values.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))]

  allow('loopback', `-RemoteAddress '127.0.0.0/8','::1'`)

  const serverIps = context.serverIps.filter(Boolean)
  const serverPorts = validPorts(context.serverPorts)
  if (context.corePath && serverIps.length > 0 && serverPorts.length > 0) {
    for (const protocol of ['TCP', 'UDP']) {
      allow(
        `core ${protocol}`,
        `-Program ${psQuote(context.corePath)} -RemoteAddress ${ips(serverIps)} -RemotePort ${ports(serverPorts)} -Protocol ${protocol}`
      )
    }
  }

  // The DoH relay only exists while DNS protection is active. Allow it only
  // then, and only towards the pinned resolver address and port.
  if (context.dnsProtected) {
    const dohPorts = validPorts(context.dohPorts)
    if (context.dohIps.length > 0 && dohPorts.length > 0) {
      for (const port of dohPorts) {
        allow(
          `DoH app ${port}`,
          `-Program ${psQuote(context.appPath)} -RemoteAddress ${ips(context.dohIps)} -RemotePort ${port} -Protocol TCP`
        )
        if (context.corePath) {
          allow(
            `DoH core ${port}`,
            `-Program ${psQuote(context.corePath)} -RemoteAddress ${ips(context.dohIps)} -RemotePort ${port} -Protocol TCP`
          )
        }
      }
    }
  }

  const dnsServers = context.dnsServers.filter(Boolean)
  if (!context.dnsProtected && dnsServers.length > 0) {
    // Without the loopback relay the core and Eaglet still need the system
    // resolvers. Scope them to those two executables; other programs get no
    // DNS exception and must use the tunnel.
    for (const protocol of ['TCP', 'UDP']) {
      allow(
        `DNS core ${protocol}`,
        `-Program ${psQuote(context.corePath ?? context.appPath)} -RemoteAddress ${ips(dnsServers)} -RemotePort 53 -Protocol ${protocol}`
      )
      if (context.corePath) {
        allow(
          `DNS app ${protocol}`,
          `-Program ${psQuote(context.appPath)} -RemoteAddress ${ips(dnsServers)} -RemotePort 53 -Protocol ${protocol}`
        )
      }
    }
  }

  // Resolved subscription servers, update checks and the IP probe. Every rule
  // names one executable, one concrete address and one concrete port.
  for (const endpoint of context.appEndpoints) {
    const endpointIps = endpoint.ips.filter(Boolean)
    const endpointPorts = validPorts(endpoint.ports)
    if (endpointIps.length === 0 || endpointPorts.length === 0) continue
    for (const port of endpointPorts) {
      allow(
        `app endpoint ${port}`,
        `-Program ${psQuote(context.appPath)} -RemoteAddress ${ips(endpointIps)} -RemotePort ${port} -Protocol TCP`
      )
    }
  }

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
