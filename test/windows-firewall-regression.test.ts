import { describe, expect, it } from 'vitest'
import { t } from '../src/main/i18n'
import {
  createWindowsKillSwitch,
  type FirewallRunner,
  type FirewallStore,
  type PolicyBackup
} from '../src/main/vpn/firewall/windows'
import type { KillSwitchContext } from '../src/main/vpn/firewall/types'

const BACKUP = '/tmp/eaglet-test/kill-switch-backup.json'

const CONTEXT: KillSwitchContext = {
  appPath: 'C:\\Eaglet\\eaglet.exe',
  corePath: 'C:\\Eaglet\\sing-box.exe',
  serverIps: ['203.0.113.10'],
  serverPorts: [443],
  dnsProtected: true,
  dnsServers: ['8.8.8.8'],
  dohIps: ['1.1.1.1'],
  dohPorts: [443],
  appEndpoints: []
}

const ORIGINAL_PROFILES = { Domain: 'Allow', Private: 'Allow', Public: 'Allow' }

interface Behaviour {
  profiles?: Record<string, string>
  /** Kill-switch rules still present after a removal attempt. */
  rules?: number
  /** Simulate a removal attempt that does not actually delete the rules. */
  stickyRules?: boolean
  removeError?: string
  enableError?: string
  restoreError?: string
  /** Leave the live policy untouched when the restore script runs. */
  restoreMismatch?: boolean
}

function memoryStore(initial: Record<string, string> = {}): FirewallStore & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial))
  return {
    files,
    exists: (path) => files.has(path),
    read: (path) => {
      const value = files.get(path)
      if (value === undefined) throw new Error(`missing ${path}`)
      return value
    },
    writeAtomic: (path, data) => void files.set(path, data),
    remove: (path) => void files.delete(path)
  }
}

function fakeRunner(behaviour: Behaviour = {}): FirewallRunner & {
  profiles: Record<string, string>
  profileScripts: string[]
} {
  const profiles: Record<string, string> = { ...(behaviour.profiles ?? ORIGINAL_PROFILES) }
  const profileScripts: string[] = []

  const readProfiles = (): string =>
    Object.entries(profiles)
      .map(([name, action]) => `${name}=${action}`)
      .join('\n')

  /** Applies only the explicit `-Profile X -DefaultOutboundAction Y` pairs. */
  const applyRestore = (script: string): void => {
    for (const line of script.split('\n')) {
      const match = line.match(/-Profile (\S+) -DefaultOutboundAction (\w+)/)
      if (match) profiles[match[1]] = match[2]
    }
  }

  const run = async (script: string): Promise<string> => {
    if (script.includes('New-NetFirewallRule')) {
      if (behaviour.enableError) throw new Error(behaviour.enableError)
      for (const name of Object.keys(profiles)) profiles[name] = 'Block'
      behaviour.rules = 1
      return ''
    }
    if (script.includes('Remove-NetFirewallRule')) {
      if (behaviour.removeError) throw new Error(behaviour.removeError)
      if (!behaviour.stickyRules) behaviour.rules = 0
      return ''
    }
    if (script.trimStart().startsWith('@(Get-NetFirewallRule')) {
      return String(behaviour.rules ?? 0)
    }
    if (script.includes('Set-NetFirewallProfile')) {
      profileScripts.push(script)
      if (behaviour.restoreError) throw new Error(behaviour.restoreError)
      if (!behaviour.restoreMismatch) applyRestore(script)
      return readProfiles()
    }
    if (script.includes('Get-NetFirewallProfile')) return readProfiles()
    return ''
  }

  const runSync = (script: string): string => {
    if (script.includes('Set-NetFirewallProfile')) {
      profileScripts.push(script)
      if (behaviour.restoreError) throw new Error(behaviour.restoreError)
      if (!behaviour.restoreMismatch) applyRestore(script)
      return `${readProfiles()}\n${behaviour.rules ?? 0}`
    }
    if (script.trimStart().startsWith('@(Get-NetFirewallRule')) return String(behaviour.rules ?? 0)
    if (script.includes('Remove-NetFirewallRule')) {
      if (behaviour.removeError) throw new Error(behaviour.removeError)
      if (!behaviour.stickyRules) behaviour.rules = 0
      return ''
    }
    if (script.includes('Get-NetFirewallProfile')) return readProfiles()
    return ''
  }

  return {
    run,
    runSync,
    profiles,
    profileScripts
  }
}

function backupJson(profiles = ORIGINAL_PROFILES): string {
  const backup: PolicyBackup = { at: 1, profiles }
  return JSON.stringify(backup)
}

describe('Windows kill switch backup handling', () => {
  it('saves the pre-arm policy before blocking outbound traffic', async () => {
    const store = memoryStore()
    const runner = fakeRunner()
    const killSwitch = createWindowsKillSwitch({ backupPath: BACKUP, runner, store })

    await killSwitch.enable(CONTEXT)

    expect(store.files.has(BACKUP)).toBe(true)
    expect(JSON.parse(store.files.get(BACKUP)!) as PolicyBackup).toMatchObject({
      profiles: ORIGINAL_PROFILES
    })
    expect(runner.profiles).toEqual({ Domain: 'Block', Private: 'Block', Public: 'Block' })
  })

  it('keeps the previous backup when one survived a crash', async () => {
    const store = memoryStore({ [BACKUP]: backupJson({ Domain: 'Allow', Private: 'Block', Public: 'Allow' }) })
    const killSwitch = createWindowsKillSwitch({ backupPath: BACKUP, runner: fakeRunner(), store })

    await killSwitch.enable(CONTEXT)

    expect(JSON.parse(store.files.get(BACKUP)!) as PolicyBackup).toMatchObject({
      profiles: { Domain: 'Allow', Private: 'Block', Public: 'Allow' }
    })
  })

  it('refuses to arm when the existing backup is unreadable', async () => {
    const store = memoryStore({ [BACKUP]: 'not json' })
    const killSwitch = createWindowsKillSwitch({ backupPath: BACKUP, runner: fakeRunner(), store })
    const message = t(
      'The existing firewall backup is unreadable: {error}. Delete {path} after checking the firewall policy manually.',
      { error: '\u0000', path: BACKUP }
    )
    const prefix = message.slice(0, message.indexOf('\u0000'))

    await expect(killSwitch.enable(CONTEXT)).rejects.toThrow(prefix)
    expect(store.files.get(BACKUP)).toBe('not json')
  })

  it('rolls back and reports the policy error when arming fails', async () => {
    const store = memoryStore()
    const runner = fakeRunner({ enableError: 'Access denied' })
    const killSwitch = createWindowsKillSwitch({ backupPath: BACKUP, runner, store })

    await expect(killSwitch.enable(CONTEXT)).rejects.toThrow(
      t('Windows firewall rejected the kill-switch policy: {error}', { error: 'Access denied' })
    )
    expect(store.files.has(BACKUP)).toBe(false)
    expect(runner.profiles).toEqual(ORIGINAL_PROFILES)
  })

  it('keeps the backup when the rollback cannot restore the policy', async () => {
    const store = memoryStore()
    const runner = fakeRunner({ enableError: 'Access denied', restoreError: 'Policy service unavailable' })
    const killSwitch = createWindowsKillSwitch({ backupPath: BACKUP, runner, store })

    await expect(killSwitch.enable(CONTEXT)).rejects.toThrow(
      t(
        'Windows rejected the kill-switch policy and the previous outbound policy could not be restored ({error}). The backup is kept at {path}; re-run Eaglet as administrator to retry.',
        { error: 'Policy service unavailable', path: BACKUP }
      )
    )
    expect(store.files.has(BACKUP)).toBe(true)
  })
})

describe('Windows kill switch disable', () => {
  it('removes the rules, restores the policy and deletes the backup', async () => {
    const store = memoryStore({ [BACKUP]: backupJson() })
    const runner = fakeRunner({ profiles: { Domain: 'Block', Private: 'Block', Public: 'Block' }, rules: 1 })
    const killSwitch = createWindowsKillSwitch({ backupPath: BACKUP, runner, store })

    await killSwitch.disable()

    expect(store.files.has(BACKUP)).toBe(false)
    expect(runner.profiles).toEqual(ORIGINAL_PROFILES)
    expect(runner.profileScripts).toHaveLength(1)
  })

  it('keeps the backup when rule removal fails', async () => {
    const store = memoryStore({ [BACKUP]: backupJson() })
    const runner = fakeRunner({ removeError: 'Permission denied', rules: 1 })
    const killSwitch = createWindowsKillSwitch({ backupPath: BACKUP, runner, store })

    await expect(killSwitch.disable()).rejects.toThrow(
      t(
        'The Windows firewall policy could not be fully restored ({error}). The backup is kept at {path}; run Eaglet as administrator to retry.',
        { error: 'Permission denied', path: BACKUP }
      )
    )
    expect(store.files.has(BACKUP)).toBe(true)
  })

  it('keeps the backup when kill-switch rules survive the removal', async () => {
    const store = memoryStore({ [BACKUP]: backupJson() })
    const runner = fakeRunner({ rules: 2, stickyRules: true })
    const killSwitch = createWindowsKillSwitch({ backupPath: BACKUP, runner, store })

    await expect(killSwitch.disable()).rejects.toThrow(
      t(
        'The Windows firewall policy could not be fully restored ({error}). The backup is kept at {path}; run Eaglet as administrator to retry.',
        { error: t('{count} kill-switch rules are still present', { count: 2 }), path: BACKUP }
      )
    )
    expect(store.files.has(BACKUP)).toBe(true)
  })

  it('keeps the backup when the policy read-back mismatches', async () => {
    const store = memoryStore({ [BACKUP]: backupJson() })
    const runner = fakeRunner({
      profiles: { Domain: 'Block', Private: 'Block', Public: 'Block' },
      restoreMismatch: true
    })
    const killSwitch = createWindowsKillSwitch({ backupPath: BACKUP, runner, store })

    await expect(killSwitch.disable()).rejects.toThrow(
      t(
        'The Windows firewall policy could not be fully restored ({error}). The backup is kept at {path}; run Eaglet as administrator to retry.',
        {
          error: 'Domain: expected Allow, got Block; Private: expected Allow, got Block; Public: expected Allow, got Block',
          path: BACKUP
        }
      )
    )
    expect(store.files.has(BACKUP)).toBe(true)
  })

  it('reports leftover rules even without a backup', async () => {
    const store = memoryStore()
    const killSwitch = createWindowsKillSwitch({
      backupPath: BACKUP,
      runner: fakeRunner({ rules: 3, stickyRules: true }),
      store
    })

    await expect(killSwitch.disable()).rejects.toThrow(
      t('{count} kill-switch firewall rules are still present', { count: 3 })
    )
  })

  it('reports a removal failure when there is no backup to restore', async () => {
    const store = memoryStore()
    const killSwitch = createWindowsKillSwitch({
      backupPath: BACKUP,
      runner: fakeRunner({ removeError: 'Access denied' }),
      store
    })

    await expect(killSwitch.disable()).rejects.toThrow(
      t('Could not remove the kill-switch firewall rules: {error}', { error: 'Access denied' })
    )
  })
})

describe('Windows kill switch synchronous paths', () => {
  it('restores the policy and drops the backup on success', () => {
    const store = memoryStore({ [BACKUP]: backupJson() })
    const runner = fakeRunner({ profiles: { Domain: 'Block', Private: 'Block', Public: 'Block' }, rules: 0 })
    const killSwitch = createWindowsKillSwitch({ backupPath: BACKUP, runner, store })

    killSwitch.disableSync()

    expect(store.files.has(BACKUP)).toBe(false)
    expect(runner.profiles).toEqual(ORIGINAL_PROFILES)
  })

  it('keeps the backup when the synchronous restore fails', () => {
    const store = memoryStore({ [BACKUP]: backupJson() })
    const runner = fakeRunner({ restoreError: 'Access denied' })
    const killSwitch = createWindowsKillSwitch({ backupPath: BACKUP, runner, store })

    expect(() => killSwitch.disableSync()).toThrow('Access denied')
    expect(store.files.has(BACKUP)).toBe(true)
  })

  it('retries a stale backup on the next launch and stops once it is gone', () => {
    const store = memoryStore({ [BACKUP]: backupJson() })
    const runner = fakeRunner({ profiles: { Domain: 'Block', Private: 'Block', Public: 'Block' }, rules: 0 })
    const killSwitch = createWindowsKillSwitch({ backupPath: BACKUP, runner, store })

    killSwitch.recover()
    expect(store.files.has(BACKUP)).toBe(false)

    expect(() => killSwitch.recover()).not.toThrow()
    expect(store.files.has(BACKUP)).toBe(false)
  })
})
