import { describe, expect, it } from 'vitest'
import {
  classifyLinuxDns,
  classifyNetworkdDns,
  effectiveNetworkdFiles,
  hasStaticDnsInNetworkd,
  networkdDhcpEnabled,
  networkdDropInFiles,
  parseResolvectlServers,
  staticDnsInNetworkFile,
  type NetworkdReader
} from '../src/main/vpn/dns-guard'

/** Builds a reader over an in-memory set of `.network` files. */
function reader(files: Record<string, string | null>): NetworkdReader {
  return {
    list: () => Object.keys(files),
    read: (path) => (path in files ? files[path] : null)
  }
}

const staticFile = (iface: string, dns = '8.8.8.8'): string => `[Match]
Name=${iface}

[Network]
DNS=${dns}
`

const dhcpFile = (iface: string): string => `[Match]
Name=${iface}

[Network]
DHCP=yes
`

describe('staticDnsInNetworkFile', () => {
  it('reports static DNS for a matching interface', () => {
    expect(staticDnsInNetworkFile(staticFile('eth0'), 'eth0')).toBe(true)
  })

  it('ignores a file that matches another interface', () => {
    expect(staticDnsInNetworkFile(staticFile('eth1'), 'eth0')).toBe(false)
  })

  it('treats DHCP-only configuration as not static', () => {
    expect(staticDnsInNetworkFile(dhcpFile('eth0'), 'eth0')).toBe(false)
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

describe('effectiveNetworkdFiles', () => {
  it('lets /etc replace the same-named file in /run and /usr/lib', () => {
    const files = effectiveNetworkdFiles([
      '/usr/lib/systemd/network/10-eth0.network',
      '/run/systemd/network/10-eth0.network',
      '/etc/systemd/network/10-eth0.network'
    ])
    expect(files).toEqual(['/etc/systemd/network/10-eth0.network'])
  })

  it('lets /run replace /usr/lib when there is no override in /etc', () => {
    const files = effectiveNetworkdFiles([
      '/usr/lib/systemd/network/10-eth0.network',
      '/run/systemd/network/10-eth0.network'
    ])
    expect(files).toEqual(['/run/systemd/network/10-eth0.network'])
  })

  it('keeps files from every directory when the names differ', () => {
    const files = effectiveNetworkdFiles([
      '/usr/lib/systemd/network/10-default.network',
      '/run/systemd/network/20-run.network',
      '/etc/systemd/network/30-etc.network'
    ])
    expect(files).toEqual([
      '/usr/lib/systemd/network/10-default.network',
      '/run/systemd/network/20-run.network',
      '/etc/systemd/network/30-etc.network'
    ])
  })

  it('sorts by file name, not by directory priority', () => {
    const files = effectiveNetworkdFiles([
      '/etc/systemd/network/50-wifi.network',
      '/usr/lib/systemd/network/10-eth.network'
    ])
    expect(files[0]).toBe('/usr/lib/systemd/network/10-eth.network')
  })

  it('ignores files outside the networkd directories and non-.network files', () => {
    expect(
      effectiveNetworkdFiles([
        '/home/user/backup/10-eth0.network',
        '/etc/systemd/network/10-eth0.conf'
      ])
    ).toEqual([])
  })
})

describe('classifyNetworkdDns', () => {
  it('finds a static file in any of the standard directories', () => {
    expect(
      classifyNetworkdDns(
        'eth0',
        reader({
          '/usr/lib/systemd/network/10-eth0.network': staticFile('eth0'),
          '/run/systemd/network/20-other.network': dhcpFile('eth1')
        })
      )
    ).toBe('static')
  })

  it('uses the /etc override instead of the /usr/lib default', () => {
    expect(
      classifyNetworkdDns(
        'eth0',
        reader({
          '/usr/lib/systemd/network/10-eth0.network': staticFile('eth0'),
          '/etc/systemd/network/10-eth0.network': dhcpFile('eth0')
        })
      )
    ).toBe('auto')
  })

  it('only applies the first matching file', () => {
    // networkd does not merge files: 10-eth0 wins and does not set DNS=.
    expect(
      classifyNetworkdDns(
        'eth0',
        reader({
          '/etc/systemd/network/10-eth0.network': dhcpFile('eth0'),
          '/etc/systemd/network/20-eth0-dns.network': staticFile('eth0')
        })
      )
    ).toBe('auto')
  })

  it('reports auto for a DHCP-managed interface without DNS=', () => {
    expect(
      classifyNetworkdDns('eth0', reader({ '/etc/systemd/network/10-eth0.network': dhcpFile('eth0') }))
    ).toBe('auto')
  })

  it('reports unknown when the effective file pins neither DNS= nor DHCP=', () => {
    const content = `[Match]
Name=eth0

[Network]
Address=192.168.1.10/24
`
    expect(
      classifyNetworkdDns('eth0', reader({ '/etc/systemd/network/10-eth0.network': content }))
    ).toBe('unknown')
  })

  it('reports unknown when a file cannot be read', () => {
    expect(
      classifyNetworkdDns(
        'eth0',
        reader({
          '/etc/systemd/network/10-eth0.network': null,
          '/usr/lib/systemd/network/90-static.network': staticFile('eth0')
        })
      )
    ).toBe('unknown')
  })

  it('reports unknown when nothing applies to the interface', () => {
    expect(
      classifyNetworkdDns('eth0', reader({ '/etc/systemd/network/10-eth1.network': staticFile('eth1') }))
    ).toBe('unknown')
  })

  it('reports unknown when there are no network files at all', () => {
    expect(classifyNetworkdDns('eth0', reader({}))).toBe('unknown')
  })

  it('reports unknown when the directory listing fails', () => {
    const failing: NetworkdReader = {
      list: () => {
        throw new Error('EACCES')
      },
      read: () => ''
    }
    expect(classifyNetworkdDns('eth0', failing)).toBe('unknown')
  })
})

describe('hasStaticDnsInNetworkd', () => {
  it('is true only for a confirmed static configuration', () => {
    expect(hasStaticDnsInNetworkd('eth0', reader({ '/etc/systemd/network/10-eth0.network': staticFile('eth0') }))).toBe(true)
    expect(hasStaticDnsInNetworkd('eth0', reader({ '/etc/systemd/network/10-eth0.network': dhcpFile('eth0') }))).toBe(false)
    expect(hasStaticDnsInNetworkd('eth0', reader({ '/etc/systemd/network/10-eth0.network': null }))).toBe(false)
  })
})

describe('classifyLinuxDns', () => {
  it('never reports auto when resolvectl failed', () => {
    expect(classifyLinuxDns([], 'auto', true)).toBe('unknown')
    expect(classifyLinuxDns(['8.8.8.8'], 'auto', true)).toBe('unknown')
    expect(classifyLinuxDns(['8.8.8.8'], 'static', true)).toBe('unknown')
  })

  it('reports auto for an empty answer only when networkd uses DHCP', () => {
    expect(classifyLinuxDns([], 'auto', false)).toBe('auto')
    expect(classifyLinuxDns([], 'unknown', false)).toBe('unknown')
    expect(classifyLinuxDns([], 'static', false)).toBe('unknown')
  })

  it('uses the networkd verdict when resolvers are present', () => {
    expect(classifyLinuxDns(['8.8.8.8'], 'static', false)).toBe('static')
    expect(classifyLinuxDns(['8.8.8.8'], 'auto', false)).toBe('auto')
    expect(classifyLinuxDns(['8.8.8.8'], 'unknown', false)).toBe('unknown')
  })
})

describe('networkd DHCP values', () => {
  it('accepts every documented enabled spelling', () => {
    for (const value of ['yes', 'true', 'on', 'ipv4', 'ipv6', 'both', 'BOTH']) {
      expect(networkdDhcpEnabled(value)).toBe(true)
    }
  })

  it('rejects disabled and unknown values', () => {
    for (const value of ['no', 'false', 'off', 'none', '', 'maybe']) {
      expect(networkdDhcpEnabled(value)).toBe(false)
    }
  })

  it('classifies DHCP=both as automatic', () => {
    const content = `[Match]
Name=eth0

[Network]
DHCP=both
`
    expect(classifyNetworkdDns('eth0', reader({ '/etc/systemd/network/10-eth0.network': content }))).toBe('auto')
  })

  it('stays unknown when DHCP is explicitly disabled and no DNS= is set', () => {
    const content = `[Match]
Name=eth0

[Network]
DHCP=no
`
    expect(classifyNetworkdDns('eth0', reader({ '/etc/systemd/network/10-eth0.network': content }))).toBe('unknown')
  })
})

describe('networkd drop-ins', () => {
  const base = '/etc/systemd/network/10-eth0.network'

  it('selects drop-ins in lexicographic order with /etc precedence', () => {
    expect(
      networkdDropInFiles(base, [
        '/usr/lib/systemd/network/10-eth0.network.d/20-dns.conf',
        '/etc/systemd/network/10-eth0.network.d/20-dns.conf',
        '/etc/systemd/network/10-eth0.network.d/10-early.conf',
        '/etc/systemd/network/10-eth0.network.d/readme.txt'
      ])
    ).toEqual([
      '/etc/systemd/network/10-eth0.network.d/10-early.conf',
      '/etc/systemd/network/10-eth0.network.d/20-dns.conf'
    ])
  })

  it('lets a drop-in add static DNS to a DHCP base file', () => {
    expect(
      classifyNetworkdDns(
        'eth0',
        reader({
          [base]: dhcpFile('eth0'),
          [`${base}.d/10-dns.conf`]: `[Network]\nDNS=1.1.1.1\n`
        })
      )
    ).toBe('static')
  })

  it('lets a drop-in clear a static DNS entry', () => {
    const content = `[Match]
Name=eth0

[Network]
DHCP=yes
DNS=8.8.8.8
`
    expect(
      classifyNetworkdDns(
        'eth0',
        reader({
          [base]: content,
          [`${base}.d/10-clear.conf`]: `[Network]\nDNS=\n`
        })
      )
    ).toBe('auto')
  })

  it('reports unknown when a drop-in cannot be read', () => {
    expect(
      classifyNetworkdDns(
        'eth0',
        reader({
          [base]: dhcpFile('eth0'),
          [`${base}.d/10-dns.conf`]: null
        })
      )
    ).toBe('unknown')
  })
})

describe('parseResolvectlServers', () => {
  it('reads global and per-link lines', () => {
    const output = `Global: 1.1.1.1 2606:4700::1111
Link 2 (eth0): 192.168.1.1 fe80::1%eth0
`
    expect(parseResolvectlServers(output)).toEqual([
      '1.1.1.1',
      '2606:4700::1111',
      '192.168.1.1',
      'fe80::1'
    ])
  })

  it('ignores interface names, indices and empty answers', () => {
    expect(parseResolvectlServers('Link 2 (eth0):\nGlobal:\n')).toEqual([])
    expect(parseResolvectlServers('')).toEqual([])
  })
})
