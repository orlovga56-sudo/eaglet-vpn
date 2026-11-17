import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Core executables Eaglet installs into `<userData>/bin`. */
const CORE_BINARIES = new Set(['sing-box', 'sing-box.exe', 'xray', 'xray.exe', 'mihomo', 'mihomo.exe'])

export interface RunningProcess {
  pid: number
  /** Absolute executable path when the OS reports one (Windows CIM). */
  executablePath: string | null
  commandLine: string
}

export interface OrphanCleanupDependencies {
  list: () => Promise<RunningProcess[]>
  kill: (pid: number) => Promise<void>
  /** Windows paths are case-insensitive; Unix paths are not. */
  caseInsensitive?: boolean
  selfPid?: number
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** First token of a POSIX command line, honouring a quoted path. */
export function executableFromCommandLine(commandLine: string): string | null {
  const text = commandLine.trim()
  if (!text) return null
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1)
    return end === -1 ? text.slice(1) : text.slice(1, end)
  }
  const token = text.split(/\s+/)[0]
  return token || null
}

/** Parses `pid|executablePath|commandLine` rows produced on Windows. */
export function parseWindowsProcesses(output: string): RunningProcess[] {
  const processes: RunningProcess[] = []
  for (const line of output.split(/\r?\n/)) {
    const parts = line.split('|')
    if (parts.length < 3) continue
    const pid = Number(parts[0].trim())
    if (!Number.isInteger(pid) || pid <= 0) continue
    const executablePath = parts[1].trim() || null
    processes.push({
      pid,
      executablePath,
      commandLine: parts.slice(2).join('|').trim()
    })
  }
  return processes
}

/** Parses `ps -eo pid=,args=` rows (Linux and macOS). */
export function parsePosixProcesses(output: string): RunningProcess[] {
  const processes: RunningProcess[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/)
    if (!match) continue
    const pid = Number(match[1])
    if (!Number.isInteger(pid) || pid <= 0) continue
    processes.push({ pid, executablePath: null, commandLine: match[2] })
  }
  return processes
}

/**
 * Selects processes Eaglet may safely kill: they must run a known core binary
 * that lives inside Eaglet's own `<userData>/bin` directory. Anything else —
 * including a core bundled in the app folder or started by the user — is left
 * alone, and the current process can never select itself.
 */
export function selectOrphanCorePids(
  processes: RunningProcess[],
  binDirectory: string,
  caseInsensitive = process.platform === 'win32',
  selfPid = process.pid
): number[] {
  const directory = normalizePath(binDirectory)
  const prefix = (caseInsensitive ? directory.toLowerCase() : directory) + '/'
  const selected: number[] = []
  for (const item of processes) {
    if (!Number.isInteger(item.pid) || item.pid <= 1 || item.pid === selfPid) continue
    const executable = item.executablePath || executableFromCommandLine(item.commandLine)
    if (!executable) continue
    const normalized = normalizePath(executable)
    const comparable = caseInsensitive ? normalized.toLowerCase() : normalized
    if (!comparable.startsWith(prefix)) continue
    const name = basename(normalized).toLowerCase()
    if (!CORE_BINARIES.has(name)) continue
    selected.push(item.pid)
  }
  return [...new Set(selected)]
}

async function listProcesses(): Promise<RunningProcess[]> {
  if (process.platform === 'win32') {
    const script =
      "Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ExecutablePath } | ForEach-Object { \"$($_.ProcessId)|$($_.ExecutablePath)|$($_.CommandLine)\" }"
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 15000, windowsHide: true }
    )
    return parseWindowsProcesses(stdout)
  }
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,args='], { timeout: 10000 })
  return parsePosixProcesses(stdout)
}

async function killProcess(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000 })
    return
  }
  process.kill(pid, 'SIGKILL')
}

/**
 * Terminates cores left behind by a crash. Runs once at startup, before a new
 * core is spawned; it must never throw, because a failed cleanup is not a
 * reason to refuse to start the VPN.
 */
export async function cleanupOrphanCores(
  binDirectory: string,
  log: (message: string) => void,
  dependencies: Partial<OrphanCleanupDependencies> = {}
): Promise<number[]> {
  const list = dependencies.list ?? listProcesses
  const kill = dependencies.kill ?? killProcess
  let pids: number[]
  try {
    pids = selectOrphanCorePids(
      await list(),
      binDirectory,
      dependencies.caseInsensitive ?? process.platform === 'win32',
      dependencies.selfPid ?? process.pid
    )
  } catch (error) {
    log(`Could not inspect running cores: ${(error as Error).message}`)
    return []
  }

  const killed: number[] = []
  for (const pid of pids) {
    try {
      await kill(pid)
      killed.push(pid)
      log(`Stopped leftover core process ${pid}`)
    } catch (error) {
      log(`Could not stop leftover core process ${pid}: ${(error as Error).message}`)
    }
  }
  return killed
}
