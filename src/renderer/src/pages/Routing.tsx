import type { DnsMode, RoutingMode, Snapshot } from '@shared/types'
import { CheckIcon, GlobeIcon, LockIcon, RouteIcon, SparkIcon, WifiIcon } from '../components/Icons'
import { Toggle } from '../components/Toggle'

interface Props {
  snap: Snapshot
  onUpdate: (patch: Partial<Snapshot['settings']>) => void
}

const MODES: Array<{ id: RoutingMode; title: string; text: string; icon: React.JSX.Element }> = [
  {
    id: 'global',
    title: 'Global',
    text: 'Every packet, including the local network, leaves through the encrypted tunnel. Maximum privacy.',
    icon: <GlobeIcon />
  },
  {
    id: 'smart',
    title: 'Smart',
    text: 'Private addresses and local domains stay direct; everything else is tunnelled. The everyday default.',
    icon: <SparkIcon />
  },
  {
    id: 'direct',
    title: 'Direct',
    text: 'The core still runs, but traffic bypasses the proxy. Useful for debugging and split setups.',
    icon: <RouteIcon />
  }
]

export function Routing({ snap, onUpdate }: Props): React.JSX.Element {
  const { settings, state } = snap
  const connected = state.status === 'connected'
  const tun = settings.tunMode

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Tunnel</p>
          <h1 className="page-title">Routing</h1>
          <p className="page-sub">
            Decide what travels through the core. Routing changes apply on the next connection.
          </p>
        </div>
      </header>

      <div className="mode-grid">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            className={`mode panel ${settings.routingMode === mode.id ? 'active' : ''}`}
            onClick={() => onUpdate({ routingMode: mode.id })}
          >
            <span className="mode-tick">
              <CheckIcon />
            </span>
            {mode.icon}
            <h3>{mode.title}</h3>
            <p>{mode.text}</p>
          </button>
        ))}
      </div>

      <div className="section-title">How traffic is captured</div>
      <div className="rows panel">
        <div className="row">
          <span className="row-icon">
            <WifiIcon />
          </span>
          <span className="row-main">
            <strong>Windows system proxy</strong>
            <span>
              Routes browsers and desktop apps that honour WinINet through 127.0.0.1. Applies instantly — no reconnect.
            </span>
          </span>
          <Toggle
            checked={settings.systemProxy}
            label="System proxy"
            onChange={(value) => onUpdate({ systemProxy: value })}
          />
        </div>
        <div className="row">
          <span className="row-icon">
            <RouteIcon />
          </span>
          <span className="row-main">
            <strong>TUN mode</strong>
            <span>
              Creates a virtual adapter and captures every process, including games and terminals. Needs an
              administrator session and a reconnect.
            </span>
          </span>
          <Toggle checked={settings.tunMode} label="TUN mode" onChange={(value) => onUpdate({ tunMode: value })} />
        </div>
        <div className="row">
          <span className="row-icon">
            <LockIcon />
          </span>
          <span className="row-main">
            <strong>Kill switch</strong>
            <span>
              Restores the tunnel-only policy after a drop. Pair it with TUN mode for full coverage.
            </span>
          </span>
          <Toggle
            checked={settings.killSwitch}
            label="Kill switch"
            onChange={(value) => onUpdate({ killSwitch: value })}
          />
        </div>
      </div>

      {tun && !connected && (
        <div className="callout">
          TUN mode is enabled. The next connect will ask the core to create the adapter; make sure Eaglet runs as
          administrator.
        </div>
      )}

      <div className="section-title">DNS</div>
      <div className="rows panel">
        <div className="row">
          <span className="row-icon">
            <LockIcon />
          </span>
          <span className="row-main">
            <strong>DNS resolver</strong>
            <span>Queries are sent through the tunnel when a resolver is pinned. Automatic uses the core defaults.</span>
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
              <span>Enter a DoH endpoint such as https://dns.example.com/dns-query.</span>
            </span>
            <input
              value={settings.customDns}
              placeholder="https://…/dns-query"
              onChange={(event) => onUpdate({ customDns: event.target.value })}
            />
          </div>
        )}
        <div className="row">
          <span className="row-icon">
            <WifiIcon />
          </span>
          <span className="row-main">
            <strong>Active exit</strong>
            <span>
              {connected
                ? `${state.ip.exit?.ip ?? 'pending'} · ${state.ip.exit?.country ?? 'tunnel'}`
                : 'Not connected'}
            </span>
          </span>
          <span className={`status-pill ${connected ? 'ok' : ''}`}>{connected ? 'Live' : 'Idle'}</span>
        </div>
      </div>
    </div>
  )
}
