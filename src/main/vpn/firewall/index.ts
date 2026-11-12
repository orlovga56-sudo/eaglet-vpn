import type { Profile } from '@shared/types'
import { linuxKillSwitch } from './linux'
import { macKillSwitch } from './macos'
import { resolveServerIps, type KillSwitchBackend, type KillSwitchContext } from './types'
import { windowsKillSwitch } from './windows'

function backend(): KillSwitchBackend | null {
  if (process.platform === 'win32') return windowsKillSwitch
  if (process.platform === 'darwin') return macKillSwitch
  if (process.platform === 'linux') return linuxKillSwitch
  return null
}

export function killSwitchSupported(): boolean {
  return backend() !== null
}

/**
 * Applies the OS kill switch for the active profile. The returned list holds
 * the IPs that were whitelisted, which is useful for diagnostics.
 */
export async function enableKillSwitch(profile: Profile | null, corePath: string | null): Promise<string[]> {
  const target = backend()
  if (!target) throw new Error('Kill switch is not implemented on this platform')
  const serverIps = await resolveServerIps(profile)
  const context: KillSwitchContext = {
    serverIps,
    corePath,
    appPath: process.execPath
  }
  await target.enable(context)
  return serverIps
}

export async function disableKillSwitch(): Promise<void> {
  await backend()?.disable()
}

export function disableKillSwitchSync(): void {
  backend()?.disableSync()
}

/** Restores a policy left behind by a crash before a new connection starts. */
export function recoverKillSwitch(): void {
  backend()?.recover()
}
