import { useCallback, useEffect, useState } from 'react'
import type { Settings, Snapshot, ThemeId } from '@shared/types'
import { ThemeBackdrop } from './components/ThemeBackdrop'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Home } from './pages/Home'
import { Servers } from './pages/Servers'
import { Routing } from './pages/Routing'
import { Stats } from './pages/Stats'
import { SettingsPage } from './pages/Settings'
import { MiniView } from './pages/MiniView'

export type PageId = 'home' | 'servers' | 'routing' | 'stats' | 'settings'

export default function App(): React.JSX.Element {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [page, setPage] = useState<PageId>('home')
  const [themeOverride, setThemeOverride] = useState<ThemeId | null>(null)

  useEffect(() => {
    window.eaglet.snapshot().then(setSnap)
    return window.eaglet.onState(setSnap)
  }, [])

  const theme: ThemeId = themeOverride ?? snap?.settings.theme ?? 'cyber'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    if (patch.theme) setThemeOverride(null)
    setSnap((prev) => (prev ? { ...prev, settings: { ...prev.settings, ...patch } } : prev))
    const settings = await window.eaglet.updateSettings(patch)
    setSnap((prev) => (prev ? { ...prev, settings } : prev))
  }, [])

  // Hooks used by the offscreen screenshot harness (npm run shots).
  useEffect(() => {
    window.__eagletSetTheme = (next: string) => setThemeOverride(next as ThemeId)
    window.__eagletSetPage = (next: string) => setPage(next as PageId)
    window.__eagletConnect = () => {
      window.eaglet.connect()
    }
    return () => {
      delete window.__eagletSetTheme
      delete window.__eagletSetPage
      delete window.__eagletConnect
    }
  }, [])

  if (!snap) {
    return (
      <div className="app">
        <ThemeBackdrop theme="cyber" />
        <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--muted)', fontSize: 12 }}>
          Starting Eaglet core…
        </div>
      </div>
    )
  }

  const { state, settings } = snap
  const busy = state.status === 'connecting' || state.status === 'disconnecting'

  const toggle = (): void => {
    if (busy) {
      window.eaglet.disconnect()
      return
    }
    if (state.status === 'connected') window.eaglet.disconnect()
    else window.eaglet.connect()
  }

  const connectTo = (serverId: string): void => {
    window.eaglet.connect(serverId)
  }

  const selectServer = (serverId: string): void => {
    window.eaglet.selectServer(serverId)
  }

  const disconnect = (): void => {
    window.eaglet.disconnect()
  }

  if (settings.mini) {
    return (
      <div className="app is-mini">
        <ThemeBackdrop theme={theme} />
        <TitleBar
          status={state.status}
          protocol={settings.protocol}
          mini
          onMini={(mini) => updateSettings({ mini })}
        />
        <MiniView
          snap={snap}
          onToggle={toggle}
          onManageServers={() => updateSettings({ mini: false })}
          onExpand={() => updateSettings({ mini: false })}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <ThemeBackdrop theme={theme} />
      <TitleBar
        status={state.status}
        protocol={settings.protocol}
        mini={false}
        onMini={(mini) => updateSettings({ mini })}
      />

      <div className="shell">
        <Sidebar
          page={page}
          onNavigate={setPage}
          protocol={settings.protocol}
          serverCount={snap.servers.length}
          version={snap.version}
        />

        <main className="content">
          {page === 'home' && <Home snap={snap} onToggle={toggle} onManageServers={() => setPage('servers')} />}
          {page === 'servers' && (
            <Servers snap={snap} onConnect={connectTo} onSelect={selectServer} onDisconnect={disconnect} />
          )}
          {page === 'routing' && <Routing settings={settings} onUpdate={updateSettings} />}
          {page === 'stats' && <Stats snap={snap} />}
          {page === 'settings' && <SettingsPage settings={settings} version={snap.version} onUpdate={updateSettings} />}
        </main>
      </div>
    </div>
  )
}
