import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { t } from '../src/main/i18n'
import { createLinuxKillSwitch, type LinuxKillSwitchOptions } from '../src/main/vpn/firewall/linux'
import type { KillSwitchContext } from '../src/main/vpn/firewall/types'

const mockContext: KillSwitchContext = {
  appPath: '/path/to/eaglet',
  corePath: '/path/to/core',
  serverIps: ['1.2.3.4'],
  serverPorts: [443],
  dnsProtected: true,
  dnsServers: ['8.8.8.8'],
  dohIps: ['1.1.1.1'],
  dohPorts: [443],
  appEndpoints: [{ ips: ['example.com'], ports: [80, 443] }]
}

type Fail = (command: string, args: string[]) => string | undefined

/**
 * Sync iptables double. `fail` returns the error message the real command would
 * print, or `undefined` when the call succeeds. The default behaves like a
 * machine where the chain is already gone after a successful removal.
 */
function execWith(fail: Fail = chainAlreadyGone): NonNullable<LinuxKillSwitchOptions['execFileSync']> {
  return (command: string, args: string[]) => {
    const message = fail(command, args)
    if (message) throw new Error(message)
    return ''
  }
}

/** Removal succeeded: flushing/deleting is fine but the chain is now gone. */
const chainAlreadyGone: Fail = (_command, args) => {
  if (args.includes('-C') || args.includes('-L')) return 'No such rule or chain'
  return undefined
}

describe('Linux Firewall', () => {
  let testMarkerPath: string

  beforeEach(() => {
    testMarkerPath = join(process.cwd(), 'test-marker-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.json')
    if (existsSync(testMarkerPath)) rmSync(testMarkerPath)
  })

  afterEach(() => {
    if (existsSync(testMarkerPath)) rmSync(testMarkerPath)
  })

  function killSwitch(fail: Fail = chainAlreadyGone) {
    return createLinuxKillSwitch({ markerPath: testMarkerPath, execFileSync: execWith(fail) })
  }

  function marker(): Record<string, unknown> {
    return JSON.parse(readFileSync(testMarkerPath, 'utf-8')) as Record<string, unknown>
  }

  it('removes both chains and drops the marker', () => {
    const ks = killSwitch()
    writeFileSync(testMarkerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    expect(() => ks.disableSync()).not.toThrow()
    expect(existsSync(testMarkerPath)).toBe(false)
  })

  it('keeps the marker and reports the rule that could not be deleted', () => {
    const ks = killSwitch((command, args) => {
      if (command === 'iptables' && args.includes('-D') && args.includes('OUTPUT')) {
        return 'Permission denied'
      }
      if (command === 'iptables' && args.includes('-C') && args.includes('OUTPUT')) {
        return undefined // IPv4 chain is still there
      }
      return chainAlreadyGone(command, args)
    })
    writeFileSync(testMarkerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    expect(() => ks.disableSync()).toThrow(
      t('Kill switch could not be fully disabled: {errors}', { errors: '' }).split(':')[0]
    )

    const saved = marker()
    expect(saved.cleanupFailed).toBe(true)
    expect(saved.chainsStillExist).toBe(true)
    expect(saved.ipv4RuleRemoved).toBe(false)
    expect(saved.ipv4Status).toBe('exists')
    expect(saved.ipv6Status).toBe('absent')
  })

  it('treats permission errors while checking as an unknown state', () => {
    const ks = killSwitch((_command, args) =>
      args.includes('-C') ? 'Permission denied when checking chain' : 'No such rule or chain'
    )
    writeFileSync(testMarkerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    expect(() => ks.disableSync()).toThrow(
      t('Kill switch could not be fully disabled: {errors}', { errors: '' }).split(':')[0]
    )

    const saved = marker()
    expect(saved.cleanupFailed).toBe(true)
    expect(saved.ipv4Status).toBe('unknown')
    expect(saved.ipv6Status).toBe('unknown')
    expect(String(saved.ipv4CheckError)).toContain('Permission denied')
    expect(String(saved.ipv6CheckError)).toContain('Permission denied')
  })

  it('treats an unexpected check error as an absent chain', () => {
    // Only "not found"-style errors and permission problems are meaningful; any
    // other failure means the rule is not installed.
    const ks = killSwitch((_command, args) =>
      args.includes('-C') ? 'Unexpected error during chain check' : 'No such rule or chain'
    )
    writeFileSync(testMarkerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    expect(() => ks.disableSync()).not.toThrow()
    expect(existsSync(testMarkerPath)).toBe(false)
  })

  it('finishes cleanly when the chains were already gone', () => {
    const ks = killSwitch((_command, args) => {
      if (args.includes('-D') || args.includes('-C') || args.includes('-L')) return 'No such rule'
      return undefined
    })
    writeFileSync(testMarkerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    expect(() => ks.disableSync()).not.toThrow()
    expect(existsSync(testMarkerPath)).toBe(false)
  })

  it('retries cleanup after a previous failure during recovery', () => {
    writeFileSync(
      testMarkerPath,
      JSON.stringify({
        at: Date.now(),
        cleanupFailed: true,
        serverIps: mockContext.serverIps,
        ipv4: true,
        ipv6: true
      })
    )
    const ks = killSwitch((_command, args) => {
      if (args.includes('-D') || args.includes('-C') || args.includes('-L')) return 'No such rule'
      return undefined
    })

    expect(() => ks.recover()).not.toThrow()
    expect(existsSync(testMarkerPath)).toBe(false)
  })

  it('removes only the IPv4 chain when IPv6 was not installed', () => {
    const ks = killSwitch((command, args) => {
      if (command === 'ip6tables') return 'No such rule'
      return chainAlreadyGone(command, args)
    })
    writeFileSync(
      testMarkerPath,
      JSON.stringify({
        at: Date.now(),
        ipv4: true,
        ipv6: false,
        serverIps: mockContext.serverIps,
        cleanupFailed: false
      })
    )

    expect(() => ks.disableSync()).not.toThrow()
    expect(existsSync(testMarkerPath)).toBe(false)
  })

  it('recovers a stale marker left behind by a crash', () => {
    writeFileSync(
      testMarkerPath,
      JSON.stringify({
        at: Date.now() - 10_000,
        ipv4: true,
        ipv6: true,
        serverIps: mockContext.serverIps,
        cleanupFailed: false
      })
    )
    const ks = killSwitch((_command, args) => {
      if (args.includes('-D') || args.includes('-C') || args.includes('-L')) return 'No such rule'
      return undefined
    })

    expect(() => ks.recover()).not.toThrow()
    expect(existsSync(testMarkerPath)).toBe(false)
  })

  it('leaves the machine untouched when no marker was written', () => {
    const calls: string[][] = []
    const ks = createLinuxKillSwitch({
      markerPath: testMarkerPath,
      execFileSync: (_command, args) => {
        calls.push(args)
        return ''
      }
    })

    expect(() => ks.recover()).not.toThrow()
    expect(calls).toEqual([])
  })

  it('disable() succeeds when the chains are already gone', async () => {
    const ks = createLinuxKillSwitch({
      markerPath: testMarkerPath,
      execFile: async (_command, args) => {
        const message = chainAlreadyGone('iptables', args)
        if (message) throw new Error(message)
        return ''
      }
    })
    writeFileSync(testMarkerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    await expect(ks.disable()).resolves.toBeUndefined()
    expect(existsSync(testMarkerPath)).toBe(false)
  })

  it('disable() keeps the marker when the chain state cannot be verified', async () => {
    const ks = createLinuxKillSwitch({
      markerPath: testMarkerPath,
      execFile: async (_command, args) => {
        if (args.includes('-C')) throw new Error('Permission denied')
        const message = chainAlreadyGone('iptables', args)
        if (message) throw new Error(message)
        return ''
      }
    })
    writeFileSync(testMarkerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    await expect(ks.disable()).rejects.toThrow(t('Kill switch could not be fully disabled: {errors}', { errors: '' }).split('{errors}')[0].trim())
    expect(existsSync(testMarkerPath)).toBe(true)
    expect(marker().ipv4Status).toBe('unknown')
    expect(marker().ipv6Status).toBe('unknown')
  })
})
