import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface NativeTrafficStats {
  downTotal: number
  upTotal: number
  connections: number
}

/**
 * Reads real traffic counters from Xray-core's native StatsService through the
 * bundled CLI (`xray api statsquery`). Only inbound traffic is summed so the
 * same bytes are not counted twice through the proxy outbound.
 */
export async function xrayStats(binary: string, apiPort: number): Promise<NativeTrafficStats | null> {
  if (!binary || !apiPort) return null
  try {
    const { stdout } = await execFileAsync(
      binary,
      ['api', 'statsquery', `--server=127.0.0.1:${apiPort}`, '-pattern', ''],
      { timeout: 3500, windowsHide: true }
    )
    const parsed = JSON.parse(stdout) as { stat?: Array<{ name?: string; value?: string | number }> }
    let downTotal = 0
    let upTotal = 0
    for (const item of parsed.stat ?? []) {
      const name = item.name ?? ''
      if (!name.startsWith('inbound>>>')) continue
      const value = Number(item.value ?? 0)
      if (!Number.isFinite(value)) continue
      if (name.endsWith('>>>traffic>>>downlink')) downTotal += value
      else if (name.endsWith('>>>traffic>>>uplink')) upTotal += value
    }
    return { downTotal, upTotal, connections: 0 }
  } catch {
    return null
  }
}
