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

function portRules(destination: string, ports: number[]): string[][] {
  const rules: string[][] = []
  for (const port of ports) {
    for (const protocol of ['tcp', 'udp']) {
      rules.push(['-d', destination, '-p', protocol, '--dport', String(port), '-j', 'RETURN'])
    }
  }
  return rules
}

/**
 * IPv4 allow-list for the dedicated chain. Only loopback, DHCP, link-local,
 * the node address + port, the DoH resolver and the current DNS servers are
 * allowed. There is intentionally no ESTABLISHED/RELATED shortcut: an old
 * connection established before the tunnel started must not keep leaking.
 */
export function linuxRules(context: KillSwitchContext): string[][] {
  const rules: string[][] = [['-o', 'lo', '-j', 'RETURN']]
  rules.push(['-p', 'udp', '--sport', '68', '--dport', '67', '-j', 'RETURN'])
  rules.push(['-d', '169.254.0.0/16', '-j', 'RETURN'])
  for (const ip of family(context.serverIps, 4)) rules.push(...portRules(ip, context.serverPorts))
  for (const ip of family(context.dohIps, 4)) rules.push(...portRules(ip, context.dohPorts))
  for (const ip of family(context.dnsServers, 4)) rules.push(...portRules(ip, [53]))
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
  for (const ip of family(context.dohIps, 6)) rules.push(...portRules(ip, context.dohPorts))
  for (const ip of family(context.dnsServers, 6)) rules.push(...portRules(ip, [53]))
  rules.push(['-j', 'DROP'])
  return rules
}

async function installChain(command: string, chain: string, rules: string[][]): Promise<void> {
  await iptables(['-N', chain], command).catch(() => undefined)
  await iptables(['-F', chain], command)
  for (const rule of rules) await iptables(['-A', chain, ...rule], command)
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
    let ipv6 = false
    try {
      await installChain('iptables', CHAIN, linuxRules(context))
      try {
        await installChain('ip6tables', CHAIN6, linux6Rules(context))
        ipv6 = true
      } catch {
        // No usable ip6tables (IPv6 disabled or the binary is missing). The
        // IPv4 policy is still valid; the marker records the limitation.
      }
      writeFileSync(
        markerPath(),
        JSON.stringify({ at: Date.now(), serverIps: context.serverIps, ipv6 }),
        'utf-8'
      )
    } catch (error) {
      await this.disable().catch(() => undefined)
      throw new Error(
        `iptables rejected the kill-switch chain (run Eaglet with CAP_NET_ADMIN): ${(error as Error).message}`
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
    try {
      const data = JSON.parse(readFileSync(markerPath(), 'utf-8')) as { at?: number }
      // Only restore very recent leftovers; an old marker may belong to a
      // different network setup.
      if (data.at && Date.now() - data.at < 24 * 60 * 60 * 1000) this.disableSync()
      else rmSync(markerPath(), { force: true })
    } catch {
      this.disableSync()
    }
  }
}
