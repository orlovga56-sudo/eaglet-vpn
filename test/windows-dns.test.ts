import { describe, expect, it } from 'vitest'
import {
  classifyWindowsFamilyMethod,
  classifyWindowsMethod,
  planWindowsRestore,
  userChangedDns,
  verifyRestored,
  type DnsServiceBackup
} from '../src/main/vpn/dns-guard'
import type { WindowsAdapter } from '../src/main/vpn/dns-guard'

/** Adapter with every field explicit, so each test reads as a real scenario. */
function adapter(overrides: Partial<WindowsAdapter>): WindowsAdapter {
  return {
    index: 12,
    name: 'Ethernet',
    v4: [],
    v6: [],
    dhcp4: 'Enabled',
    dhcp6: 'Disabled',
    manual4: [],
    manual6: [],
    leased4: [],
    leased6: [],
    ...overrides
  }
}

describe('Windows DNS Classification', () => {
  describe('no resolvers', () => {
    it('classifies a DHCP interface without DNS as auto', () => {
      expect(classifyWindowsMethod(adapter({ dhcp4: 'Enabled' }))).toBe('auto')
    })

    it('classifies a static interface without DNS as unknown', () => {
      expect(classifyWindowsMethod(adapter({ dhcp4: 'Disabled', dhcp6: 'Disabled' }))).toBe('unknown')
    })

    it('classifies an unknown DHCP state without DNS as unknown', () => {
      expect(classifyWindowsMethod(adapter({ dhcp4: 'Unknown', dhcp6: 'Unknown' }))).toBe('unknown')
    })

    it('accepts case-insensitive DHCP status', () => {
      expect(classifyWindowsMethod(adapter({ dhcp4: 'enabled', dhcp6: 'ENABLED' }))).toBe('auto')
    })
  })

  describe('DHCP with lease-provided DNS', () => {
    it('classifies DNS that matches the DHCP lease as auto', () => {
      expect(
        classifyWindowsMethod(
          adapter({ v4: ['8.8.8.8'], dhcp4: 'Enabled', leased4: ['8.8.8.8'] })
        )
      ).toBe('auto')
    })

    it('classifies both families as auto when both match their leases', () => {
      expect(
        classifyWindowsMethod(
          adapter({
            v4: ['8.8.8.8'],
            v6: ['2001:4860:4860::8888'],
            dhcp4: 'Enabled',
            dhcp6: 'Enabled',
            leased4: ['8.8.8.8'],
            leased6: ['2001:4860:4860::8888']
          })
        )
      ).toBe('auto')
    })

    it('ignores lease order and duplicates when comparing', () => {
      expect(
        classifyWindowsMethod(
          adapter({
            v4: ['8.8.8.8', '1.1.1.1'],
            dhcp4: 'Enabled',
            leased4: ['1.1.1.1', '8.8.8.8', '8.8.8.8']
          })
        )
      ).toBe('auto')
    })

    it('returns unknown when the resolvers do not match the DHCP lease', () => {
      expect(
        classifyWindowsMethod(
          adapter({ v4: ['9.9.9.9'], dhcp4: 'Enabled', leased4: ['8.8.8.8'] })
        )
      ).toBe('unknown')
    })
  })

  describe('DHCP with manually configured DNS', () => {
    it('classifies manual DNS on a DHCP-managed family as static', () => {
      // DHCP for IP does not prove DNS came from DHCP.
      expect(
        classifyWindowsMethod(
          adapter({ v4: ['1.1.1.1'], dhcp4: 'Enabled', manual4: ['1.1.1.1'] })
        )
      ).toBe('static')
    })

    it('prefers the manual registry value when a lease is also present', () => {
      expect(
        classifyWindowsMethod(
          adapter({
            v4: ['1.1.1.1'],
            dhcp4: 'Enabled',
            manual4: ['1.1.1.1'],
            leased4: ['8.8.8.8']
          })
        )
      ).toBe('static')
    })
  })

  describe('static IP configuration', () => {
    it('classifies manually configured DNS with DHCP disabled as static', () => {
      expect(
        classifyWindowsMethod(
          adapter({ v4: ['1.1.1.1'], dhcp4: 'Disabled', manual4: ['1.1.1.1'] })
        )
      ).toBe('static')
    })

    it('classifies static IPv4 and IPv6 DNS as static', () => {
      expect(
        classifyWindowsMethod(
          adapter({
            v4: ['1.1.1.1'],
            v6: ['2001:4860:4860::8888'],
            dhcp4: 'Disabled',
            dhcp6: 'Disabled',
            manual4: ['1.1.1.1'],
            manual6: ['2001:4860:4860::8888']
          })
        )
      ).toBe('static')
    })

    it('returns unknown when DHCP is disabled and no manual value is recorded', () => {
      expect(
        classifyWindowsMethod(adapter({ v4: ['1.1.1.1'], dhcp4: 'Disabled' }))
      ).toBe('unknown')
    })
  })

  describe('unknown origin', () => {
    it('returns unknown when the DHCP state is missing but resolvers exist', () => {
      expect(
        classifyWindowsMethod(adapter({ v4: ['1.1.1.1'], dhcp4: '', dhcp6: '' }))
      ).toBe('unknown')
    })

    it('returns unknown when resolvers exist without manual or lease data', () => {
      expect(
        classifyWindowsMethod(adapter({ v4: ['1.1.1.1'], dhcp4: 'Enabled' }))
      ).toBe('unknown')
    })
  })

  describe('independent address families', () => {    it('classifies an IPv6-only lease as auto', () => {
      expect(
        classifyWindowsMethod(
          adapter({
            v6: ['2001:4860:4860::8888'],
            dhcp4: 'Disabled',
            dhcp6: 'Enabled',
            leased6: ['2001:4860:4860::8888']
          })
        )
      ).toBe('auto')
    })

    it('returns unknown when IPv4 is static and IPv6 came from DHCP', () => {
      expect(
        classifyWindowsMethod(
          adapter({
            v4: ['1.1.1.1'],
            v6: ['2001:4860:4860::8888'],
            dhcp4: 'Disabled',
            dhcp6: 'Enabled',
            manual4: ['1.1.1.1'],
            leased6: ['2001:4860:4860::8888']
          })
        )
      ).toBe('unknown')
    })

    it('returns unknown when IPv4 is leased and IPv6 is manual', () => {
      expect(
        classifyWindowsMethod(
          adapter({
            v4: ['8.8.8.8'],
            v6: ['2001:4860:4860::8888'],
            dhcp4: 'Enabled',
            dhcp6: 'Disabled',
            leased4: ['8.8.8.8'],
            manual6: ['2001:4860:4860::8888']
          })
        )
      ).toBe('unknown')
    })
  })

  describe('per-family methods and restore', () => {
    const mixed = adapter({
      v4: ['1.1.1.1'],
      v6: ['2001:4860:4860::8888'],
      dhcp4: 'Disabled',
      dhcp6: 'Enabled',
      manual4: ['1.1.1.1'],
      leased6: ['2001:4860:4860::8888']
    })

    it('classifies each family independently even when the combined view is unknown', () => {
      expect(classifyWindowsMethod(mixed)).toBe('unknown')
      expect(classifyWindowsFamilyMethod(mixed, 4)).toBe('static')
      expect(classifyWindowsFamilyMethod(mixed, 6)).toBe('auto')
    })

    it('resets but only re-applies the static family', () => {
      const service: DnsServiceBackup = {
        name: 'Ethernet',
        index: 12,
        v4: ['1.1.1.1'],
        v6: ['2001:4860:4860::8888'],
        method: 'unknown',
        method4: 'static',
        method6: 'auto'
      }
      expect(planWindowsRestore(service)).toEqual({ reset: true, addresses: ['1.1.1.1'] })
    })

    it('does not overwrite an automatic family or report it as a user change', () => {
      const saved: DnsServiceBackup = {
        name: 'Ethernet',
        index: 12,
        v4: ['1.1.1.1'],
        v6: ['2001:4860:4860::8888'],
        method: 'unknown',
        method4: 'static',
        method6: 'auto'
      }
      const current: DnsServiceBackup = {
        name: 'Ethernet',
        index: 12,
        v4: ['1.1.1.1'],
        v6: ['2001:4860:4860::9999'],
        method: 'unknown',
        method4: 'static',
        method6: 'auto'
      }
      // While the automatic family still points at the relay it is untouched.
      expect(userChangedDns(saved, { ...current, v6: ['::1'] })).toBe(false)
      // After the restore the automatic family may hold any DHCP address; only
      // the static family is compared exactly.
      expect(verifyRestored(saved, current)).toBeNull()
    })

    it('detects a change to the static family only', () => {
      const saved: DnsServiceBackup = {
        name: 'Ethernet',
        index: 12,
        v4: ['1.1.1.1'],
        v6: [],
        method: 'static',
        method4: 'static',
        method6: 'auto'
      }
      const current: DnsServiceBackup = {
        name: 'Ethernet',
        index: 12,
        v4: ['9.9.9.9'],
        v6: ['2001:4860:4860::8888'],
        method: 'unknown',
        method4: 'static',
        method6: 'auto'
      }
      expect(userChangedDns(saved, current)).toBe(true)
      expect(verifyRestored(saved, current)).toContain('IPv4')
    })
  })
})
