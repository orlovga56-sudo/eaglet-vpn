import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

interface ServiceProxy {
  web: { enabled: boolean; server: string; port: number }
  secure: { enabled: boolean; server: string; port: number }
  bypass: string[]
}

interface MacBackup {
  at: number
  services: Record<string, ServiceProxy>
}

function backupPath(): string {
  return join(app.getPath('userData'), 'proxy-backup-mac.json')
}

function parseProxy(output: string): { enabled: boolean; server: string; port: number } {
  const enabled = /Enabled:\s*Yes/i.test(output)
  const server = output.match(/Server:\s*(.+)/i)?.[1]?.trim() ?? ''
  const port = Number(output.match(/Port:\s*(\d+)/i)?.[1] ?? 0)
  return { enabled, server, port }
}

async function services(): Promise<string[]> {
  const { stdout } = await execFileAsync('networksetup', ['-listallnetworkservices'])
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('An asterisk') && !line.startsWith('*'))
}

async function restore(backup: MacBackup): Promise<void> {
  for (const [service, proxy] of Object.entries(backup.services)) {
    for (const [kind, value] of [
      ['web', proxy.web],
      ['secureweb', proxy.secure]
    ] as const) {
      if (value.enabled && value.server) {
        await execFileAsync('networksetup', [`-set${kind}proxy`, service, value.server, String(value.port)]).catch(
          () => undefined
        )
        await execFileAsync('networksetup', [`-set${kind}proxystate`, service, 'on']).catch(() => undefined)
      } else {
        await execFileAsync('networksetup', [`-set${kind}proxystate`, service, 'off']).catch(() => undefined)
      }
    }
    if (proxy.bypass.length > 0) {
      await execFileAsync('networksetup', ['-setproxybypassdomains', service, ...proxy.bypass]).catch(() => undefined)
    }
  }
}

/**
 * macOS system proxy through networksetup. Every network service is backed up
 * individually because the active service depends on Wi-Fi/Ethernet/USB.
 */
export async function enableSystemProxy(port: number): Promise<void> {
  const list = await services()
  const backup: MacBackup = { at: Date.now(), services: {} }
  for (const service of list) {
    const [webOut, secureOut, bypassOut] = await Promise.all([
      execFileAsync('networksetup', ['-getwebproxy', service]).then((r) => r.stdout).catch(() => ''),
      execFileAsync('networksetup', ['-getsecurewebproxy', service]).then((r) => r.stdout).catch(() => ''),
      execFileAsync('networksetup', ['-getproxybypassdomains', service]).then((r) => r.stdout).catch(() => '')
    ])
    if (!webOut) continue
    backup.services[service] = {
      web: parseProxy(webOut),
      secure: parseProxy(secureOut),
      bypass: bypassOut
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !/There aren't any bypass/i.test(line))
    }
  }
  mkdirSync(dirname(backupPath()), { recursive: true })
  writeFileSync(backupPath(), JSON.stringify(backup, null, 2), 'utf-8')

  for (const service of Object.keys(backup.services)) {
    await execFileAsync('networksetup', ['-setwebproxy', service, '127.0.0.1', String(port)])
    await execFileAsync('networksetup', ['-setsecurewebproxy', service, '127.0.0.1', String(port)])
    await execFileAsync('networksetup', ['-setproxybypassdomains', service, 'localhost', '127.0.0.1', '*.local'])
  }
}

export async function disableSystemProxy(): Promise<void> {
  if (!existsSync(backupPath())) {
    const list = await services().catch(() => [])
    for (const service of list) {
      await execFileAsync('networksetup', ['-setwebproxystate', service, 'off']).catch(() => undefined)
      await execFileAsync('networksetup', ['-setsecurewebproxystate', service, 'off']).catch(() => undefined)
    }
    return
  }
  try {
    const backup = JSON.parse(readFileSync(backupPath(), 'utf-8')) as MacBackup
    await restore(backup)
  } finally {
    rmSync(backupPath(), { force: true })
  }
}

export function disableSystemProxySync(): void {
  if (!existsSync(backupPath())) return
  try {
    const backup = JSON.parse(readFileSync(backupPath(), 'utf-8')) as MacBackup
    for (const [service, proxy] of Object.entries(backup.services)) {
      const args = proxy.web.enabled
        ? ['-setwebproxy', service, proxy.web.server, String(proxy.web.port)]
        : ['-setwebproxystate', service, 'off']
      execFileSync('networksetup', args, { timeout: 5000, stdio: 'ignore' })
    }
    rmSync(backupPath(), { force: true })
  } catch {
    // Keep the backup for the next launch.
  }
}

export function recoverStaleProxy(): void {
  if (existsSync(backupPath())) disableSystemProxySync()
}
