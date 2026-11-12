import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import jsQR from 'jsqr'
import { Store } from './store'
import { VpnEngine } from './vpn/engine'
import { runEngineTest } from './vpn/engine-test'
import { isHttpUrl, parseProfileUri, parseProfilesPayload, subscriptionName } from './vpn/profiles'
import { discoverFreeProfiles } from './vpn/free-sources'
import { normalizeScenario } from './vpn/scenarios'
import type {
  BackupPayload,
  EngineChoice,
  EngineId,
  ImportResult,
  Profile,
  ProfileEvent,
  QrImportResult,
  Scenario,
  Settings,
  Snapshot,
  Subscription,
  VpnState
} from '@shared/types'

const isDev = !app.isPackaged
const isShotMode = process.argv.includes('--eaglet-shots')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let store: Store
let engine: VpnEngine
let normalBounds: Electron.Rectangle | null = null
let quitting = false
let subscriptionTimer: NodeJS.Timeout | null = null
let trayRefreshTimer: NodeJS.Timeout | null = null

function snapshot(): Snapshot {
  return {
    state: engine.getState(),
    settings: store.getSettings(),
    profiles: store.getProfiles(),
    subscriptions: store.getSubscriptions(),
    sessions: store.getSessions(),
    scenarios: engine.getScenarios(),
    profileHistory: store.getProfileHistory(),
    engineHistory: store.getEngineHistory(),
    platform: process.platform,
    version: app.getVersion()
  }
}

function logProfileEvent(kind: ProfileEvent['kind'], message: string): void {
  store.addProfileEvent({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), kind, message })
}

function broadcast(): void {
  const data = snapshot()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('app:state', data)
  }
}

function iconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'resources', 'icon.png')
}

function appIcon(): Electron.NativeImage {
  const path = iconPath()
  return existsSync(path) ? nativeImage.createFromPath(path) : nativeImage.createEmpty()
}

function createWindow(): void {
  const icon = appIcon()
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    frame: false,
    backgroundColor: '#04060d',
    title: 'Eaglet',
    ...(icon.isEmpty() ? {} : { icon }),
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

  mainWindow.on('close', (event) => {
    if (!quitting && !isShotMode && store?.getSettings().closeToTray) {
      event.preventDefault()
      mainWindow?.hide()
      ensureTray()
    }
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
  logProfileEvent('subscription', `Subscription ${subscription.name} imported · ${profiles.length} nodes`)
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
  logProfileEvent('import', `Imported ${profiles.length} node(s) from a share link`)
  broadcast()
  return { imported: added, updated, subscription: null, profiles: store.getProfiles() }
}

async function importAnything(input: string): Promise<ImportResult> {
  const text = input.trim()
  if (!text) throw new Error('Paste a share link, a subscription URL or a base64 list')
  if (isHttpUrl(text)) return importFromUrl(text)
  return importFromText(text)
}

/** Refreshes one HTTP subscription and removes nodes the provider dropped. */
async function updateSubscriptionById(id: string): Promise<ImportResult> {
  const subscription = store.getSubscriptions().find((item) => item.id === id)
  if (!subscription) throw new Error('Subscription not found')
  const text = await fetchSubscription(subscription.url)
  const profiles = parseProfilesPayload(text)
  if (profiles.length === 0) throw new Error('Subscription returned no supported nodes')
  const incoming: Profile[] = profiles.map((profile) => ({ ...profile, sourceId: id }))
  const incomingIds = new Set(incoming.map((profile) => profile.id))
  for (const old of store.getProfiles().filter((profile) => profile.sourceId === id)) {
    if (!incomingIds.has(old.id)) store.removeProfile(old.id)
  }
  const { added, updated } = store.addProfiles(incoming)
  const refreshed: Subscription = { ...subscription, updatedAt: Date.now(), count: incoming.length }
  store.upsertSubscription(refreshed)
  engine.reconcileProfiles()
  engine.pushExternalLog('success', `Subscription refreshed · ${incoming.length} nodes · ${subscription.name}`)
  logProfileEvent('subscription', `Subscription ${subscription.name} refreshed · ${incoming.length} nodes`)
  broadcast()
  return { imported: added, updated, subscription: refreshed, profiles: store.getProfiles() }
}

async function updateAllSubscriptions(onlyDue = false): Promise<ImportResult[]> {
  const settings = store.getSettings()
  const interval = Math.max(1, settings.subscriptionIntervalHours) * 60 * 60 * 1000
  const targets = store
    .getSubscriptions()
    .filter((subscription) => !subscription.url.startsWith('eaglet://'))
    .filter((subscription) => !onlyDue || Date.now() - subscription.updatedAt > interval)
  const results: ImportResult[] = []
  for (const subscription of targets) {
    try {
      results.push(await updateSubscriptionById(subscription.id))
    } catch (error) {
      engine.pushExternalLog('warn', `Auto-update failed · ${subscription.name}: ${(error as Error).message}`)
    }
  }
  if (results.length > 0) broadcast()
  return results
}

function scheduleSubscriptionUpdates(): void {
  if (subscriptionTimer) clearInterval(subscriptionTimer)
  subscriptionTimer = null
  const settings = store.getSettings()
  if (!settings.autoUpdateSubscriptions) return
  const hours = Math.max(1, settings.subscriptionIntervalHours)
  subscriptionTimer = setInterval(() => void updateAllSubscriptions(true), hours * 60 * 60 * 1000)
  // Catch up shortly after launch instead of waiting a whole interval.
  setTimeout(() => void updateAllSubscriptions(true), 20000)
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
  logProfileEvent('import', `Added ${added} free node(s) from public catalogs`)
  broadcast()
  return { imported: added, updated, subscription, profiles: store.getProfiles() }
}

/* ------------------------------------------------------------------ */
/*  QR import                                                         */
/* ------------------------------------------------------------------ */

/**
 * Decodes a QR code from an image file. Electron exposes the bitmap as BGRA,
 * so both channel orders are tried — jsQR only understands RGBA.
 */
function decodeQr(file: string): string {
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) throw new Error('That image could not be read')
  const { width, height } = image.getSize()
  if (width <= 0 || height <= 0) throw new Error('That image has no pixels')
  const raw = image.toBitmap()
  const direct = new Uint8ClampedArray(width * height * 4)
  const swapped = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index + 3 < raw.length; index += 4) {
    direct[index] = raw[index]
    direct[index + 1] = raw[index + 1]
    direct[index + 2] = raw[index + 2]
    direct[index + 3] = raw[index + 3]
    swapped[index] = raw[index + 2]
    swapped[index + 1] = raw[index + 1]
    swapped[index + 2] = raw[index]
    swapped[index + 3] = raw[index + 3]
  }
  const code = jsQR(direct, width, height) ?? jsQR(swapped, width, height)
  if (!code?.data) throw new Error('No QR code was found in that image')
  return code.data
}

/* ------------------------------------------------------------------ */
/*  Tray                                                              */
/* ------------------------------------------------------------------ */

function showWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (!mainWindow.isVisible()) mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function toggleFromTray(): void {
  const status = engine.getState().status
  if (status === 'connected' || status === 'connecting') {
    void engine.disconnect().then(() => broadcast())
  } else {
    void engine.connect().then(() => broadcast())
  }
}

function refreshTray(): void {
  if (!tray) return
  const state = engine.getState()
  const connected = state.status === 'connected'
  const favourites = store
    .getProfiles()
    .filter((profile) => profile.favorite && profile.protocol !== 'direct')
    .slice(0, 8)
  const menu = Menu.buildFromTemplate([
    { label: `Eaglet · ${connected ? 'connected' : state.status}`, enabled: false },
    {
      label: state.profile ? state.profile.name : 'No node selected',
      enabled: false
    },
    { type: 'separator' },
    {
      label: connected ? 'Disconnect' : 'Connect',
      click: () => toggleFromTray()
    },
    { type: 'separator' },
    ...favourites.map((profile) => ({
      label: profile.name,
      type: 'checkbox' as const,
      checked: state.profile?.id === profile.id,
      click: () => {
        engine.selectProfile(profile.id)
        broadcast()
      }
    })),
    ...(favourites.length > 0 ? [{ type: 'separator' as const }] : []),
    { label: 'Open Eaglet', click: () => showWindow() },
    {
      label: 'Quit',
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.setToolTip(
    state.profile ? `Eaglet · ${connected ? state.profile.name : state.status}` : `Eaglet · ${state.status}`
  )
}

function ensureTray(): void {
  if (tray || isShotMode) return
  const icon = appIcon()
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('Eaglet VPN')
  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.hide()
    else showWindow()
  })
  refreshTray()
  if (trayRefreshTimer) clearInterval(trayRefreshTimer)
  trayRefreshTimer = setInterval(() => refreshTray(), 5000)
}

function destroyTray(): void {
  if (trayRefreshTimer) clearInterval(trayRefreshTimer)
  trayRefreshTimer = null
  tray?.destroy()
  tray = null
}

/* ------------------------------------------------------------------ */
/*  Quick connect + notifications                                     */
/* ------------------------------------------------------------------ */

/** Refreshes a bounded sample of nodes and returns the fastest one. */
async function pickFastestProfile(): Promise<Profile> {
  const profiles = store.getProfiles().filter((profile) => profile.protocol !== 'direct' && profile.port > 0)
  if (profiles.length === 0) {
    throw new Error('No nodes yet — import a subscription or find free servers first')
  }

  // Favourites and nodes without a measurement are worth re-testing first.
  const ranked = [...profiles].sort((left, right) => {
    if (left.favorite !== right.favorite) return left.favorite ? -1 : 1
    if (left.ping === null && right.ping === null) return right.addedAt - left.addedAt
    if (left.ping === null) return -1
    if (right.ping === null) return 1
    return left.ping - right.ping
  })

  const sample = ranked.slice(0, 16)
  await engine.testProfiles(sample.map((profile) => profile.id))

  const measured = store
    .getProfiles()
    .filter((profile) => sample.some((item) => item.id === profile.id) && profile.ping !== null)
    .sort((left, right) => (left.ping ?? Infinity) - (right.ping ?? Infinity))

  return measured[0] ?? sample[0]
}

function notify(title: string, body: string): void {
  if (isShotMode || !Notification.isSupported()) return
  if (!store.getSettings().notifications) return
  try {
    new Notification({ title, body, silent: false }).show()
  } catch {
    // Notifications are best-effort.
  }
}

let lastNotifiedStatus = 'disconnected'
let lastNotifiedIpCheck = 0

/** Turns real state transitions into desktop notifications. */
function notifyState(state: VpnState): void {
  if (!store || isShotMode) return
  if (state.status !== lastNotifiedStatus) {
    if (state.status === 'connected') {
      notify(
        'Eaglet · Tunnel up',
        state.profile
          ? `${state.profile.name} · exit ${state.ip.exit?.ip ?? 'measuring…'}`
          : 'Encrypted tunnel established'
      )
    } else if (state.status === 'error') {
      notify('Eaglet · Tunnel dropped', state.error ?? 'The core stopped unexpectedly')
    } else if (state.status === 'disconnected' && lastNotifiedStatus === 'connected') {
      notify('Eaglet · Disconnected', 'Direct connection restored')
    }
    lastNotifiedStatus = state.status
  }

  if (state.ip.changed && state.ip.checkedAt && state.ip.checkedAt !== lastNotifiedIpCheck) {
    lastNotifiedIpCheck = state.ip.checkedAt
    notify('Eaglet · Exit IP changed', `${state.ip.direct?.ip ?? 'unknown'} → ${state.ip.exit?.ip ?? 'unknown'}`)
  }
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

  ipcMain.handle('vpn:quick-connect', async () => {
    if (engine.getState().status === 'connected' || engine.getState().status === 'connecting') {
      throw new Error('Disconnect before picking a new fastest node')
    }
    try {
      const fastest = await pickFastestProfile()
      engine.pushExternalLog(
        'info',
        `Quick connect · fastest node ${fastest.name}${fastest.ping !== null ? ` (${fastest.ping} ms)` : ''}`
      )
      await engine.connect(fastest.id)
      broadcast()
      return fastest
    } catch (error) {
      engine.pushExternalLog('error', (error as Error).message)
      broadcast()
      throw error
    }
  })

  ipcMain.handle('vpn:disconnect', async () => {
    await engine.disconnect()
    broadcast()
  })

  ipcMain.handle('vpn:select-profile', (_event, id: string) => {
    engine.selectProfile(id)
    broadcast()
  })

  ipcMain.handle('profiles:favorite', (_event, id: string, favorite: boolean) => {
    store.setFavorite(id, favorite)
    engine.pushExternalLog('info', favorite ? 'Pinned node to favourites' : 'Removed node from favourites')
    broadcast()
    return store.getProfiles()
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
    try {
      return await updateSubscriptionById(id)
    } catch (error) {
      engine.pushExternalLog('error', `Subscription refresh failed: ${(error as Error).message}`)
      broadcast()
      throw error
    }
  })

  ipcMain.handle('subscriptions:update-all', async () => {
    try {
      return await updateAllSubscriptions(false)
    } catch (error) {
      engine.pushExternalLog('error', `Subscription refresh failed: ${(error as Error).message}`)
      throw error
    }
  })

  ipcMain.handle('subscriptions:remove', (_event, id: string) => {
    const subscription = store.getSubscriptions().find((item) => item.id === id)
    store.removeProfilesBySource(id)
    store.removeSubscription(id)
    engine.reconcileProfiles()
    engine.pushExternalLog('info', 'Subscription removed')
    logProfileEvent('remove', `Subscription ${subscription?.name ?? id} removed`)
    broadcast()
  })

  ipcMain.handle('profiles:remove', (_event, id: string) => {
    const profile = store.getProfile(id)
    store.removeProfile(id)
    engine.reconcileProfiles()
    engine.pushExternalLog('info', 'Node removed')
    logProfileEvent('remove', `Node ${profile?.name ?? id} removed`)
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

  ipcMain.handle('speed:test', async () => {
    try {
      const result = await engine.runSpeedTest()
      broadcast()
      return result
    } catch (error) {
      engine.pushExternalLog('warn', `Speed test failed: ${(error as Error).message}`)
      broadcast()
      throw error
    }
  })

  ipcMain.handle('sessions:clear', () => {
    store.clearSessions()
    engine.pushExternalLog('info', 'Session history cleared')
    broadcast()
    return store.getSessions()
  })

  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(String(text ?? ''))
  })

  ipcMain.handle('clipboard:read', () => clipboard.readText())

  ipcMain.handle('core:refresh', async () => {
    const core = await engine.refreshCore()
    broadcast()
    return core
  })

  /* ---------------------------------------------------------------- */
  /*  Engines                                                          */
  /* ---------------------------------------------------------------- */

  ipcMain.handle('engines:refresh', async () => {
    const engines = await engine.refreshEngines(false)
    broadcast()
    return engines
  })

  ipcMain.handle('engines:check-updates', async () => {
    try {
      const engines = await engine.checkEngineUpdates()
      broadcast()
      return engines
    } catch (error) {
      engine.pushExternalLog('warn', `Engine update check failed: ${(error as Error).message}`)
      broadcast()
      throw error
    }
  })

  ipcMain.handle('engines:install', async (_event, id: EngineId) => {
    try {
      const engines = await engine.installEngine(id)
      broadcast()
      return engines
    } catch (error) {
      engine.pushExternalLog('error', `Engine install failed: ${(error as Error).message}`)
      broadcast()
      throw error
    }
  })

  ipcMain.handle('engines:remove', async (_event, id: EngineId) => {
    try {
      const engines = await engine.removeEngine(id)
      broadcast()
      return engines
    } catch (error) {
      engine.pushExternalLog('error', `Engine removal failed: ${(error as Error).message}`)
      broadcast()
      throw error
    }
  })

  ipcMain.handle('engines:set', (_event, choice: EngineChoice) => {
    const settings = engine.setEngine(choice)
    broadcast()
    return settings
  })

  ipcMain.handle('profiles:engine', (_event, profileId: string, id: EngineId | null) => {
    const profiles = engine.setProfileEngine(profileId, id)
    broadcast()
    return profiles
  })

  ipcMain.handle('engine-history:clear', () => {
    const history = engine.clearEngineHistory()
    broadcast()
    return history
  })

  /* ---------------------------------------------------------------- */
  /*  Scenarios + diagnostics                                          */
  /* ---------------------------------------------------------------- */

  ipcMain.handle('scenarios:apply', async (_event, id: string) => {
    try {
      await engine.applyScenario(id)
      scheduleSubscriptionUpdates()
      broadcast()
    } catch (error) {
      engine.pushExternalLog('error', `Scenario failed: ${(error as Error).message}`)
      broadcast()
      throw error
    }
  })

  ipcMain.handle('scenarios:save', (_event, input: Partial<Scenario>) => {
    try {
      const scenario = normalizeScenario(input)
      const scenarios = engine.saveScenario(scenario)
      broadcast()
      return scenarios
    } catch (error) {
      engine.pushExternalLog('error', `Scenario save failed: ${(error as Error).message}`)
      throw error
    }
  })

  ipcMain.handle('scenarios:remove', (_event, id: string) => {
    const scenarios = engine.removeScenario(id)
    broadcast()
    return scenarios
  })

  ipcMain.handle('diagnostics:run', async () => {
    const result = await engine.diagnose()
    broadcast()
    return result
  })

  /* ---------------------------------------------------------------- */
  /*  Backup, config export and QR import                              */
  /* ---------------------------------------------------------------- */

  ipcMain.handle('backup:export', async () => {
    const payload: BackupPayload = {
      format: 'eaglet-backup',
      version: 1,
      createdAt: Date.now(),
      settings: store.getSettings(),
      profiles: store.getProfiles(),
      subscriptions: store.getSubscriptions(),
      scenarios: store.getScenarios()
    }
    const result = await dialog.showSaveDialog({
      title: 'Export Eaglet backup',
      defaultPath: `eaglet-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8')
    engine.pushExternalLog('success', `Backup exported · ${payload.profiles.length} profiles`)
    broadcast()
    return result.filePath
  })

  ipcMain.handle('backup:import', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Eaglet backup',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const raw = JSON.parse(readFileSync(result.filePaths[0], 'utf-8')) as Partial<BackupPayload>
    if (raw.format !== 'eaglet-backup' || !raw.settings || !Array.isArray(raw.profiles)) {
      throw new Error('That file is not an Eaglet backup')
    }
    store.replaceAll({
      settings: raw.settings,
      profiles: raw.profiles,
      subscriptions: Array.isArray(raw.subscriptions) ? raw.subscriptions : [],
      scenarios: Array.isArray(raw.scenarios) ? raw.scenarios : []
    })
    engine.reconcileProfiles()
    scheduleSubscriptionUpdates()
    engine.pushExternalLog('success', `Backup imported · ${raw.profiles.length} profiles`)
    logProfileEvent('import', 'Configuration restored from a backup')
    broadcast()
    return snapshot()
  })

  ipcMain.handle('config:export', async () => {
    const exported = engine.buildExportConfig()
    const result = await dialog.showSaveDialog({
      title: `Export ${exported.engine} configuration`,
      defaultPath: `eaglet-${exported.engine}-config.${exported.extension}`,
      filters: [{ name: exported.extension.toUpperCase(), extensions: [exported.extension] }]
    })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, exported.content, 'utf-8')
    engine.pushExternalLog('success', `${exported.engine} configuration exported`)
    broadcast()
    return result.filePath
  })

  ipcMain.handle('profiles:qr', async (): Promise<QrImportResult> => {
    const result = await dialog.showOpenDialog({
      title: 'Import a QR code from an image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) throw new Error('No image selected')
    const text = decodeQr(result.filePaths[0])
    const imported = await importAnything(text)
    return { ...imported, codes: 1 }
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
    if (patch.autoUpdateSubscriptions !== undefined || patch.subscriptionIntervalHours !== undefined) {
      scheduleSubscriptionUpdates()
    }
    if (patch.tray !== undefined) {
      if (settings.tray) ensureTray()
      else destroyTray()
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

  engine.on('state', (state: VpnState) => {
    notifyState(state)
    broadcast()
  })

  if (process.argv.includes('--eaglet-engine-test')) {
    // Dev harness for the multi-engine batch. Electron hides stdout on Windows,
    // so the full report is written as JSON next to the project.
    const outFile = process.env.EAGLET_ENGINE_OUT ?? join(process.cwd(), 'engine-test.json')
    let report: Record<string, unknown> = {}
    try {
      report = await runEngineTest(store, engine)
    } catch (error) {
      report = { error: (error as Error).message }
    }
    writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8')
    await engine.shutdown()
    app.exit(0)
    return
  }

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

  if (process.argv.includes('--eaglet-feature-test')) {
    // Dev harness for the "quality of life" batch: favourites, bypass rules,
    // speed test, auto-reconnect after a real core crash, and session history.
    const outFile = process.env.EAGLET_FEATURE_OUT ?? join(process.cwd(), 'feature-test.json')
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
    const report: Record<string, unknown> = {}
    const originalSettings = store.getSettings()
    let addedDirectId: string | null = null
    try {
      await engine.init()
      await engine.ensureCore()
      report.core = engine.getState().core

      // 1. Favourites survive a round-trip through the store.
      let direct = store.getProfiles().find((profile) => profile.protocol === 'direct')
      if (!direct) {
        const [parsed] = parseProfilesPayload('direct://Feature%20test')
        if (!parsed) throw new Error('Could not create a direct profile')
        store.addProfiles([parsed])
        engine.reconcileProfiles()
        direct = store.getProfile(parsed.id) ?? undefined
        addedDirectId = parsed.id
      }
      if (!direct) throw new Error('Direct profile missing')

      store.setFavorite(direct.id, true)
      report.favoriteOn = store.getProfile(direct.id)?.favorite
      store.setFavorite(direct.id, false)
      report.favoriteOff = store.getProfile(direct.id)?.favorite

      // 2. Bypass rules end up in the generated config and must validate.
      store.updateSettings({
        bypassList: 'bank.example.com\napi.test.local\n10.0.0.0/8\n192.168.50.7',
        autoReconnect: true,
        systemProxy: true,
        notifications: false
      })
      report.bypassParsed = store.getSettings().bypassList.split(/\s+/).filter(Boolean).length
      report.notificationsStored = store.getSettings().notifications

      engine.setProfile(direct.id)
      await engine.connect()
      const connectDeadline = Date.now() + 60000
      while (engine.getState().status === 'connecting' && Date.now() < connectDeadline) await sleep(250)
      const state = engine.getState()
      report.connected = state.status
      report.exitIp = state.ip.exit?.ip ?? null
      report.changed = state.ip.changed

      const configPath = join(app.getPath('userData'), 'core', 'config.json')
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { route?: { rules?: unknown[] } }
      report.bypassRules = (config.route?.rules ?? []).filter(
        (rule) => (rule as { outbound?: string }).outbound === 'direct'
      )

      // 3. Real throughput test through the mixed inbound.
      if (state.status === 'connected') {
        try {
          report.speed = await engine.runSpeedTest()
        } catch (error) {
          report.speedError = (error as Error).message
        }
      }

      // 4. Kill the core for real and let auto-reconnect bring it back.
      if (engine.getState().status === 'connected') {
        report.autoReconnect = { killed: true }
        await new Promise<void>((resolve) => {
          execFile('taskkill.exe', ['/F', '/IM', 'sing-box.exe'], () => resolve())
        })
        const reconnectDeadline = Date.now() + 60000
        let sawError = false
        while (Date.now() < reconnectDeadline) {
          const current = engine.getState().status
          if (current === 'error') sawError = true
          if (sawError && current === 'connected') break
          if (current === 'error' && !store.getSettings().autoReconnect) break
          await sleep(300)
        }
        const after = engine.getState()
        report.autoReconnect = {
          killed: true,
          finalStatus: after.status,
          restored: sawError && after.status === 'connected',
          logs: after.logs
            .filter((entry) => /auto-reconnect|stopped unexpectedly/i.test(entry.message))
            .map((entry) => entry.message)
        }
      }

      // 5. Disconnect records a persistent session.
      if (engine.getState().status === 'connected') {
        await engine.disconnect()
        const disconnectDeadline = Date.now() + 30000
        while (engine.getState().status !== 'disconnected' && Date.now() < disconnectDeadline) await sleep(250)
      }
      const sessions = store.getSessions()
      report.sessions = sessions.length
      report.lastSession = sessions[0] ?? null
      report.proxyRestored = true
    } catch (error) {
      report.error = (error as Error).message
    }

    // Restore the user's settings, keeping the recorded sessions as evidence.
    try {
      store.updateSettings(originalSettings)
      if (addedDirectId) {
        store.removeProfile(addedDirectId)
        engine.reconcileProfiles()
      }
    } catch {
      // Best effort.
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
  if (settings.tray && !isShotMode) ensureTray()
  scheduleSubscriptionUpdates()

  if (settings.autoConnect && !isShotMode) {
    setTimeout(() => void engine.connect(), 900)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // With the tray icon enabled Eaglet keeps running in the background.
  if (process.platform !== 'darwin' && !store?.getSettings().tray) app.quit()
})

app.on('before-quit', (event) => {
  if (quitting || !engine) return
  quitting = true
  event.preventDefault()
  if (subscriptionTimer) clearInterval(subscriptionTimer)
  destroyTray()
  void engine.shutdown().finally(() => app.exit(0))
})

/* ------------------------------------------------------------------ */
/*  Screenshot harness (used by `npm run shots` to preview all themes) */
/* ------------------------------------------------------------------ */

const SHOT_SOURCE = '__shots__'

async function seedShotProfiles(): Promise<void> {
  const hasShotProfiles = store.getProfiles().some((profile) => profile.sourceId === SHOT_SOURCE)
  const links = hasShotProfiles
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
  const shotProfiles = store.getProfiles().filter((profile) => profile.sourceId === SHOT_SOURCE)
  const favourite = shotProfiles.find((profile) => profile.name.includes('Frankfurt'))
  if (favourite) store.setFavorite(favourite.id, true)
  const direct = shotProfiles.find((profile) => profile.protocol === 'direct')
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
    const beforeBypass = store.getSettings().bypassList

    if (!freeOnly) {
      // Show a populated bypass list and a clean, real session history.
      store.updateSettings({ bypassList: 'bank.example.com\n10.0.0.0/8\n192.168.50.7' })
      store.clearSessions()

      const themes = ['cyber', 'glass', 'minimal', 'hud', 'neon', 'aurora']
      for (const theme of themes) {
        await win.webContents.executeJavaScript(`window.__eagletSetTheme && window.__eagletSetTheme('${theme}')`)
        await wait(900)
        const image = await win.webContents.capturePage()
        writeFileSync(join(dir, `theme-${theme}.png`), image.toPNG())
      }

      // Two short real sessions give the history table believable data.
      for (let index = 0; index < 2; index += 1) {
        await win.webContents.executeJavaScript(`window.eaglet.connect()`)
        await wait(2600)
        await win.webContents.executeJavaScript(`window.eaglet.runSpeedTest().catch(() => null)`)
        await wait(1200)
        await win.webContents.executeJavaScript(`window.eaglet.disconnect()`)
        await wait(1600)
      }

      await win.webContents.executeJavaScript(`window.__eagletSetTheme && window.__eagletSetTheme('cyber')`)
      await win.webContents.executeJavaScript(`window.eaglet.connect()`)
      await wait(22000)
      for (const page of ['home', 'servers', 'scenarios', 'routing', 'stats', 'settings']) {
        await win.webContents.executeJavaScript(`window.__eagletSetPage && window.__eagletSetPage('${page}')`)
        await wait(900)
        if (page === 'stats') {
          // Click the real speed-test button so the card shows a measured value.
          const clicked = await win.webContents.executeJavaScript(`
            (() => {
              const button = [...document.querySelectorAll('button')].find((item) =>
                /Run speed test/i.test(item.textContent || '')
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
                `(() => { const value = document.querySelector('.speed-value'); return Boolean(value) && /^\\d/.test((value.textContent || '').trim()) })()`
              )
              if (ready || Date.now() - started > 45000) break
              await wait(500)
            }
            await wait(500)
          }
        }
        const image = await win.webContents.capturePage()
        writeFileSync(join(dir, page === 'home' ? 'connected.png' : `page-${page}.png`), image.toPNG())
        if (page === 'stats') {
          await win.webContents.executeJavaScript(
            `document.querySelector('.sessions') && document.querySelector('.sessions').scrollIntoView({ block: 'center' })`
          )
          await wait(600)
          const historyShot = await win.webContents.capturePage()
          writeFileSync(join(dir, 'page-stats-history.png'), historyShot.toPNG())
          await win.webContents.executeJavaScript(
            `document.querySelector('.content') && document.querySelector('.content').scrollTo(0, 0)`
          )
        }
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
    if (!freeOnly) store.updateSettings({ bypassList: beforeBypass })
    await engine.shutdown()
    clearShotProfiles()
    app.exit(0)
  })
}
