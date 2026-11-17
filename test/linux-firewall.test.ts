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

/** Returns the message the real iptables call would print, or `undefined`. */
type Fail = (command: string, args: string[]) => string | undefined

/** Both chains are gone; every probe answers with the classic "missing" text. */
const chainsGone: Fail = (_command, args) => {
  if (args.includes('-D') || args.includes('-C') || args.includes('-L')) {
    return 'iptables: No chain/target/match by that name.'
  }
  return undefined
}

/** The message prefix shared by every failing disable, in the active language. */
function disabledPrefix(): string {
  return t('Kill switch could not be fully disabled: {errors}', { errors: '' })
    .split('{errors}')[0]
    .trim()
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

  function syncKillSwitch(fail: Fail = chainsGone) {
    const execFileSync: NonNullable<LinuxKillSwitchOptions['execFileSync']> = (command, args) => {
      const message = fail(command, args)
      if (message) throw new Error(message)
      return ''
    }
    return createLinuxKillSwitch({ markerPath: testMarkerPath, execFileSync })
  }

  function asyncKillSwitch(fail: Fail = chainsGone) {
    const execFile: NonNullable<LinuxKillSwitchOptions['execFile']> = async (command, args) => {
      const message = fail(command, args)
      if (message) throw new Error(message)
      return ''
    }
    return createLinuxKillSwitch({ markerPath: testMarkerPath, execFile })
  }

  function writeMarker(): void {
    writeFileSync(testMarkerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))
  }

  function marker(): Record<string, unknown> {
    return JSON.parse(readFileSync(testMarkerPath, 'utf-8')) as Record<string, unknown>
  }

  describe('synchronous cleanup', () => {
    it('removes both chains and drops the marker', () => {
      const ks = syncKillSwitch()
      writeMarker()

      expect(() => ks.disableSync()).not.toThrow()
      expect(existsSync(testMarkerPath)).toBe(false)
    })

    it('keeps the marker and reports the rule that could not be deleted', () => {
      const ks = syncKillSwitch((command, args) => {
        if (command === 'iptables' && args.includes('-D') && args.includes('OUTPUT')) return 'Permission denied'
        if (command === 'iptables' && args.includes('-C')) return undefined // IPv4 jump is still there
        return chainsGone(command, args)
      })
      writeMarker()

      expect(() => ks.disableSync()).toThrow(disabledPrefix())

      const saved = marker()
      expect(saved.cleanupFailed).toBe(true)
      expect(saved.chainsStillExist).toBe(true)
      expect(saved.ipv4RuleRemoved).toBe(false)
      expect(saved.ipv4Status).toBe('exists')
      expect(saved.ipv6Status).toBe('absent')
    })

    it('treats a missing iptables binary as an unknown state', () => {
      const ks = syncKillSwitch(() => 'spawnSync iptables ENOENT')
      writeMarker()

      expect(() => ks.disableSync()).toThrow(disabledPrefix())

      const saved = marker()
      expect(saved.cleanupFailed).toBe(true)
      expect(saved.ipv4Status).toBe('unknown')
      expect(saved.ipv6Status).toBe('unknown')
      expect(String(saved.ipv4Error)).toContain('ENOENT')
    })

    it('treats an unexpected execution error as an unknown state', () => {
      const ks = syncKillSwitch(() => 'Unexpected error during chain check')
      writeMarker()

      expect(() => ks.disableSync()).toThrow(disabledPrefix())

      const saved = marker()
      expect(saved.cleanupFailed).toBe(true)
      expect(saved.stateUnknown).toBe(true)
      expect(saved.ipv4Status).toBe('unknown')
      expect(saved.ipv6Status).toBe('unknown')
      expect(String(saved.ipv4Error)).toContain('Unexpected error')
    })

    it('treats an access error as an unknown state', () => {
      const ks = syncKillSwitch(() => 'Permission denied when checking chain')
      writeMarker()

      expect(() => ks.disableSync()).toThrow(disabledPrefix())

      const saved = marker()
      expect(saved.ipv4Status).toBe('unknown')
      expect(saved.ipv6Status).toBe('unknown')
      expect(String(saved.ipv4Error)).toContain('Permission denied')
      expect(String(saved.ipv6Error)).toContain('Permission denied')
    })

    it('treats trusted "no such chain" errors as an absent state', () => {
      const ks = syncKillSwitch((_command, args) =>
        args.includes('-C') || args.includes('-L') ? 'iptables: No chain/target/match by that name.' : undefined
      )
      writeMarker()

      expect(() => ks.disableSync()).not.toThrow()
      expect(existsSync(testMarkerPath)).toBe(false)
    })

    it('keeps the marker when the OUTPUT jump is gone but the chain remains', () => {
      const ks = syncKillSwitch((_command, args) => {
        if (args.includes('-C')) {
          // The jump is gone; the chain itself still exists.
          return 'iptables: Bad rule (does a matching rule exist in that chain?).'
        }
        if (args.includes('-L')) return undefined
        return chainsGone('iptables', args)
      })
      writeMarker()

      expect(() => ks.disableSync()).toThrow(disabledPrefix())

      const saved = marker()
      expect(saved.cleanupFailed).toBe(true)
      expect(saved.chainsStillExist).toBe(true)
      expect(saved.ipv4Status).toBe('exists')
      expect(saved.ipv4RuleRemoved).toBe(true)
      expect(saved.ipv4ChainRemoved).toBe(false)
    })

    it('keeps the marker when verification fails after a successful removal', () => {
      const ks = syncKillSwitch((_command, args) => {
        if (args.includes('-D') || args.includes('-F') || args.includes('-X')) return undefined
        if (args.includes('-C') || args.includes('-L')) return 'Operation not permitted'
        return undefined
      })
      writeMarker()

      expect(() => ks.disableSync()).toThrow(disabledPrefix())

      const saved = marker()
      expect(saved.cleanupFailed).toBe(true)
      expect(saved.stateUnknown).toBe(true)
      expect(saved.ipv4Status).toBe('unknown')
      expect(saved.ipv6Status).toBe('unknown')
    })

    it('finishes cleanly when the chains were already gone', () => {
      const ks = syncKillSwitch((_command, args) => {
        if (args.includes('-D') || args.includes('-C') || args.includes('-L')) return 'No such rule'
        return undefined
      })
      writeMarker()

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
      const ks = syncKillSwitch((_command, args) => {
        if (args.includes('-D') || args.includes('-C') || args.includes('-L')) return 'No such rule'
        return undefined
      })

      expect(() => ks.recover()).not.toThrow()
      expect(existsSync(testMarkerPath)).toBe(false)
    })

    it('removes only the IPv4 chain when IPv6 was not installed', () => {
      const ks = syncKillSwitch((command, args) => {
        if (command === 'ip6tables') return 'No such rule'
        return chainsGone(command, args)
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
      const ks = syncKillSwitch((_command, args) => {
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
  })

  describe('asynchronous cleanup', () => {
    it('removes both chains and drops the marker', async () => {
      const ks = asyncKillSwitch()
      writeMarker()

      await expect(ks.disable()).resolves.toBeUndefined()
      expect(existsSync(testMarkerPath)).toBe(false)
    })

    it('treats a missing iptables binary as an unknown state', async () => {
      const ks = asyncKillSwitch(() => 'spawnSync iptables ENOENT')
      writeMarker()

      await expect(ks.disable()).rejects.toThrow(disabledPrefix())
      expect(existsSync(testMarkerPath)).toBe(true)
      expect(marker().ipv4Status).toBe('unknown')
      expect(marker().ipv6Status).toBe('unknown')
    })

    it('treats an unexpected execution error as an unknown state', async () => {
      const ks = asyncKillSwitch(() => 'Unexpected error during chain check')
      writeMarker()

      await expect(ks.disable()).rejects.toThrow(disabledPrefix())
      expect(existsSync(testMarkerPath)).toBe(true)
      expect(marker().stateUnknown).toBe(true)
      expect(marker().ipv4Status).toBe('unknown')
    })

    it('treats an access error as an unknown state', async () => {
      const ks = asyncKillSwitch(() => 'Permission denied')
      writeMarker()

      await expect(ks.disable()).rejects.toThrow(disabledPrefix())
      expect(marker().ipv4Status).toBe('unknown')
      expect(marker().ipv6Status).toBe('unknown')
    })

    it('treats trusted "no such chain" errors as an absent state', async () => {
      const ks = asyncKillSwitch((_command, args) =>
        args.includes('-C') || args.includes('-L') ? 'ip6tables: No chain/target/match by that name.' : undefined
      )
      writeMarker()

      await expect(ks.disable()).resolves.toBeUndefined()
      expect(existsSync(testMarkerPath)).toBe(false)
    })

    it('keeps the marker when the OUTPUT jump is gone but the chain remains', async () => {
      const ks = asyncKillSwitch((_command, args) => {
        if (args.includes('-C')) return 'iptables: Bad rule (does a matching rule exist in that chain?).'
        if (args.includes('-L')) return undefined
        return chainsGone('iptables', args)
      })
      writeMarker()

      await expect(ks.disable()).rejects.toThrow(disabledPrefix())
      expect(marker().chainsStillExist).toBe(true)
      expect(marker().ipv4Status).toBe('exists')
    })

    it('keeps the marker when verification fails after a successful removal', async () => {
      const ks = asyncKillSwitch((_command, args) => {
        if (args.includes('-D') || args.includes('-F') || args.includes('-X')) return undefined
        if (args.includes('-C') || args.includes('-L')) return 'Operation not permitted'
        return undefined
      })
      writeMarker()

      await expect(ks.disable()).rejects.toThrow(disabledPrefix())
      expect(marker().stateUnknown).toBe(true)
      expect(marker().ipv4Status).toBe('unknown')
    })
  })
})
