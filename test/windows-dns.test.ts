import { describe, expect, it } from 'vitest'
import { classifyWindowsMethod } from '../src/main/vpn/dns-guard'
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

  describe('independent address families', () => {
    it('classifies an IPv6-only lease as auto', () => {
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
})
