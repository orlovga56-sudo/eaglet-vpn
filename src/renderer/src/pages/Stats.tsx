import type { HistoryPoint, Snapshot } from '@shared/types'
import { average, formatBytes, formatClock, formatDuration } from '../format'

interface Props {
  snap: Snapshot
}

function SpeedChart({ history }: { history: HistoryPoint[] }): React.JSX.Element {
  const W = 620
  const H = 150
  const data = history.length > 1 ? history : Array.from({ length: 2 }, () => ({ t: 0, ping: 0, down: 0, up: 0 }))
  const max = Math.max(1, ...data.map((point) => Math.max(point.down, point.up)))

  const build = (key: 'down' | 'up'): string =>
    data
      .map((point, index) => {
        const x = (index / (data.length - 1)) * W
        const y = H - 10 - (point[key] / max) * (H - 24)
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')

  const downLine = build('down')
  const upLine = build('up')

  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" fill="none">
      <defs>
        <linearGradient id="eg-chart-down" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--chart)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--chart)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((fraction) => (
        <line
          key={fraction}
          x1="0"
          x2={W}
          y1={H * fraction}
          y2={H * fraction}
          stroke="var(--border)"
          strokeWidth="1"
          strokeDasharray="3 6"
        />
      ))}
      <path d={`${downLine} L${W} ${H} L0 ${H} Z`} fill="url(#eg-chart-down)" />
      <path d={downLine} stroke="var(--chart)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <path d={upLine} stroke="var(--accent-2)" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" opacity="0.75" />
    </svg>
  )
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function Stats({ snap }: Props): React.JSX.Element {
  const { state, settings, subscriptions } = snap
  const { metrics, history, ip } = state
  const live = state.status === 'connected'
  const pingAvg = average(history.map((point) => point.ping).filter((value) => value > 0))

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Telemetry</p>
          <h1 className="page-title">Stats</h1>
          <p className="page-sub">
            Numbers come straight from the sing-box Clash API — no simulation. History resets on every reconnect.
          </p>
        </div>
        <span className={`status-pill ${live ? 'ok' : ''}`}>{live ? 'Live session' : 'Offline'}</span>
      </header>

      <div className="tile-grid">
        <div className="tile panel">
          <div className="tile-label">Session</div>
          <div className="tile-value">{formatDuration(metrics.sessionSeconds)}</div>
          <div className="tile-foot">{live ? `${metrics.connections} active connections` : 'Not connected'}</div>
        </div>
        <div className="tile panel">
          <div className="tile-label">Downloaded</div>
          <div className="tile-value">{formatBytes(metrics.downTotal)}</div>
          <div className="tile-foot">Session total</div>
        </div>
        <div className="tile panel">
          <div className="tile-label">Uploaded</div>
          <div className="tile-value">{formatBytes(metrics.upTotal)}</div>
          <div className="tile-foot">Session total</div>
        </div>
        <div className="tile panel">
          <div className="tile-label">Latency</div>
          <div className="tile-value">
            {live ? Math.round(metrics.ping) : '—'}
            <span className="unit">ms</span>
          </div>
          <div className="tile-foot">
            {live ? `${Math.round(pingAvg)} ms average · ${history.length} samples` : 'Waiting for a tunnel'}
          </div>
        </div>
      </div>

      <div className="chart-card panel">
        <div className="chart-head">
          <div className="tile-label" style={{ margin: 0 }}>
            Throughput · Mbps
          </div>
          <div className="chart-legend">
            <span className="down">
              <i /> Down
            </span>
            <span className="up">
              <i /> Up
            </span>
          </div>
        </div>
        <SpeedChart history={history} />
      </div>

      <div className="section-title">Tunnel facts</div>
      <div className="facts panel">
        <Fact label="Profile" value={state.profile?.name ?? 'None selected'} />
        <Fact label="Protocol" value={state.profile?.protocol.toUpperCase() ?? '—'} />
        <Fact label="Exit IP" value={ip.exit?.ip ?? '—'} />
        <Fact label="Exit location" value={[ip.exit?.city, ip.exit?.country].filter(Boolean).join(', ') || '—'} />
        <Fact label="Core" value={state.core.version ? `sing-box ${state.core.version}` : 'Not installed'} />
        <Fact label="Routing" value={settings.routingMode.toUpperCase()} />
        <Fact label="System proxy" value={settings.systemProxy ? 'On' : 'Off'} />
        <Fact label="Subscriptions" value={subscriptions.length ? String(subscriptions.length) : '—'} />
      </div>

      <div className="section-title">Event log</div>
      <div className="log-panel panel">
        {state.logs.length === 0 && <div className="empty-hint">Nothing logged yet.</div>}
        {state.logs.map((entry) => (
          <div className="log-row" key={entry.id}>
            <span className="log-time">{formatClock(entry.time)}</span>
            <span className={`log-level ${entry.level}`}>{entry.level}</span>
            <span className="log-msg">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
