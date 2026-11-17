import { describe, expect, it } from 'vitest'
import {
  cleanupOrphanCores,
  executableFromCommandLine,
  parsePosixProcesses,
  parseWindowsProcesses,
  selectOrphanCorePids,
  type RunningProcess
} from '../src/main/vpn/engines/orphans'

const BIN = 'C:\\Users\\user\\AppData\\Roaming\\Eaglet\\bin'

function processEntry(pid: number, executablePath: string | null, commandLine = ''): RunningProcess {
  return { pid, executablePath, commandLine }
}

describe('executable path extraction', () => {
  it('handles quoted and unquoted POSIX command lines', () => {
    expect(executableFromCommandLine('"/opt/Eaglet bin/xray" run -c /tmp/x.json')).toBe('/opt/Eaglet bin/xray')
    expect(executableFromCommandLine('/usr/local/bin/sing-box run -c /tmp/c.json')).toBe('/usr/local/bin/sing-box')
    expect(executableFromCommandLine('')).toBeNull()
  })
})

describe('process list parsing', () => {
  it('parses the Windows pid|path|command shape', () => {
    const parsed = parseWindowsProcesses('1234|C:\\Eaglet\\bin\\sing-box.exe|"C:\\Eaglet\\bin\\sing-box.exe" run\r\nbroken\n')
    expect(parsed).toEqual([
      {
        pid: 1234,
        executablePath: 'C:\\Eaglet\\bin\\sing-box.exe',
        commandLine: '"C:\\Eaglet\\bin\\sing-box.exe" run'
      }
    ])
  })

  it('parses ps output', () => {
    expect(parsePosixProcesses('  42 /opt/eaglet/bin/xray run\nnot a process\n')).toEqual([
      { pid: 42, executablePath: null, commandLine: '/opt/eaglet/bin/xray run' }
    ])
  })
})

describe('orphan selection', () => {
  const processes = [
    processEntry(10, `${BIN}\\sing-box.exe`),
    processEntry(11, `${BIN}\\xray.exe`, `"${BIN}\\xray.exe" run`),
    processEntry(12, `${BIN}\\mihomo.exe`),
    processEntry(13, 'C:\\Program Files\\Eaglet\\resources\\bin\\sing-box.exe'),
    processEntry(14, `${BIN}\\notepad.exe`),
    processEntry(15, `${BIN}\\sing-box.exe`),
  ]

  it('selects only Eaglet core binaries inside its userData bin directory', () => {
    expect(selectOrphanCorePids(processes, BIN, true, 999)).toEqual([10, 11, 12, 15])
  })

  it('never selects itself, PID 1 or bundled cores', () => {
    expect(selectOrphanCorePids(processes, BIN, true, 10)).not.toContain(10)
    expect(selectOrphanCorePids([processEntry(1, `${BIN}\\xray.exe`)], BIN, true, 999)).toEqual([])
  })

  it('respects case-sensitive Unix paths', () => {
    expect(
      selectOrphanCorePids(
        [processEntry(20, '/home/user/.config/Eaglet/bin/xray'), processEntry(21, '/HOME/user/.config/eaglet/bin/xray')],
        '/home/user/.config/Eaglet/bin',
        false,
        999
      )
    ).toEqual([20])
  })

  it('uses the command line when the OS does not report the executable path', () => {
    expect(
      selectOrphanCorePids(
        [processEntry(30, null, '"/home/user/.local/bin/xray" run -c x.json')],
        '/home/user/.local/bin',
        false,
        999
      )
    ).toEqual([30])
  })
})

describe('cleanupOrphanCores', () => {
  it('kills every selected pid and reports what it did', async () => {
    const killed: number[] = []
    const messages: string[] = []
    const pids = await cleanupOrphanCores(
      BIN,
      (message) => messages.push(message),
      {
        caseInsensitive: true,
        selfPid: 999,
        list: async () => [processEntry(10, `${BIN}\\sing-box.exe`), processEntry(11, `${BIN}\\xray.exe`)],
        kill: async (pid) => {
          killed.push(pid)
        }
      }
    )

    expect(pids).toEqual([10, 11])
    expect(killed).toEqual([10, 11])
    expect(messages).toHaveLength(2)
  })

  it('continues when a kill fails and never throws on listing errors', async () => {
    const messages: string[] = []
    const pids = await cleanupOrphanCores(BIN, (message) => messages.push(message), {
      caseInsensitive: true,
      selfPid: 999,
      list: async () => [processEntry(10, `${BIN}\\sing-box.exe`), processEntry(11, `${BIN}\\xray.exe`)],
      kill: async (pid) => {
        if (pid === 10) throw new Error('access denied')
      }
    })
    expect(pids).toEqual([11])
    expect(messages.join(' ')).toContain('access denied')

    const none = await cleanupOrphanCores(BIN, (message) => messages.push(message), {
      list: async () => {
        throw new Error('Task Manager unavailable')
      }
    })
    expect(none).toEqual([])
    expect(messages.join(' ')).toContain('Task Manager unavailable')
  })
})
