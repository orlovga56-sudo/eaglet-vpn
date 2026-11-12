import { spawn, execFile } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { gunzipSync } from 'node:zlib'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { EngineChoice, EngineId, EngineState, Profile, Settings } from '@shared/types'
import { mihomoAdapter } from './mihomo-adapter'
import { singboxAdapter } from './singbox-adapter'
import { xrayAdapter } from './xray-adapter'
import type { EngineAdapter, EngineBuildInput } from './types'

const execFileAsync = promisify(execFile)

interface EngineEntry {
  adapter: EngineAdapter
  binary: string | null
  version: string | null
  latestVersion: string | null
}

export interface EngineProcess {
  pid: number | null
  stop: () => Promise<void>
}

export interface ChooseResult {
  id: EngineId
  reason: 'profile' | 'global' | 'auto' | 'scenario'
}

function binaryCandidates(adapter: EngineAdapter): string[] {
  const name = adapter.binaryName(process.platform)
  return [
    join(process.resourcesPath, 'bin', name),
    join(app.getAppPath(), 'resources', 'bin', name),
    join(app.getPath('userData'), 'bin', name)
  ]
}

function userDataBinary(adapter: EngineAdapter): string {
  return join(app.getPath('userData'), 'bin', adapter.binaryName(process.platform))
}

function resourceBinary(adapter: EngineAdapter): string | null {
  const candidates = binaryCandidates(adapter)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else files.push(full)
  }
  return files
}

/**
 * Owns every tunnel core Eaglet can run. Adapters know their config format and
 * CLI flags; the manager handles discovery, installation, versions, selection
 * and process lifetime, so adding a fourth engine means adding one adapter.
 */
export class EngineManager {
  private entries = new Map<EngineId, EngineEntry>()
  private latestCache = new Map<EngineId, { at: number; version: string | null; url: string | null }>()

  constructor() {
    for (const adapter of [singboxAdapter, xrayAdapter, mihomoAdapter]) {
      this.entries.set(adapter.id, { adapter, binary: null, version: null, latestVersion: null })
    }
  }

  /** Cheap local discovery; never touches the network. */
  async init(): Promise<void> {
    for (const entry of this.entries.values()) {
      entry.binary = resourceBinary(entry.adapter)
      entry.version = entry.binary ? await this.readVersion(entry.adapter, entry.binary) : null
    }
  }

  private async readVersion(adapter: EngineAdapter, binary: string): Promise<string | null> {
    try {
      const { stdout, stderr } = await execFileAsync(binary, adapter.versionArgs, {
        timeout: 12000,
        windowsHide: true
      })
      return adapter.parseVersion(`${stdout}\n${stderr}`)
    } catch {
      return null
    }
  }

  adapter(id: EngineId): EngineAdapter {
    const entry = this.entries.get(id)
    if (!entry) throw new Error(`Unknown engine ${id}`)
    return entry.adapter
  }

  platformSupport(id: EngineId): EngineState['platformSupport'] {
    if (process.platform === 'win32') return 'supported'
    // macOS/Linux integrations exist but are not part of the verified matrix yet.
    return id === 'sing-box' ? 'experimental' : 'experimental'
  }

  /** Protocol support plus per-profile capability checks (e.g. SS ciphers). */
  supportsProfile(id: EngineId, profile: Profile | null): boolean {
    if (!profile) return true
    const adapter = this.adapter(id)
    if (!adapter.protocols.includes(profile.protocol)) return false
    return adapter.supportsProfile ? adapter.supportsProfile(profile) : true
  }

  getStates(active: EngineId, running: boolean): EngineState[] {
    return [...this.entries.values()].map((entry) => {
      const binary = entry.binary ?? resourceBinary(entry.adapter)
      return {
        id: entry.adapter.id,
        name: entry.adapter.name,
        installed: Boolean(binary),
        version: entry.version,
        latestVersion: entry.latestVersion,
        updateAvailable: Boolean(entry.version && entry.latestVersion && entry.version !== entry.latestVersion),
        path: binary,
        running: running && entry.adapter.id === active,
        protocols: [...entry.adapter.protocols],
        telemetry: entry.adapter.telemetry,
        supportsTun: entry.adapter.supportsTun,
        platformSupport: this.platformSupport(entry.adapter.id),
        removable: Boolean(binary && binary.startsWith(app.getPath('userData')))
      }
    })
  }

  getVersion(id: EngineId): string | null {
    return this.entries.get(id)?.version ?? null
  }

  getPath(id: EngineId): string | null {
    return this.entries.get(id)?.binary ?? resourceBinary(this.adapter(id))
  }

  /**
   * Chooses the core for a profile. Explicit profile/global choices win; auto
   * prefers an installed core that actually supports the protocol and, for TUN,
   * a core with a TUN implementation.
   */
  choose(profile: Profile | null, settings: Settings): ChooseResult {
    const supports = (id: EngineId): boolean => this.supportsProfile(id, profile)
    const tunOk = (id: EngineId): boolean => !settings.tunMode || this.adapter(id).supportsTun

    if (profile?.engine && supports(profile.engine) && tunOk(profile.engine)) {
      return { id: profile.engine, reason: 'profile' }
    }
    const global = settings.engine
    if (global !== 'auto' && supports(global) && tunOk(global)) {
      return { id: global, reason: 'global' }
    }

    const order: EngineId[] = ['sing-box', 'mihomo', 'xray']
    const installed = order.filter((id) => supports(id) && tunOk(id) && this.getPath(id))
    if (installed.length > 0) return { id: installed[0], reason: 'auto' }
    const capable = order.find((id) => supports(id) && tunOk(id)) ?? 'sing-box'
    return { id: capable, reason: 'auto' }
  }

  /** Locates a core, downloading it when missing. */
  async ensure(id: EngineId, log: (message: string) => void): Promise<string> {
    const existing = this.getPath(id)
    if (existing) return existing
    return this.install(id, log)
  }

  buildConfig(id: EngineId, input: EngineBuildInput): string {
    return this.adapter(id).buildConfig(input)
  }

  async validate(id: EngineId, binary: string, configPath: string): Promise<void> {
    const args = this.adapter(id).validateArgs(configPath)
    try {
      await execFileAsync(binary, args, { timeout: 25000, windowsHide: true })
    } catch (error) {
      const detail = (error as { stderr?: string; stdout?: string; message?: string }).stderr?.trim()
      const stdout = (error as { stdout?: string }).stdout?.trim()
      throw new Error(detail || stdout || (error as Error).message || `${this.adapter(id).name} rejected the config`)
    }
  }

  start(
    id: EngineId,
    binary: string,
    configPath: string,
    onLog: (level: 'info' | 'warn' | 'error', message: string) => void,
    onExit: (code: number | null) => void
  ): EngineProcess {
    const binDir = join(app.getPath('userData'), 'bin')
    mkdirSync(binDir, { recursive: true })
    const child = spawn(binary, this.adapter(id).runArgs(configPath), {
      windowsHide: true,
      // Windows resolves wintun.dll (TUN) relative to the working directory.
      cwd: binDir,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const pipe = (stream: NodeJS.ReadableStream | null, level: 'info' | 'warn' | 'error'): void => {
      if (!stream) return
      let buffer = ''
      stream.setEncoding('utf-8')
      stream.on('data', (chunk: string) => {
        buffer += chunk
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const clean = line
            .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
            .replace(/^[+-]\d{4}\s+/, '')
            .replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+/, '')
            .replace(/^(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+/i, '')
            .trim()
          if (!clean) continue
          const mapped = /\b(FATAL|ERROR|PANIC)\b/i.test(line)
            ? 'error'
            : /\bWARN\b/i.test(line)
              ? 'warn'
              : level === 'error'
                ? 'error'
                : 'info'
          onLog(mapped, `[${this.adapter(id).name}] ${clean}`)
        }
      })
    }
    pipe(child.stdout, 'info')
    pipe(child.stderr, 'warn')

    let stopped = false
    child.once('exit', (code) => {
      if (!stopped) onExit(code)
    })
    child.once('error', (error) => {
      if (!stopped) onLog('error', `[${this.adapter(id).name}] ${error.message}`)
    })

    return {
      pid: child.pid ?? null,
      stop: async () => {
        stopped = true
        const pid = child.pid
        if (!pid) return
        if (process.platform === 'win32') {
          try {
            await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
          } catch {
            child.kill()
          }
        } else {
          try {
            await execFileAsync('pkill', ['-TERM', '-P', String(pid)], { windowsHide: true })
          } catch {
            // No children or pkill unavailable.
          }
          child.kill('SIGTERM')
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Installation                                                      */
  /* ------------------------------------------------------------------ */

  private async latestRelease(adapter: EngineAdapter): Promise<{
    version: string | null
    url: string | null
  }> {
    const cached = this.latestCache.get(adapter.id)
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) {
      return { version: cached.version, url: cached.url }
    }
    const response = await fetch(`https://api.github.com/repos/${adapter.releaseRepo}/releases/latest`, {
      headers: { 'User-Agent': 'Eaglet-VPN' },
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status})`)
    const release = (await response.json()) as {
      tag_name?: string
      assets?: Array<{ name: string; browser_download_url: string }>
    }
    const version = (release.tag_name ?? '').replace(/^v/, '') || null
    const pattern = adapter.assetPattern(process.platform, process.arch)
    // Prefer the plain build over "compatible"/"legacy" variants.
    const assets = (release.assets ?? []).filter((asset) => pattern.test(asset.name))
    const asset =
      assets.find((item) => !/compatible|legacy|go1\./i.test(item.name)) ??
      assets[0] ??
      null
    const url = asset?.browser_download_url ?? null
    this.latestCache.set(adapter.id, { at: Date.now(), version, url })
    return { version, url }
  }

  async install(id: EngineId, log: (message: string) => void): Promise<string> {
    const entry = this.entries.get(id)
    if (!entry) throw new Error(`Unknown engine ${id}`)
    const adapter = entry.adapter
    const existing = resourceBinary(adapter)
    if (existing) {
      entry.binary = existing
      entry.version = entry.version ?? (await this.readVersion(adapter, existing))
      return existing
    }

    log(`Downloading ${adapter.name}…`)
    const release = await this.latestRelease(adapter)
    if (!release.url) throw new Error(`No ${adapter.name} build found for ${process.platform}/${process.arch}`)
    entry.latestVersion = release.version

    const extension = release.url.endsWith('.tar.gz') ? '.tar.gz' : release.url.endsWith('.gz') ? '.gz' : '.zip'
    const archive = join(tmpdir(), `eaglet-${adapter.id}-${Date.now()}${extension}`)
    const download = await fetch(release.url, {
      headers: { 'User-Agent': 'Eaglet-VPN' },
      signal: AbortSignal.timeout(180000)
    })
    if (!download.ok || !download.body) throw new Error(`${adapter.name} download failed (${download.status})`)
    await new Promise<void>((resolve, reject) => {
      const file = createWriteStream(archive)
      const reader = download.body!.getReader()
      const pump = async (): Promise<void> => {
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (!file.write(Buffer.from(value))) await new Promise((r) => file.once('drain', r))
          }
          file.end(() => resolve())
        } catch (error) {
          reject(error)
        }
      }
      void pump()
    })

    const destination = join(app.getPath('userData'), 'bin')
    mkdirSync(destination, { recursive: true })
    const binaryName = adapter.binaryName(process.platform)

    if (extension === '.gz') {
      // Single-file gzip build (Mihomo Linux).
      const target = join(destination, binaryName)
      writeFileSync(target, gunzipSync(readFileSync(archive)))
    } else {
      const extracted = join(tmpdir(), `eaglet-${adapter.id}-${Date.now()}`)
      mkdirSync(extracted, { recursive: true })
      try {
        if (extension === '.tar.gz') {
          await execFileAsync('tar', ['-xzf', archive, '-C', extracted], { windowsHide: true })
        } else if (process.platform === 'linux') {
          await execFileAsync('unzip', ['-o', archive, '-d', extracted], { windowsHide: true })
        } else {
          await execFileAsync('tar', ['-xf', archive, '-C', extracted], { windowsHide: true })
        }
        const files = walk(extracted)
        for (const file of files) {
          const name = basename(file)
          if (name.endsWith('.dll') || name.endsWith('.dat') || name.endsWith('.metadb')) {
            writeFileSync(join(destination, name), readFileSync(file))
          }
        }
        // Release archives do not always name the payload after the binary:
        // Mihomo ships `mihomo-windows-amd64-v1-go120.exe`, for example.
        const executable = process.platform === 'win32' ? /\.exe$/i : /^(?!.*\.(md|txt|json|yaml|yml|dat|dll)$).+$/i
        const candidates = files.filter((file) => executable.test(basename(file)))
        const core =
          candidates.find((file) => basename(file) === binaryName) ??
          candidates.find((file) => basename(file).toLowerCase().startsWith(adapter.id)) ??
          candidates.sort((left, right) => statSync(right).size - statSync(left).size)[0]
        if (core) writeFileSync(join(destination, binaryName), readFileSync(core))
      } finally {
        rmSync(extracted, { recursive: true, force: true })
      }
    }

    rmSync(archive, { force: true })
    const binary = join(destination, binaryName)
    if (!existsSync(binary)) throw new Error(`${adapter.name} archive did not contain ${binaryName}`)
    if (process.platform !== 'win32') {
      await execFileAsync('chmod', ['+x', binary]).catch(() => undefined)
    }
    entry.binary = binary
    entry.version = await this.readVersion(adapter, binary)
    log(`${adapter.name} installed${entry.version ? ` · ${entry.version}` : ''}`)
    return binary
  }

  /**
   * Prepares Windows TUN support: downloads wintun.dll once and makes sure the
   * chosen core lives next to it. Windows resolves the DLL from the executable
   * directory first, so a bundled sing-box is copied into userData on demand.
   */
  async ensureTun(id: EngineId, binary: string, log: (message: string) => void): Promise<string> {
    if (process.platform !== 'win32' || !this.adapter(id).supportsTun) return binary
    const destination = join(app.getPath('userData'), 'bin')
    mkdirSync(destination, { recursive: true })
    const wintun = join(destination, 'wintun.dll')

    if (!existsSync(wintun)) {
      log('Downloading wintun.dll for TUN mode…')
      const archive = join(tmpdir(), `eaglet-wintun-${Date.now()}.zip`)
      const response = await fetch('https://www.wintun.net/builds/wintun-0.14.1.zip', {
        headers: { 'User-Agent': 'Eaglet-VPN' },
        signal: AbortSignal.timeout(60000)
      })
      if (!response.ok) throw new Error(`wintun.dll download failed (${response.status})`)
      writeFileSync(archive, Buffer.from(await response.arrayBuffer()))
      const extracted = join(tmpdir(), `eaglet-wintun-${Date.now()}`)
      mkdirSync(extracted, { recursive: true })
      try {
        await execFileAsync('tar', ['-xf', archive, '-C', extracted], { windowsHide: true })
        const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
        const files = walk(extracted)
        const dll =
          files.find((file) => /wintun\.dll$/i.test(file) && file.replace(/\\/g, '/').includes(`/${arch}/`)) ??
          files.find((file) => /wintun\.dll$/i.test(file))
        if (!dll) throw new Error('The wintun archive did not contain wintun.dll')
        writeFileSync(wintun, readFileSync(dll))
        log('wintun.dll ready · TUN capture available')
      } finally {
        rmSync(extracted, { recursive: true, force: true })
        rmSync(archive, { force: true })
      }
    }

    const binaryName = this.adapter(id).binaryName(process.platform)
    const target = join(destination, binaryName)
    if (binary !== target) {
      writeFileSync(target, readFileSync(binary))
      // sing-box needs libcronet.dll next to the executable.
      for (const file of readdirSync(dirname(binary))) {
        if (/\.dll$/i.test(file) && !existsSync(join(destination, file))) {
          writeFileSync(join(destination, file), readFileSync(join(dirname(binary), file)))
        }
      }
      const entry = this.entries.get(id)
      if (entry) entry.binary = target
      log(`${this.adapter(id).name} staged next to wintun.dll`)
      return target
    }
    return binary
  }

  async remove(id: EngineId): Promise<boolean> {
    const entry = this.entries.get(id)
    if (!entry) return false
    const binary = entry.binary ?? resourceBinary(entry.adapter)
    if (!binary) return false
    if (!binary.startsWith(app.getPath('userData'))) {
      throw new Error(`${entry.adapter.name} is bundled with Eaglet and cannot be removed from the app folder`)
    }
    const dir = join(app.getPath('userData'), 'bin')
    const keep = new Set(['sing-box.exe', 'xray.exe', 'mihomo.exe', 'sing-box', 'xray', 'mihomo', 'wintun.dll'])
    for (const file of existsSync(dir) ? readdirSync(dir) : []) {
      const full = join(dir, file)
      if (full === binary || (!keep.has(file) && /\.(dat|metadb|dll)$/i.test(file))) {
        rmSync(full, { force: true })
      }
    }
    entry.binary = null
    entry.version = null
    return true
  }

  async checkUpdates(): Promise<void> {
    for (const entry of this.entries.values()) {
      if (!entry.binary) continue
      try {
        entry.latestVersion = (await this.latestRelease(entry.adapter)).version
      } catch {
        // Offline or rate limited — keep the previous value.
      }
    }
  }
}
