import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Store } from './store'
import { VpnEngine } from './vpn/engine'
import { isHttpUrl, parseProfileUri, parseProfilesPayload, subscriptionName } from './vpn/profiles'
import { discoverFreeProfiles } from './vpn/free-sources'
import type { ImportResult, Profile, Settings, Snapshot, Subscription } from '@shared/types'

const isDev = !app.isPackaged
const isShotMode = process.argv.includes('--eaglet-shots')

let mainWindow: BrowserWindow | null = null
let store: Store
let engine: VpnEngine
let normalBounds: Electron.Rectangle | null = null
let quitting = false

function snapshot(): Snapshot {
  return {
    state: engine.getState(),
    settings: store.getSettings(),
    profiles: store.getProfiles(),
    subscriptions: store.getSubscriptions(),
    platform: process.platform,
    version: app.getVersion()
  }
}

function broadcast(): void {
  const data = snapshot()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('app:state', data)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    frame: false,
    backgroundColor: '#04060d',
    title: 'Eaglet',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  if (isShotMode) scheduleShots(mainWindow)

  mainWindow.on('ready-to-show', () => {
    if (isShotMode) mainWindow?.showInactive()
    else mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function setMini(win: BrowserWindow, mini: boolean): void {
  if (mini) {
    if (!normalBounds) normalBounds = win.getBounds()
    win.setResizable(false)
    win.setMinimumSize(360, 540)
    win.setSize(372, 566, true)
    win.setAlwaysOnTop(true, 'floating')
    win.center()
    store.updateSettings({ mini: true })
  } else {
    win.setAlwaysOnTop(false)
    win.setResizable(true)
    win.setMinimumSize(1000, 660)
    if (normalBounds) {
      win.setBounds(normalBounds, true)
      normalBounds = null
    } else {
      win.setSize(1180, 780, true)
      win.center()
    }
    store.updateSettings({ mini: false })
  }
}

function applyLoginItem(enabled: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
  } catch {
    // Unsupported on some platforms — ignore.
  }
}

/* ------------------------------------------------------------------ */
/*  Subscription helpers                                              */
/* ------------------------------------------------------------------ */

async function fetchSubscription(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Eaglet/1.0 (sing-box)',
      Accept: 'text/plain, */*'
    },
    signal: AbortSignal.timeout(20000)
  })
  if (!response.ok) throw new Error(`Subscription request failed (${response.status})`)
  return response.text()
}

function subscriptionId(url: string): string {
  return createHash('sha1').update(url.trim()).digest('hex').slice(0, 12)
}

async function importFromUrl(url: string): Promise<ImportResult> {
  const text = await fetchSubscription(url)
  const profiles = parseProfilesPayload(text)
  if (profiles.length === 0) throw new Error('The subscription did not contain any supported nodes')

  const id = subscriptionId(url)
  const existing = store.getSubscriptions().find((item) => item.id === id)
  const sourceProfiles = profiles.map((profile) => ({ ...profile, sourceId: id }))
  const { added, updated } = store.addProfiles(sourceProfiles)
  const subscription: Subscription = {
    id,
    name: existing?.name ?? subscriptionName(url),
    url: url.trim(),
    updatedAt: Date.now(),
    count: sourceProfiles.length
  }
  store.upsertSubscription(subscription)
  engine.reconcileProfiles()
  engine.pushExternalLog('success', `Subscription imported · ${profiles.length} nodes · ${subscription.name}`)
  broadcast()

  return {
    imported: added,
    updated,
    subscription,
    profiles: store.getProfiles()
  }
}

function importFromText(text: string): ImportResult {
  const profiles = parseProfilesPayload(text)
  if (profiles.length === 0) throw new Error('No supported share links found in that text')
  const { added, updated } = store.addProfiles(profiles)
  engine.reconcileProfiles()
  engine.pushExternalLog('success', `Imported ${profiles.length} node(s) from a share link`)
  broadcast()
  return { imported: added, updated, subscription: null, profiles: store.getProfiles() }
}

async function importAnything(input: string): Promise<ImportResult> {
  const text = input.trim()
  if (!text) throw new Error('Paste a share link, a subscription URL or a base64 list')
  if (isHttpUrl(text)) return importFromUrl(text)
  return importFromText(text)
}

const FREE_SOURCE_ID = 'free-public-nodes'

/**
 * Stores nodes picked in the free-server finder as a removable pseudo
 * subscription, so "Free public nodes" can be cleaned up in one click.
 */
function addFreeProfiles(links: string[]): ImportResult {
  const parsed = links
    .map((link) => parseProfileUri(link))
    .filter((profile): profile is Profile => Boolean(profile))
  if (parsed.length === 0) throw new Error('No valid share links were selected')

  const incoming = parsed.map((profile) => ({ ...profile, sourceId: FREE_SOURCE_ID }))
  const { added, updated } = store.addProfiles(incoming)
  const count = store.getProfiles().filter((profile) => profile.sourceId === FREE_SOURCE_ID).length
  const subscription: Subscription = {
    id: FREE_SOURCE_ID,
    name: 'Free public nodes',
    url: 'eaglet://free-public',
    updatedAt: Date.now(),
    count
  }
  store.upsertSubscription(subscription)
  engine.reconcileProfiles()
  engine.pushExternalLog('success', `Added ${added} free node(s) from public catalogs`)
  broadcast()
  return { imported: added, updated, subscription, profiles: store.getProfiles() }
}

/* ------------------------------------------------------------------ */
/*  IPC                                                               */
/* ------------------------------------------------------------------ */

function registerIpc(): void {
  ipcMain.handle('app:snapshot', () => snapshot())

  ipcMain.handle('vpn:connect', async (_event, id?: string) => {
    await engine.connect(id)
    broadcast()
  })

  ipcMain.handle('vpn:disconnect', async () => {
    await engine.disconnect()
    broadcast()
  })

  ipcMain.handle('vpn:select-profile', (_event, id: string) => {
    engine.selectProfile(id)
    broadcast()
  })

  ipcMain.handle('profiles:import', async (_event, text: string) => {
    try {
      return await importAnything(text)
    } catch (error) {
      engine.pushExternalLog('error', (error as Error).message)
      broadcast()
      throw error
    }
  })

  ipcMain.handle('free:discover', async () => {
    engine.pushExternalLog('info', 'Searching public free-node catalogs…')
    try {
      let corePath: string | null = null
      try {
        corePath = await engine.ensureCore()
      } catch {
        corePath = null
      }
      const result = await discoverFreeProfiles({
        settings: store.getSettings(),
        corePath,
        onProgress: (message) => {
          engine.pushExternalLog('info', message)
          broadcast()
        }
      })
      engine.pushExternalLog(
        result.profiles.length > 0 ? 'success' : 'warn',
        `Free search · ${result.found} found · ${result.reachable} reachable · ${result.profiles.length} working`
      )
      broadcast()
      return result
    } catch (error) {
      engine.pushExternalLog('error', `Free search failed: ${(error as Error).message}`)
      broadcast()
      throw error
    }
  })

  ipcMain.handle('free:add', (_event, links: string[]) => {
    try {
      return addFreeProfiles(links)
    } catch (error) {
      engine.pushExternalLog('error', (error as Error).message)
      broadcast()
      throw error
    }
  })

  ipcMain.handle('subscriptions:update', async (_event, id: string) => {
    const subscription = store.getSubscriptions().find((item) => item.id === id)
    if (!subscription) throw new Error('Subscription not found')
    try {
      const text = await fetchSubscription(subscription.url)
      const profiles = parseProfilesPayload(text)
      if (profiles.length === 0) throw new Error('Subscription returned no supported nodes')
      // Drop removed nodes, then upsert the fresh list.
      const incoming: Profile[] = profiles.map((profile) => ({ ...profile, sourceId: id }))
      const incomingIds = new Set(incoming.map((profile) => profile.id))
      for (const old of store.getProfiles().filter((profile) => profile.sourceId === id)) {
        if (!incomingIds.has(old.id)) store.removeProfile(old.id)
      }
      const { added, updated } = store.addProfiles(incoming)
      store.upsertSubscription({ ...subscription, updatedAt: Date.now(), count: incoming.length })
      engine.reconcileProfiles()
      engine.pushExternalLog('success', `Subscription refreshed · ${incoming.length} nodes`)
      broadcast()
      return {
        imported: added,
        updated,
        subscription: { ...subscription, updatedAt: Date.now(), count: incoming.length },
        profiles: store.getProfiles()
      } satisfies ImportResult
    } catch (error) {
      engine.pushExternalLog('error', `Subscription refresh failed: ${(error as Error).message}`)
      broadcast()
      throw error
    }
  })

  ipcMain.handle('subscriptions:remove', (_event, id: string) => {
    store.removeProfilesBySource(id)
    store.removeSubscription(id)
    engine.reconcileProfiles()
    engine.pushExternalLog('info', 'Subscription removed')
    broadcast()
  })

  ipcMain.handle('profiles:remove', (_event, id: string) => {
    store.removeProfile(id)
    engine.reconcileProfiles()
    engine.pushExternalLog('info', 'Node removed')
    broadcast()
  })

  ipcMain.handle('profiles:test', async (_event, ids?: string[]) => {
    const profiles = await engine.testProfiles(ids)
    broadcast()
    return profiles
  })

  ipcMain.handle('ip:check', async () => {
    await engine.checkIp()
    broadcast()
  })

  ipcMain.handle('core:refresh', async () => {
    const core = await engine.refreshCore()
    broadcast()
    return core
  })

  ipcMain.handle('settings:update', async (_event, patch: Partial<Settings>) => {
    const previous = store.getSettings()
    const settings = store.updateSettings(patch)
    if (patch.mini !== undefined && mainWindow) setMini(mainWindow, patch.mini)
    if (patch.launchAtStartup !== undefined) applyLoginItem(patch.launchAtStartup)
    if (patch.systemProxy !== undefined && patch.systemProxy !== previous.systemProxy) {
      await engine.setSystemProxy(patch.systemProxy)
    }
    if ((patch.routingMode && patch.routingMode !== previous.routingMode) ||
        (patch.dns && patch.dns !== previous.dns) ||
        (patch.customDns !== undefined && patch.customDns !== previous.customDns)) {
      if (engine.getState().status === 'connected') {
        engine.pushExternalLog('warn', 'Routing changes apply on the next connection')
      }
    }
    broadcast()
    return settings
  })

  ipcMain.handle('window:set-mini', (_event, mini: boolean) => {
    if (mainWindow) setMini(mainWindow, mini)
    broadcast()
  })

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
}

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                         */
/* ------------------------------------------------------------------ */

app.whenReady().then(async () => {
  app.setAppUserModelId('com.eaglet.vpn')
  store = new Store()
  const settings = store.getSettings()
  engine = new VpnEngine(store)

  engine.on('state', () => {
    broadcast()
  })

  if (process.argv.includes('--eaglet-free-connect-test')) {
    // Dev harness: proves the whole finder → connect → exit-IP → teardown
    // path against real public nodes. Writes JSON because stdout is invisible.
    const outFile = process.env.EAGLET_FREE_CONNECT_OUT ?? join(process.cwd(), 'free-connect-test.json')
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
    const report: Record<string, unknown> = { attempts: [] }
    try {
      await engine.init()
      const corePath = await engine.ensureCore().catch(() => null)
      // Each run starts from a clean free-node set so repeated tests don't pile up.
      store.removeProfilesBySource(FREE_SOURCE_ID)
      store.removeSubscription(FREE_SOURCE_ID)
      const found = await discoverFreeProfiles({ settings: store.getSettings(), corePath })
      report.found = found.found
      report.reachable = found.reachable
      report.tested = found.tested
      report.verified = found.verified
      const picks = found.profiles.slice(0, 10)
      if (picks.length === 0) throw new Error('No working public nodes found')
      const imported = addFreeProfiles(picks.map((profile) => profile.raw))
      report.added = imported.imported
      report.subscription = imported.subscription
      engine.reconcileProfiles()

      const ids = picks.map((profile) => profile.id).filter((id) => Boolean(store.getProfile(id)))
      for (const id of ids) {
        const profile = store.getProfile(id)
        if (!profile) continue
        engine.setProfile(id)
        await engine.connect()
        const deadline = Date.now() + 60000
        while (engine.getState().status === 'connecting' && Date.now() < deadline) await sleep(250)
        const state = engine.getState()
        const attempt = {
          name: profile.name,
          protocol: profile.protocol,
          host: profile.host,
          port: profile.port,
          status: state.status,
          directIp: state.ip.direct?.ip ?? null,
          exitIp: state.ip.exit?.ip ?? null,
          changed: state.ip.changed,
          error: state.error,
          logs: state.logs.slice(0, 14).map((entry) => `${entry.level}: ${entry.message}`)
        }
        ;(report.attempts as unknown[]).push(attempt)
        if (state.status === 'connected') {
          await sleep(2500)
          report.connected = attempt
          report.metrics = engine.getState().metrics
          break
        }
      }

      if (engine.getState().status === 'connected') {
        await engine.disconnect()
        const deadline = Date.now() + 30000
        while (engine.getState().status !== 'disconnected' && Date.now() < deadline) await sleep(250)
      }
      report.afterDisconnect = engine.getState().status
      report.storedFreeProfiles = store.getProfiles().filter((p) => p.sourceId === FREE_SOURCE_ID).length
    } catch (error) {
      report.error = (error as Error).message
    }
    writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8')
    await engine.shutdown()
    app.exit(0)
    return
  }

  if (process.argv.includes('--eaglet-free-test')) {
    // Electron is a GUI binary on Windows, so stdout is invisible here: the
    // harness writes a JSON report instead.
    const outFile = process.env.EAGLET_FREE_TEST_OUT ?? join(process.cwd(), 'free-test.json')
    try {
      await engine.init()
      const corePath = await engine.ensureCore().catch(() => null)
      const result = await discoverFreeProfiles({ settings: store.getSettings(), corePath })
      const report = {
        sources: result.sources,
        found: result.found,
        tested: result.tested,
        reachable: result.reachable,
        verified: result.verified,
        working: result.profiles.length,
        sample: result.profiles.slice(0, 8).map((profile) => ({
          name: profile.name,
          host: profile.host,
          port: profile.port,
          protocol: profile.protocol,
          ping: profile.ping
        })),
        raw: result.profiles.slice(0, 12).map((profile) => profile.raw)
      }
      writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8')
      console.log(JSON.stringify(report, null, 2))
    } catch (error) {
      writeFileSync(outFile, JSON.stringify({ error: (error as Error).message }, null, 2), 'utf8')
    }
    await engine.shutdown()
    app.exit(0)
    return
  }

  registerIpc()
  applyLoginItem(settings.launchAtStartup)
  createWindow()
  await engine.init()
  engine.reconcileProfiles()

  if (settings.autoConnect && !isShotMode) {
    setTimeout(() => void engine.connect(), 900)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitting || !engine) return
  quitting = true
  event.preventDefault()
  void engine.shutdown().finally(() => app.exit(0))
})

/* ------------------------------------------------------------------ */
/*  Screenshot harness (used by `npm run shots` to preview all themes) */
/* ------------------------------------------------------------------ */

const SHOT_SOURCE = '__shots__'

async function seedShotProfiles(): Promise<void> {
  const hasDirect = store.getProfiles().some((profile) => profile.protocol === 'direct')
  const links = hasDirect
    ? []
    : [
        'direct://Showcase%20direct',
        'vless://11111111-1111-4111-8111-111111111111@fra.eaglet-demo.net:443?security=reality&sni=cdn.eaglet-demo.net&fp=chrome&pbk=demo&sid=ab12&type=tcp&flow=xtls-rprx-vision#Frankfurt%20Edge',
        'vless://22222222-2222-4222-8222-222222222222@ams.eaglet-demo.net:443?security=tls&sni=ams.eaglet-demo.net&type=ws&path=%2Fws#Amsterdam%20Core',
        'trojan://demo-password@tyo.eaglet-demo.net:443?security=tls&sni=tyo.eaglet-demo.net#Tokyo%20Relay',
        'hysteria2://demo-password@nyc.eaglet-demo.net:443?sni=nyc.eaglet-demo.net#New%20York%20Fast',
        'ss://YWVzLTI1Ni1nY206ZGVtby1wYXNzd29yZA==@sgp.eaglet-demo.net:8388#Singapore%20Lite'
      ]
  for (const link of links) {
    const [profile] = parseProfilesPayload(link)
    if (profile) store.addProfiles([{ ...profile, sourceId: SHOT_SOURCE }])
  }
  engine.reconcileProfiles()
  const direct = store.getProfiles().find((profile) => profile.protocol === 'direct')
  if (direct) engine.setProfile(direct.id)
  await engine.testProfiles()
}

function clearShotProfiles(): void {
  for (const profile of store.getProfiles().filter((item) => item.sourceId === SHOT_SOURCE)) {
    store.removeProfile(profile.id)
  }
  engine.reconcileProfiles()
}

async function scheduleShots(win: BrowserWindow): Promise<void> {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const dir = process.env['EAGLET_SHOT_DIR'] ?? join(process.cwd(), 'screenshots')
  mkdirSync(dir, { recursive: true })

  win.webContents.once('did-finish-load', async () => {
    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    await wait(1200)
    await seedShotProfiles()
    const freeOnly = process.env['EAGLET_SHOT_ONLY'] === 'free'

    if (!freeOnly) {
      const themes = ['cyber', 'glass', 'minimal', 'hud', 'neon', 'aurora']
      for (const theme of themes) {
        await win.webContents.executeJavaScript(`window.__eagletSetTheme && window.__eagletSetTheme('${theme}')`)
        await wait(900)
        const image = await win.webContents.capturePage()
        writeFileSync(join(dir, `theme-${theme}.png`), image.toPNG())
      }

      await win.webContents.executeJavaScript(`window.__eagletSetTheme && window.__eagletSetTheme('cyber')`)
      await win.webContents.executeJavaScript(`window.eaglet.connect()`)
      await wait(22000)
      for (const page of ['home', 'servers', 'routing', 'stats', 'settings']) {
        await win.webContents.executeJavaScript(`window.__eagletSetPage && window.__eagletSetPage('${page}')`)
        await wait(900)
        const image = await win.webContents.capturePage()
        writeFileSync(join(dir, page === 'home' ? 'connected.png' : `page-${page}.png`), image.toPNG())
      }
    }

    if (process.env['EAGLET_SHOT_FREE'] === '1' || freeOnly) {
      await win.webContents.executeJavaScript(`window.__eagletSetPage && window.__eagletSetPage('servers')`)
      await wait(700)
      const clicked = await win.webContents.executeJavaScript(`
        (() => {
          const button = [...document.querySelectorAll('button')].find((item) =>
            /Find free servers/i.test(item.textContent || '')
          )
          if (!button) return false
          button.click()
          return true
        })()
      `)
      if (clicked) {
        const started = Date.now()
        for (;;) {
          const ready = await win.webContents.executeJavaScript(
            `Boolean(document.querySelector('.free-list, .free-empty'))`
          )
          if (ready || Date.now() - started > 150000) break
          await wait(1000)
        }
        await wait(800)
        const freeShot = await win.webContents.capturePage()
        writeFileSync(join(dir, 'servers-free.png'), freeShot.toPNG())
      }
    }

    if (!freeOnly) {
      await win.webContents.executeJavaScript(`window.__eagletSetPage && window.__eagletSetPage('home')`)
      await win.webContents.executeJavaScript(`window.eaglet.updateSettings({ mini: true })`)
      await wait(1400)
      const mini = await win.webContents.capturePage()
      writeFileSync(join(dir, 'mini.png'), mini.toPNG())
      await win.webContents.executeJavaScript(`window.eaglet.updateSettings({ mini: false })`)
    }

    console.log('[shots] done')
    await engine.shutdown()
    clearShotProfiles()
    app.exit(0)
  })
}
