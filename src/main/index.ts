import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Store } from './store'
import { VpnEngine } from './vpn/engine'
import { isHttpUrl, parseProfilesPayload, subscriptionName } from './vpn/profiles'
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

    await win.webContents.executeJavaScript(`window.__eagletSetPage && window.__eagletSetPage('home')`)
    await win.webContents.executeJavaScript(`window.eaglet.updateSettings({ mini: true })`)
    await wait(1400)
    const mini = await win.webContents.capturePage()
    writeFileSync(join(dir, 'mini.png'), mini.toPNG())
    await win.webContents.executeJavaScript(`window.eaglet.updateSettings({ mini: false })`)

    console.log('[shots] done')
    await engine.shutdown()
    clearShotProfiles()
    app.exit(0)
  })
}
