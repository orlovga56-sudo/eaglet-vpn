import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

interface KeyValue {
  schema: string
  key: string
  value: string
}

interface LinuxBackup {
  at: number
  values: KeyValue[]
}

function backupPath(): string {
  return join(app.getPath('userData'), 'proxy-backup-linux.json')
}

async function gsettings(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gsettings', args, { timeout: 6000 })
  return stdout.trim()
}

async function ensureSchema(): Promise<void> {
  const schemas = await gsettings(['list-schemas'])
  if (!schemas.split(/\r?\n/).includes('org.gnome.system.proxy')) {
    throw new Error(
      'System proxy integration currently supports GNOME/GTK desktops. Use TUN mode or configure your desktop proxy manually.'
    )
  }
}

/**
 * Linux system proxy through GSettings (GNOME and GTK-based desktops).
 * KDE and other desktops are not claimed: TUN mode remains the supported path.
 */
export async function enableSystemProxy(port: number): Promise<void> {
  await ensureSchema()
  const keys: Array<[string, string]> = [
    ['org.gnome.system.proxy', 'mode'],
    ['org.gnome.system.proxy.http', 'host'],
    ['org.gnome.system.proxy.http', 'port'],
    ['org.gnome.system.proxy.https', 'host'],
    ['org.gnome.system.proxy.https', 'port'],
    ['org.gnome.system.proxy.socks', 'host'],
    ['org.gnome.system.proxy.socks', 'port'],
    ['org.gnome.system.proxy', 'ignore-hosts']
  ]
  const values: KeyValue[] = []
  for (const [schema, key] of keys) {
    values.push({ schema, key, value: await gsettings(['get', schema, key]).catch(() => "''") })
  }
  mkdirSync(dirname(backupPath()), { recursive: true })
  writeFileSync(backupPath(), JSON.stringify({ at: Date.now(), values } satisfies LinuxBackup, null, 2), 'utf-8')

  await gsettings(['set', 'org.gnome.system.proxy.http', 'host', "'127.0.0.1'"])
  await gsettings(['set', 'org.gnome.system.proxy.http', 'port', String(port)])
  await gsettings(['set', 'org.gnome.system.proxy.https', 'host', "'127.0.0.1'"])
  await gsettings(['set', 'org.gnome.system.proxy.https', 'port', String(port)])
  await gsettings(['set', 'org.gnome.system.proxy.socks', 'host', "'127.0.0.1'"])
  await gsettings(['set', 'org.gnome.system.proxy.socks', 'port', String(port)])
  await gsettings([
    'set',
    'org.gnome.system.proxy',
    'ignore-hosts',
    "['localhost', '127.0.0.0/8', '::1', '*.local']"
  ])
  await gsettings(['set', 'org.gnome.system.proxy', 'mode', "'manual'"])
}

export async function disableSystemProxy(): Promise<void> {
  if (!existsSync(backupPath())) {
    await gsettings(['set', 'org.gnome.system.proxy', 'mode', "'none'"]).catch(() => undefined)
    return
  }
  try {
    const backup = JSON.parse(readFileSync(backupPath(), 'utf-8')) as LinuxBackup
    // Restore mode last so intermediate values never point at a dead port.
    const ordered = [...backup.values].sort((left, right) => Number(left.key === 'mode') - Number(right.key === 'mode'))
    for (const item of ordered) {
      await gsettings(['set', item.schema, item.key, item.value]).catch(() => undefined)
    }
  } finally {
    rmSync(backupPath(), { force: true })
  }
}

export function disableSystemProxySync(): void {
  if (!existsSync(backupPath())) return
  try {
    const backup = JSON.parse(readFileSync(backupPath(), 'utf-8')) as LinuxBackup
    for (const item of backup.values) {
      execFileSync('gsettings', ['set', item.schema, item.key, item.value], { timeout: 4000, stdio: 'ignore' })
    }
    rmSync(backupPath(), { force: true })
  } catch {
    // Keep the backup for the next launch.
  }
}

export function recoverStaleProxy(): void {
  if (existsSync(backupPath())) disableSystemProxySync()
}
