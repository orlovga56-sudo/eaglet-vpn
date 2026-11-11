import type { Snapshot } from '@shared/types'
import { PowerDial } from '../components/PowerDial'
import { Sparkline } from '../components/Sparkline'
import { WorldMap } from '../components/WorldMap'
import { ArrowDownIcon, ArrowUpIcon, BoltIcon, ShieldIcon, SignalIcon } from '../components/Icons'
import { formatDuration, formatSpeed } from '../format'

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

export function Home({ snap, onToggle, onQuickConnect, onManageServers }: Props): React.JSX.Element {
  const { state } = snap
  const { status, profile, metrics, history, ip } = state
  const connected = status === 'connected'
  const busy = status === 'connecting' || status === 'disconnecting'
  const hasRemote = snap.profiles.some((item) => item.protocol !== 'direct')

  const label =
    status === 'connected'
      ? 'Connected'
      : status === 'connecting'
        ? 'Connecting'
        : status === 'disconnecting'
          ? 'Disconnecting'
          : status === 'error'
            ? 'Error'
            : 'Disconnected'

  const location = profile ? (
    <>
      <strong>{profile.name}</strong> · {profile.protocol.toUpperCase()}
    </>
  ) : (
    <>No profile selected</>
  )

  const meta = connected
    ? `Session ${formatDuration(metrics.sessionSeconds)} · ${ip.exit?.countryCode ?? 'tunnel active'}`
    : busy
      ? (state.stage ?? 'Working…')
      : profile
        ? 'Tap the dial to connect'
        : 'Import a subscription to begin'

  const verdict = ip.checking
    ? { text: 'Checking', tone: 'wait' }
    : ip.changed
      ? { text: 'IP changed', tone: 'ok' }
      : connected && ip.exit
        ? { text: 'Unchanged', tone: 'idle' }
        : ip.exit
          ? { text: 'Last known', tone: 'idle' }
          : { text: 'Standby', tone: 'idle' }

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
        </div>
      </section>

      {!connected && !busy && (
        <button
          className="quick-connect panel"
          onClick={() => (hasRemote ? onQuickConnect() : onManageServers())}
          title={hasRemote ? 'Ping nodes and connect to the fastest' : 'Open the server list'}
        >
          <span className="quick-icon">
            <BoltIcon />
          </span>
          <span className="quick-text">
            <strong>{hasRemote ? 'Quick connect' : 'Find a server first'}</strong>
            <span>
              {hasRemote
                ? 'Pings your nodes in parallel and connects to the fastest one'
                : 'Import a subscription or run the free-server finder'}
            </span>
          </span>
          <span className="quick-cta">{hasRemote ? 'Auto-pick' : 'Open servers'}</span>
        </button>
      )}

      <section className="ip-row">
        <div className="ip-card panel">
          <div className="ip-head">
            <span className="ip-dot" />
            Direct address
            <span className="ip-tag">before tunnel</span>
          </div>
          <div className={`ip-value ${ip.direct ? '' : 'is-empty'}`}>{ip.direct?.ip ?? '—'}</div>
          <div className="ip-meta">
            {ip.direct ? place(ip.direct) || 'Direct connection' : 'Waiting for the first probe'}
          </div>
        </div>

        <div className={`ip-card panel ${ip.changed ? 'is-changed' : ''}`}>
          <div className="ip-head">
            <span className="ip-dot exit" />
            Tunnel exit
            <span className={`ip-badge ${verdict.tone}`}>{verdict.text}</span>
            <button
              className="ip-refresh"
              onClick={() => void window.eaglet.checkIp()}
              disabled={ip.checking}
              title="Re-probe both addresses"
            >
              {ip.checking ? 'Probing…' : 'Re-check'}
            </button>
          </div>
          <div className={`ip-value ${ip.exit ? '' : 'is-empty'}`}>{ip.exit?.ip ?? '—'}</div>
          <div className="ip-meta">
            {ip.exit ? place(ip.exit) || ip.exit.countryCode : connected ? 'Probing the tunnel…' : 'Connect to measure the exit'}
          </div>
        </div>
      </section>

      {ip.changed && (
        <div className="ip-note panel">
          <span className="ip-note-icon">
            <ShieldIcon />
          </span>
          <span>
            Your public address changed from <strong>{ip.direct?.ip}</strong> to <strong>{ip.exit?.ip}</strong>.
            Traffic is leaving through {place(ip.exit) || ip.exit?.countryCode}.
          </span>
        </div>
      )}

      <section className="stats-row">
        <div className="stat panel">
          <div className="stat-icon">
            <SignalIcon />
          </div>
          <div className="stat-body">
            <div className="stat-label">Ping</div>
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
            <div className="stat-label">Download</div>
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
            <div className="stat-label">Upload</div>
            <div className="stat-value">
              {connected ? formatSpeed(metrics.up) : '—'}
              <span className="unit">Mbps</span>
            </div>
          </div>
          {connected && <Sparkline className="stat-spark" values={history.map((p) => p.up)} width={56} height={24} />}
        </div>
      </section>

      <WorldMap direct={ip.direct} exit={ip.exit} status={status} onManage={onManageServers} />
    </div>
  )
}
