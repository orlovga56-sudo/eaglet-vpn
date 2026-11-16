import { describe, expect, it } from 'vitest'
import { t } from '../src/main/i18n'
import {
  byFamily,
  hasLoopback,
  parseDnsBackup,
  planLinuxRestore,
  planMacRestore,
  planWindowsRestore,
  userChangedDns,
  verifyRestored,
  windowsRestoreScript,
  type DnsServiceBackup
} from '../src/main/vpn/dns-guard'

function service(overrides: Partial<DnsServiceBackup> = {}): DnsServiceBackup {
  return {
    name: 'Ethernet',
    index: 12,
    v4: ['8.8.8.8'],
    v6: ['2001:4860:4860::8888'],
    method: 'static',
    ...overrides
  }
}

describe('DNS backup parsing', () => {
  it('keeps explicit families and method', () => {
    const backup = parseDnsBackup(
      JSON.stringify({
        version: 2,
        platform: 'win32',
        at: 123,
        services: [{ name: 'Ethernet', index: 12, v4: ['1.1.1.1'], v6: [], method: 'auto' }]
      })
    )
    expect(backup.version).toBe(2)
    expect(backup.at).toBe(123)
    expect(backup.services).toHaveLength(1)
    expect(backup.services[0]).toMatchObject({ name: 'Ethernet', index: 12, method: 'auto' })
    expect(backup.services[0].v4).toEqual(['1.1.1.1'])
    expect(backup.services[0].v6).toEqual([])
  })

  it('migrates the legacy flat server list', () => {
    const backup = parseDnsBackup(
      JSON.stringify({
        at: 1,
        items: [{ index: 7, alias: 'Wi-Fi', servers: ['9.9.9.9', '2620:fe::fe'] }]
      })
    )
    expect(backup.services[0]).toMatchObject({ name: 'Wi-Fi', index: 7, method: 'static' })
    expect(backup.services[0].v4).toEqual(['9.9.9.9'])
    expect(backup.services[0].v6).toEqual(['2620:fe::fe'])
  })

  it('treats a legacy backup without servers as automatic', () => {
    const backup = parseDnsBackup(JSON.stringify({ items: [{ index: 7, alias: 'Wi-Fi' }] }))
    expect(backup.services[0].method).toBe('auto')
  })

  it('rejects malformed JSON', () => {
    expect(() => parseDnsBackup('kill-switch-backup.json is malformed')).toThrow()
  })
})

describe('restore plans', () => {
  it('resets both families then re-applies static servers on Windows', () => {
    expect(planWindowsRestore(service())).toEqual({
      reset: true,
      addresses: ['8.8.8.8', '2001:4860:4860::8888']
    })
  })

  it('only resets the interface when the resolvers came from DHCP', () => {
    expect(planWindowsRestore(service({ method: 'auto' }))).toEqual({ reset: true, addresses: [] })
  })

  it('applies the saved addresses without a reset when the origin is unknown', () => {
    // Both saved families are re-applied explicitly, so the loopback values are
    // replaced without clearing the interface first.
    expect(planWindowsRestore(service({ method: 'unknown' }))).toEqual({
      reset: false,
      addresses: ['8.8.8.8', '2001:4860:4860::8888']
    })
  })

  it('resets an interface with an unknown origin and no saved addresses', () => {
    expect(planWindowsRestore(service({ method: 'unknown', v4: [], v6: [] }))).toEqual({
      reset: true,
      addresses: []
    })
  })

  it('emits a PowerShell script per interface plus a cache flush', () => {
    const script = windowsRestoreScript([service(), service({ name: 'Other', index: undefined })])
    expect(script.match(/InterfaceIndex 12/g)).toHaveLength(2)
    expect(script).toContain('-ResetServerAddresses')
    expect(script).toContain('-ServerAddresses \'8.8.8.8\',\'2001:4860:4860::8888\'')
    expect(script.trim().endsWith('ipconfig /flushdns | Out-Null')).toBe(true)
    expect(script).not.toContain('undefined')
  })

  it('restores macOS resolvers or empties the override', () => {
    expect(planMacRestore(service())).toEqual(['-setdnsservers', 'Ethernet', '8.8.8.8', '2001:4860:4860::8888'])
    expect(planMacRestore(service({ method: 'auto' }))).toEqual(['-setdnsservers', 'Ethernet', 'Empty'])
  })

  it('reverts the link instead of freezing DHCP resolvers on Linux', () => {
    expect(planLinuxRestore(service())).toEqual(['dns', 'Ethernet', '8.8.8.8', '2001:4860:4860::8888'])
    expect(planLinuxRestore(service({ method: 'auto' }))).toEqual(['revert', 'Ethernet'])
    expect(planLinuxRestore(service({ method: 'unknown' }))).toEqual(['revert', 'Ethernet'])
  })
})

describe('classification helpers', () => {
  it('splits addresses by family and ignores invalid entries', () => {
    expect(byFamily(['8.8.8.8', '2001:db8::1', 'not-an-ip'], 4)).toEqual(['8.8.8.8'])
    expect(byFamily(['8.8.8.8', '2001:db8::1', 'not-an-ip'], 6)).toEqual(['2001:db8::1'])
  })

  it('detects the local relay address', () => {
    expect(hasLoopback(['127.0.0.1', '8.8.8.8'])).toBe(true)
    expect(hasLoopback(['::1'])).toBe(true)
    expect(hasLoopback(['8.8.8.8'])).toBe(false)
  })
})

describe('user changes during a session', () => {
  it('leaves an automatic interface alone once it is off the relay', () => {
    const saved = service({ method: 'auto', v4: [], v6: [] })
    expect(userChangedDns(saved, service({ method: 'auto', v4: ['192.168.1.1'], v6: [] }))).toBe(true)
  })

  it('treats an untouched static interface as unchanged', () => {
    expect(userChangedDns(service(), service())).toBe(false)
  })

  it('does not touch an interface that still points at the relay', () => {
    const current = service({ v4: ['127.0.0.1'], v6: [] })
    expect(userChangedDns(service(), current)).toBe(false)
  })

  it('detects a manual change away from the saved static servers', () => {
    const current = service({ v4: ['1.1.1.1'], v6: [] })
    expect(userChangedDns(service(), current)).toBe(true)
  })

  it('flags an interface still pointing at the relay as unrestored', () => {
    expect(verifyRestored(service(), service({ v4: ['127.0.0.1'], v6: [] }))).toBe(
      t('{name}: still points at the local relay', { name: 'Ethernet' })
    )
  })

  it('flags differing static addresses after a restore', () => {
    expect(verifyRestored(service(), service({ v4: ['1.1.1.1'] }))).toContain('IPv4')
    expect(verifyRestored(service(), service({ v6: [] }))).toContain('IPv6')
  })

  it('accepts a matching restore', () => {
    expect(verifyRestored(service(), service())).toBeNull()
  })
})
