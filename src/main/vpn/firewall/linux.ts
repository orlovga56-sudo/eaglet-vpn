import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { t } from '../../i18n'
import type { KillSwitchContext } from './types'

export interface LinuxKillSwitchOptions {
  markerPath?: string
  execFileSync?: (command: string, args: string[], options?: { timeout?: number; stdio?: 'ignore' }) => string
  execFile?: (command: string, args: string[], options?: { timeout?: number }) => Promise<unknown>
}

interface KillSwitchBackend {
  backupFile: () => string
  enable: (context: KillSwitchContext) => Promise<void>
  disable: () => Promise<void>
  disableSync: () => void
  recover: () => void
}

const execFileAsync = promisify(execFile)
const CHAIN = 'EAGLET_KS'
const CHAIN6 = 'EAGLET_KS6'

type AsyncRunner = (args: string[], command?: string) => Promise<void>
type SyncRunner = (args: string[], command?: string) => void

function markerPathDefault(): string {
  return join(app.getPath('userData'), 'iptables-marker.json')
}

function markerExists(path = markerPathDefault()): boolean {
  return existsSync(path)
}

/**
 * iptables reports a missing chain or rule as a plain error, just like a real
 * failure. Cleanup must not warn about state that is already correct, so the
 * two cases are told apart by their message.
 */
function isMissingIptablesTarget(message: string): boolean {
  const text = message.toLowerCase()
  return (
    text.includes('no such rule') ||
    text.includes('no chain/target/match') ||
    text.includes('does a matching rule exist') ||
    text.includes('bad rule')
  )
}

function isPermissionError(message: string): boolean {
  const text = message.toLowerCase()
  return text.includes('permission denied') || text.includes('operation not permitted')
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

async function installChain(
  run: AsyncRunner,
  command: string,
  chain: string,
  rules: string[][]
): Promise<void> {
  await run(['-N', chain], command).catch(() => undefined)
  await run(['-F', chain], command)
  // Keep the chain fail-closed while the allow list is rebuilt. The trailing
  // DROP is written first and every allow rule is inserted in front of it, so
  // the gap between the flush and the complete policy cannot leak traffic.
  await run(['-A', chain, '-j', 'DROP'], command)
  let position = 1
  for (const rule of rules) {
    await run(['-I', chain, String(position), ...rule], command)
    position += 1
  }
  await run(['-C', 'OUTPUT', '-j', chain], command).catch(async () => {
    await run(['-I', 'OUTPUT', '1', '-j', chain], command)
  })
}



async function removeChain(
  run: AsyncRunner,
  command: string,
  chain: string
): Promise<{ success: boolean; error: string | null }> {
  const errors: string[] = []

  const attempt = async (args: string[], action: string): Promise<void> => {
    try {
      await run(args, command)
    } catch (err) {
      const message = (err as Error).message
      // An absent rule or chain is the state cleanup wants to reach.
      if (isMissingIptablesTarget(message)) return
      errors.push(`${action}: ${message}`)
    }
  }

  await attempt(['-D', 'OUTPUT', '-j', chain], `could not delete the OUTPUT jump for ${chain}`)
  await attempt(['-F', chain], `could not flush ${chain}`)
  await attempt(['-X', chain], `could not delete ${chain}`)

  return {
    success: errors.length === 0,
    error: errors.length > 0 ? errors.join('; ') : null
  }
}

function removeChainSync(
  run: SyncRunner,
  command: string,
  chain: string
): { success: boolean; error: string | null; ruleRemoved: boolean; chainRemoved: boolean } {
  const errors: string[] = []

  const attempt = (args: string[], action: string): void => {
    try {
      run(args, command)
    } catch (err) {
      const message = (err as Error).message
      if (isMissingIptablesTarget(message)) return
      console.error(`[firewall] ${action}: ${message}`)
      errors.push(`${action}: ${message}`)
    }
  }

  attempt(['-D', 'OUTPUT', '-j', chain], `could not delete the OUTPUT jump for ${chain}`)
  attempt(['-F', chain], `could not flush ${chain}`)
  attempt(['-X', chain], `could not delete ${chain}`)

  // Trust the table itself, not the exit codes: `-C` verifies the jump and `-L`
  // verifies the chain. A permission error leaves the state unknown, which the
  // caller treats as a failure instead of silently dropping the marker.
  let ruleRemoved = true
  let chainRemoved = true

  try {
    run(['-C', 'OUTPUT', '-j', chain], command)
    ruleRemoved = false
  } catch (err) {
    const message = (err as Error).message
    if (isPermissionError(message)) {
      errors.push(`could not verify the OUTPUT jump for ${chain}: ${message}`)
      ruleRemoved = false
    }
  }

  try {
    run(['-L', chain], command)
    chainRemoved = false
  } catch (err) {
    const message = (err as Error).message
    if (isPermissionError(message)) {
      errors.push(`could not verify ${chain}: ${message}`)
      chainRemoved = false
    }
  }

  return {
    success: ruleRemoved && chainRemoved && errors.length === 0,
    error: errors.length > 0 ? errors.join('; ') : null,
    ruleRemoved,
    chainRemoved
  }
}

export type ChainStatus = 'exists' | 'absent' | 'unknown'

function statusFromError(message: string): ChainStatus {
  // "No such rule" proves the chain is gone; a permission error proves nothing.
  return isPermissionError(message) ? 'unknown' : 'absent'
}

async function checkChains(run: AsyncRunner): Promise<{ ipv4: ChainStatus; ipv6: ChainStatus }> {
  const status = async (command: string, chain: string): Promise<ChainStatus> => {
    try {
      await run(['-C', 'OUTPUT', '-j', chain], command)
      return 'exists'
    } catch (error) {
      return statusFromError((error as Error).message)
    }
  }

  return { ipv4: await status('iptables', CHAIN), ipv6: await status('ip6tables', CHAIN6) }
}

function checkChainsSync(run: SyncRunner): { ipv4: ChainStatus; ipv6: ChainStatus } {
  const status = (command: string, chain: string): ChainStatus => {
    try {
      run(['-C', 'OUTPUT', '-j', chain], command)
      return 'exists'
    } catch (error) {
      return statusFromError((error as Error).message)
    }
  }

  return { ipv4: status('iptables', CHAIN), ipv6: status('ip6tables', CHAIN6) }
}

/**
 * Linux kill switch built on dedicated iptables/ip6tables chains. Requires
 * CAP_NET_ADMIN/root; a failure removes both chains again.
 */
export const linuxKillSwitch: KillSwitchBackend = createLinuxKillSwitch()

/**
 * Create a Linux kill switch with custom dependencies for testing.
 */
export function createLinuxKillSwitch(options: LinuxKillSwitchOptions = {}): KillSwitchBackend {
  const markerPath = options.markerPath || markerPathDefault()

  const execFileSyncImpl = options.execFileSync || execFileSync
  const execFileImpl =
    options.execFile ||
    ((command: string, args: string[], opts?: { timeout?: number }) => execFileAsync(command, args, opts))

  const run: AsyncRunner = async (args, command = 'iptables') => {
    await execFileImpl(command, args, { timeout: 8000 })
  }

  const runSync: SyncRunner = (args, command = 'iptables') => {
    execFileSyncImpl(command, args, { timeout: 5000, stdio: 'ignore' })
  }

  const markerFileExists = (): boolean => markerExists(markerPath)

  async function checkEagletChains(): Promise<{ ipv4: ChainStatus; ipv6: ChainStatus }> {
    return checkChains(run)
  }

  return {
    backupFile: () => markerPath,

    async enable(context: KillSwitchContext): Promise<void> {
      let ipv4 = false
      let ipv6 = false
      try {
        // Write the marker before touching either table. If the process crashes
        // halfway through, the next launch still knows that Eaglet may have left
        // a partial chain behind and can clean both tables.
        writeFileSync(markerPath, JSON.stringify({ at: Date.now(), installing: true }), 'utf-8')

        await installChain(run, 'iptables', CHAIN, linuxRules(context))
        ipv4 = true

        if (ipv6StackDisabled()) {
          // The kernel has IPv6 switched off, so there is nothing to protect and
          // no ip6tables dependency.
          ipv6 = false
          await removeChain(run, 'ip6tables', CHAIN6).catch(() => undefined)
        } else {
          try {
            await installChain(run, 'ip6tables', CHAIN6, linux6Rules(context))
            ipv6 = true
          } catch (error) {
            throw new Error(
              `ip6tables is unavailable, so IPv6 cannot be blocked; refusing to arm a partial kill switch (${(error as Error).message})`
            )
          }
        }

        writeFileSync(
          markerPath,
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
      let ipv4Result = { success: false, error: null as string | null }
      let ipv6Result = { success: false, error: null as string | null }
      let chainsExist = { ipv4: 'unknown' as 'exists' | 'absent' | 'unknown', ipv6: 'unknown' as 'exists' | 'absent' | 'unknown' }
      
      try {
        ipv4Result = await removeChain(run, 'iptables', CHAIN)
      } catch (error) {
        ipv4Result.error = `Failed to remove IPv4 chain: ${(error as Error).message}`
      }
      
      try {
        ipv6Result = await removeChain(run, 'ip6tables', CHAIN6)
      } catch (error) {
        ipv6Result.error = `Failed to remove IPv6 chain: ${(error as Error).message}`
      }
      
      // Check if chains were actually removed
      try {
        chainsExist = await checkEagletChains()
      } catch (error) {
        console.error(`[firewall] Failed to check chain status: ${(error as Error).message}`)
      }
      
      // Only remove marker if both chains were successfully removed and no longer exist
      const chainsStillExist = chainsExist.ipv4 === 'exists' || chainsExist.ipv6 === 'exists'
      const hasErrors = chainsExist.ipv4 === 'unknown' || chainsExist.ipv6 === 'unknown'
      
      if (!chainsStillExist && !hasErrors) {
        rmSync(markerPath, { force: true })
      } else {
        // Save marker for recovery if chains still exist or there were errors
        const marker = markerFileExists() ? JSON.parse(readFileSync(markerPath, 'utf-8')) : null
        if (marker) {
          writeFileSync(
            markerPath,
            JSON.stringify({ 
              ...marker, 
              ipv4: chainsExist.ipv4 === 'absent', 
              ipv6: chainsExist.ipv6 === 'absent', 
              cleanupFailed: true,
              chainsStillExist,
              ipv4Error: ipv4Result.error,
              ipv6Error: ipv6Result.error,
              ipv4Status: chainsExist.ipv4,
              ipv6Status: chainsExist.ipv6
            }, null, 2),
            'utf-8'
          )
        }
        
        const errors = [
          ipv4Result.error,
          ipv6Result.error,
          chainsExist.ipv4 === 'exists' ? 'IPv4 chain still exists' : null,
          chainsExist.ipv6 === 'exists' ? 'IPv6 chain still exists' : null,
          hasErrors ? 'the chain state could not be verified (permission denied)' : null
        ].filter(Boolean).join('; ')
        
        throw new Error(t('Kill switch could not be fully disabled: {errors}', { errors }))
      }
    },

    disableSync(): void {
      let ipv4Result: { success: boolean; error: string | null; ruleRemoved: boolean; chainRemoved: boolean }
      let ipv6Result: { success: boolean; error: string | null; ruleRemoved: boolean; chainRemoved: boolean }
      
      // Try to remove chains
      try {
        ipv4Result = removeChainSync(runSync, 'iptables', CHAIN)
      } catch (error) {
        ipv4Result = { success: false, error: `Failed to remove IPv4 chain: ${(error as Error).message}`, ruleRemoved: false, chainRemoved: false }
      }
      
      try {
        ipv6Result = removeChainSync(runSync, 'ip6tables', CHAIN6)
      } catch (error) {
        ipv6Result = { success: false, error: `Failed to remove IPv6 chain: ${(error as Error).message}`, ruleRemoved: false, chainRemoved: false }
      }
      
      // Check actual chain status after removal through the same injected runner.
      const { ipv4: ipv4Status, ipv6: ipv6Status } = checkChainsSync(runSync)
      const ipv4CheckError =
        ipv4Status === 'unknown' ? `Permission denied when checking IPv4 chain` : null
      const ipv6CheckError =
        ipv6Status === 'unknown' ? `Permission denied when checking IPv6 chain` : null
      
      // Only remove marker if both chains were successfully removed and no longer exist
      const chainsStillExist = ipv4Status === 'exists' || ipv6Status === 'exists'
      const hasErrors = ipv4Status === 'unknown' || ipv6Status === 'unknown'
      
      if (!chainsStillExist && !hasErrors) {
        rmSync(markerPath, { force: true })
      } else {
        // Save marker for recovery if chains still exist or there were errors
        const marker = markerFileExists() ? JSON.parse(readFileSync(markerPath, 'utf-8')) : null
        if (marker) {
          writeFileSync(
            markerPath,
            JSON.stringify({ 
              ...marker, 
              ipv4: ipv4Status === 'absent', 
              ipv6: ipv6Status === 'absent', 
              cleanupFailed: true,
              chainsStillExist,
              ipv4CheckError,
              ipv6CheckError,
              ipv4RuleRemoved: ipv4Result.ruleRemoved,
              ipv6RuleRemoved: ipv6Result.ruleRemoved,
              ipv4ChainRemoved: ipv4Result.chainRemoved,
              ipv6ChainRemoved: ipv6Result.chainRemoved,
              ipv4Status,
              ipv6Status
            }, null, 2),
            'utf-8'
          )
        }
        
        const errors = [
          ipv4Result.error,
          ipv6Result.error,
          ipv4CheckError,
          ipv6CheckError,
          chainsStillExist ? 'the chains are still present' : null,
          hasErrors ? 'the chain state could not be verified' : null
        ].filter(Boolean).join('; ')
        
        throw new Error(t('Kill switch could not be fully disabled: {errors}', { errors }))
      }
    },

    recover(): void {
      if (!existsSync(markerPath)) return
      
      const marker = JSON.parse(readFileSync(markerPath, 'utf-8'))
      
      // If cleanup previously failed, try to remove remaining chains
      if (marker.cleanupFailed) {
        console.log('[firewall] Previous cleanup failed, attempting to remove remaining chains')
        try {
          this.disableSync()
        } catch (error) {
          console.error(`[firewall] Recovery failed: ${(error as Error).message}`)
        }
        return
      }
      
      // The marker can only have been written by Eaglet after our chains were
      // installed. Remove both tables regardless of age: leaving a stale DROP
      // chain behind after a crash is exactly the outage this recovery prevents.
      this.disableSync()
    }
  }
}