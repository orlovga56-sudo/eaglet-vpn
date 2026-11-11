import { useState } from 'react'
import type { DnsMode, RoutingMode, Settings } from '@shared/types'
import { CheckIcon, GlobeIcon, RouteIcon, SparkIcon, WifiIcon, LockIcon } from '../components/Icons'
import { Toggle } from '../components/Toggle'

interface Props {
  settings: Settings
  onUpdate: (patch: Partial<Settings>) => void
}

const MODES: Array<{ id: RoutingMode; title: string; text: string; icon: React.JSX.Element }> = [
  {
    id: 'global',
    title: 'Global',
    text: 'Every packet goes through the encrypted tunnel. Maximum privacy, simplest setup.',
    icon: <GlobeIcon />
  },
  {
    id: 'smart',
    title: 'Smart',
    text: 'Local traffic stays direct, everything else is tunnelled automatically.',
    icon: <SparkIcon />
  },
  {
    id: 'split',
    title: 'Split',
    text: 'Choose exactly which apps use the VPN and which use your normal connection.',
    icon: <RouteIcon />
  }
]

const APPS = ['Chrome', 'Spotify', 'Telegram', 'Steam', 'Slack', 'Zoom']

export function Routing({ settings, onUpdate }: Props): React.JSX.Element {
  const [apps, setApps] = useState<Record<string, boolean>>({
    Chrome: true,
    Spotify: true,
    Telegram: true,
    Steam: false,
    Slack: false,
    Zoom: true
  })

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Tunnel</p>
          <h1 className="page-title">Routing</h1>
          <p className="page-sub">
            Decide what travels through the tunnel. Smart mode is a good default for everyday browsing.
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

      <div className="section-title">Split tunneling · applications</div>
      <div className="rows panel">
        {APPS.map((app) => (
          <div className="row" key={app}>
            <span className="row-icon">
              <WifiIcon />
            </span>
            <span className="row-main">
              <strong>{app}</strong>
              <span>{apps[app] ? 'Routes through Eaglet' : 'Uses your direct connection'}</span>
            </span>
            <Toggle
              checked={Boolean(apps[app])}
              label={`${app} tunneling`}
              onChange={(value) => setApps((prev) => ({ ...prev, [app]: value }))}
            />
          </div>
        ))}
      </div>

      <div className="section-title">DNS</div>
      <div className="rows panel">
        <div className="row">
          <span className="row-icon">
            <LockIcon />
          </span>
          <span className="row-main">
            <strong>DNS resolver</strong>
            <span>Queries are resolved inside the tunnel and never logged.</span>
          </span>
          <select
            value={settings.dns}
            onChange={(event) => onUpdate({ dns: event.target.value as DnsMode })}
          >
            <option value="auto">Automatic (Eaglet)</option>
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
              <span>Enter an IPv4 address of your DNS server.</span>
            </span>
            <input
              value={settings.customDns}
              placeholder="10.0.0.53"
              onChange={(event) => onUpdate({ customDns: event.target.value })}
            />
          </div>
        )}
        <div className="row">
          <span className="row-icon">
            <LockIcon />
          </span>
          <span className="row-main">
            <strong>Kill switch</strong>
            <span>Blocks all traffic if the tunnel drops unexpectedly.</span>
          </span>
          <Toggle
            checked={settings.killSwitch}
            label="Kill switch"
            onChange={(value) => onUpdate({ killSwitch: value })}
          />
        </div>
      </div>
    </div>
  )
}
