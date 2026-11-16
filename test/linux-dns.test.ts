import { describe, expect, it } from 'vitest'
import {
  hasStaticDnsInNetworkd,
  staticDnsInNetworkFile,
  type NetworkdReader
} from '../src/main/vpn/dns-guard'

/** Builds a reader over an in-memory set of `.network` files. */
function reader(files: Record<string, string>): NetworkdReader {
  return {
    list: () => Object.keys(files),
    read: (path) => files[path] ?? ''
  }
}

describe('staticDnsInNetworkFile', () => {
  it('reports static DNS for a matching interface', () => {
    const content = `[Match]
Name=eth0

[Network]
DNS=8.8.8.8
Gateway=192.168.1.1
`
    expect(staticDnsInNetworkFile(content, 'eth0')).toBe(true)
  })

  it('ignores a file that matches another interface', () => {
    const content = `[Match]
Name=eth1

[Network]
DNS=8.8.8.8
`
    expect(staticDnsInNetworkFile(content, 'eth0')).toBe(false)
  })

  it('treats DHCP-only configuration as not static', () => {
    const content = `[Match]
Name=eth0

[Network]
DHCP=yes
`
    expect(staticDnsInNetworkFile(content, 'eth0')).toBe(false)
  })

  it('treats DHCP with an explicit DNS= as static', () => {
    const content = `[Match]
Name=eth0

[Network]
DHCP=yes
DNS=1.1.1.1
`
    expect(staticDnsInNetworkFile(content, 'eth0')).toBe(true)
  })

  it('does not treat an empty DNS= entry as static', () => {
    const content = `[Match]
Name=eth0

[Network]
DNS=
`
    expect(staticDnsInNetworkFile(content, 'eth0')).toBe(false)
  })

  it('requires the interface to be declared in the Match section', () => {
    const content = `[Match]
Name=eth0

[Network]
Gateway=192.168.1.1

[DHCPv4]
UseDNS=true
`
    expect(staticDnsInNetworkFile(content, 'eth0')).toBe(false)
  })

  it('supports glob patterns in Name=', () => {
    const content = `[Match]
Name=en*

[Network]
DNS=9.9.9.9
`
    expect(staticDnsInNetworkFile(content, 'enp3s0')).toBe(true)
    expect(staticDnsInNetworkFile(content, 'wl0')).toBe(false)
  })
})

describe('hasStaticDnsInNetworkd', () => {
  it('finds the interface across several files', () => {
    const files = {
      '/etc/systemd/network/10-eth0.network': `[Match]
Name=eth0

[Network]
Gateway=192.168.1.1
`,
      '/etc/systemd/network/20-static.network': `[Match]
Name=eth1

[Network]
DNS=8.8.8.8
`
    }
    expect(hasStaticDnsInNetworkd('eth0', reader(files))).toBe(false)
    expect(hasStaticDnsInNetworkd('eth1', reader(files))).toBe(true)
  })

  it('returns false when no network files are present', () => {
    expect(hasStaticDnsInNetworkd('eth0', reader({}))).toBe(false)
  })

  it('returns false when a file cannot be read', () => {
    const unreadable: NetworkdReader = {
      list: () => ['/etc/systemd/network/broken.network'],
      read: () => ''
    }
    expect(hasStaticDnsInNetworkd('eth0', unreadable)).toBe(false)
  })
})
