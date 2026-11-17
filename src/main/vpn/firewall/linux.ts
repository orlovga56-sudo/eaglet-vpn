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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? 'unknown error')
}

/**
 * Messages that *prove* the probed rule or chain is not present. Anything else
 * — a missing binary (`spawnSync iptables ENOENT`), a missing table, a
 * permission problem or an unknown backend error — says nothing about the
 * actual state and must stay `unknown` instead of being read as "already
 * clean". Both iptables and ip6tables share the classic messages; the nft
 * backend additionally names the object (`Chain 'X' does not exist`).
 */
const MISSING_TARGET_MESSAGES = [
  'no chain/target/match by that name',
  'does a matching rule exist in that chain',
  'bad rule',
  'no such rule'
]

function isMissingChainOrRuleError(message: string): boolean {
  const text = message.toLowerCase()
  if (MISSING_TARGET_MESSAGES.some((pattern) => text.includes(pattern))) return true
  // nft backend wording. A `Table ... does not exist` error deliberately does
  // not match: the table is missing, not the chain.
  return /\b(?:chain|rule)\s+['"`][^'"`]+['"`]\s+does not exist\b/.test(text)
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



export type ChainStatus = 'exists' | 'absent' | 'unknown'

interface ChainState {
  status: ChainStatus
  /** Failure that prevented a reliable answer, or a real removal error. */
  error: string | null
}

interface ProbeResult {
  /** `true`/`false` when the probe answered, `null` when it failed unexpectedly. */
  present: boolean | null
  error: string | null
}

/** Probes one rule/chain and only records "absent" for trusted messages. */
async function probeAsync(
  run: AsyncRunner,
  command: string,
  args: string[],
  label: string
): Promise<ProbeResult> {
  try {
    await run(args, command)
    return { present: true, error: null }
  } catch (error) {
    const message = errorMessage(error)
    if (isMissingChainOrRuleError(message)) return { present: false, error: null }
    return { present: null, error: `${label}: ${message}` }
  }
}

function probeSync(run: SyncRunner, command: string, args: string[], label: string): ProbeResult {
  try {
    run(args, command)
    return { present: true, error: null }
  } catch (error) {
    const message = errorMessage(error)
    if (isMissingChainOrRuleError(message)) return { present: false, error: null }
    return { present: null, error: `${label}: ${message}` }
  }
}

/**
 * A chain is only "gone" when both its OUTPUT jump and the chain itself are
 * provably missing. Removing the jump while leaving the chain behind (or a
 * probe that cannot run) is not success.
 */
function combineProbes(jump: ProbeResult, chain: ProbeResult): ChainState {
  const error = [jump.error, chain.error].filter(Boolean).join('; ') || null
  // Positive evidence wins: one present object means the chain is still armed.
  if (jump.present === true || chain.present === true) return { status: 'exists', error }
  if (jump.present === null || chain.present === null) return { status: 'unknown', error }
  return { status: 'absent', error }
}

async function probeChainAsync(run: AsyncRunner, command: string, chain: string): Promise<ChainState> {
  const jump = await probeAsync(run, command, ['-C', 'OUTPUT', '-j', chain], `could not verify the OUTPUT jump for ${chain}`)
  const target = await probeAsync(run, command, ['-L', chain], `could not verify ${chain}`)
  return combineProbes(jump, target)
}

type RemovalResult = ChainState & {
  success: boolean
  ruleRemoved: boolean
  chainRemoved: boolean
}

async function removeChain(run: AsyncRunner, command: string, chain: string): Promise<RemovalResult> {
  const errors: string[] = []

  const attempt = async (args: string[], action: string): Promise<void> => {
    try {
      await run(args, command)
    } catch (error) {
      const message = errorMessage(error)
      // An absent rule or chain is the state cleanup wants to reach.
      if (isMissingChainOrRuleError(message)) return
      errors.push(`${action}: ${message}`)
    }
  }

  await attempt(['-D', 'OUTPUT', '-j', chain], `could not delete the OUTPUT jump for ${chain}`)
  await attempt(['-F', chain], `could not flush ${chain}`)
  await attempt(['-X', chain], `could not delete ${chain}`)

  const state = await probeChainAsync(run, command, chain)
  const error = [...errors, state.error].filter(Boolean).join('; ') || null
  return {
    status: state.status,
    // Unknown errors are never a successful removal, even if the chain happens
    // to be gone; only a verified-absent chain with no errors counts.
    success: state.status === 'absent' && error === null,
    error,
    ruleRemoved: state.status === 'absent',
    chainRemoved: state.status === 'absent'
  }
}

function removeChainSync(run: SyncRunner, command: string, chain: string): RemovalResult {
  const errors: string[] = []

  const attempt = (args: string[], action: string): void => {
    try {
      run(args, command)
    } catch (error) {
      const message = errorMessage(error)
      if (isMissingChainOrRuleError(message)) return
      console.error(`[firewall] ${action}: ${message}`)
      errors.push(`${action}: ${message}`)
    }
  }

  attempt(['-D', 'OUTPUT', '-j', chain], `could not delete the OUTPUT jump for ${chain}`)
  attempt(['-F', chain], `could not flush ${chain}`)
  attempt(['-X', chain], `could not delete ${chain}`)

  // Trust the table itself, not the exit codes: `-C` verifies the jump and `-L`
  // verifies the chain. Unknown errors leave the state unknown, so the caller
  // keeps the marker instead of silently dropping it.
  const jump = probeSync(run, command, ['-C', 'OUTPUT', '-j', chain], `could not verify the OUTPUT jump for ${chain}`)
  const target = probeSync(run, command, ['-L', chain], `could not verify ${chain}`)
  const state = combineProbes(jump, target)
  const error = [...errors, state.error].filter(Boolean).join('; ') || null

  return {
    status: state.status,
    success: state.status === 'absent' && error === null,
    error,
    ruleRemoved: jump.present === false,
    chainRemoved: target.present === false
  }
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
      const unknownRemoval = (message: string): RemovalResult => ({
        status: 'unknown',
        success: false,
        error: message,
        ruleRemoved: false,
        chainRemoved: false
      })

      let ipv4Result: RemovalResult
      let ipv6Result: RemovalResult

      try {
        ipv4Result = await removeChain(run, 'iptables', CHAIN)
      } catch (error) {
        ipv4Result = unknownRemoval(`Failed to remove the IPv4 chain: ${errorMessage(error)}`)
      }

      try {
        ipv6Result = await removeChain(run, 'ip6tables', CHAIN6)
      } catch (error) {
        ipv6Result = unknownRemoval(`Failed to remove the IPv6 chain: ${errorMessage(error)}`)
      }

      // Only a provably absent pair may drop the marker. `exists` means part of
      // the policy is still armed; `unknown` means the answer could not be
      // obtained, so the next launch must retry instead of trusting it.
      const chainsStillExist = ipv4Result.status === 'exists' || ipv6Result.status === 'exists'
      const stateUnknown = ipv4Result.status === 'unknown' || ipv6Result.status === 'unknown'

      if (!chainsStillExist && !stateUnknown) {
        if (ipv4Result.error || ipv6Result.error) {
          // The end state is verified, but a command still complained. Keep the
          // failure visible without blocking a disconnect that already happened.
          console.warn(
            `[firewall] Kill switch is off, but cleanup reported: ${[ipv4Result.error, ipv6Result.error].filter(Boolean).join('; ')}`
          )
        }
        rmSync(markerPath, { force: true })
      } else {
        // Save marker for recovery if chains still exist or the state is unknown.
        const marker = markerFileExists() ? JSON.parse(readFileSync(markerPath, 'utf-8')) : null
        if (marker) {
          writeFileSync(
            markerPath,
            JSON.stringify({
              ...marker,
              ipv4: ipv4Result.status === 'absent',
              ipv6: ipv6Result.status === 'absent',
              cleanupFailed: true,
              chainsStillExist,
              stateUnknown,
              ipv4Error: ipv4Result.error,
              ipv6Error: ipv6Result.error,
              ipv4Status: ipv4Result.status,
              ipv6Status: ipv6Result.status
            }, null, 2),
            'utf-8'
          )
        }

        const errors = [
          ipv4Result.error,
          ipv6Result.error,
          ipv4Result.status === 'exists' ? 'the IPv4 chain is still present' : null,
          ipv6Result.status === 'exists' ? 'the IPv6 chain is still present' : null,
          stateUnknown ? 'the chain state could not be verified' : null
        ].filter(Boolean).join('; ')

        throw new Error(t('Kill switch could not be fully disabled: {errors}', { errors }))
      }
    },

    disableSync(): void {
      const unknownRemoval = (message: string): RemovalResult => ({
        status: 'unknown',
        success: false,
        error: message,
        ruleRemoved: false,
        chainRemoved: false
      })

      let ipv4Result: RemovalResult
      let ipv6Result: RemovalResult

      try {
        ipv4Result = removeChainSync(runSync, 'iptables', CHAIN)
      } catch (error) {
        ipv4Result = unknownRemoval(`Failed to remove the IPv4 chain: ${errorMessage(error)}`)
      }

      try {
        ipv6Result = removeChainSync(runSync, 'ip6tables', CHAIN6)
      } catch (error) {
        ipv6Result = unknownRemoval(`Failed to remove the IPv6 chain: ${errorMessage(error)}`)
      }

      const chainsStillExist = ipv4Result.status === 'exists' || ipv6Result.status === 'exists'
      const stateUnknown = ipv4Result.status === 'unknown' || ipv6Result.status === 'unknown'

      if (!chainsStillExist && !stateUnknown) {
        if (ipv4Result.error || ipv6Result.error) {
          console.warn(
            `[firewall] Kill switch is off, but cleanup reported: ${[ipv4Result.error, ipv6Result.error].filter(Boolean).join('; ')}`
          )
        }
        rmSync(markerPath, { force: true })
      } else {
        // Keep the marker whenever something is still armed or the state could
        // not be verified; recover() retries on the next launch.
        const marker = markerFileExists() ? JSON.parse(readFileSync(markerPath, 'utf-8')) : null
        if (marker) {
          writeFileSync(
            markerPath,
            JSON.stringify({
              ...marker,
              ipv4: ipv4Result.status === 'absent',
              ipv6: ipv6Result.status === 'absent',
              cleanupFailed: true,
              chainsStillExist,
              stateUnknown,
              ipv4Error: ipv4Result.error,
              ipv6Error: ipv6Result.error,
              ipv4RuleRemoved: ipv4Result.ruleRemoved,
              ipv6RuleRemoved: ipv6Result.ruleRemoved,
              ipv4ChainRemoved: ipv4Result.chainRemoved,
              ipv6ChainRemoved: ipv6Result.chainRemoved,
              ipv4Status: ipv4Result.status,
              ipv6Status: ipv6Result.status
            }, null, 2),
            'utf-8'
          )
        }

        const errors = [
          ipv4Result.error,
          ipv6Result.error,
          ipv4Result.status === 'exists' ? 'the IPv4 chain is still present' : null,
          ipv6Result.status === 'exists' ? 'the IPv6 chain is still present' : null,
          stateUnknown ? 'the chain state could not be verified' : null
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