import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { Store } from './store'
import { VpnEngine } from './vpn/engine'
import { SERVERS, DEFAULT_SERVER_ID } from './vpn/servers'
import type { Settings, Snapshot } from '@shared/types'

const isDev = !app.isPackaged
const isShotMode = process.argv.includes('--eaglet-shots')

let mainWindow: BrowserWindow | null = null
let store: Store
let engine: VpnEngine
let normalBounds: Electron.Rectangle | null = null

function snapshot(): Snapshot {
  return {
    state: engine.getState(),
    settings: store.get(),
    servers: SERVERS,
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
    store.update({ mini: true })
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
    store.update({ mini: false })
  }
}

function applyLoginItem(enabled: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
  } catch {
    // Unsupported on some platforms — ignore.
  }
}

function registerIpc(): void {
  ipcMain.handle('app:snapshot', () => snapshot())

  ipcMain.handle('vpn:connect', async (_event, serverId?: string) => {
    await engine.connect(serverId)
    store.update({ activeServerId: engine.getServerId() })
    broadcast()
  })

  ipcMain.handle('vpn:disconnect', async () => {
    await engine.disconnect()
    broadcast()
  })

  ipcMain.handle('vpn:select-server', (_event, serverId: string) => {
    engine.selectServer(serverId)
    store.update({ activeServerId: serverId })
    broadcast()
  })

  ipcMain.handle('settings:update', (_event, patch: Partial<Settings>) => {
    const settings = store.update(patch)
    if (patch.mini !== undefined && mainWindow) setMini(mainWindow, patch.mini)
    if (patch.launchAtStartup !== undefined) applyLoginItem(patch.launchAtStartup)
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

app.whenReady().then(() => {
  store = new Store()
  const settings = store.get()
  const serverId = SERVERS.some((s) => s.id === settings.activeServerId)
    ? settings.activeServerId
    : DEFAULT_SERVER_ID
  engine = new VpnEngine(serverId)

  engine.on('state', () => {
    broadcast()
  })

  registerIpc()
  applyLoginItem(settings.launchAtStartup)
  createWindow()

  if (settings.autoConnect && !isShotMode) {
    setTimeout(() => engine.connect(), 900)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/* ------------------------------------------------------------------ */
/*  Screenshot harness (used by `npm run shots` to preview all themes) */
/* ------------------------------------------------------------------ */

async function scheduleShots(win: BrowserWindow): Promise<void> {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const dir = process.env['EAGLET_SHOT_DIR'] ?? join(process.cwd(), 'screenshots')
  mkdirSync(dir, { recursive: true })

  win.webContents.once('did-finish-load', async () => {
    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    await wait(1400)
    const themes = ['cyber', 'glass', 'minimal', 'hud', 'neon', 'aurora']
    for (const theme of themes) {
      await win.webContents.executeJavaScript(`window.__eagletSetTheme && window.__eagletSetTheme('${theme}')`)
      await wait(1100)
      const applied = await win.webContents.executeJavaScript(
        `[document.documentElement.dataset.theme, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()].join(' | ')`
      )
      console.log(`[shots] ${theme} → ${applied}`)
      const image = await win.webContents.capturePage()
      writeFileSync(join(dir, `theme-${theme}.png`), image.toPNG())
    }
    await win.webContents.executeJavaScript(`window.__eagletSetTheme && window.__eagletSetTheme('cyber')`)
    await win.webContents.executeJavaScript(`window.__eagletConnect && window.__eagletConnect()`)
    await wait(9000)
    const connected = await win.webContents.capturePage()
    writeFileSync(join(dir, 'connected.png'), connected.toPNG())

    for (const page of ['servers', 'routing', 'stats', 'settings']) {
      await win.webContents.executeJavaScript(`window.__eagletSetPage && window.__eagletSetPage('${page}')`)
      await wait(900)
      const image = await win.webContents.capturePage()
      writeFileSync(join(dir, `page-${page}.png`), image.toPNG())
    }

    await win.webContents.executeJavaScript(`window.__eagletSetPage && window.__eagletSetPage('home')`)
    await win.webContents.executeJavaScript(`window.eaglet.updateSettings({ mini: true })`)
    await wait(1400)
    const mini = await win.webContents.capturePage()
    writeFileSync(join(dir, 'mini.png'), mini.toPNG())
    await win.webContents.executeJavaScript(`window.eaglet.updateSettings({ mini: false })`)

    console.log('[shots] done')
    app.exit(0)
  })
}
