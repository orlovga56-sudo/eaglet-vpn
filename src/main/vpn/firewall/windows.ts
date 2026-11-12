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
 * Windows kill switch.
 *
 * Windows evaluates explicit block rules before allow rules, so "block all"
 * plus exceptions does not work. Instead we flip the default outbound action to
 * Block and add allow rules for loopback, the core, Eaglet and the node IPs.
 * The previous per-profile policy is backed up and restored on disconnect.
 * Requires an elevated Eaglet process; failures are surfaced to the UI.
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
      await runPowerShell(`
New-NetFirewallRule -DisplayName '${RULE_PREFIX} · loopback' -Direction Outbound -Action Allow -RemoteAddress '127.0.0.0/8','::1' -ErrorAction Stop | Out-Null;
${context.corePath ? `New-NetFirewallRule -DisplayName '${RULE_PREFIX} · core' -Direction Outbound -Action Allow -Program ${psQuote(context.corePath)} -ErrorAction Stop | Out-Null;` : ''}
New-NetFirewallRule -DisplayName '${RULE_PREFIX} · app' -Direction Outbound -Action Allow -Program ${psQuote(context.appPath)} -ErrorAction Stop | Out-Null;
${context.serverIps.length > 0 ? `New-NetFirewallRule -DisplayName '${RULE_PREFIX} · nodes' -Direction Outbound -Action Allow -RemoteAddress ${context.serverIps.map(psQuote).join(',')} -ErrorAction Stop | Out-Null;` : ''}
Set-NetFirewallProfile -All -DefaultOutboundAction Block -ErrorAction Stop
`)
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
