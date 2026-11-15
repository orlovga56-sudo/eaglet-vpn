import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { setMainLanguage } from '../src/main/i18n'
import {
  createWindowsKillSwitch,
  parseFirewallProfiles,
  profileMismatches,
  RULE_PREFIX,
  writeAtomicFile,
  type FirewallRunner,
  type FirewallStore,
  type PolicyBackup
} from '../src/main/vpn/firewall/windows'
import type { KillSwitchContext } from '../src/main/vpn/firewall/types'

const context: KillSwitchContext = {
  serverIps: ['203.0.113.10'],
  serverPorts: [443],
  corePath: 'C:\\Eaglet\\sing-box.exe',
  appPath: 'C:\\Eaglet\\Eaglet.exe',
  dohIps: [],
  dohPorts: [],
  dnsServers: ['192.168.1.1'],
  dnsProtected: false,
  appEndpoints: []
}

class MemoryStore implements FirewallStore {
  files = new Map<string, string>()
  writes: string[] = []
  exists(path: string): boolean {
    return this.files.has(path)
  }
  read(path: string): string {
    return this.files.get(path) ?? ''
  }
  writeAtomic(path: string, data: string): void {
    // Mirror the real implementation: no partially written file is ever visible.
    this.writes.push(path)
    this.files.set(path, data)
  }
  remove(path: string): void {
    this.files.delete(path)
  }
}

/** Simulated firewall: profile actions, rule count and injectable failures. */
class FakeRunner implements FirewallRunner {
  profiles: Record<string, string> = { Domain: 'Allow', Private: 'Allow', Public: 'Allow' }
  rules = 0
  failRead = false
  failApply = false
  failRestore = false
  /** Simulates a rule sweep that does not actually remove every rule. */
  stuckRules = false
  /** Profiles the OS silently refuses to change back. */
  stuck: Set<string> = new Set()

  private apply(script: string): string {
    if (script.includes('New-NetFirewallRule')) {
      this.rules += (script.match(/New-NetFirewallRule/g) ?? []).length
    }
    if (script.includes(`${RULE_PREFIX}*`) && script.includes('Remove-NetFirewallRule')) {
      if (!this.stuckRules) this.rules = 0
    }
    if (/-All -DefaultOutboundAction Block/.test(script)) {
      for (const name of Object.keys(this.profiles)) this.profiles[name] = 'Block'
    }
    for (const match of script.matchAll(
      /Set-NetFirewallProfile -Profile (\w+) -DefaultOutboundAction (\w+)/g
    )) {
      const [, name, action] = match
      if (this.failRestore) throw new Error('Set-NetFirewallProfile failed: access denied')
      if (!this.stuck.has(name)) this.profiles[name] = action
    }
    return ''
  }

  private report(): string {
    return Object.entries(this.profiles)
      .map(([name, action]) => `${name}=${action}`)
      .join('\r\n')
  }

  async run(script: string): Promise<string> {
    if (this.failRead && script.includes('Get-NetFirewallProfile')) {
      throw new Error('Get-NetFirewallProfile failed')
    }
    if (script.includes('New-NetFirewallRule')) {
      if (this.failApply) throw new Error('New-NetFirewallRule failed: policy rejected')
      this.apply(script)
      return ''
    }
    if (script.includes('Remove-NetFirewallRule')) {
      this.apply(script)
      return ''
    }
    if (script.includes('DefaultOutboundAction')) {
      this.apply(script)
      return this.report()
    }
    if (/@\(Get-NetFirewallRule/.test(script)) return String(this.rules)
    if (script.includes('Get-NetFirewallProfile')) return this.report()
    return ''
  }

  runSync(script: string): string {
    if (this.failRead) throw new Error('Get-NetFirewallProfile failed')
    if (script.includes('New-NetFirewallRule')) this.apply(script)
    if (script.includes('Remove-NetFirewallRule')) this.apply(script)
    if (script.includes('Set-NetFirewallProfile')) this.apply(script)
    if (/@\(Get-NetFirewallRule/.test(script)) {
      return `${this.report()}\r\n${this.rules}`
    }
    return this.report()
  }
}

const backup = (profiles: Record<string, string>): PolicyBackup => ({ at: 1, profiles })

function backend(runner: FakeRunner, store: MemoryStore, path = 'C:\\data\\kill-switch-backup.json') {
  return createWindowsKillSwitch({ runner, store, backupPath: path })
}

describe('windows firewall backup/restore', () => {
  // Assertions below check the English messages; the Russian dictionary is
  // covered separately by test/i18n.test.ts.
  beforeAll(() => setMainLanguage('en'))

  it('writes the policy backup atomically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eaglet-atomic-'))
    const path = join(dir, 'nested', 'kill-switch-backup.json')
    try {
      writeAtomicFile(path, '{"profiles":{"Public":"Allow"}}')
      expect(readFileSync(path, 'utf-8')).toContain('Public')
      expect(readdirSync(join(dir, 'nested')).filter((name) => name.endsWith('.tmp'))).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('parses profiles and reports mismatches', () => {
    expect(parseFirewallProfiles('Domain=Allow\r\nPrivate=Block\r\n')).toEqual({
      Domain: 'Allow',
      Private: 'Block'
    })
    expect(() => parseFirewallProfiles('')).toThrow()
    expect(profileMismatches({ Public: 'Allow' }, { Public: 'Block' })).toHaveLength(1)
    expect(profileMismatches({ Public: 'Allow' }, { Public: 'Allow' })).toHaveLength(0)
  })

  it('keeps the backup when the live policy cannot be verified after restore', async () => {
    const runner = new FakeRunner()
    const store = new MemoryStore()
    runner.profiles = { Domain: 'Block', Private: 'Block', Public: 'Block' }
    store.files.set('C:\\data\\kill-switch-backup.json', JSON.stringify(backup({ Public: 'Allow' })))
    runner.stuck.add('Public')

    await expect(backend(runner, store).disable()).rejects.toThrow(/could not be fully restored/i)
    expect(store.exists('C:\\data\\kill-switch-backup.json')).toBe(true)
  })

  it('removes the backup only after a verified retry', async () => {
    const runner = new FakeRunner()
    const store = new MemoryStore()
    const path = 'C:\\data\\kill-switch-backup.json'
    runner.profiles = { Domain: 'Block', Private: 'Block', Public: 'Block' }
    store.files.set(path, JSON.stringify(backup({ Public: 'Allow' })))
    runner.stuck.add('Public')

    await expect(backend(runner, store).disable()).rejects.toThrow()
    expect(store.exists(path)).toBe(true)

    runner.stuck.clear()
    await backend(runner, store).disable()
    expect(store.exists(path)).toBe(false)
    expect(runner.profiles.Public).toBe('Allow')
  })

  it('keeps the backup when PowerShell fails during the restore', async () => {
    const runner = new FakeRunner()
    const store = new MemoryStore()
    const path = 'C:\\data\\kill-switch-backup.json'
    store.files.set(path, JSON.stringify(backup({ Public: 'Allow' })))
    runner.failRestore = true

    await expect(backend(runner, store).disable()).rejects.toThrow(/access denied|could not be fully restored/i)
    expect(store.exists(path)).toBe(true)
  })

  it('keeps the backup when an enable fails and the rollback cannot be verified', async () => {
    const runner = new FakeRunner()
    const store = new MemoryStore()
    const path = 'C:\\data\\kill-switch-backup.json'
    runner.failApply = true
    runner.failRestore = true

    await expect(backend(runner, store).enable(context)).rejects.toThrow(/backup is kept/i)
    expect(store.exists(path)).toBe(true)
  })

  it('discards the backup when an enable failure was rolled back cleanly', async () => {
    const runner = new FakeRunner()
    const store = new MemoryStore()
    const path = 'C:\\data\\kill-switch-backup.json'
    runner.failApply = true

    await expect(backend(runner, store).enable(context)).rejects.toThrow(/rejected the kill-switch policy/i)
    expect(store.exists(path)).toBe(false)
    expect(runner.profiles.Public).toBe('Allow')
  })

  it('never overwrites the original backup during a re-arm', async () => {
    const runner = new FakeRunner()
    const store = new MemoryStore()
    const path = 'C:\\data\\kill-switch-backup.json'
    store.files.set(path, JSON.stringify(backup({ Public: 'Allow' })))
    // A previous session already flipped the policy to Block.
    runner.profiles = { Public: 'Block' }

    await backend(runner, store).enable(context)
    const saved = JSON.parse(store.read(path)) as PolicyBackup
    expect(saved.profiles.Public).toBe('Allow')
  })

  it('disableSync keeps the backup when the live values do not match', () => {
    const runner = new FakeRunner()
    const store = new MemoryStore()
    const path = 'C:\\data\\kill-switch-backup.json'
    runner.profiles = { Public: 'Block' }
    store.files.set(path, JSON.stringify(backup({ Public: 'Allow' })))
    runner.stuck.add('Public')

    backend(runner, store).disableSync()
    expect(store.exists(path)).toBe(true)
  })

  it('disableSync deletes the backup only after verified values and zero rules', () => {
    const runner = new FakeRunner()
    const store = new MemoryStore()
    const path = 'C:\\data\\kill-switch-backup.json'
    runner.profiles = { Public: 'Block' }
    runner.rules = 2
    store.files.set(path, JSON.stringify(backup({ Public: 'Allow' })))

    backend(runner, store).disableSync()
    expect(store.exists(path)).toBe(false)
    expect(runner.profiles.Public).toBe('Allow')
    expect(runner.rules).toBe(0)
  })

  it('disableSync keeps the backup when rules are still present', () => {
    const runner = new FakeRunner()
    const store = new MemoryStore()
    const path = 'C:\\data\\kill-switch-backup.json'
    store.files.set(path, JSON.stringify(backup({ Public: 'Allow' })))
    runner.rules = 1
    runner.stuckRules = true

    backend(runner, store).disableSync()
    expect(store.exists(path)).toBe(true)
  })
})
