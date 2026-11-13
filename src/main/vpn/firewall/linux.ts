import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { KillSwitchBackend, KillSwitchContext } from './types'

const execFileAsync = promisify(execFile)
const CHAIN = 'EAGLET_KS'
const CHAIN6 = 'EAGLET_KS6'

function markerPath(): string {
  return join(app.getPath('userData'), 'iptables-marker.json')
}

async function iptables(args: string[], command = 'iptables'): Promise<void> {
  await execFileAsync(command, args, { timeout: 8000 })
}

function iptablesSync(args: string[], command = 'iptables'): void {
  execFileSync(command, args, { timeout: 5000, stdio: 'ignore' })
}

function markerExists(): boolean {
  return existsSync(markerPath())
}

function family(values: string[], version: 4 | 6): string[] {
  return values.filter((value) => isIP(value) === version)
}

function validPorts(values: number[]): number[] {
  return [...new Set(values.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))]
}

function portRules(destination: string, ports: number[], protocols: string[] = ['tcp', 'udp']): string[][] {
  const rules: string[][] = []
  for (const port of validPorts(ports)) {
    for (const protocol of protocols) {
      rules.push(['-d', destination, '-p', protocol, '--dport', String(port), '-j', 'RETURN'])
    }
  }
  return rules
}

function appEndpointRules(context: KillSwitchContext, version: 4 | 6): string[][] {
  const rules: string[][] = []
  for (const endpoint of context.appEndpoints) {
    for (const ip of family(endpoint.ips, version)) {
      // The Electron app only speaks HTTPS/HTTP for subscriptions and probes.
      rules.push(...portRules(ip, endpoint.ports, ['tcp']))
    }
  }
  return rules
}

/**
 * IPv4 allow-list for the dedicated chain. Only loopback, DHCP, link-local,
 * the node address + port, the DoH resolver, the app's resolved endpoints and
 * (when DNS protection is off) the current DNS servers are allowed. There is
 * intentionally no ESTABLISHED/RELATED shortcut: an old connection established
 * before the tunnel started must not keep leaking.
 */
export function linuxRules(context: KillSwitchContext): string[][] {
  const rules: string[][] = [['-o', 'lo', '-j', 'RETURN']]
  rules.push(['-p', 'udp', '--sport', '68', '--dport', '67', '-j', 'RETURN'])
  rules.push(['-d', '169.254.0.0/16', '-j', 'RETURN'])
  for (const ip of family(context.serverIps, 4)) rules.push(...portRules(ip, context.serverPorts))
  if (context.dnsProtected) {
    for (const ip of family(context.dohIps, 4)) rules.push(...portRules(ip, context.dohPorts, ['tcp']))
  } else {
    for (const ip of family(context.dnsServers, 4)) rules.push(...portRules(ip, [53]))
  }
  rules.push(...appEndpointRules(context, 4))
  rules.push(['-j', 'DROP'])
  return rules
}

/**
 * IPv6 allow-list. IPv6 is blocked even when the node has no IPv6 address,
 * which closes the classic IPv6 leak: without this chain every IPv6 packet
 * would leave the machine without passing through the tunnel.
 */
export function linux6Rules(context: KillSwitchContext): string[][] {
  const rules: string[][] = [['-o', 'lo', '-j', 'RETURN']]
  // Neighbour discovery and router advertisements stay local to the link.
  rules.push(['-p', 'ipv6-icmp', '-d', 'fe80::/10', '-j', 'RETURN'])
  rules.push(['-p', 'ipv6-icmp', '-d', 'ff00::/8', '-j', 'RETURN'])
  rules.push(['-p', 'udp', '--sport', '546', '--dport', '547', '-j', 'RETURN'])
  for (const ip of family(context.serverIps, 6)) rules.push(...portRules(ip, context.serverPorts))
  if (context.dnsProtected) {
    for (const ip of family(context.dohIps, 6)) rules.push(...portRules(ip, context.dohPorts, ['tcp']))
  } else {
    for (const ip of family(context.dnsServers, 6)) rules.push(...portRules(ip, [53]))
  }
  rules.push(...appEndpointRules(context, 6))
  rules.push(['-j', 'DROP'])
  return rules
}

/**
 * IPv6 can only be skipped when the kernel really has it disabled. When the
 * stack is enabled (the normal case), a missing ip6tables must fail the whole
 * kill switch instead of silently leaving IPv6 wide open.
 */
export function ipv6NeedsProtection(disableFlag: string | null | undefined): boolean {
  return String(disableFlag ?? '').trim() !== '1'
}

function ipv6StackDisabled(): boolean {
  try {
    return !ipv6NeedsProtection(readFileSync('/proc/sys/net/ipv6/conf/all/disable_ipv6', 'utf-8'))
  } catch {
    // No /proc entry means the stack is normally enabled; fail closed.
    return false
  }
}

async function installChain(command: string, chain: string, rules: string[][]): Promise<void> {
  await iptables(['-N', chain], command).catch(() => undefined)
  await iptables(['-F', chain], command)
  // Keep the chain fail-closed while the allow list is rebuilt. The trailing
  // DROP is written first and every allow rule is inserted in front of it, so
  // the gap between the flush and the complete policy cannot leak traffic.
  await iptables(['-A', chain, '-j', 'DROP'], command)
  let position = 1
  for (const rule of rules) {
    await iptables(['-I', chain, String(position), ...rule], command)
    position += 1
  }
  await iptables(['-C', 'OUTPUT', '-j', chain], command).catch(async () => {
    await iptables(['-I', 'OUTPUT', '1', '-j', chain], command)
  })
}

async function removeChain(command: string, chain: string): Promise<void> {
  await iptables(['-D', 'OUTPUT', '-j', chain], command).catch(() => undefined)
  await iptables(['-F', chain], command).catch(() => undefined)
  await iptables(['-X', chain], command).catch(() => undefined)
}

function removeChainSync(command: string, chain: string): void {
  try {
    iptablesSync(['-D', 'OUTPUT', '-j', chain], command)
  } catch {
    // ignore
  }
  try {
    iptablesSync(['-F', chain], command)
    iptablesSync(['-X', chain], command)
  } catch {
    // ignore
  }
}

/**
 * Linux kill switch built on dedicated iptables/ip6tables chains. Requires
 * CAP_NET_ADMIN/root; a failure removes both chains again.
 */
export const linuxKillSwitch: KillSwitchBackend = {
  async enable(context: KillSwitchContext): Promise<void> {
    let ipv4 = false
    let ipv6 = false
    try {
      // Write the marker before touching either table. If the process crashes
      // halfway through, the next launch still knows that Eaglet may have left
      // a partial chain behind and can clean both tables.
      writeFileSync(markerPath(), JSON.stringify({ at: Date.now(), installing: true }), 'utf-8')

      await installChain('iptables', CHAIN, linuxRules(context))
      ipv4 = true

      if (ipv6StackDisabled()) {
        // The kernel has IPv6 switched off, so there is nothing to protect and
        // no ip6tables dependency.
        ipv6 = false
        await removeChain('ip6tables', CHAIN6).catch(() => undefined)
      } else {
        try {
          await installChain('ip6tables', CHAIN6, linux6Rules(context))
          ipv6 = true
        } catch (error) {
          throw new Error(
            `ip6tables is unavailable, so IPv6 cannot be blocked; refusing to arm a partial kill switch (${(error as Error).message})`
          )
        }
      }

      writeFileSync(
        markerPath(),
        JSON.stringify({ at: Date.now(), serverIps: context.serverIps, ipv4, ipv6 }),
        'utf-8'
      )
    } catch (error) {
      await this.disable().catch(() => undefined)
      throw new Error(
        `Linux kill switch was not armed (run Eaglet with CAP_NET_ADMIN): ${(error as Error).message}`
      )
    }
  },

  async disable(): Promise<void> {
    await removeChain('iptables', CHAIN)
    await removeChain('ip6tables', CHAIN6)
    rmSync(markerPath(), { force: true })
  },

  disableSync(): void {
    removeChainSync('iptables', CHAIN)
    removeChainSync('ip6tables', CHAIN6)
    rmSync(markerPath(), { force: true })
  },

  recover(): void {
    if (!markerExists()) return
    // The marker can only have been written by Eaglet after our chains were
    // installed. Remove both tables regardless of age: leaving a stale DROP
    // chain behind after a crash is exactly the outage this recovery prevents.
    this.disableSync()
  }
}
