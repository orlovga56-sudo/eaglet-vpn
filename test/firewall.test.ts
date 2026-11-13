import { describe, expect, it } from 'vitest'
import {
  ipv6NeedsProtection,
  linux6Rules,
  linuxRules
} from '../src/main/vpn/firewall/linux'
import { macRules } from '../src/main/vpn/firewall/macos'
import { windowsKillSwitchScript } from '../src/main/vpn/firewall/windows'
import type { KillSwitchContext } from '../src/main/vpn/firewall/types'

const context: KillSwitchContext = {
  serverIps: ['203.0.113.10', '2001:db8::10'],
  serverPorts: [443, 8443],
  corePath: 'C:\\Users\\user\\AppData\\Roaming\\Eaglet\\bin\\sing-box.exe',
  appPath: 'C:\\Program Files\\Eaglet\\Eaglet.exe',
  dohIps: ['1.1.1.1', '2606:4700:4700::1111'],
  dohPorts: [443],
  dnsServers: ['192.168.1.1', '2001:db8::53'],
  dnsProtected: false,
  appEndpoints: [
    { ips: ['93.184.216.34'], ports: [443] },
    { ips: ['203.0.113.77', '2001:db8::77'], ports: [80] }
  ]
}

function flat(rules: string[][]): string[] {
  return rules.map((rule) => rule.join(' '))
}

describe('windows kill switch', () => {
  const script = windowsKillSwitchScript(context)

  it('flips the default policy to block', () => {
    expect(script).toContain('Set-NetFirewallProfile -All -DefaultOutboundAction Block')
    // Every allow rule must be explicit; no "any program / any port" rule.
    expect(script).not.toMatch(/-Protocol\s+Any/i)
    expect(script).not.toMatch(/-RemotePort\s+Any/i)
    expect(script).not.toMatch(/-RemoteAddress\s+Any/i)
  })

  it('scopes the node exception to the core executable, node IPs and node ports', () => {
    const coreRules = script
      .split('\n')
      .filter((line) => line.includes('Kill Switch · core'))
    expect(coreRules).toHaveLength(2)
    for (const rule of coreRules) {
      expect(rule).toContain(`-Program '${context.corePath}'`)
      expect(rule).toContain("'203.0.113.10','2001:db8::10'")
      expect(rule).toContain('-RemotePort 443,8443')
    }
    expect(coreRules[0]).toContain('-Protocol TCP')
    expect(coreRules[1]).toContain('-Protocol UDP')
  })

  it('never allows the app to reach arbitrary addresses on 80/443', () => {
    expect(script).not.toContain('-RemotePort 80,443')
    expect(script).not.toContain('Kill Switch · app web')
  })

  it('allows only resolved app endpoints on their exact ports', () => {
    const endpointRules = script
      .split('\n')
      .filter((line) => line.includes('Kill Switch · app endpoint'))
    expect(endpointRules).toHaveLength(2)
    expect(endpointRules[0]).toContain(`-Program '${context.appPath}'`)
    expect(endpointRules[0]).toContain("'93.184.216.34'")
    expect(endpointRules[0]).toContain('-RemotePort 443 -Protocol TCP')
    expect(endpointRules[1]).toContain("'203.0.113.77','2001:db8::77'")
    expect(endpointRules[1]).toContain('-RemotePort 80 -Protocol TCP')
  })

  it('allows loopback and DHCP only as fixed infrastructure exceptions', () => {
    expect(script).toContain("-RemoteAddress '127.0.0.0/8','::1'")
    expect(script).toContain('-Protocol UDP -LocalPort 68 -RemotePort 67')
  })

  it('limits DNS to the core and app when DNS protection is off', () => {
    const dnsRules = script.split('\n').filter((line) => line.includes('Kill Switch · DNS'))
    expect(dnsRules).toHaveLength(4)
    for (const rule of dnsRules) {
      expect(rule).toContain("'192.168.1.1','2001:db8::53'")
      expect(rule).toContain('-RemotePort 53')
      expect(rule).toContain('-Program')
    }
    expect(dnsRules.some((rule) => rule.includes(context.corePath ?? ''))).toBe(true)
    expect(dnsRules.some((rule) => rule.includes(context.appPath))).toBe(true)
  })

  it('removes every plaintext DNS rule and allows only DoH when protection is on', () => {
    const protectedScript = windowsKillSwitchScript({ ...context, dnsProtected: true })
    expect(protectedScript).not.toContain('Kill Switch · DNS')
    expect(protectedScript).not.toContain('-RemotePort 53')
    expect(protectedScript).toContain('Kill Switch · DoH app 443')
    expect(protectedScript).toContain('Kill Switch · DoH core 443')
    expect(protectedScript).toContain("'1.1.1.1','2606:4700:4700::1111'")
  })

  it('drops invalid ports instead of widening the rule', () => {
    const filtered = windowsKillSwitchScript({
      ...context,
      serverPorts: [0, 70000, -1],
      dohPorts: [0],
      dnsProtected: true
    })
    expect(filtered).not.toContain('Kill Switch · core')
    expect(filtered).not.toContain('Kill Switch · DoH')
    // The resolved app endpoints are unaffected by node/DoH port validation.
    expect(filtered).toContain('-RemotePort 443 -Protocol TCP')
  })
})

describe('linux kill switch', () => {
  it('allows only loopback, DHCP, link-local, node, app endpoints and DNS', () => {
    const rules = flat(linuxRules(context))
    expect(rules[0]).toBe('-o lo -j RETURN')
    expect(rules).toContain('-p udp --sport 68 --dport 67 -j RETURN')
    expect(rules).toContain('-d 169.254.0.0/16 -j RETURN')
    expect(rules).toContain('-d 203.0.113.10 -p tcp --dport 443 -j RETURN')
    expect(rules).toContain('-d 203.0.113.10 -p udp --dport 8443 -j RETURN')
    expect(rules).toContain('-d 93.184.216.34 -p tcp --dport 443 -j RETURN')
    expect(rules).toContain('-d 192.168.1.1 -p udp --dport 53 -j RETURN')
    expect(rules.at(-1)).toBe('-j DROP')
    // Older builds opened port 53 to any destination and used conntrack.
    expect(rules).not.toContain('-p tcp --dport 53 -j RETURN')
    expect(rules.some((rule) => rule.includes('conntrack'))).toBe(false)
    expect(rules.some((rule) => rule.includes('2001:db8::10'))).toBe(false)
  })

  it('uses DoH only and closes plaintext DNS when protection is on', () => {
    const rules = flat(linuxRules({ ...context, dnsProtected: true }))
    expect(rules).toContain('-d 1.1.1.1 -p tcp --dport 443 -j RETURN')
    expect(rules.some((rule) => rule.includes('--dport 53'))).toBe(false)
  })

  it('drops unusable DNS entries instead of widening the hole', () => {
    const rules = flat(linuxRules({ ...context, dnsServers: ['not-an-ip'] }))
    expect(rules.some((rule) => rule.includes('--dport 53'))).toBe(false)
  })

  it('blocks IPv6 separately, including neighbour discovery and DHCPv6', () => {
    const rules = flat(linux6Rules(context))
    expect(rules).toContain('-p ipv6-icmp -d fe80::/10 -j RETURN')
    expect(rules).toContain('-p ipv6-icmp -d ff00::/8 -j RETURN')
    expect(rules).toContain('-p udp --sport 546 --dport 547 -j RETURN')
    expect(rules).toContain('-d 2001:db8::10 -p tcp --dport 443 -j RETURN')
    expect(rules).toContain('-d 2001:db8::77 -p tcp --dport 80 -j RETURN')
    expect(rules).toContain('-d 2001:db8::53 -p udp --dport 53 -j RETURN')
    expect(rules.at(-1)).toBe('-j DROP')
    expect(rules.some((rule) => rule.includes('203.0.113.10'))).toBe(false)
  })

  it('uses DoH-only IPv6 rules when DNS protection is on', () => {
    const rules = flat(linux6Rules({ ...context, dnsProtected: true }))
    expect(rules).toContain('-d 2606:4700:4700::1111 -p tcp --dport 443 -j RETURN')
    expect(rules.some((rule) => rule.includes('--dport 53'))).toBe(false)
  })

  it('requires IPv6 protection unless the kernel has IPv6 disabled', () => {
    expect(ipv6NeedsProtection('0')).toBe(true)
    expect(ipv6NeedsProtection('')).toBe(true)
    expect(ipv6NeedsProtection(null)).toBe(true)
    expect(ipv6NeedsProtection('1')).toBe(false)
    expect(ipv6NeedsProtection('1\n')).toBe(false)
  })
})

describe('macOS kill switch', () => {
  const rules = macRules(context).trim().split('\n')

  it('ends with a catch-all drop', () => {
    expect(rules.at(-1)).toBe('block drop out quick all')
  })

  it('whitelists node addresses on their ports only', () => {
    expect(rules).toContain('pass out quick proto { tcp udp } to 203.0.113.10 port { 443, 8443 }')
    expect(rules).toContain('pass out quick inet6 proto { tcp udp } to 2001:db8::10 port { 443, 8443 }')
  })

  it('adds app endpoints on their exact ports', () => {
    expect(rules).toContain('pass out quick proto tcp to 93.184.216.34 port { 443 }')
    expect(rules).toContain('pass out quick proto tcp to 203.0.113.77 port { 80 }')
    expect(rules).toContain('pass out quick inet6 proto tcp to 2001:db8::77 port { 80 }')
  })

  it('keeps DNS limited to the recorded resolvers while protection is off', () => {
    expect(rules).toContain('pass out quick proto { tcp udp } to 192.168.1.1 port 53')
    expect(rules).toContain('pass out quick inet6 proto { tcp udp } to 2001:db8::53 port 53')
    expect(rules.some((rule) => rule.includes('to any port 53'))).toBe(false)
  })

  it('replaces plaintext DNS with the pinned DoH endpoint when protection is on', () => {
    const protectedRules = macRules({ ...context, dnsProtected: true }).trim().split('\n')
    expect(protectedRules).toContain('pass out quick proto tcp to 1.1.1.1 port { 443 }')
    expect(protectedRules).toContain('pass out quick inet6 proto tcp to 2606:4700:4700::1111 port { 443 }')
    expect(protectedRules.some((rule) => rule.includes('port 53'))).toBe(false)
  })

  it('omits node rules when the port is unknown', () => {
    const withoutPorts = macRules({ ...context, serverPorts: [] })
    expect(withoutPorts).not.toContain('203.0.113.10')
  })
})
