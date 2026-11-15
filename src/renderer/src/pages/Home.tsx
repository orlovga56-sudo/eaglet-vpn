import type { Snapshot } from '@shared/types'
import { PowerDial } from '../components/PowerDial'
import { Sparkline } from '../components/Sparkline'
import { WorldMap } from '../components/WorldMap'
import { ArrowDownIcon, ArrowUpIcon, BoltIcon, ShieldIcon, SignalIcon } from '../components/Icons'
import { formatDuration, formatSpeed } from '../format'
import { t } from '../i18n'

interface Props {
  snap: Snapshot
  onToggle: () => void
  onQuickConnect: () => void
  onManageServers: () => void
}

function place(info: { city: string; country: string } | null): string {
  if (!info) return ''
  return [info.city, info.country].filter(Boolean).join(', ')
}

const ENGINE_NAME: Record<Snapshot['state']['engine'], string> = {
  'sing-box': 'sing-box',
  xray: 'Xray-core',
  mihomo: 'Mihomo'
}

export function Home({ snap, onToggle, onQuickConnect, onManageServers }: Props): React.JSX.Element {
  const { state, settings } = snap
  const { status, profile, metrics, history, ip } = state
  const connected = status === 'connected'
  const busy = status === 'connecting' || status === 'disconnecting'
  const hasRemote = snap.profiles.some((item) => item.protocol !== 'direct')

  const label =
    status === 'connected'
      ? t('Connected')
      : status === 'connecting'
        ? t('Connecting')
        : status === 'disconnecting'
          ? t('Disconnecting')
          : status === 'error'
            ? t('Error')
            : t('Disconnected')

  const location = profile ? (
    <>
      <strong>{profile.name}</strong> · {profile.protocol.toUpperCase()}
    </>
  ) : (
    <>{t('No profile selected')}</>
  )

  const meta = connected
    ? t('Session {duration} · {exit}', {
        duration: formatDuration(metrics.sessionSeconds),
        exit: ip.exit?.countryCode ?? t('tunnel active')
      })
    : busy
      ? (state.stage ?? t('Working…'))
      : profile
        ? t('Tap the dial to connect')
        : t('Import a subscription to begin')

  const verdict = ip.checking
    ? { text: t('Checking'), tone: 'wait' }
    : ip.changed
      ? { text: t('IP changed'), tone: 'ok' }
      : connected && ip.exit
        ? { text: t('Unchanged'), tone: 'idle' }
        : ip.exit
          ? { text: t('Last known'), tone: 'idle' }
          : { text: t('Standby'), tone: 'idle' }

  return (
    <div className="home">
      <section className="hero">
        <PowerDial status={status} onToggle={onToggle} />

        <div className="status-block">
          <div className={`status-label ${connected || busy ? '' : 'is-off'}`}>
            <span className="pulse" />
            {label}
          </div>
          <div className="status-location">{location}</div>
          <div className="status-meta">{meta}</div>
          {busy && (
            <div className="progress-line">
              <span style={{ ['--p' as string]: `${Math.round(state.progress * 100)}%` }} />
            </div>
          )}
          <div className="home-badges">
            <span className="home-badge">
              <BoltIcon /> {ENGINE_NAME[state.engine]}
            </span>
            {state.protection.killSwitch === 'active' && (
              <span className="home-badge is-on">
                <ShieldIcon /> {t('Kill switch')}
              </span>
            )}
            {(state.protection.killSwitch === 'error' ||
              state.protection.killSwitch === 'unsupported') && (
              <span className="home-badge is-bad" title={state.protection.error ?? undefined}>
                <ShieldIcon /> {t('Kill switch')} · {t('not active')}
              </span>
            )}
            {state.protection.dns === 'active' && (
              <span className="home-badge is-on">{t('DNS guard')}</span>
            )}
            {state.protection.dns === 'error' && (
              <span className="home-badge is-bad" title={state.protection.error ?? undefined}>
                {t('DNS guard')} · {t('not active')}
              </span>
            )}
            {settings.tunMode && <span className="home-badge">TUN</span>}
            {!settings.ipv6 && <span className="home-badge">{t('IPv4 only')}</span>}
          </div>
        </div>
      </section>

      {!connected && !busy && (
        <button
          className="quick-connect panel"
          onClick={() => (hasRemote ? onQuickConnect() : onManageServers())}
          title={hasRemote ? t('Ping nodes and connect to the fastest') : t('Open the server list')}
        >
          <span className="quick-icon">
            <BoltIcon />
          </span>
          <span className="quick-text">
            <strong>{hasRemote ? t('Quick connect') : t('Find a server first')}</strong>
            <span>
              {hasRemote
                ? t('Pings your nodes in parallel and connects to the fastest one')
                : t('Import a subscription or run the free-server finder')}
            </span>
          </span>
          <span className="quick-cta">{hasRemote ? t('Auto-pick') : t('Open servers')}</span>
        </button>
      )}

      <section className="ip-row">
        <div className="ip-card panel">
          <div className="ip-head">
            <span className="ip-dot" />
            {t('Direct address')}
            <span className="ip-tag">{t('before tunnel')}</span>
          </div>
          <div className={`ip-value ${ip.direct ? '' : 'is-empty'}`}>{ip.direct?.ip ?? '—'}</div>
          <div className="ip-meta">
            {ip.direct ? place(ip.direct) || t('Direct connection') : t('Waiting for the first probe')}
          </div>
        </div>

        <div className={`ip-card panel ${ip.changed ? 'is-changed' : ''}`}>
          <div className="ip-head">
            <span className="ip-dot exit" />
            {t('Tunnel exit')}
            <span className={`ip-badge ${verdict.tone}`}>{verdict.text}</span>
            <button
              className="ip-refresh"
              onClick={() => void window.eaglet.checkIp()}
              disabled={ip.checking}
              title={t('Re-probe both addresses')}
            >
              {ip.checking ? t('Probing…') : t('Re-check')}
            </button>
          </div>
          <div className={`ip-value ${ip.exit ? '' : 'is-empty'}`}>{ip.exit?.ip ?? '—'}</div>
          <div className="ip-meta">
            {ip.exit
              ? place(ip.exit) || ip.exit.countryCode
              : connected
                ? t('Probing the tunnel…')
                : t('Connect to measure the exit')}
          </div>
        </div>
      </section>

      {ip.changed && (
        <div className="ip-note panel">
          <span className="ip-note-icon">
            <ShieldIcon />
          </span>
          <span>
            {t('Your public address changed from')} <strong>{ip.direct?.ip}</strong> {t('to')}{' '}
            <strong>{ip.exit?.ip}</strong>.{' '}
            {t('Traffic is leaving through {exit}.', { exit: place(ip.exit) || ip.exit?.countryCode || '' })}
          </span>
        </div>
      )}

      <section className="stats-row">
        <div className="stat panel">
          <div className="stat-icon">
            <SignalIcon />
          </div>
          <div className="stat-body">
            <div className="stat-label">{t('Ping')}</div>
            <div className="stat-value">
              {connected ? Math.round(metrics.ping) : '—'}
              <span className="unit">ms</span>
            </div>
          </div>
          {connected && (
            <Sparkline className="stat-spark" values={history.map((point) => point.ping)} width={56} height={24} />
          )}
        </div>

        <div className="stat panel">
          <div className="stat-icon">
            <ArrowDownIcon />
          </div>
          <div className="stat-body">
            <div className="stat-label">{t('Download')}</div>
            <div className="stat-value">
              {connected ? formatSpeed(metrics.down) : '—'}
              <span className="unit">Mbps</span>
            </div>
          </div>
          {connected && <Sparkline className="stat-spark" values={history.map((p) => p.down)} width={56} height={24} />}
        </div>

        <div className="stat panel">
          <div className="stat-icon">
            <ArrowUpIcon />
          </div>
          <div className="stat-body">
            <div className="stat-label">{t('Upload')}</div>
            <div className="stat-value">
              {connected ? formatSpeed(metrics.up) : '—'}
              <span className="unit">Mbps</span>
            </div>
          </div>
          {connected && <Sparkline className="stat-spark" values={history.map((p) => p.up)} width={56} height={24} />}
        </div>
      </section>

      {snap.scenarios.length > 0 && (
        <section className="scenario-strip panel">
          <div className="scenario-strip-head">
            <strong>{t('Scenarios')}</strong>
            <span>{t('One click applies engine, routing and protection settings')}</span>
          </div>
          <div className="scenario-strip-actions">
            {snap.scenarios.map((scenario) => (
              <button
                key={scenario.id}
                className="toggle-chip"
                title={scenario.description}
                onClick={() => void window.eaglet.applyScenario(scenario.id)}
              >
                {scenario.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <WorldMap
        direct={ip.direct}
        exit={ip.exit}
        status={status}
        onManage={onManageServers}
        profiles={snap.profiles}
        selected={profile}
        onPick={(id) => void window.eaglet.selectProfile(id)}
      />
    </div>
  )
}
