import { beforeAll, describe, expect, it } from 'vitest'
import { setMainLanguage } from '../src/main/i18n'
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

function service(patch: Partial<DnsServiceBackup> = {}): DnsServiceBackup {
  return {
    name: 'Ethernet',
    index: 7,
    v4: [],
    v6: [],
    method: 'unknown',
    ...patch
  }
}

describe('DNS backup format', () => {
  it('splits addresses by family and drops duplicates', () => {
    expect(byFamily(['1.1.1.1', '2606:4700::1111', '1.1.1.1'], 4)).toEqual(['1.1.1.1'])
    expect(byFamily(['1.1.1.1', '2606:4700::1111'], 6)).toEqual(['2606:4700::1111'])
  })

  it('detects the loopback relay', () => {
    expect(hasLoopback(['127.0.0.1'])).toBe(true)
    expect(hasLoopback(['::1'])).toBe(true)
    expect(hasLoopback(['1.1.1.1', '8.8.8.8'])).toBe(false)
    expect(hasLoopback([])).toBe(false)
  })

  it('reads the v2 format with separate families and method', () => {
    const backup = parseDnsBackup(
      JSON.stringify({
        version: 2,
        platform: 'win32',
        at: 42,
        services: [
          { name: 'Ethernet', index: 7, v4: ['192.168.1.1'], v6: ['2001:db8::53'], method: 'static' }
        ]
      })
    )
    expect(backup).toEqual({
      version: 2,
      platform: 'win32',
      at: 42,
      services: [
        { name: 'Ethernet', index: 7, v4: ['192.168.1.1'], v6: ['2001:db8::53'], method: 'static' }
      ]
    })
  })

  it('migrates the legacy `items` format without inventing static DNS', () => {
    const backup = parseDnsBackup(
      JSON.stringify({
        platform: 'win32',
        items: [
          { index: 7, alias: 'Ethernet', servers: ['192.168.1.1', '2001:db8::53'] },
          { index: 9, alias: 'Wi-Fi', servers: [] }
        ]
      })
    )
    expect(backup.version).toBe(2)
    expect(backup.services[0]).toMatchObject({
      name: 'Ethernet',
      index: 7,
      v4: ['192.168.1.1'],
      v6: ['2001:db8::53'],
      method: 'static'
    })
    // An empty legacy entry came from DHCP, so it must be reset, not frozen.
    expect(backup.services[1]).toMatchObject({ name: 'Wi-Fi', method: 'auto', v4: [], v6: [] })
  })

  it('treats missing origin information as unknown', () => {
    const backup = parseDnsBackup(
      JSON.stringify({
        version: 2,
        platform: 'darwin',
        services: [{ name: 'Wi-Fi', v4: ['9.9.9.9'], v6: [] }]
      })
    )
    expect(backup.services[0].method).toBe('unknown')
  })

  it('drops entries without a name', () => {
    const backup = parseDnsBackup(
      JSON.stringify({ version: 2, platform: 'linux', services: [{ v4: ['1.1.1.1'] }] })
    )
    expect(backup.services).toEqual([])
  })
})

describe('restore plans', () => {
  it('resets Windows DHCP adapters instead of pinning them', () => {
    expect(planWindowsRestore(service({ method: 'auto' }))).toEqual({ reset: true, addresses: [] })
  })

  it('resets Windows before applying static addresses', () => {
    expect(
      planWindowsRestore(
        service({ method: 'static', v4: ['192.168.1.1'], v6: ['2001:db8::53'] })
      )
    ).toEqual({ reset: true, addresses: ['192.168.1.1', '2001:db8::53'] })
  })

  it('restores both families in the Windows script', () => {
    const script = windowsRestoreScript([
      service({ method: 'static', v4: ['192.168.1.1'], v6: ['2001:db8::53'] })
    ])
    expect(script).toContain('-InterfaceIndex 7 -ResetServerAddresses')
    expect(script).toContain("-ServerAddresses '192.168.1.1','2001:db8::53'")
    expect(script).toContain('flushdns')
  })

  it('skips adapters without an index in the Windows script', () => {
    const script = windowsRestoreScript([service({ index: undefined })])
    expect(script).not.toContain('Set-DnsClientServerAddress')
  })

  it('returns macOS services to DHCP or exact servers', () => {
    expect(planMacRestore(service({ method: 'auto', name: 'Wi-Fi' }))).toEqual([
      '-setdnsservers',
      'Wi-Fi',
      'Empty'
    ])
    expect(
      planMacRestore(service({ method: 'static', name: 'Wi-Fi', v4: ['192.168.1.1'] }))
    ).toEqual(['-setdnsservers', 'Wi-Fi', '192.168.1.1'])
    // Unknown origin is reset, never written as a static resolver.
    expect(planMacRestore(service({ method: 'unknown', name: 'Wi-Fi' }))).toEqual([
      '-setdnsservers',
      'Wi-Fi',
      'Empty'
    ])
  })

  it('reverts Linux links instead of freezing DHCP resolvers', () => {
    expect(planLinuxRestore(service({ method: 'auto', name: 'eth0' }))).toEqual(['revert', 'eth0'])
    expect(
      planLinuxRestore(service({ method: 'static', name: 'eth0', v4: ['9.9.9.9'], v6: ['2620:fe::fe'] }))
    ).toEqual(['dns', 'eth0', '9.9.9.9', '2620:fe::fe'])
  })
})

describe('restore verification', () => {
  beforeAll(() => setMainLanguage('en'))

  it('flags an interface that still points at the relay', () => {
    expect(
      verifyRestored(service({ method: 'static', v4: ['192.168.1.1'] }), service({ v4: ['127.0.0.1'] }))
    ).toMatch(/still points at the local relay/)
  })

  it('flags family-specific mismatches', () => {
    const original = service({ method: 'static', v4: ['192.168.1.1'], v6: ['2001:db8::53'] })
    expect(verifyRestored(original, service({ v4: ['192.168.1.1'], v6: ['2001:db8::99'] }))).toMatch(
      /IPv6 resolvers differ/
    )
    expect(verifyRestored(original, service({ v4: ['192.168.1.99'], v6: ['2001:db8::53'] }))).toMatch(
      /IPv4 resolvers differ/
    )
  })

  it('accepts a verified static restore', () => {
    const original = service({ method: 'static', v4: ['192.168.1.1'], v6: [] })
    expect(verifyRestored(original, service({ v4: ['192.168.1.1'] }))).toBeNull()
  })

  it('accepts a non-loopback resolver after an automatic restore', () => {
    const original = service({ method: 'auto' })
    expect(verifyRestored(original, service({ v4: ['10.0.0.1'] }))).toBeNull()
  })

  it('does not overwrite resolvers the user changed while the VPN was up', () => {
    const original = service({ method: 'static', v4: ['192.168.1.1'] })
    expect(userChangedDns(original, service({ v4: ['9.9.9.9'] }))).toBe(true)
    expect(userChangedDns(original, service({ v4: ['127.0.0.1'] }))).toBe(false)
    // Back to the original value is fine too, even if the user did it manually.
    expect(userChangedDns(original, service({ v4: ['192.168.1.1'] }))).toBe(false)
    expect(userChangedDns(service({ method: 'auto' }), service({ v4: ['10.0.0.1'] }))).toBe(true)
    expect(userChangedDns(service({ method: 'auto' }), service({ v4: ['127.0.0.1'] }))).toBe(false)
  })
})
