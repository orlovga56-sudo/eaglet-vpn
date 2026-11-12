import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { KillSwitchBackend, KillSwitchContext } from './types'

const execFileAsync = promisify(execFile)
const CHAIN = 'EAGLET_KS'

function markerPath(): string {
  return join(app.getPath('userData'), 'iptables-marker.json')
}

async function iptables(args: string[]): Promise<void> {
  await execFileAsync('iptables', args, { timeout: 8000 })
}

function iptablesSync(args: string[]): void {
  execFileSync('iptables', args, { timeout: 5000, stdio: 'ignore' })
}

function markerExists(): boolean {
  return existsSync(markerPath())
}

/**
 * Linux kill switch built on a dedicated iptables chain. The chain permits
 * loopback, node IPs and DNS, then drops everything else. Requires
 * CAP_NET_ADMIN/root; failure leaves no chain behind.
 */
export const linuxKillSwitch: KillSwitchBackend = {
  async enable(context: KillSwitchContext): Promise<void> {
    try {
      await iptables(['-N', CHAIN]).catch(() => undefined)
      await iptables(['-F', CHAIN])
      await iptables(['-A', CHAIN, '-o', 'lo', '-j', 'RETURN'])
      for (const ip of context.serverIps) {
        await iptables(['-A', CHAIN, '-d', ip, '-j', 'RETURN'])
      }
      await iptables(['-A', CHAIN, '-p', 'udp', '--dport', '53', '-j', 'RETURN'])
      await iptables(['-A', CHAIN, '-p', 'tcp', '--dport', '53', '-j', 'RETURN'])
      await iptables(['-A', CHAIN, '-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'RETURN'])
      await iptables(['-A', CHAIN, '-j', 'DROP'])
      await iptables(['-C', 'OUTPUT', '-j', CHAIN]).catch(async () => {
        await iptables(['-I', 'OUTPUT', '1', '-j', CHAIN])
      })
      writeFileSync(markerPath(), JSON.stringify({ at: Date.now(), serverIps: context.serverIps }), 'utf-8')
    } catch (error) {
      await this.disable().catch(() => undefined)
      throw new Error(`iptables rejected the kill-switch chain (run Eaglet with CAP_NET_ADMIN): ${(error as Error).message}`)
    }
  },

  async disable(): Promise<void> {
    await iptables(['-D', 'OUTPUT', '-j', CHAIN]).catch(() => undefined)
    await iptables(['-F', CHAIN]).catch(() => undefined)
    await iptables(['-X', CHAIN]).catch(() => undefined)
    rmSync(markerPath(), { force: true })
  },

  disableSync(): void {
    try {
      iptablesSync(['-D', 'OUTPUT', '-j', CHAIN])
    } catch {
      // ignore
    }
    try {
      iptablesSync(['-F', CHAIN])
      iptablesSync(['-X', CHAIN])
    } catch {
      // ignore
    }
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
