import { useState } from 'react'
import type { DnsMode, EngineChoice, EngineId, Settings, Snapshot, ThemeId } from '@shared/types'
import { CheckIcon, GlobeIcon, LogoIcon, PowerIcon, ServerIcon, ShieldIcon } from '../components/Icons'
import { Toggle } from '../components/Toggle'

interface Props {
  snap: Snapshot
  onUpdate: (patch: Partial<Settings>) => void
}

interface ThemeMeta {
  id: ThemeId
  name: string
  sub: string
  background: string
  window: string
  accent: string
}

const THEMES: ThemeMeta[] = [
  {
    id: 'cyber',
    name: 'Electric Cyber',
    sub: 'Electric blue on deep space',
    background:
      'radial-gradient(120% 95% at 50% -20%, rgba(34,211,238,.55), transparent 62%), radial-gradient(80% 60% at 88% 110%, rgba(59,130,246,.5), transparent 62%), #04101f',
    window: 'rgba(9,22,40,.72)',
    accent: '#22d3ee'
  },
  {
    id: 'glass',
    name: 'Glassmorphism',
    sub: 'Frosted layers, violet light',
    background:
      'radial-gradient(circle at 22% 18%, #6d4fe0, transparent 55%), radial-gradient(circle at 82% 24%, #9b7bf5, transparent 52%), radial-gradient(circle at 60% 100%, #2563eb, transparent 58%), #1a1333',
    window: 'rgba(255,255,255,.14)',
    accent: '#c7c8ff'
  },
  {
    id: 'minimal',
    name: 'Minimal Dark',
    sub: 'Quiet, typographic, precise',
    background: 'radial-gradient(100% 70% at 50% -10%, rgba(255,255,255,.05), transparent 60%), #0a0a0c',
    window: '#121216',
    accent: '#3b82f6'
  },
  {
    id: 'hud',
    name: 'HUD / Scifi',
    sub: 'Telemetry green on black',
    background:
      'linear-gradient(rgba(45,212,191,.16) 1px, transparent 1px) 0 0/16px 16px, linear-gradient(90deg, rgba(45,212,191,.16) 1px, transparent 1px) 0 0/16px 16px, radial-gradient(80% 60% at 50% 0%, rgba(45,212,191,.28), transparent 65%), #041716',
    window: 'rgba(4,30,30,.72)',
    accent: '#2dd4bf'
  },
  {
    id: 'neon',
    name: 'Neon Purple',
    sub: 'Violet bloom after dark',
    background:
      'radial-gradient(80% 70% at 20% 0%, rgba(168,85,247,.5), transparent 60%), radial-gradient(70% 60% at 90% 20%, rgba(217,70,239,.34), transparent 62%), #08020f',
    window: 'rgba(30,9,52,.72)',
    accent: '#c084fc'
  },
  {
    id: 'aurora',
    name: 'Nature Aurora',
    sub: 'Northern lights over teal',
    background:
      'radial-gradient(80% 60% at 18% -6%, rgba(53,224,184,.5), transparent 58%), radial-gradient(70% 50% at 80% 6%, rgba(96,165,250,.4), transparent 60%), #04121a',
    window: 'rgba(7,32,40,.72)',
    accent: '#35e0b8'
  }
]

export function SettingsPage({ snap, onUpdate }: Props): React.JSX.Element {
  const { settings, state, version } = snap
  const [refreshing, setRefreshing] = useState(false)
  const [engineBusy, setEngineBusy] = useState<EngineId | 'check' | null>(null)
  const [engineMessage, setEngineMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const refreshCore = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await window.eaglet.refreshEngines()
    } finally {
      setRefreshing(false)
    }
  }

  const engineAction = async (id: EngineId): Promise<void> => {
    setEngineBusy(id)
    setEngineMessage(null)
    try {
      const engine = state.engines.find((item) => item.id === id)
      if (engine?.installed) await window.eaglet.removeEngine(id)
      else await window.eaglet.installEngine(id)
      setEngineMessage({ tone: 'ok', text: engine?.installed ? 'Engine removed' : 'Engine installed' })
    } catch (error) {
      setEngineMessage({
        tone: 'err',
        text: (error as Error).message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
      })
    } finally {
      setEngineBusy(null)
    }
  }

  const checkUpdates = async (): Promise<void> => {
    setEngineBusy('check')
    setEngineMessage(null)
    try {
      const engines = await window.eaglet.checkEngineUpdates()
      const updates = engines.filter((engine) => engine.updateAvailable)
      setEngineMessage({
        tone: 'ok',
        text:
          updates.length > 0
            ? `Updates available: ${updates.map((engine) => `${engine.name} ${engine.latestVersion}`).join(', ')}`
            : 'All installed engines are up to date'
      })
    } catch (error) {
      setEngineMessage({ tone: 'err', text: (error as Error).message })
    } finally {
      setEngineBusy(null)
    }
  }

  const setEngine = async (choice: EngineChoice): Promise<void> => {
    try {
      const updated = await window.eaglet.setEngine(choice)
      onUpdate(updated)
    } catch (error) {
      setEngineMessage({ tone: 'err', text: (error as Error).message })
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Preferences</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Six interface styles ship with Eaglet. Pick the one that fits your desk.</p>
        </div>
      </header>

      <div className="theme-grid">
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            className={`theme-card panel ${settings.theme === theme.id ? 'active' : ''}`}
            onClick={() => onUpdate({ theme: theme.id })}
          >
            <div className="theme-preview" style={{ background: theme.background }}>
              <div
                className="tp-window"
                style={{ background: theme.window, color: theme.accent, backdropFilter: 'blur(4px)' }}
              >
                <span
                  className="tp-ring"
                  style={{ boxShadow: `0 0 12px ${theme.accent}66`, background: `${theme.accent}14` }}
                >
                  <PowerIcon />
                </span>
              </div>
            </div>
            <div className="theme-card-name">
              {theme.name}
              <CheckIcon />
            </div>
            <div className="theme-card-sub">{theme.sub}</div>
          </button>
        ))}
      </div>

      <div className="section-title">Connection</div>
      <div className="settings-cols">
        <div className="rows panel">
          <div className="row">
            <span className="row-main">
              <strong>System proxy</strong>
              <span>Point WinINet apps at the local mixed inbound while the tunnel is up.</span>
            </span>
            <Toggle
              checked={settings.systemProxy}
              label="System proxy"
              onChange={(value) => onUpdate({ systemProxy: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>TUN mode</strong>
              <span>Capture every process through a virtual adapter. Needs admin and a reconnect.</span>
            </span>
            <Toggle checked={settings.tunMode} label="TUN mode" onChange={(value) => onUpdate({ tunMode: value })} />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>Kill switch</strong>
              <span>Keep the tunnel-only policy after an unexpected drop.</span>
            </span>
            <Toggle
              checked={settings.killSwitch}
              label="Kill switch"
              onChange={(value) => onUpdate({ killSwitch: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>Network protection</strong>
              <span>Master switch: arms the kill switch and the local DNS guard together.</span>
            </span>
            <Toggle
              checked={settings.networkProtection}
              label="Network protection"
              onChange={(value) => onUpdate({ networkProtection: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>DNS protection</strong>
              <span>Run a real DoH relay on 127.0.0.1 and point the system resolver at it.</span>
            </span>
            <Toggle
              checked={settings.dnsProtection}
              label="DNS protection"
              onChange={(value) => onUpdate({ dnsProtection: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>IPv6</strong>
              <span>Off rejects IPv6 inside the tunnel so leaks cannot bypass the core.</span>
            </span>
            <Toggle checked={settings.ipv6} label="IPv6" onChange={(value) => onUpdate({ ipv6: value })} />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>Auto-reconnect</strong>
              <span>If the core drops, retry up to three times with a growing delay.</span>
            </span>
            <Toggle
              checked={settings.autoReconnect}
              label="Auto-reconnect"
              onChange={(value) => onUpdate({ autoReconnect: value })}
            />
          </div>
        </div>

        <div className="rows panel">
          <div className="row">
            <span className="row-main">
              <strong>Auto-connect on launch</strong>
              <span>Bring the tunnel up as soon as Eaglet starts.</span>
            </span>
            <Toggle
              checked={settings.autoConnect}
              label="Auto-connect"
              onChange={(value) => onUpdate({ autoConnect: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>Launch at startup</strong>
              <span>Start Eaglet automatically when the computer boots.</span>
            </span>
            <Toggle
              checked={settings.launchAtStartup}
              label="Launch at startup"
              onChange={(value) => onUpdate({ launchAtStartup: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>Compact mode</strong>
              <span>Shrink Eaglet to an always-on-top mini window.</span>
            </span>
            <Toggle checked={settings.mini} label="Compact mode" onChange={(value) => onUpdate({ mini: value })} />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>Desktop notifications</strong>
              <span>Notify on connect, disconnect, drops and exit-IP changes.</span>
            </span>
            <Toggle
              checked={settings.notifications}
              label="Notifications"
              onChange={(value) => onUpdate({ notifications: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>Keep in tray</strong>
              <span>Keep Eaglet and the tunnel running from the system tray.</span>
            </span>
            <Toggle checked={settings.tray} label="System tray" onChange={(value) => onUpdate({ tray: value })} />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>Close to tray</strong>
              <span>The window hides instead of quitting when you press close.</span>
            </span>
            <Toggle
              checked={settings.closeToTray}
              label="Close to tray"
              onChange={(value) => onUpdate({ closeToTray: value })}
            />
          </div>
        </div>
      </div>

      <div className="section-title">DNS</div>
      <div className="rows panel">
        <div className="row">
          <span className="row-icon">
            <GlobeIcon />
          </span>
          <span className="row-main">
            <strong>Resolver</strong>
            <span>Pinned resolvers are queried inside the tunnel.</span>
          </span>
          <select value={settings.dns} onChange={(event) => onUpdate({ dns: event.target.value as DnsMode })}>
            <option value="auto">Automatic (core)</option>
            <option value="cloudflare">Cloudflare · 1.1.1.1</option>
            <option value="google">Google · 8.8.8.8</option>
            <option value="custom">Custom…</option>
          </select>
        </div>
        {settings.dns === 'custom' && (
          <div className="row">
            <span className="row-icon">
              <GlobeIcon />
            </span>
            <span className="row-main">
              <strong>Custom resolver</strong>
              <span>DoH endpoint used for tunnelled queries.</span>
            </span>
            <input
              value={settings.customDns}
              placeholder="https://…/dns-query"
              onChange={(event) => onUpdate({ customDns: event.target.value })}
            />
          </div>
        )}
      </div>

      <div className="section-title">Tunnel engines</div>
      <div className="rows panel engine-choice">
        <div className="row">
          <span className="row-icon">
            <ServerIcon />
          </span>
          <span className="row-main">
            <strong>Global engine</strong>
            <span>
              Auto prefers an installed core that supports the profile protocol and TUN when it is enabled. Profiles can
              override this choice individually.
            </span>
          </span>
          <select value={settings.engine} onChange={(event) => void setEngine(event.target.value as EngineChoice)}>
            <option value="auto">Auto · best installed</option>
            <option value="sing-box">sing-box</option>
            <option value="xray">Xray-core</option>
            <option value="mihomo">Mihomo</option>
          </select>
        </div>
      </div>

      <div className="engine-grid">
        {state.engines.map((engine) => (
          <div
            className={`engine-card panel ${engine.id === state.engine ? 'is-active' : ''} ${
              engine.installed ? '' : 'is-missing'
            }`}
            key={engine.id}
          >
            <div className="engine-card-head">
              <span className="engine-icon">
                <ServerIcon />
              </span>
              <div>
                <strong>{engine.name}</strong>
                <span>{engine.installed ? engine.version ? `v${engine.version}` : 'Installed' : 'Not installed'}</span>
              </div>
              <span className={`status-pill ${engine.installed ? 'ok' : 'warn'}`}>
                {engine.running ? 'Running' : engine.installed ? 'Ready' : 'Missing'}
              </span>
            </div>
            <div className="engine-tags">
              <span>{engine.supportsTun ? 'TUN' : 'No TUN'}</span>
              <span>{engine.telemetry ? 'Live counters' : 'Basic counters'}</span>
              <span>{engine.protocols.length} protocols</span>
              <span className={`platform-${engine.platformSupport}`}>{engine.platformSupport}</span>
            </div>
            <div className="engine-path mono-path">{engine.path ?? 'Eaglet downloads it on first use'}</div>
            {engine.updateAvailable && (
              <div className="engine-update">Update available · {engine.latestVersion}</div>
            )}
            <div className="engine-card-actions">
              <button
                className="btn small"
                onClick={() => void engineAction(engine.id)}
                disabled={engineBusy !== null || (engine.removable === false && engine.installed)}
              >
                {engineBusy === engine.id ? 'Working…' : engine.installed ? (engine.removable ? 'Remove' : 'Bundled') : 'Install'}
              </button>
              {engine.id === state.engine && <span className="engine-current">Active engine</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="engine-toolbar">
        <button className="btn small" onClick={() => void refreshCore()} disabled={refreshing}>
          {refreshing ? 'Detecting…' : 'Re-detect engines'}
        </button>
        <button className="btn small" onClick={() => void checkUpdates()} disabled={engineBusy !== null}>
          {engineBusy === 'check' ? 'Checking…' : 'Check updates'}
        </button>
        {engineMessage && <span className={`engine-message ${engineMessage.tone}`}>{engineMessage.text}</span>}
      </div>

      <div className="section-title">Subscriptions</div>
      <div className="rows panel">
        <div className="row">
          <span className="row-main">
            <strong>Automatic updates</strong>
            <span>Refresh HTTP subscriptions in the background so nodes and keys stay current.</span>
          </span>
          <Toggle
            checked={settings.autoUpdateSubscriptions}
            label="Automatic subscription updates"
            onChange={(value) => onUpdate({ autoUpdateSubscriptions: value })}
          />
        </div>
        <div className="row">
          <span className="row-main">
            <strong>Update interval</strong>
            <span>How often a due subscription is refreshed.</span>
          </span>
          <select
            value={settings.subscriptionIntervalHours}
            onChange={(event) => onUpdate({ subscriptionIntervalHours: Number(event.target.value) })}
            disabled={!settings.autoUpdateSubscriptions}
          >
            <option value={1}>Every hour</option>
            <option value={3}>Every 3 hours</option>
            <option value={6}>Every 6 hours</option>
            <option value={12}>Every 12 hours</option>
            <option value={24}>Every 24 hours</option>
          </select>
        </div>
        <div className="row">
          <span className="row-icon">
            <ShieldIcon />
          </span>
          <span className="row-main">
            <strong>Refresh all now</strong>
            <span>Force an update of every HTTP subscription, ignoring the interval.</span>
          </span>
          <button className="btn small" onClick={() => void window.eaglet.updateAllSubscriptions()}>
            Update all
          </button>
        </div>
      </div>

      <div className="section-title">About</div>
      <div className="about panel">
        <div className="about-logo">
          <LogoIcon />
        </div>
        <div>
          <strong>Eaglet {version}</strong>
          <p>
            A private desktop VPN client with three tunnel cores — sing-box, Xray-core and Mihomo. Six interchangeable
            themes, live core telemetry, real exit-IP verification and subscription import in one window.
          </p>
        </div>
      </div>
    </div>
  )
}
