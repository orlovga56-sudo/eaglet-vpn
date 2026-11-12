import * as linux from './system-proxy/linux'
import * as macos from './system-proxy/macos'
import * as windows from './system-proxy/windows'

/**
 * Cross-platform system proxy facade. Each OS has its own implementation:
 * WinINET registry on Windows, networksetup on macOS and GSettings on GNOME.
 * Unsupported desktops fail loudly instead of pretending to be protected.
 */

export type SystemProxySupport = 'supported' | 'experimental' | 'unsupported'

export function systemProxySupport(): SystemProxySupport {
  if (process.platform === 'win32') return 'supported'
  if (process.platform === 'darwin') return 'experimental'
  if (process.platform === 'linux') return 'experimental'
  return 'unsupported'
}

function backend(): typeof windows | typeof macos | typeof linux {
  if (process.platform === 'win32') return windows
  if (process.platform === 'darwin') return macos
  if (process.platform === 'linux') return linux
  throw new Error(`System proxy is not implemented on ${process.platform}`)
}

export async function enableSystemProxy(port: number): Promise<void> {
  await backend().enableSystemProxy(port)
}

export async function disableSystemProxy(): Promise<void> {
  await backend().disableSystemProxy()
}

export function disableSystemProxySync(): void {
  try {
    backend().disableSystemProxySync()
  } catch {
    // Unsupported platform: nothing was applied.
  }
}

/** Restores a proxy left behind by a previous crash. */
export function recoverStaleProxy(): void {
  try {
    backend().recoverStaleProxy()
  } catch {
    // Unsupported platform: nothing was applied.
  }
}
