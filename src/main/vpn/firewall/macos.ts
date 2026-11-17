import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { dirname, join } from 'node:path'
import { t } from '../../i18n'
import type { KillSwitchBackend, KillSwitchContext } from './types'

/**
 * Rules live in a dedicated pf anchor. Apple's stock /etc/pf.conf contains
 * `anchor "com.apple/*"`, which evaluates every child anchor — including this
 * one — without editing the user's main ruleset. The code still verifies that
 * the anchor is really referenced and only appends its own marker block when a
 * custom ruleset dropped the wildcard.
 */
export const ANCHOR = 'com.apple/eaglet'
export const PF_CONF = '/etc/pf.conf'
export const ANCHOR_FILE = '/etc/pf.anchors/eaglet'
export const PF_CONF_BEGIN = '# >>> eaglet kill switch >>>'
export const PF_CONF_END = '# <<< eaglet kill switch <<<'
const PF_CONF_BLOCK = `${PF_CONF_BEGIN}\nanchor "${ANCHOR}"\nload anchor "${ANCHOR}" from "${ANCHOR_FILE}"\n${PF_CONF_END}`

export interface PfBackup {
  at: number
  /** `null` means pfctl could not tell us; the state is then never changed back. */
  pfEnabled: boolean | null
  /** Rules that lived in our anchor before the kill switch was armed. */
  anchorRules: string
  /** True when this session appended the anchor block to /etc/pf.conf. */
  pfConfPatched: boolean
  /** Original /etc/pf.conf text (only when patched). */
  pfConfOriginal: string | null
  /** True when /etc/pf.anchors/eaglet existed before Eaglet wrote it. */
  anchorFileExisted: boolean
  anchorFileOriginal: string | null
}

export interface PfRunner {
  /** Runs pfctl and returns stdout. Throws when the command fails. */
  run(args: string[], input?: string, timeout?: number): string
  runSync(args: string[], input?: string, timeout?: number): string
}

export interface PfFiles {
  read(path: string): string
  exists(path: string): boolean
  writeAtomic(path: string, data: string): void
  remove(path: string): void
}

export function defaultPfBackupPath(): string {
  return join(app.getPath('userData'), 'pf-backup.json')
}

const realRunner: PfRunner = {
  run(args, input, timeout = 10000) {
    const result = execFileSync('pfctl', args, {
      input,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return typeof result === 'string' ? result : ''
  },
  runSync(args, input, timeout = 8000) {
    const result = execFileSync('pfctl', args, {
      input,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return typeof result === 'string' ? result : ''
  }
}

const realFiles: PfFiles = {
  read: (path) => readFileSync(path, 'utf-8'),
  exists: (path) => existsSync(path),
  writeAtomic(path, data) {
    mkdirSync(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temp, data, 'utf-8')
    try {
      renameSync(temp, path)
    } catch (error) {
      rmSync(temp, { force: true })
      throw error
    }
  },
  remove: (path) => rmSync(path, { force: true })
}

/** `true`/`false` when pfctl answered, `null` when the state is unknown. */
export function parsePfState(output: string): boolean | null {
  if (/Status:\s+Enabled/i.test(output)) return true
  if (/Status:\s+Disabled/i.test(output)) return false
  return null
}

/** True when the main ruleset evaluates our anchor (Apple wildcard or explicit). */
export function pfConfReferencesAnchor(pfConf: string): boolean {
  return /^\s*anchor\s+"com\.apple\/\*"/m.test(pfConf) || /^\s*anchor\s+"com\.apple\/eaglet"/m.test(pfConf)
}

/** Appends the Eaglet anchor block exactly once, never touching other rules. */
export function patchPfConf(pfConf: string): { text: string; patched: boolean } {
  if (pfConf.includes(PF_CONF_BEGIN)) return { text: pfConf, patched: false }
  const separator = pfConf.endsWith('\n') || pfConf.length === 0 ? '' : '\n'
  return { text: `${pfConf}${separator}\n${PF_CONF_BLOCK}\n`, patched: true }
}

/** Removes only our marker block; user edits outside it are preserved verbatim. */
export function unpatchPfConf(pfConf: string): string {
  const pattern = new RegExp(
    `\\n?${PF_CONF_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${PF_CONF_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`,
    'g'
  )
  return pfConf.replace(pattern, '\n')
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

/** Normalised rule comparison used to verify that an anchor really holds the rules. */
export function sameRules(expected: string, actual: string): boolean {
  const normalise = (value: string): string =>
    value
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .sort()
      .join('\n')
  return normalise(expected) === normalise(actual)
}

function parseBackup(raw: string): PfBackup {
  const parsed = JSON.parse(raw) as Partial<PfBackup> & { enabled?: boolean }
  const pfEnabled =
    typeof parsed.pfEnabled === 'boolean'
      ? parsed.pfEnabled
      : typeof parsed.enabled === 'boolean'
        ? parsed.enabled
        : null
  return {
    at: Number(parsed.at) || 0,
    pfEnabled,
    anchorRules: typeof parsed.anchorRules === 'string' ? parsed.anchorRules : '',
    pfConfPatched: Boolean(parsed.pfConfPatched),
    pfConfOriginal: typeof parsed.pfConfOriginal === 'string' ? parsed.pfConfOriginal : null,
    anchorFileExisted: Boolean(parsed.anchorFileExisted),
    anchorFileOriginal: typeof parsed.anchorFileOriginal === 'string' ? parsed.anchorFileOriginal : null
  }
}

export interface MacKillSwitchOptions {
  runner?: PfRunner
  files?: PfFiles
  backupPath?: string
  pfConfPath?: string
  anchorFile?: string
}

/**
 * macOS packet filter kill switch.
 *
 * Enable/disable is verified against the live pf state: the anchor must be
 * referenced by the active ruleset, contain our rules, and pf must be enabled.
 * The backup file is only deleted after that verification passes, so a failed
 * restore is retried on the next launch instead of being forgotten.
 */
export function createMacKillSwitch(
  options: MacKillSwitchOptions = {}
): KillSwitchBackend & { backupFile(): string } {
  const runner = options.runner ?? realRunner
  const files = options.files ?? realFiles
  const path = options.backupPath ?? defaultPfBackupPath()
  const pfConfPath = options.pfConfPath ?? PF_CONF
  const anchorFile = options.anchorFile ?? ANCHOR_FILE

  const pfState = (sync = false): boolean | null => {
    try {
      const output = sync ? runner.runSync(['-s', 'info']) : runner.run(['-s', 'info'])
      return parsePfState(output)
    } catch {
      return null
    }
  }

  const readAnchorRules = (sync = false): string => {
    try {
      return sync ? runner.runSync(['-a', ANCHOR, '-sr']) : runner.run(['-a', ANCHOR, '-sr'])
    } catch {
      return ''
    }
  }

  const mainRuleset = (): string => {
    try {
      return runner.run(['-sr'])
    } catch {
      return ''
    }
  }

  const anchorRegistered = (): boolean => {
    const rules = mainRuleset()
    return /anchor\s+"com\.apple\/eaglet"/.test(rules) || /anchor\s+"com\.apple\/\*"/.test(rules)
  }

  const writeAnchor = (rules: string, sync = false): void => {
    if (rules.trim()) {
      if (sync) runner.runSync(['-a', ANCHOR, '-f', '-'], rules)
      else runner.run(['-a', ANCHOR, '-f', '-'], rules)
    } else if (sync) {
      runner.runSync(['-a', ANCHOR, '-F', 'rules'])
    } else {
      runner.run(['-a', ANCHOR, '-F', 'rules'])
    }
  }

  const setEnabled = (enabled: boolean, sync = false): void => {
    if (enabled) {
      if (sync) runner.runSync(['-e'])
      else runner.run(['-e'])
    } else if (sync) {
      runner.runSync(['-d'])
    } else {
      runner.run(['-d'])
    }
  }

  const ensureAnchorReferenced = (backup: PfBackup): void => {
    const pfConf = files.exists(pfConfPath) ? files.read(pfConfPath) : ''
    if (pfConfReferencesAnchor(pfConf)) return
    const { text, patched } = patchPfConf(pfConf)
    backup.pfConfOriginal = pfConf
    backup.pfConfPatched = patched
    files.writeAtomic(pfConfPath, text)
    runner.run(['-f', pfConfPath])
  }

  const restoreAnchorFile = (backup: PfBackup): void => {
    if (backup.anchorFileExisted && backup.anchorFileOriginal !== null) {
      files.writeAtomic(anchorFile, backup.anchorFileOriginal)
    } else {
      files.remove(anchorFile)
    }
  }

  const restorePfConf = (backup: PfBackup): void => {
    if (!backup.pfConfPatched) return
    if (!files.exists(pfConfPath)) return
    const current = files.read(pfConfPath)
    // Preserve edits the user made while the kill switch was armed: remove only
    // our marker block, not the whole file.
    files.writeAtomic(pfConfPath, unpatchPfConf(current))
    runner.run(['-f', pfConfPath])
  }

  const restorePfState = (backup: PfBackup): void => {
    if (backup.pfEnabled === true) {
      // The user had pf on before Eaglet; make sure we did not turn it off.
      if (pfState() === false) setEnabled(true)
      return
    }
    if (backup.pfEnabled === false) {
      if (pfState() !== false) setEnabled(false)
      return
    }
    // Unknown original state: never disable pf on speculation.
  }

  const verifyEnabled = (): string | null => {
    if (!anchorRegistered()) return 'the anchor is not referenced by the active pf ruleset'
    if (pfState() !== true) return 'pf is not enabled'
    const live = readAnchorRules()
    if (!live.includes('block drop out quick all')) return 'the kill-switch rules are not loaded'
    return null
  }

  /**
   * A corrupt backup must not abort cleanup: load it as "unknown" and still
   * remove our anchor rules. The file stays on disk for manual inspection.
   */
  const loadBackup = (): { backup: PfBackup | null; corrupt: string | null } => {
    if (!files.exists(path)) return { backup: null, corrupt: null }
    try {
      return { backup: parseBackup(files.read(path)), corrupt: null }
    } catch (error) {
      console.error('[firewall] pf backup is unreadable; treating the previous state as unknown:', (error as Error).message)
      return { backup: null, corrupt: (error as Error).message }
    }
  }

  const verifyDisabled = (backup: PfBackup | null): string | null => {
    if (backup) {
      const live = readAnchorRules()
      if (backup.anchorRules.trim()) {
        if (!sameRules(backup.anchorRules, live)) return 'the previous anchor rules were not restored'
      } else if (live.trim()) {
        return 'our anchor rules are still loaded'
      }
      if (backup.pfEnabled === false && pfState() !== false) return 'pf is still enabled'
      if (backup.pfEnabled === true && pfState() !== true) return 'pf was enabled before Eaglet and is now off'
    }
    return null
  }

  const rollback = (backup: PfBackup): string | null => {
    let failure: string | null = null
    try {
      writeAnchor(backup.anchorRules)
    } catch (error) {
      failure = (error as Error).message
    }
    try {
      restoreAnchorFile(backup)
      restorePfConf(backup)
      restorePfState(backup)
    } catch (error) {
      failure = failure ?? (error as Error).message
    }
    return failure
  }

  return {
    backupFile: () => path,

    async enable(context: KillSwitchContext): Promise<void> {
      let backup: PfBackup
      if (files.exists(path)) {
        try {
          backup = parseBackup(files.read(path))
        } catch (error) {
          throw new Error(
            t('The existing pf backup is unreadable: {error}. Delete {path} after checking pf manually.', {
              error: (error as Error).message,
              path
            })
          )
        }
      } else {
        const pfConf = files.exists(pfConfPath) ? files.read(pfConfPath) : ''
        backup = {
          at: Date.now(),
          pfEnabled: pfState(),
          anchorRules: readAnchorRules(),
          pfConfPatched: false,
          pfConfOriginal: pfConf,
          anchorFileExisted: files.exists(anchorFile),
          anchorFileOriginal: files.exists(anchorFile) ? files.read(anchorFile) : null
        }
        files.writeAtomic(path, JSON.stringify(backup, null, 2))
      }

      try {
        files.writeAtomic(anchorFile, macRules(context))
        ensureAnchorReferenced(backup)
        files.writeAtomic(path, JSON.stringify(backup, null, 2))
        writeAnchor(macRules(context))
        if (pfState() !== true) setEnabled(true)
        const failure = verifyEnabled()
        if (failure) throw new Error(failure)
      } catch (error) {
        const rollbackError = rollback(backup)
        if (!rollbackError) files.remove(path)
        if (rollbackError) {
          throw new Error(
            t(
              'pf rejected the kill-switch rules and the previous state could not be restored ({error}). The backup is kept at {path}; run Eaglet as root to retry.',
              { error: rollbackError, path }
            )
          )
        }
        throw new Error(
          t('pf rejected the kill-switch rules (run Eaglet as root): {error}', {
            error: (error as Error).message
          })
        )
      }
    },

    async disable(): Promise<void> {
      const { backup, corrupt } = loadBackup()
      let failure: string | null = null

      try {
        if (backup) {
          writeAnchor(backup.anchorRules)
          restoreAnchorFile(backup)
          restorePfConf(backup)
          restorePfState(backup)
        } else {
          writeAnchor('')
          files.remove(anchorFile)
        }
      } catch (error) {
        failure = (error as Error).message
      }

      const verification = verifyDisabled(backup)
      if (failure || verification) {
        throw new Error(
          t(
            'The previous pf state could not be fully restored ({error}). The backup is kept at {path}; run Eaglet as root to retry.',
            { error: failure ?? verification ?? t('unknown error'), path }
          )
        )
      }
      if (corrupt) {
        throw new Error(
          t('The existing pf backup is unreadable: {error}. Delete {path} after checking pf manually.', {
            error: corrupt,
            path
          })
        )
      }
      if (backup) files.remove(path)
    },

    disableSync(): void {
      const { backup, corrupt } = loadBackup()
      try {
        if (backup) {
          writeAnchor(backup.anchorRules, true)
          restoreAnchorFile(backup)
          restorePfConf(backup)
          restorePfState(backup)
        } else {
          writeAnchor('', true)
          files.remove(anchorFile)
        }
        const verification = verifyDisabled(backup)
        if (verification) throw new Error(verification)
        if (corrupt) {
          throw new Error(
            t('The existing pf backup is unreadable: {error}. Delete {path} after checking pf manually.', {
              error: corrupt,
              path
            })
          )
        }
        if (backup) files.remove(path)
      } catch (error) {
        // The backup stays on disk so the next launch can retry.
        console.error('[firewall] synchronous pf restore failed; backup kept:', (error as Error).message)
      }
    },

    recover(): void {
      if (files.exists(path)) {
        try {
          this.disableSync()
        } catch (error) {
          console.error('[firewall] pf recovery failed; backup kept:', (error as Error).message)
        }
      } else {
        try {
          writeAnchor('')
        } catch {
          // Nothing was loaded.
        }
      }
    }
  }
}

export const macKillSwitch = createMacKillSwitch()
