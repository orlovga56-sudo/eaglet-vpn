import { useEffect, useState } from 'react'
import type { DnsMode, RoutingMode, Snapshot } from '@shared/types'
import { CheckIcon, GlobeIcon, LockIcon, RouteIcon, ShieldIcon, SparkIcon, WifiIcon } from '../components/Icons'
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
  const [bypass, setBypass] = useState(settings.bypassList)

  useEffect(() => {
    setBypass(settings.bypassList)
  }, [settings.bypassList])

  const commitBypass = (): void => {
    if (bypass !== settings.bypassList) onUpdate({ bypassList: bypass })
  }

  const bypassCount = bypass.split(/[\s,;]+/).filter(Boolean).length

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

      <div className="section-title">Split tunneling · bypass list</div>
      <div className="bypass panel">
        <div className="bypass-head">
          <div>
            <strong>Always direct</strong>
            <span>
              Domains, IPs or CIDRs that never enter the tunnel. These rules win in both Global and Smart mode and
              apply on the next connection.
            </span>
          </div>
          <span className="bypass-count">
            {bypassCount} {bypassCount === 1 ? 'entry' : 'entries'}
          </span>
        </div>
        <textarea
          className="bypass-input"
          value={bypass}
          spellCheck={false}
          placeholder={'bank.example.com\n192.168.1.0/24\n10.0.0.5'}
          onChange={(event) => setBypass(event.target.value)}
          onBlur={commitBypass}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) commitBypass()
          }}
        />
        <div className="bypass-hint">
          One entry per line or comma-separated · suffix matches cover subdomains, so <code>example.com</code> also
          bypasses <code>api.example.com</code>. Up to 120 entries.
        </div>
      </div>

      <div className="section-title">How traffic is captured</div>
      <div className="rows panel">
        <div className="row">
          <span className="row-icon">
            <WifiIcon />
          </span>
          <span className="row-main">
            <strong>System proxy</strong>
            <span>
              Routes browsers and desktop apps that honour the OS proxy through 127.0.0.1. WinINet on Windows,
              networksetup on macOS, GSettings on GNOME.
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
        <div className="row">
          <span className="row-icon">
            <ShieldIcon />
          </span>
          <span className="row-main">
            <strong>Network protection</strong>
            <span>Arms the kill switch and the DNS guard together on every connection.</span>
          </span>
          <Toggle
            checked={settings.networkProtection}
            label="Network protection"
            onChange={(value) => onUpdate({ networkProtection: value })}
          />
        </div>
        <div className="row">
          <span className="row-icon">
            <GlobeIcon />
          </span>
          <span className="row-main">
            <strong>DNS protection</strong>
            <span>
              Starts a real DNS-over-HTTPS relay on 127.0.0.1:53, backs up the system resolver and restores it on
              disconnect.
            </span>
          </span>
          <Toggle
            checked={settings.dnsProtection}
            label="DNS protection"
            onChange={(value) => onUpdate({ dnsProtection: value })}
          />
        </div>
        <div className="row">
          <span className="row-icon">
            <WifiIcon />
          </span>
          <span className="row-main">
            <strong>IPv6</strong>
            <span>Turn off to reject IPv6 inside the tunnel and prevent leaks around the core.</span>
          </span>
          <Toggle checked={settings.ipv6} label="IPv6" onChange={(value) => onUpdate({ ipv6: value })} />
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
