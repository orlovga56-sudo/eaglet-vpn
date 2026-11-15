import * as linux from './system-proxy/linux'
import * as macos from './system-proxy/macos'
import * as windows from './system-proxy/windows'
import { t } from '../i18n'

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
  throw new Error(t('System proxy is not implemented on {platform}', { platform: process.platform }))
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

/**
 * Reads the live system proxy. `null` means the platform could not be queried,
 * which callers must report as "not checked" instead of "restored".
 */
export async function readSystemProxy(): Promise<Record<string, string> | null> {
  try {
    return await backend().readSystemProxy()
  } catch {
    return null
  }
}

/** Field-by-field comparison used by the diagnostics harness. */
export function sameSystemProxy(
  left: Record<string, string> | null,
  right: Record<string, string> | null
): boolean {
  if (!left || !right) return false
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (left[key] !== right[key]) return false
  }
  return true
}
