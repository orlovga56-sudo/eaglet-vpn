import { describe, expect, it } from 'vitest'
import { classifyWindowsMethod } from '../src/main/vpn/dns-guard'
import type { WindowsAdapter } from '../src/main/vpn/dns-guard'

describe('Windows DNS Classification', () => {
  it('should classify DHCP with no DNS as auto', () => {
    const adapter: WindowsAdapter = {
      index: 12,
      name: 'Ethernet',
      v4: [],
      v6: [],
      dhcp4: 'Enabled',
      dhcp6: 'Disabled'
    }
    
    expect(classifyWindowsMethod(adapter)).toBe('auto')
  })

  it('should classify DHCP with obtained DNS as auto', () => {
    const adapter: WindowsAdapter = {
      index: 12,
      name: 'Ethernet',
      v4: ['8.8.8.8'], // DHCP-obtained DNS
      v6: [],
      dhcp4: 'Enabled',
      dhcp6: 'Disabled'
    }
    
    expect(classifyWindowsMethod(adapter)).toBe('auto')
  })

  it('should classify manual DNS as static', () => {
    const adapter: WindowsAdapter = {
      index: 12,
      name: 'Ethernet',
      v4: ['1.1.1.1'], // Manual DNS
      v6: [],
      dhcp4: 'Disabled',
      dhcp6: 'Disabled'
    }
    
    expect(classifyWindowsMethod(adapter)).toBe('static')
  })

  it('should classify mixed DHCP and manual DNS correctly', () => {
    const adapter: WindowsAdapter = {
      index: 12,
      name: 'Ethernet',
      v4: ['1.1.1.1'], // Manual IPv4 DNS
      v6: [], // No IPv6 DNS
      dhcp4: 'Disabled', // IPv4 DHCP disabled
      dhcp6: 'Enabled' // IPv6 DHCP enabled
    }
    
    expect(classifyWindowsMethod(adapter)).toBe('static')
  })

  it('should classify both families with manual DNS as static', () => {
    const adapter: WindowsAdapter = {
      index: 12,
      name: 'Ethernet',
      v4: ['1.1.1.1'],
      v6: ['2001:4860:4860::8888'],
      dhcp4: 'Disabled',
      dhcp6: 'Disabled'
    }
    
    expect(classifyWindowsMethod(adapter)).toBe('static')
  })

  it('should classify DHCP-only configuration as auto', () => {
    const adapter: WindowsAdapter = {
      index: 12,
      name: 'Ethernet',
      v4: [],
      v6: [],
      dhcp4: 'Enabled',
      dhcp6: 'Enabled'
    }
    
    expect(classifyWindowsMethod(adapter)).toBe('auto')
  })

  it('should classify unknown DHCP state as unknown', () => {
    const adapter: WindowsAdapter = {
      index: 12,
      name: 'Ethernet',
      v4: [],
      v6: [],
      dhcp4: 'Unknown',
      dhcp6: 'Unknown'
    }
    
    expect(classifyWindowsMethod(adapter)).toBe('unknown')
  })

  it('should classify partial DHCP state correctly', () => {
    const adapter: WindowsAdapter = {
      index: 12,
      name: 'Ethernet',
      v4: ['8.8.8.8'], // DHCP-obtained IPv4
      v6: ['2001:4860:4860::8888'], // Manual IPv6
      dhcp4: 'Enabled',
      dhcp6: 'Disabled'
    }
    
    expect(classifyWindowsMethod(adapter)).toBe('static')
  })

  it('should handle empty DHCP strings', () => {
    const adapter: WindowsAdapter = {
      index: 12,
      name: 'Ethernet',
      v4: ['1.1.1.1'],
      v6: [],
      dhcp4: '', // Empty string
      dhcp6: ''
    }
    
    expect(classifyWindowsMethod(adapter)).toBe('static')
  })

  it('should handle case-insensitive DHCP status', () => {
    const adapter: WindowsAdapter = {
      index: 12,
      name: 'Ethernet',
      v4: [],
      v6: [],
      dhcp4: 'enabled', // lowercase
      dhcp6: 'ENABLED' // uppercase
    }
    
    expect(classifyWindowsMethod(adapter)).toBe('auto')
  })
})