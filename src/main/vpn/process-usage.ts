import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { promisify } from 'node:util'
import type { EngineUsage } from '@shared/types'

const execFileAsync = promisify(execFile)
const EMPTY: EngineUsage = { pid: null, cpu: 0, memory: 0 }

/**
 * Measures the tunnel core process itself. Windows exposes cumulative CPU
 * seconds through Get-Process, Linux through /proc and macOS through ps; the
 * sampler turns the cumulative value into a percentage between two samples.
 */
export class ProcessUsageSampler {
  private last = new Map<number, { at: number; cpuSeconds: number }>()

  async sample(pid: number | null): Promise<EngineUsage> {
    if (!pid) return EMPTY
    try {
      if (process.platform === 'win32') return await this.sampleWindows(pid)
      if (process.platform === 'linux') return await this.sampleLinux(pid)
      return await this.sampleMac(pid)
    } catch {
      return { pid, cpu: 0, memory: 0 }
    }
  }

  private percent(pid: number, cpuSeconds: number, now: number): number {
    const previous = this.last.get(pid)
    this.last.set(pid, { at: now, cpuSeconds })
    if (!previous) return 0
    const elapsed = (now - previous.at) / 1000
    if (elapsed <= 0) return 0
    const used = Math.max(0, cpuSeconds - previous.cpuSeconds)
    const cores = Math.max(1, cpus().length)
    return Math.round((used / elapsed / cores) * 1000) / 10
  }

  private async sampleWindows(pid: number): Promise<EngineUsage> {
    const script = `$p = Get-Process -Id ${pid} -ErrorAction Stop; "$($p.CPU)|$($p.WorkingSet64)"`
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 6000, windowsHide: true }
    )
    const [cpuRaw, memoryRaw] = stdout.trim().split('|')
    const cpuSeconds = Number(cpuRaw)
    const memory = Number(memoryRaw)
    return {
      pid,
      cpu: Number.isFinite(cpuSeconds) ? this.percent(pid, cpuSeconds, Date.now()) : 0,
      memory: Number.isFinite(memory) ? memory : 0
    }
  }

  private async sampleLinux(pid: number): Promise<EngineUsage> {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf-8')
    // The process name may contain spaces, so split after the closing paren.
    const tail = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const utime = Number(tail[11])
    const stime = Number(tail[12])
    const rssPages = Number(tail[21])
    const cpuSeconds = (utime + stime) / 100
    return {
      pid,
      cpu: this.percent(pid, cpuSeconds, Date.now()),
      memory: Number.isFinite(rssPages) ? rssPages * 4096 : 0
    }
  }

  private async sampleMac(pid: number): Promise<EngineUsage> {
    const { stdout } = await execFileAsync('ps', ['-o', '%cpu=,rss=', '-p', String(pid)], {
      timeout: 5000
    })
    const [cpuRaw, rssRaw] = stdout.trim().split(/\s+/)
    const cpu = Number(cpuRaw)
    const memory = Number(rssRaw) * 1024
    return {
      pid,
      cpu: Number.isFinite(cpu) ? Math.round(cpu * 10) / 10 : 0,
      memory: Number.isFinite(memory) ? memory : 0
    }
  }
}
