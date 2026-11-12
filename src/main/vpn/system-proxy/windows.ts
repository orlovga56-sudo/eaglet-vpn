import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Windows system proxy integration (WinINet).
 *
 * Apps that respect WinINet (Edge, Chrome, most desktop clients) start using
 * the local mixed inbound as soon as ProxyEnable is flipped. The previous
 * values are backed up so a crash or disconnect restores the user's setup.
 */

interface ProxyBackup {
  enabled: number | null
  server: string | null
  override: string | null
}

function backupPath(): string {
  return join(app.getPath('userData'), 'proxy-backup.json')
}

function refreshScript(): string {
  return `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class EagletWinInet { [DllImport("wininet.dll", SetLastError=true)] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l); }'
[EagletWinInet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
[EagletWinInet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null
`.trim()
}

function psScript(body: string): string {
  return `$ErrorActionPreference='SilentlyContinue'; $key='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; ${body}`
}

async function runPowerShell(script: string): Promise<void> {
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script
  ])
}

export async function enableSystemProxy(port: number): Promise<void> {
  const backup = backupPath()
  mkdirSync(dirname(backup), { recursive: true })
  const escaped = backup.replace(/'/g, "''")

  const script = psScript(`
$current = Get-ItemProperty -Path $key;
@{ enabled = $current.ProxyEnable; server = $current.ProxyServer; override = $current.ProxyOverride } | ConvertTo-Json -Compress | Set-Content -LiteralPath '${escaped}' -Encoding UTF8;
Set-ItemProperty -Path $key -Name ProxyEnable -Value 1 -Type DWord;
Set-ItemProperty -Path $key -Name ProxyServer -Value '127.0.0.1:${port}' -Type String;
Set-ItemProperty -Path $key -Name ProxyOverride -Value '<local>;localhost;127.*' -Type String;
${refreshScript()}
`)
  await runPowerShell(script)
}

export async function disableSystemProxy(): Promise<void> {
  const backup = backupPath()
  if (!existsSync(backup)) {
    await runPowerShell(
      psScript(`
Set-ItemProperty -Path $key -Name ProxyEnable -Value 0 -Type DWord;
${refreshScript()}
`)
    )
    return
  }

  let data: ProxyBackup | null = null
  try {
    data = JSON.parse(readFileSync(backup, 'utf-8')) as ProxyBackup
  } catch {
    data = null
  }
  const escaped = backup.replace(/'/g, "''")
  const enabled = Number(data?.enabled ?? 0) === 1 ? 1 : 0
  const server = String(data?.server ?? '').replace(/'/g, "''")
  const override = String(data?.override ?? '<local>').replace(/'/g, "''")

  await runPowerShell(
    psScript(`
Set-ItemProperty -Path $key -Name ProxyEnable -Value ${enabled} -Type DWord;
Set-ItemProperty -Path $key -Name ProxyServer -Value '${server}' -Type String;
Set-ItemProperty -Path $key -Name ProxyOverride -Value '${override}' -Type String;
${refreshScript()}
`)
  )

  try {
    rmSync(backup, { force: true })
  } catch {
    // ignore
  }
}

/** Best-effort synchronous restore used on app quit. */
export function disableSystemProxySync(): void {
  const backup = backupPath()
  let enabled = 0
  let server = ''
  let override = '<local>'
  if (existsSync(backup)) {
    try {
      const data = JSON.parse(readFileSync(backup, 'utf-8')) as ProxyBackup
      enabled = Number(data.enabled ?? 0) === 1 ? 1 : 0
      server = String(data.server ?? '')
      override = String(data.override ?? '<local>')
    } catch {
      // ignore malformed backup
    }
  }
  try {
    const script = psScript(`
Set-ItemProperty -Path $key -Name ProxyEnable -Value ${enabled} -Type DWord;
Set-ItemProperty -Path $key -Name ProxyServer -Value '${server.replace(/'/g, "''")}' -Type String;
Set-ItemProperty -Path $key -Name ProxyOverride -Value '${override.replace(/'/g, "''")}' -Type String;
${refreshScript()}
`)
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 5000 }
    )
    rmSync(backup, { force: true })
  } catch {
    // ignore
  }
}

/** Restores a proxy left behind by a previous crash. */
export function recoverStaleProxy(): void {
  if (existsSync(backupPath())) disableSystemProxySync()
}
