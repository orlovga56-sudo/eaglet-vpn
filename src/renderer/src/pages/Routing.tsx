import { useEffect, useState } from 'react'
import type { DnsMode, RoutingMode, Snapshot } from '@shared/types'
import { CheckIcon, GlobeIcon, LockIcon, RouteIcon, ShieldIcon, SparkIcon, WifiIcon } from '../components/Icons'
import { Toggle } from '../components/Toggle'
import { t } from '../i18n'

interface Props {
  snap: Snapshot
  onUpdate: (patch: Partial<Snapshot['settings']>) => void
}

const modes = (): Array<{ id: RoutingMode; title: string; text: string; icon: React.JSX.Element }> => [
  {
    id: 'global',
    title: t('Global'),
    text: t('Every packet, including the local network, leaves through the encrypted tunnel. Maximum privacy.'),
    icon: <GlobeIcon />
  },
  {
    id: 'smart',
    title: t('Smart'),
    text: t('Private addresses and local domains stay direct; everything else is tunnelled. The everyday default.'),
    icon: <SparkIcon />
  },
  {
    id: 'direct',
    title: t('Direct'),
    text: t('The core still runs, but traffic bypasses the proxy. Useful for debugging and split setups.'),
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
          <p className="page-eyebrow">{t('Tunnel')}</p>
          <h1 className="page-title">{t('Routing')}</h1>
          <p className="page-sub">
            {t('Decide what travels through the core. Routing changes apply on the next connection.')}
          </p>
        </div>
      </header>

      <div className="mode-grid">
        {modes().map((mode) => (
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

      <div className="section-title">{t('Split tunneling · bypass list')}</div>
      <div className="bypass panel">
        <div className="bypass-head">
          <div>
            <strong>{t('Always direct')}</strong>
            <span>
              {t(
                'Domains, IPs or CIDRs that never enter the tunnel. These rules win in both Global and Smart mode and apply on the next connection.'
              )}
            </span>
          </div>
          <span className="bypass-count">
            {bypassCount} {bypassCount === 1 ? t('entry') : t('entries')}
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
          {t('One entry per line or comma-separated · suffix matches cover subdomains, so')}{' '}
          <code>example.com</code> {t('also bypasses')} <code>api.example.com</code>
          {t('. Up to 120 entries.')}
        </div>
      </div>

      <div className="section-title">{t('How traffic is captured')}</div>
      <div className="rows panel">
        <div className="row">
          <span className="row-icon">
            <WifiIcon />
          </span>
          <span className="row-main">
            <strong>{t('System proxy')}</strong>
            <span>
              {t(
                'Routes browsers and desktop apps that honour the OS proxy through 127.0.0.1. WinINet on Windows, networksetup on macOS, GSettings on GNOME.'
              )}
            </span>
          </span>
          <Toggle
            checked={settings.systemProxy}
            label={t('System proxy')}
            onChange={(value) => onUpdate({ systemProxy: value })}
          />
        </div>
        <div className="row">
          <span className="row-icon">
            <RouteIcon />
          </span>
          <span className="row-main">
            <strong>{t('TUN mode')}</strong>
            <span>
              {t(
                'Creates a virtual adapter and captures every process, including games and terminals. Needs an administrator session and a reconnect.'
              )}
            </span>
          </span>
          <Toggle checked={settings.tunMode} label={t('TUN mode')} onChange={(value) => onUpdate({ tunMode: value })} />
        </div>
        <div className="row">
          <span className="row-icon">
            <LockIcon />
          </span>
          <span className="row-main">
            <strong>{t('Kill switch')}</strong>
            <span>
              {t('Restores the tunnel-only policy after a drop. Pair it with TUN mode for full coverage.')}
            </span>
          </span>
          <Toggle
            checked={settings.killSwitch}
            label={t('Kill switch')}
            onChange={(value) => onUpdate({ killSwitch: value })}
          />
        </div>
        <div className="row">
          <span className="row-icon">
            <ShieldIcon />
          </span>
          <span className="row-main">
            <strong>{t('Network protection')}</strong>
            <span>{t('Arms the kill switch and the DNS guard together on every connection.')}</span>
          </span>
          <Toggle
            checked={settings.networkProtection}
            label={t('Network protection')}
            onChange={(value) => onUpdate({ networkProtection: value })}
          />
        </div>
        <div className="row">
          <span className="row-icon">
            <GlobeIcon />
          </span>
          <span className="row-main">
            <strong>{t('DNS protection')}</strong>
            <span>
              {t(
                'Starts a real DNS-over-HTTPS relay on 127.0.0.1:53, backs up the system resolver and restores it on disconnect.'
              )}
            </span>
          </span>
          <Toggle
            checked={settings.dnsProtection}
            label={t('DNS protection')}
            onChange={(value) => onUpdate({ dnsProtection: value })}
          />
        </div>
        <div className="row">
          <span className="row-icon">
            <WifiIcon />
          </span>
          <span className="row-main">
            <strong>{t('IPv6')}</strong>
            <span>{t('Turn off to reject IPv6 inside the tunnel and prevent leaks around the core.')}</span>
          </span>
          <Toggle checked={settings.ipv6} label={t('IPv6')} onChange={(value) => onUpdate({ ipv6: value })} />
        </div>
      </div>

      {tun && !connected && (
        <div className="callout">
          {t(
            'TUN mode is enabled. The next connect will ask the core to create the adapter; make sure Eaglet runs as administrator.'
          )}
        </div>
      )}

      <div className="section-title">{t('DNS')}</div>
      <div className="rows panel">
        <div className="row">
          <span className="row-icon">
            <LockIcon />
          </span>
          <span className="row-main">
            <strong>{t('DNS resolver')}</strong>
            <span>
              {t('Queries are sent through the tunnel when a resolver is pinned. Automatic uses the core defaults.')}
            </span>
          </span>
          <select value={settings.dns} onChange={(event) => onUpdate({ dns: event.target.value as DnsMode })}>
            <option value="auto">{t('Automatic (core)')}</option>
            <option value="cloudflare">{t('Cloudflare · 1.1.1.1')}</option>
            <option value="google">{t('Google · 8.8.8.8')}</option>
            <option value="custom">{t('Custom…')}</option>
          </select>
        </div>
        {settings.dns === 'custom' && (
          <div className="row">
            <span className="row-icon">
              <GlobeIcon />
            </span>
            <span className="row-main">
              <strong>{t('Custom resolver')}</strong>
              <span>{t('Enter a DoH endpoint such as https://dns.example.com/dns-query.')}</span>
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
            <strong>{t('Active exit')}</strong>
            <span>
              {connected
                ? t('{ip} · {country}', {
                    ip: state.ip.exit?.ip ?? t('pending'),
                    country: state.ip.exit?.country ?? t('tunnel')
                  })
                : t('Not connected')}
            </span>
          </span>
          <span className={`status-pill ${connected ? 'ok' : ''}`}>{connected ? t('Live') : t('Idle')}</span>
        </div>
      </div>
    </div>
  )
}
