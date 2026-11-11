import type { HistoryPoint, Snapshot } from '@shared/types'
import { average, formatBytes, formatClock, formatDuration } from '../format'

interface Props {
  snap: Snapshot
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEK = [62, 78, 54, 88, 70, 92, 66]

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

export function Stats({ snap }: Props): React.JSX.Element {
  const { state } = snap
  const { metrics, history } = state
  const live = state.status === 'connected'
  const pingAvg = average(history.map((point) => point.ping))
  const total = metrics.downTotal + metrics.upTotal

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Telemetry</p>
          <h1 className="page-title">Stats</h1>
          <p className="page-sub">Live tunnel telemetry for the current session. History resets on every reconnect.</p>
        </div>
      </header>

      <div className="tile-grid">
        <div className="tile panel">
          <div className="tile-label">Session</div>
          <div className="tile-value">{formatDuration(metrics.sessionSeconds)}</div>
          <div className="tile-foot">{live ? `On ${state.server.code} · ${snap.settings.protocol}` : 'Not connected'}</div>
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
          <div className="tile-label">Average ping</div>
          <div className="tile-value">
            {live ? Math.round(pingAvg) : '—'}
            <span className="unit">ms</span>
          </div>
          <div className="tile-foot">Across last {history.length || 0} samples</div>
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

      <div className="chart-card panel">
        <div className="chart-head">
          <div className="tile-label" style={{ margin: 0 }}>
            Traffic · last 7 days
          </div>
          <div className="chart-legend">
            <span className="down">
              <i />
              {formatBytes(total * 7 + 4_400_000_000)}
            </span>
          </div>
        </div>
        <div className="bars">
          {WEEK.map((value, index) => (
            <div key={DAYS[index]} style={{ height: `${value}%` }} />
          ))}
        </div>
        <div className="bar-labels">
          {DAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
      </div>

      <div className="section-title">Event log</div>
      <div className="log-panel panel">
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
