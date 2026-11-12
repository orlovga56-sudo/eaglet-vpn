import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import type { EngineId, Profile, Settings } from '@shared/types'
import type { Store } from '../store'
import type { VpnEngine } from './engine'
import { parseProfilesPayload } from './profiles'

const execFileAsync = promisify(execFile)
const ENGINES: EngineId[] = ['sing-box', 'xray', 'mihomo']
const ENGINE_PROCESS: Record<EngineId, string> = {
  'sing-box': 'sing-box.exe',
  xray: 'xray.exe',
  mihomo: 'mihomo.exe'
}

interface ProxySnapshot {
  enabled: boolean | null
  server: string | null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function run(command: string, args: string[], timeout = 25000): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout, windowsHide: true })
    return `${stdout}${stderr}`.trim()
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string; message?: string }
    return `${detail.stdout ?? ''}${detail.stderr ?? detail.message ?? ''}`.trim()
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number, interval = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(interval)
  }
  return predicate()
}

export async function isElevated(): Promise<boolean> {
  if (process.platform !== 'win32') return process.getuid?.() === 0
  const output = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
  ])
  return /true/i.test(output)
}

async function readProxy(): Promise<ProxySnapshot> {
  if (process.platform !== 'win32') return { enabled: null, server: null }
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
  const enabledRaw = await run('reg.exe', ['query', key, '/v', 'ProxyEnable'])
  const serverRaw = await run('reg.exe', ['query', key, '/v', 'ProxyServer'])
  const enabledMatch = enabledRaw.match(/REG_DWORD\s+0x([0-9a-f]+)/i)
  const serverMatch = serverRaw.match(/REG_SZ\s+(.+)/i)
  return {
    enabled: enabledMatch ? Number.parseInt(enabledMatch[1], 16) === 1 : null,
    server: serverMatch ? serverMatch[1].trim() : null
  }
}

function sameProxy(left: ProxySnapshot, right: ProxySnapshot): boolean {
  return left.enabled === right.enabled && left.server === right.server
}

async function processAlive(image: string): Promise<boolean> {
  const output = await run('tasklist.exe', ['/FI', `IMAGENAME eq ${image}`, '/NH'])
  return new RegExp(image.replace('.', '\\.'), 'i').test(output) && !/No tasks/i.test(output)
}

async function firewallDefaultAction(): Promise<string> {
  const output = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-NetFirewallProfile | ForEach-Object { "$($_.Name)=$($_.DefaultOutboundAction)" }'
  ])
  return output.replace(/\r/g, '').trim()
}

async function firewallRules(): Promise<string> {
  const output = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "(Get-NetFirewallRule -DisplayName 'Eaglet Kill Switch*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty DisplayName) -join ', '"
  ])
  return output.replace(/\r/g, '').trim()
}

async function systemDns(): Promise<string> {
  if (process.platform !== 'win32') return 'not probed on this platform'
  const output = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses } | ForEach-Object { \"$($_.InterfaceAlias)=$($_.ServerAddresses -join ';')\" }"
  ])
  return output.replace(/\r/g, '').trim()
}

async function resolveViaLoopback(): Promise<string> {
  const output = await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "try { (Resolve-DnsName example.com -Server 127.0.0.1 -Type A -ErrorAction Stop | Where-Object { $_.IPAddress } | Select-Object -First 2).IPAddress -join ',' } catch { 'ERROR: ' + $_.Exception.Message }"
    ],
    20000
  )
  return output.replace(/\r/g, '').trim()
}

/** Settings that make every core's native config observable without protection layers. */
function baseSettings(engine: EngineId): Partial<Settings> {
  return {
    engine,
    systemProxy: true,
    tunMode: false,
    killSwitch: false,
    networkProtection: false,
    dnsProtection: false,
    dns: 'auto',
    ipv6: true,
    routingMode: 'smart',
    autoReconnect: true,
    notifications: false,
    autoUpdateSubscriptions: false
  }
}

function describeState(engine: VpnEngine): Record<string, unknown> {
  const state = engine.getState()
  return {
    status: state.status,
    engine: state.engine,
    error: state.error,
    stage: state.stage,
    exitIp: state.ip.exit?.ip ?? null,
    exitCountry: state.ip.exit?.countryCode ?? null,
    directIp: state.ip.direct?.ip ?? null,
    changed: state.ip.changed,
    killSwitchActive: state.killSwitchActive,
    dnsProtectionActive: state.dnsProtectionActive,
    usage: state.usage,
    metrics: state.metrics,
    logs: state.logs.slice(0, 12).map((entry) => `${entry.level}: ${entry.message}`)
  }
}

/**
 * Dev harness for the multi-engine batch (`--eaglet-engine-test`).
 *
 * It installs every core, validates native configs for both hardened and
 * standard settings, opens a real tunnel with each engine, kills each core to
 * exercise auto-reconnect, verifies per-profile/global engine selection, checks
 * the WinINet proxy round-trip and finally terminates while connected to prove
 * the emergency teardown. Protection layers that need elevation are reported
 * honestly instead of being faked.
 */
export async function runEngineTest(store: Store, engine: VpnEngine): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    platform: `${process.platform}/${process.arch}`,
    elevated: await isElevated()
  }
  const originalSettings = store.getSettings()
  const originalSessions = store.getSessions()
  const baselineProxy = await readProxy()
  report.baselineProxy = baselineProxy
  report.baselineFirewall = await firewallDefaultAction()
  report.baselineDns = await systemDns()
  const results: Array<Record<string, unknown>> = []
  report.engines = results
  let remoteId: string | null = null
  let addedDirectId: string | null = null

  try {
    await engine.init()
    // The harness must not pollute the user's real history with test entries.
    engine.clearEngineHistory()
    const remote = store.getProfiles().find((profile) => profile.protocol !== 'direct')
    if (!remote) throw new Error('No remote profile is configured — import a node before running the engine test')
    remoteId = remote.id
    report.profile = {
      id: remote.id,
      name: remote.name,
      protocol: remote.protocol,
      host: remote.host,
      port: remote.port,
      ping: remote.ping
    }
    engine.setProfile(remote.id)
    engine.setProfileEngine(remote.id, null)

    const ensureDirect = (): Profile => {
      const existing = store.getProfiles().find((profile) => profile.protocol === 'direct')
      if (existing) return existing
      const [parsed] = parseProfilesPayload('direct://Engine%20test%20route')
      if (!parsed) throw new Error('Could not create a direct profile for the engine test')
      store.addProfiles([parsed])
      engine.reconcileProfiles()
      addedDirectId = parsed.id
      return store.getProfile(parsed.id) ?? parsed
    }

    /* 1. Install every engine and record versions. */
    const installs: Array<Record<string, unknown>> = []
    for (const id of ENGINES) {
      const before = engine.getEngineStates().find((item) => item.id === id)
      try {
        const states = await engine.installEngine(id)
        const state = states.find((item) => item.id === id)
        installs.push({
          engine: id,
          ok: true,
          alreadyInstalled: Boolean(before?.installed),
          version: state?.version ?? null,
          path: state?.path ?? null
        })
      } catch (error) {
        installs.push({ engine: id, ok: false, error: (error as Error).message })
      }
    }
    report.installs = installs

    /* 2. Build + validate every native config in two variants. */
    const configs: Array<Record<string, unknown>> = []
    for (const id of ENGINES) {
      const installed = engine.getEngineStates().find((item) => item.id === id)?.installed
      if (!installed) {
        configs.push({ engine: id, variant: 'all', valid: false, detail: 'not installed' })
        continue
      }
      const target = engine.supportsProfile(id, remote.id) ? remote : ensureDirect()
      engine.setProfile(target.id)
      store.updateSettings({
        ...baseSettings(id),
        ipv6: true,
        routingMode: 'smart',
        bypassList: 'bank.example.com\n10.0.0.0/8'
      })
      const standard = await engine.validateEngineConfig(id)
      let markers: string[] = []
      try {
        const content = standard.configPath ? readFileSync(standard.configPath, 'utf-8') : ''
        markers = ['bank.example.com', '10.0.0.0/8'].filter((marker) => content.includes(marker))
      } catch {
        markers = []
      }
      configs.push({
        engine: id,
        variant: 'standard',
        profile: target.protocol,
        valid: standard.valid,
        detail: standard.detail,
        bypassMarkers: markers
      })

      store.updateSettings({ ipv6: false, routingMode: 'global', networkProtection: false, dnsProtection: true, bypassList: '' })
      const hardened = await engine.validateEngineConfig(id)
      let ipv6Marker = false
      try {
        const content = hardened.configPath ? readFileSync(hardened.configPath, 'utf-8') : ''
        ipv6Marker =
          content.includes('IP-CIDR6,::/0,REJECT') ||
          content.includes('"::/0"') ||
          content.includes('"ip_version": 6')
      } catch {
        ipv6Marker = false
      }
      configs.push({
        engine: id,
        variant: 'hardened',
        profile: target.protocol,
        valid: hardened.valid,
        detail: hardened.detail,
        ipv6RejectRule: ipv6Marker
      })
    }
    engine.setProfile(remote.id)
    report.configs = configs

    /* 3. Real tunnel with each engine + auto-reconnect after a real kill. */
    for (const id of ENGINES) {
      const installed = engine.getEngineStates().find((item) => item.id === id)?.installed
      const entry: Record<string, unknown> = { engine: id }
      if (!installed) {
        entry.skipped = 'engine is not installed'
        results.push(entry)
        continue
      }
      const target = engine.supportsProfile(id, remote.id) ? remote : ensureDirect()
      store.updateSettings({ ...baseSettings(id), bypassList: '' })
      engine.setEngine(id)
      engine.setProfile(target.id)
      entry.profile = target.protocol
      entry.remoteNode = target.id === remote.id
      entry.chosenBeforeConnect = engine.getEngineId()

      await engine.connect()
      const settled = await waitFor(() => engine.getState().status !== 'connecting', 120000)
      entry.settled = settled
      await waitFor(() => engine.getState().usage.pid !== null, 6000)
      entry.connectedState = describeState(engine)
      entry.proxyDuring = await readProxy()
      entry.dnsDuring = await systemDns()

      const live = engine.getState()
      if (live.status === 'connected') {
        // Long enough for the 5 s latency probe and the resource sampler.
        await sleep(6500)
        const sampled = engine.getState().metrics
        entry.sampledMetrics = {
          downTotal: sampled.downTotal,
          upTotal: sampled.upTotal,
          connections: sampled.connections,
          probes: sampled.probes,
          ping: sampled.ping,
          jitter: sampled.jitter,
          loss: sampled.loss
        }
        entry.telemetryCountersLive = sampled.downTotal + sampled.upTotal > 0
        entry.usageSampled = engine.getState().usage

        const pid = engine.getState().usage.pid
        const reconnect: Record<string, unknown> = { pid, killed: false }
        entry.reconnect = reconnect
        if (pid) {
          await run('taskkill.exe', ['/PID', String(pid), '/T', '/F'])
          reconnect.killed = true
          let sawError = false
          const deadline = Date.now() + 75000
          while (Date.now() < deadline) {
            const current = engine.getState().status
            if (current === 'error') sawError = true
            if (sawError && current === 'connected') break
            if (current === 'error' && !store.getSettings().autoReconnect) break
            await sleep(300)
          }
          const after = engine.getState()
          reconnect.sawError = sawError
          reconnect.finalStatus = after.status
          reconnect.restored = sawError && after.status === 'connected'
          reconnect.logs = after.logs
            .filter((log) => /auto-reconnect|stopped unexpectedly|restored the tunnel/i.test(log.message))
            .map((log) => log.message)
        }
      }

      if (engine.getState().status === 'connected') {
        await engine.disconnect()
        await waitFor(() => engine.getState().status === 'disconnected', 40000)
      }
      entry.finalStatus = engine.getState().status
      entry.proxyAfter = await readProxy()
      entry.proxyRestored = sameProxy(entry.proxyAfter as ProxySnapshot, baselineProxy)
      entry.dnsAfter = await systemDns()
      entry.coreProcessAlive = await processAlive(ENGINE_PROCESS[id])
      results.push(entry)
    }

    /* 4. Per-profile engine override: global sing-box, profile pinned to another core. */
    const override: Record<string, unknown> = {}
    const alternative = (['mihomo', 'xray'] as EngineId[]).find(
      (id) => engine.getEngineStates().find((item) => item.id === id)?.installed
    )
    if (alternative) {
      const overrideProfile = engine.supportsProfile(alternative, remote.id) ? remote : ensureDirect()
      store.updateSettings({ ...baseSettings('sing-box'), bypassList: '' })
      engine.setProfileEngine(overrideProfile.id, alternative)
      engine.setEngine('sing-box')
      engine.setProfile(overrideProfile.id)
      override.pinnedTo = alternative
      override.profile = overrideProfile.protocol
      override.selected = engine.getEngineId()
      await engine.connect()
      await waitFor(() => engine.getState().status !== 'connecting', 120000)
      override.connectedState = describeState(engine)
      override.usedPinnedEngine = engine.getState().engine === alternative
      override.logEvidence = engine
        .getState()
        .logs.filter((log) => /Core: |Tunnel established/i.test(log.message))
        .map((log) => log.message)
        .slice(0, 6)
      if (engine.getState().status === 'connected') {
        await engine.disconnect()
        await waitFor(() => engine.getState().status === 'disconnected', 40000)
      }
    } else {
      override.skipped = 'No alternative engine is installed'
    }
    report.profileOverride = override

    /* 5. Global engine: profile back on auto, the alternative core selected globally. */
    const global: Record<string, unknown> = {}
    engine.setProfileEngine(remote.id, null)
    if (alternative) {
      const globalProfile = engine.supportsProfile(alternative, remote.id) ? remote : ensureDirect()
      engine.setProfileEngine(globalProfile.id, null)
      store.updateSettings({ ...baseSettings(alternative), bypassList: '' })
      engine.setEngine(alternative)
      engine.setProfile(globalProfile.id)
      global.engine = alternative
      global.profile = globalProfile.protocol
      global.selected = engine.getEngineId()
      await engine.connect()
      await waitFor(() => engine.getState().status !== 'connecting', 120000)
      global.connectedState = describeState(engine)
      global.usedGlobalEngine = engine.getState().engine === alternative
      if (engine.getState().status === 'connected') {
        await engine.disconnect()
        await waitFor(() => engine.getState().status === 'disconnected', 40000)
      }
    } else {
      global.skipped = 'No alternative engine is installed'
    }
    report.globalEngine = global

    /* 6. Auto choice after clearing both overrides. */
    store.updateSettings({ engine: 'auto' })
    engine.setProfile(remote.id)
    report.autoChoice = {
      chosen: engine.getEngineId(),
      installed: engine
        .getEngineStates()
        .filter((item) => item.installed)
        .map((item) => item.id)
    }

    /* 7. Scenarios mutate real settings and select an engine. */
    const scenarios: Array<Record<string, unknown>> = []
    for (const id of ['gaming', 'manual']) {
      try {
        await engine.applyScenario(id)
        const settings = store.getSettings()
        scenarios.push({
          id,
          engine: settings.engine,
          tunMode: settings.tunMode,
          systemProxy: settings.systemProxy,
          killSwitch: settings.killSwitch,
          dnsProtection: settings.dnsProtection,
          ipv6: settings.ipv6,
          routingMode: settings.routingMode,
          chosen: engine.getEngineId()
        })
      } catch (error) {
        scenarios.push({ id, error: (error as Error).message })
      }
    }
    report.scenarios = scenarios

    /* 8. TUN prerequisites (wintun + core staging) can be verified without elevation. */
    try {
      store.updateSettings({
        engine: 'sing-box',
        tunMode: true,
        systemProxy: false,
        killSwitch: false,
        networkProtection: false,
        dnsProtection: false
      })
      engine.setProfile(remote.id)
      const prepared = await engine.prepareTun()
      report.tunPreparation = {
        engine: prepared.engine,
        path: prepared.path,
        wintun: prepared.wintun,
        note: 'TUN adapter capture itself requires an elevated process'
      }
    } catch (error) {
      report.tunPreparation = { error: (error as Error).message }
    }

    /* 9. Kill switch and DNS protection need an elevated process on Windows. */
    const elevated = report.elevated === true
    if (elevated) {
      store.updateSettings({
        ...baseSettings('sing-box'),
        systemProxy: false,
        killSwitch: true,
        networkProtection: true,
        dnsProtection: true
      })
      engine.setEngine('sing-box')
      engine.setProfile(remote.id)
      await engine.connect()
      await waitFor(() => engine.getState().status !== 'connecting', 120000)
      const live = engine.getState()
      const relay = await resolveViaLoopback()
      const protection: Record<string, unknown> = {
        status: live.status,
        killSwitchActive: live.killSwitchActive,
        dnsProtectionActive: live.dnsProtectionActive,
        firewallDuring: await firewallDefaultAction(),
        firewallRules: await firewallRules(),
        systemDnsDuring: await systemDns(),
        loopbackDohAnswer: relay
      }
      report.protection = protection
      if (live.status === 'connected') {
        await engine.disconnect()
        await waitFor(() => engine.getState().status === 'disconnected', 40000)
      }
      protection.firewallAfter = await firewallDefaultAction()
      protection.systemDnsAfter = await systemDns()
      protection.rulesAfter = await firewallRules()
    } else {
      report.protection = {
        skipped: 'requires an elevated process: firewall policy, system DNS override and TUN capture were not exercised'
      }
    }

    /* 10. Emergency termination while a tunnel is live. */
    const emergency: Record<string, unknown> = {}
    store.updateSettings({ ...baseSettings('sing-box'), systemProxy: true, autoReconnect: true })
    engine.setEngine('sing-box')
    engine.setProfile(remote.id)
    await engine.connect()
    await waitFor(() => engine.getState().status !== 'connecting', 120000)
    emergency.before = describeState(engine)
    const beforeProxy = await readProxy()
    emergency.proxyBefore = beforeProxy
    await engine.shutdown()
    await sleep(1200)
    emergency.statusAfter = engine.getState().status
    emergency.coreProcessAlive = await processAlive(ENGINE_PROCESS['sing-box'])
    emergency.proxyAfter = await readProxy()
    emergency.proxyRestored = sameProxy(emergency.proxyAfter as ProxySnapshot, baselineProxy)
    emergency.sessionsPersisted = store.getSessions().length
    report.emergency = emergency
  } catch (error) {
    report.error = (error as Error).message
  } finally {
    /* Always leave the machine as we found it. */
    try {
      if (engine.getState().status === 'connected' || engine.getState().status === 'error') {
        await engine.disconnect().catch(() => undefined)
      }
      await engine.shutdown()
      store.updateSettings(originalSettings)
      if (remoteId) engine.setProfileEngine(remoteId, null)
      if (addedDirectId) store.removeProfile(addedDirectId)
      engine.reconcileProfiles()
      // Restore the exact session list the user had before the harness ran.
      store.clearSessions()
      for (let index = originalSessions.length - 1; index >= 0; index -= 1) {
        store.addSession(originalSessions[index])
      }
      engine.clearEngineHistory()
    } catch {
      // Best effort: the report already records what failed.
    }
    report.finishedAt = new Date().toISOString()
    report.proxyFinal = await readProxy()
    report.firewallFinal = await firewallDefaultAction()
    report.dnsFinal = await systemDns()
  }

  return report
}
