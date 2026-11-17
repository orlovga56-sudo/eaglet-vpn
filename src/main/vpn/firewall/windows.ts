import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { t } from '../../i18n'
import type { KillSwitchBackend, KillSwitchContext } from './types'

const execFileAsync = promisify(execFile)
export const RULE_PREFIX = 'Eaglet Kill Switch'

export interface PolicyBackup {
  at: number
  profiles: Record<string, string>
}

/**
 * The small surface the kill switch needs from the operating system. Keeping it
 * injectable is what makes the backup/restore logic testable without touching a
 * real firewall policy.
 */
export interface FirewallRunner {
  run(script: string, timeout?: number): Promise<string>
  runSync(script: string): string
}

export interface FirewallStore {
  exists(path: string): boolean
  read(path: string): string
  writeAtomic(path: string, data: string): void
  remove(path: string): void
}

export function defaultBackupPath(): string {
  return join(app.getPath('userData'), 'kill-switch-backup.json')
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

const READ_PROFILES = `Get-NetFirewallProfile | ForEach-Object { "$($_.Name)=$($_.DefaultOutboundAction)" }`

const REMOVE_RULES = `$rules = Get-NetFirewallRule -DisplayName '${RULE_PREFIX}*' -ErrorAction SilentlyContinue
if ($rules) { $rules | Remove-NetFirewallRule -ErrorAction Stop }`

const COUNT_RULES = `@(Get-NetFirewallRule -DisplayName '${RULE_PREFIX}*' -ErrorAction SilentlyContinue).Count`

const realRunner: FirewallRunner = {
  async run(script, timeout = 20000) {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, windowsHide: true }
    )
    return stdout
  },
  runSync(script) {
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 12000, encoding: 'utf-8' }
    )
  }
}

const realStore: FirewallStore = {
  exists: (path) => existsSync(path),
  read: (path) => readFileSync(path, 'utf-8'),
  writeAtomic: (path, data) => writeAtomicFile(path, data),
  remove: (path) => rmSync(path, { force: true })
}

/** Write to a sibling temp file and rename, so a crash cannot truncate the backup. */
export function writeAtomicFile(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, data, 'utf-8')
  try {
    renameSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

/** Parses `Name=Action` lines into a profile map. Throws when nothing was read. */
export function parseFirewallProfiles(output: string): Record<string, string> {
  const profiles: Record<string, string> = {}
  for (const line of output.split(/\r?\n/).map((item) => item.trim())) {
    if (!line) continue
    const [name, action] = line.split('=')
    if (!name) continue
    profiles[name] = action === 'Block' ? 'Block' : 'Allow'
  }
  if (Object.keys(profiles).length === 0) {
    throw new Error(t('Firewall profile state could not be read from PowerShell'))
  }
  return profiles
}

/** Names whose live value no longer matches the saved value. */
export function profileMismatches(
  expected: Record<string, string>,
  actual: Record<string, string>
): string[] {
  return Object.entries(expected)
    .filter(([name, action]) => actual[name] !== action)
    .map(([name, action]) => `${name}: expected ${action}, got ${actual[name] ?? 'missing'}`)
}

export function restoreProfilesScript(profiles: Record<string, string>): string {
  const lines = Object.entries(profiles).map(([profile, action]) => {
    const safeAction = action === 'Block' ? 'Block' : 'Allow'
    return `Set-NetFirewallProfile -Profile ${profile} -DefaultOutboundAction ${safeAction} -ErrorAction Stop;`
  })
  // Emit the verified state so an invalid profile name fails loudly instead of
  // leaving a silently half-restored policy.
  lines.push(READ_PROFILES)
  return lines.join('\n')
}

function parseBackup(raw: string): PolicyBackup {
  const parsed = JSON.parse(raw) as Partial<PolicyBackup>
  if (!parsed || typeof parsed !== 'object' || !parsed.profiles || typeof parsed.profiles !== 'object') {
    throw new Error(t('kill-switch-backup.json is malformed'))
  }
  const profiles: Record<string, string> = {}
  for (const [name, action] of Object.entries(parsed.profiles)) {
    profiles[name] = action === 'Block' ? 'Block' : 'Allow'
  }
  return { at: Number(parsed.at) || 0, profiles }
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

export interface WindowsKillSwitchOptions {
  runner?: FirewallRunner
  store?: FirewallStore
  backupPath?: string
}

/**
 * Windows kill switch factory.
 *
 * The previous per-profile policy is written atomically before anything is
 * changed and is only deleted once the live policy has been read back and
 * verified. A failed enable or disable keeps the backup so the next launch can
 * retry instead of silently leaving the machine on a blocked or open policy.
 */
export function createWindowsKillSwitch(
  options: WindowsKillSwitchOptions = {}
): KillSwitchBackend & { backupFile(): string } {
  const runner = options.runner ?? realRunner
  const store = options.store ?? realStore
  const path = options.backupPath ?? defaultBackupPath()

  const readProfiles = async (): Promise<Record<string, string>> =>
    parseFirewallProfiles(await runner.run(READ_PROFILES))

  const removeRules = async (): Promise<void> => {
    await runner.run(REMOVE_RULES)
  }

  const countRules = async (): Promise<number> => {
    const output = await runner.run(COUNT_RULES)
    const value = Number(output.trim())
    return Number.isFinite(value) ? value : 0
  }

  /**
   * Load the saved policy. A truncated or hand-edited backup is reported
   * separately instead of throwing, because cleanup must still remove our
   * firewall rules even when the previous profile state is unreadable.
   */
  const loadBackup = (): { backup: PolicyBackup | null; corrupt: string | null } => {
    if (!store.exists(path)) return { backup: null, corrupt: null }
    try {
      return { backup: parseBackup(store.read(path)), corrupt: null }
    } catch (error) {
      return { backup: null, corrupt: (error as Error).message }
    }
  }

  const unreadableBackupError = (detail: string): Error =>
    new Error(
      t('The existing firewall backup is unreadable: {error}. Delete {path} after checking the firewall policy manually.', {
        error: detail,
        path
      })
    )

  const restoreVerified = async (backup: PolicyBackup): Promise<string | null> => {
    try {
      const output = await runner.run(restoreProfilesScript(backup.profiles))
      const actual = output.trim()
        ? parseFirewallProfiles(output)
        : await readProfiles()
      const mismatches = profileMismatches(backup.profiles, actual)
      return mismatches.length === 0 ? null : mismatches.join('; ')
    } catch (error) {
      return (error as Error).message
    }
  }

  const rollback = async (
    backup: PolicyBackup
  ): Promise<{ restored: boolean; error: string | null }> => {
    await removeRules().catch(() => undefined)
    
    // Check if rules were actually removed
    const leftoverRules = await countRules()
    if (leftoverRules > 0) {
      return { restored: false, error: t('{count} kill-switch firewall rules are still present', { count: leftoverRules }) }
    }
    
    const error = await restoreVerified(backup)
    if (error === null) {
      store.remove(path)
      return { restored: true, error: null }
    }
    return { restored: false, error }
  }

  return {
    backupFile: () => path,

    async enable(context: KillSwitchContext): Promise<void> {
      // A backup that survived a crash describes the real pre-arm policy. Never
      // overwrite it with the already-blocked state of a half-applied session.
      let backup: PolicyBackup
      if (store.exists(path)) {
        try {
          backup = parseBackup(store.read(path))
        } catch (error) {
          throw new Error(
            t('The existing firewall backup is unreadable: {error}. Delete {path} after checking the firewall policy manually.', {
              error: (error as Error).message,
              path
            })
          )
        }
      } else {
        backup = { at: Date.now(), profiles: await readProfiles() }
        store.writeAtomic(path, JSON.stringify(backup, null, 2))
      }

      await removeRules()

      try {
        await runner.run(windowsKillSwitchScript(context))
        const live = await readProfiles()
        const notBlocked = Object.entries(live)
          .filter(([, action]) => action !== 'Block')
          .map(([name]) => name)
        if (notBlocked.length > 0) {
          throw new Error(
            t('default outbound action is still Allow for {profiles}', {
              profiles: notBlocked.join(', ')
            })
          )
        }
        if ((await countRules()) === 0) {
          throw new Error(t('the kill-switch rules are missing after the script completed'))
        }
      } catch (error) {
        const result = await rollback(backup)
        if (!result.restored) {
          throw new Error(
            t(
              'Windows rejected the kill-switch policy and the previous outbound policy could not be restored ({error}). The backup is kept at {path}; re-run Eaglet as administrator to retry.',
              { error: result.error ?? (error as Error).message, path }
            )
          )
        }
        throw new Error(
          t('Windows firewall rejected the kill-switch policy: {error}', {
            error: (error as Error).message
          })
        )
      }
    },

    async disable(): Promise<void> {
      const { backup, corrupt } = loadBackup()

      // Remove the allow rules first: while the default action is still Block
      // the machine stays closed even if the policy restore fails.
      let failure: string | null = null
      let leftoverRules = 0
      
      try {
        await removeRules()
        // Check if rules were actually removed
        leftoverRules = await countRules()
      } catch (error) {
        failure = (error as Error).message
      }

      if (corrupt) {
        // The rules are gone, but the pre-arm profile state cannot be read.
        // Never guess: keep the backup for manual recovery and make the reason
        // explicit instead of crashing on JSON.parse.
        const leftovers = leftoverRules > 0
          ? ` ${t('{count} kill-switch firewall rules are still present', { count: leftoverRules })}`
          : ''
        throw unreadableBackupError(`${corrupt}${leftovers}`)
      }

      if (!backup) {
        if (failure) {
          throw new Error(t('Could not remove the kill-switch firewall rules: {error}', { error: failure }))
        }
        if (leftoverRules > 0) {
          throw new Error(t('{count} kill-switch firewall rules are still present', { count: leftoverRules }))
        }
        return
      }

      const restoreError = await restoreVerified(backup)
      const leftoversAfterRestore = await countRules().catch(() => -1)
      if (restoreError !== null || failure || leftoversAfterRestore !== 0) {
        throw new Error(
          t(
            'The Windows firewall policy could not be fully restored ({error}). The backup is kept at {path}; run Eaglet as administrator to retry.',
            {
              error:
                restoreError ??
                failure ??
                t('{count} kill-switch rules are still present', { count: leftoversAfterRestore }),
              path
            }
          )
        )
      }

      store.remove(path)
    },

    disableSync(): void {
      const { backup, corrupt } = loadBackup()
      if (corrupt) {
        // Still remove the allow rules; the profile restore is impossible
        // without a readable backup, so keep it and report the reason.
        try {
          runner.runSync(`${REMOVE_RULES}\n${COUNT_RULES}`)
        } catch (error) {
          console.error('[firewall] synchronous rule removal failed:', (error as Error).message)
        }
        throw unreadableBackupError(corrupt)
      }
      const script = backup
        ? `${REMOVE_RULES}\n${restoreProfilesScript(backup.profiles)}\n${COUNT_RULES}`
        : `${REMOVE_RULES}\n${READ_PROFILES}`
      
      let output = ''
      let count = 0
      let actual: Record<string, string> = {}
      let mismatches: string[] = []
      
      try {
        output = runner.runSync(script).trim()
        if (!backup) {
          // Check if rules were actually removed
          const countAfterRemoval = Number(runner.runSync(COUNT_RULES).trim())
          if (countAfterRemoval > 0) {
            throw new Error(t('{count} kill-switch firewall rules are still present', { count: countAfterRemoval }))
          }
          store.remove(path)
          return
        }
        
        const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        count = Number(lines.at(-1))
        actual = parseFirewallProfiles(lines.slice(0, -1).join('\n'))
        mismatches = profileMismatches(backup.profiles, actual)
        
        if (mismatches.length > 0 || count !== 0) {
          // Keep the backup: the next launch retries instead of trusting an
          // exit code that only says the command itself returned.
          throw new Error(mismatches.join('; ') || `rules left: ${count}`)
        }
        
        store.remove(path)
      } catch (error) {
        console.error('[firewall] synchronous restore failed; backup kept:', (error as Error).message)
        throw error
      }
    },

    recover(): void {
      if (!store.exists(path)) return
      try {
        this.disableSync()
      } catch (error) {
        console.error('[firewall] Windows recovery failed; backup kept:', (error as Error).message)
      }
    }
  }
}

export const windowsKillSwitch = createWindowsKillSwitch()
