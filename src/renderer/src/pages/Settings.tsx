import type { Protocol, Settings, ThemeId } from '@shared/types'
import { CheckIcon, LogoIcon, PowerIcon } from '../components/Icons'
import { Toggle } from '../components/Toggle'

interface Props {
  settings: Settings
  version: string
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
      'radial-gradient(120% 90% at 50% -20%, rgba(34,211,238,.34), transparent 60%), radial-gradient(80% 60% at 85% 110%, rgba(59,130,246,.36), transparent 62%), #03060e',
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
      'linear-gradient(rgba(45,212,191,.08) 1px, transparent 1px) 0 0/22px 22px, linear-gradient(90deg, rgba(45,212,191,.08) 1px, transparent 1px) 0 0/22px 22px, #03100f',
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

const PROTOCOLS: Array<{ id: Protocol; label: string }> = [
  { id: 'wireguard', label: 'WireGuard' },
  { id: 'openvpn', label: 'OpenVPN' },
  { id: 'ikev2', label: 'IKEv2' }
]

export function SettingsPage({ settings, version, onUpdate }: Props): React.JSX.Element {
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
              <strong>Protocol</strong>
              <span>Tunnel implementation used for new sessions.</span>
            </span>
            <div className="segmented">
              {PROTOCOLS.map((protocol) => (
                <button
                  key={protocol.id}
                  className={settings.protocol === protocol.id ? 'active' : ''}
                  onClick={() => onUpdate({ protocol: protocol.id })}
                >
                  {protocol.label}
                </button>
              ))}
            </div>
          </div>
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
              <span>Start Eaglet with Windows, minimised to the tray.</span>
            </span>
            <Toggle
              checked={settings.launchAtStartup}
              label="Launch at startup"
              onChange={(value) => onUpdate({ launchAtStartup: value })}
            />
          </div>
        </div>

        <div className="rows panel">
          <div className="row">
            <span className="row-main">
              <strong>Kill switch</strong>
              <span>Cut all traffic whenever the tunnel drops.</span>
            </span>
            <Toggle
              checked={settings.killSwitch}
              label="Kill switch"
              onChange={(value) => onUpdate({ killSwitch: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>Notifications</strong>
              <span>Toast when the connection state changes.</span>
            </span>
            <Toggle
              checked={settings.notifications}
              label="Notifications"
              onChange={(value) => onUpdate({ notifications: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>Compact mode</strong>
              <span>Shrink Eaglet to a always-on-top mini window.</span>
            </span>
            <Toggle
              checked={settings.mini}
              label="Compact mode"
              onChange={(value) => onUpdate({ mini: value })}
            />
          </div>
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
            A fast, private desktop VPN client. Interface system with six swappable themes, live telemetry and a
            WireGuard-ready engine.
          </p>
        </div>
      </div>
    </div>
  )
}
