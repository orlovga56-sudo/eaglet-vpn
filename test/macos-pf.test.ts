import { beforeAll, describe, expect, it } from 'vitest'
import { setMainLanguage } from '../src/main/i18n'
import {
  ANCHOR,
  createMacKillSwitch,
  parsePfState,
  patchPfConf,
  pfConfReferencesAnchor,
  sameRules,
  unpatchPfConf,
  PF_CONF_BEGIN,
  PF_CONF_END,
  type PfFiles,
  type PfRunner
} from '../src/main/vpn/firewall/macos'
import type { KillSwitchContext } from '../src/main/vpn/firewall/types'

const context: KillSwitchContext = {
  serverIps: ['203.0.113.10'],
  serverPorts: [443],
  corePath: '/Applications/Eaglet.app/sing-box',
  appPath: '/Applications/Eaglet.app/Eaglet',
  dohIps: [],
  dohPorts: [],
  dnsServers: ['192.168.1.1'],
  dnsProtected: false,
  appEndpoints: []
}

const APPLE_PF_CONF = `scrub-anchor "com.apple/*"
anchor "com.apple/*"
load anchor "com.apple" from "/etc/pf.anchors/com.apple"
`

class MemoryFiles implements PfFiles {
  files = new Map<string, string>()
  read(path: string): string {
    const value = this.files.get(path)
    if (value === undefined) throw new Error(`missing ${path}`)
    return value
  }
  exists(path: string): boolean {
    return this.files.has(path)
  }
  writeAtomic(path: string, data: string): void {
    this.files.set(path, data)
  }
  remove(path: string): void {
    this.files.delete(path)
  }
}

class FakePf implements PfRunner {
  enabled = false
  /** When null, `pfctl -s info` fails and the state is unknowable. */
  readable: boolean | null = true
  anchors = new Map<string, string>()
  mainRules = 'anchor "com.apple/*" all\n'
  failAnchorWrite = false
  /** Called after `pfctl -f`, so a reload can pick up the patched pf.conf. */
  onReload: (() => void) | null = null

  run(args: string[], input?: string): string {
    if (args[0] === '-s' && args[1] === 'info') {
      if (this.readable === null) throw new Error('pfctl: permission denied')
      return this.enabled ? 'Status: Enabled for 0 days' : 'Status: Disabled'
    }
    if (args[0] === '-a' && args[2] === '-sr') return this.anchors.get(ANCHOR) ?? ''
    if (args[0] === '-a' && args[2] === '-f') {
      if (this.failAnchorWrite) throw new Error('pfctl: Syntax error')
      this.anchors.set(ANCHOR, input ?? '')
      return ''
    }
    if (args[0] === '-a' && args[2] === '-F') {
      this.anchors.set(ANCHOR, '')
      return ''
    }
    if (args[0] === '-sr') return this.mainRules
    if (args[0] === '-e') {
      this.enabled = true
      return ''
    }
    if (args[0] === '-d') {
      this.enabled = false
      return ''
    }
    if (args[0] === '-f') {
      // Reloading the main ruleset keeps the wildcard anchor visible.
      this.onReload?.()
      return ''
    }
    return ''
  }

  runSync(args: string[], input?: string): string {
    return this.run(args, input)
  }
}

function backend(pf: FakePf, files: MemoryFiles, pfConfPath = '/etc/pf.conf') {
  return createMacKillSwitch({
    runner: pf,
    files,
    backupPath: '/tmp/pf-backup.json',
    pfConfPath,
    anchorFile: '/etc/pf.anchors/eaglet'
  })
}

describe('pf.conf wiring', () => {
  it('recognises Apple wildcard and explicit anchors', () => {
    expect(pfConfReferencesAnchor(APPLE_PF_CONF)).toBe(true)
    expect(pfConfReferencesAnchor(`anchor "${ANCHOR}"\n`)).toBe(true)
    expect(pfConfReferencesAnchor('pass all\n')).toBe(false)
  })

  it('patches only once and keeps user rules intact', () => {
    const once = patchPfConf('pass quick proto tcp from any to any port 22\n')
    expect(once.patched).toBe(true)
    expect(once.text).toContain('port 22')
    expect(once.text).toContain(PF_CONF_BEGIN)
    expect(patchPfConf(once.text).patched).toBe(false)
  })

  it('removes only its own marker block', () => {
    const base = 'pass quick proto tcp from any to any port 22\n'
    const patched = patchPfConf(base).text.replace('port 22', 'port 2222')
    const restored = unpatchPfConf(patched)
    expect(restored).toContain('port 2222')
    expect(restored).not.toContain(PF_CONF_BEGIN)
    expect(restored).not.toContain(PF_CONF_END)
  })

  it('distinguishes enabled, disabled and unknown states', () => {
    expect(parsePfState('Status: Enabled for 1 days')).toBe(true)
    expect(parsePfState('Status: Disabled')).toBe(false)
    expect(parsePfState('something else')).toBeNull()
  })

  it('compares anchors ignoring order and whitespace', () => {
    expect(sameRules('pass all\nblock drop out quick all\n', 'block drop out quick all\r\npass   all')).toBe(true)
    expect(sameRules('pass all', 'block drop out quick all')).toBe(false)
  })
})

describe('macOS kill-switch lifecycle', () => {
  beforeAll(() => setMainLanguage('en'))

  it('loads the anchor, verifies registration and enables pf', async () => {
    const pf = new FakePf()
    const files = new MemoryFiles()
    files.files.set('/etc/pf.conf', APPLE_PF_CONF)

    await backend(pf, files).enable(context)

    expect(pf.enabled).toBe(true)
    expect(pf.anchors.get(ANCHOR)).toContain('block drop out quick all')
    expect(files.exists('/tmp/pf-backup.json')).toBe(true)
    expect(files.files.get('/etc/pf.anchors/eaglet')).toContain('203.0.113.10')
  })

  it('appends its own anchor when the ruleset has no wildcard', async () => {
    const pf = new FakePf()
    pf.mainRules = ''
    const files = new MemoryFiles()
    files.files.set('/etc/pf.conf', 'pass quick proto tcp from any to any port 22\n')
    // pf re-reads pf.conf on reload, so the appended anchor becomes active.
    pf.onReload = () => {
      pf.mainRules = files.read('/etc/pf.conf')
    }

    await backend(pf, files).enable(context)

    const pfConf = files.read('/etc/pf.conf')
    expect(pfConf).toContain(PF_CONF_BEGIN)
    expect(pfConf).toContain(`anchor "${ANCHOR}"`)
    expect(pfConf).toContain('port 22')
    expect(pf.anchors.get(ANCHOR)).toContain('block drop out quick all')
  })

  it('does not disable pf that was already enabled by the user', async () => {
    const pf = new FakePf()
    pf.enabled = true
    const files = new MemoryFiles()
    files.files.set('/etc/pf.conf', APPLE_PF_CONF)

    const killSwitch = backend(pf, files)
    await killSwitch.enable(context)
    await killSwitch.disable()

    expect(pf.enabled).toBe(true)
    expect(pf.anchors.get(ANCHOR) ?? '').toBe('')
  })

  it('never disables pf when the original state was unknown', async () => {
    const pf = new FakePf()
    const files = new MemoryFiles()
    files.files.set('/etc/pf.conf', APPLE_PF_CONF)
    // A crash left a backup whose pf state could not be read at the time.
    files.files.set(
      '/tmp/pf-backup.json',
      JSON.stringify({
        at: 1,
        pfEnabled: null,
        anchorRules: '',
        pfConfPatched: false,
        pfConfOriginal: APPLE_PF_CONF,
        anchorFileExisted: false,
        anchorFileOriginal: null
      })
    )

    const killSwitch = backend(pf, files)
    await killSwitch.enable(context)
    expect(pf.enabled).toBe(true)

    await killSwitch.disable()

    // Eaglet turned pf on for the kill switch, but it cannot prove the user had
    // it off before, so it leaves pf running instead of guessing.
    expect(pf.enabled).toBe(true)
    expect(files.exists('/tmp/pf-backup.json')).toBe(false)
  })

  it('keeps the backup when restoring the anchor fails', async () => {
    const pf = new FakePf()
    pf.anchors.set(ANCHOR, 'pass out quick on lo0 all\n')
    const files = new MemoryFiles()
    files.files.set('/etc/pf.conf', APPLE_PF_CONF)
    const killSwitch = backend(pf, files)
    await killSwitch.enable(context)

    pf.failAnchorWrite = true
    await expect(killSwitch.disable()).rejects.toThrow(/backup is kept/i)
    expect(files.exists('/tmp/pf-backup.json')).toBe(true)

    pf.failAnchorWrite = false
    await killSwitch.disable()
    expect(files.exists('/tmp/pf-backup.json')).toBe(false)
    expect(sameRules('pass out quick on lo0 all', pf.anchors.get(ANCHOR) ?? '')).toBe(true)
  })

  it('restores the previous anchor rules exactly', async () => {
    const pf = new FakePf()
    pf.anchors.set(ANCHOR, 'pass out quick on lo0 all\r\n')
    const files = new MemoryFiles()
    files.files.set('/etc/pf.conf', APPLE_PF_CONF)

    const killSwitch = backend(pf, files)
    await killSwitch.enable(context)
    expect(pf.anchors.get(ANCHOR)).toContain('block drop out quick all')

    await killSwitch.disable()
    expect(sameRules('pass out quick on lo0 all', pf.anchors.get(ANCHOR) ?? '')).toBe(true)
  })

  it('fails the enable when the anchor is not actually registered', async () => {    const pf = new FakePf()
    pf.mainRules = ''
    const files = new MemoryFiles()
    files.files.set('/etc/pf.conf', 'pass all\n')
    // A runner that refuses to reload the main ruleset leaves the anchor
    // unregistered even though pfctl accepted the rules.
    pf.run = ((original) =>
      function (this: FakePf, args: string[], input?: string): string {
        if (args[0] === '-f') return ''
        return original.call(this, args, input)
      })(pf.run)

    await expect(backend(pf, files).enable(context)).rejects.toThrow(/not referenced|pf rejected/i)
  })

  it('clears its anchor but keeps an unreadable backup on disable', async () => {
    const pf = new FakePf()
    pf.enabled = true
    pf.anchors.set(ANCHOR, 'block drop out quick all\n')
    const files = new MemoryFiles()
    files.files.set('/etc/pf.conf', APPLE_PF_CONF)
    files.files.set('/tmp/pf-backup.json', 'not json')

    const killSwitch = backend(pf, files)
    await expect(killSwitch.disable()).rejects.toThrow(/unreadable/i)

    expect(pf.anchors.get(ANCHOR) ?? '').toBe('')
    expect(files.exists('/tmp/pf-backup.json')).toBe(true)
  })

  it('does not throw from recover when the backup is unreadable', () => {
    const pf = new FakePf()
    pf.enabled = true
    pf.anchors.set(ANCHOR, 'block drop out quick all\n')
    const files = new MemoryFiles()
    files.files.set('/etc/pf.conf', APPLE_PF_CONF)
    files.files.set('/tmp/pf-backup.json', '{broken')

    const killSwitch = backend(pf, files)
    expect(() => killSwitch.recover()).not.toThrow()
    expect(files.exists('/tmp/pf-backup.json')).toBe(true)
  })
})
