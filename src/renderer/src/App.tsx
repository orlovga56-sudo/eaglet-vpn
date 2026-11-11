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
    void window.eaglet.snapshot().then(setSnap)
    return window.eaglet.onState(setSnap)
  }, [])

  const theme: ThemeId = themeOverride ?? snap?.settings.theme ?? 'cyber'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    if (patch.theme) setThemeOverride(null)
    setSnap((prev) => (prev ? { ...prev, settings: { ...prev.settings, ...patch } } : prev))
    try {
      const settings = await window.eaglet.updateSettings(patch)
      setSnap((prev) => (prev ? { ...prev, settings } : prev))
    } catch {
      // The next broadcast restores the authoritative settings.
    }
  }, [])

  // Hooks used by the offscreen screenshot harness (npm run shots).
  useEffect(() => {
    window.__eagletSetTheme = (next: string) => setThemeOverride(next as ThemeId)
    window.__eagletSetPage = (next: string) => setPage(next as PageId)
    window.__eagletConnect = () => {
      void window.eaglet.connect()
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
        <div className="boot">
          <span className="boot-ring" />
          <span>Starting Eaglet core…</span>
        </div>
      </div>
    )
  }

  const { state, settings } = snap
  const busy = state.status === 'connecting' || state.status === 'disconnecting'
  const protocol = state.profile?.protocol.toUpperCase() ?? 'NO PROFILE'

  const toggle = (): void => {
    if (busy) return
    if (state.status === 'connected') void window.eaglet.disconnect()
    else void window.eaglet.connect()
  }

  const connectTo = (profileId: string): void => {
    void window.eaglet.connect(profileId)
  }

  const selectProfile = (profileId: string): void => {
    void window.eaglet.selectProfile(profileId)
  }

  const disconnect = (): void => {
    void window.eaglet.disconnect()
  }

  if (settings.mini) {
    return (
      <div className="app is-mini">
        <ThemeBackdrop theme={theme} />
        <TitleBar status={state.status} protocol={protocol} mini onMini={(mini) => updateSettings({ mini })} />
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
      <TitleBar status={state.status} protocol={protocol} mini={false} onMini={(mini) => updateSettings({ mini })} />

      <div className="shell">
        <Sidebar
          page={page}
          onNavigate={setPage}
          profileCount={snap.profiles.length}
          subscriptions={snap.subscriptions.length}
          coreVersion={state.core.version}
          systemProxy={settings.systemProxy}
          version={snap.version}
        />

        <main className="content">
          {page === 'home' && (
            <Home snap={snap} onToggle={toggle} onManageServers={() => setPage('servers')} />
          )}
          {page === 'servers' && (
            <Servers snap={snap} onConnect={connectTo} onSelect={selectProfile} onDisconnect={disconnect} />
          )}
          {page === 'routing' && <Routing snap={snap} onUpdate={updateSettings} />}
          {page === 'stats' && <Stats snap={snap} />}
          {page === 'settings' && <SettingsPage snap={snap} onUpdate={updateSettings} />}
        </main>
      </div>
    </div>
  )
}
