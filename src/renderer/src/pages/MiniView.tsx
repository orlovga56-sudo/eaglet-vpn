import type { Snapshot } from '@shared/types'
import { PowerDial } from '../components/PowerDial'
import { Sparkline } from '../components/Sparkline'
import { ExpandIcon } from '../components/Icons'
import { formatDuration } from '../format'

interface Props {
  snap: Snapshot
  onToggle: () => void
  onManageServers: () => void
  onExpand: () => void
}

export function MiniView({ snap, onToggle, onManageServers, onExpand }: Props): React.JSX.Element {
  const { state, settings } = snap
  const connected = state.status === 'connected'
  const label =
    state.status === 'connected'
      ? 'Connected'
      : state.status === 'connecting'
        ? 'Connecting'
        : state.status === 'disconnecting'
          ? 'Closing'
          : 'Disconnected'

  return (
    <div className="mini">
      <PowerDial status={state.status} onToggle={onToggle} />

      <div className="status-block" style={{ minHeight: 0 }}>
        <div className={`status-label ${connected || state.status === 'connecting' ? '' : 'is-off'}`}>
          <span className="pulse" />
          {label}
        </div>
        <div className="status-location">
          {connected ? (
            <>
              <strong>{state.server.city}</strong> · {state.server.country}
            </>
          ) : (
            'No active tunnel'
          )}
        </div>
        <div className="status-meta">
          {connected ? formatDuration(state.metrics.sessionSeconds) : settings.protocol}
        </div>
      </div>

      <div className="mini-card panel">
        <div className="mini-metric">
          <span>Ping</span>
          <strong>
            {connected ? Math.round(state.metrics.ping) : '—'}
            <em>ms</em>
          </strong>
        </div>
        <div className="mini-metric">
          <span>Down</span>
          <strong>
            {connected ? Math.round(state.metrics.down) : '—'}
            <em>mbps</em>
          </strong>
        </div>
        <Sparkline
          className="mini-spark"
          values={state.history.map((point) => point.down)}
          width={110}
          height={38}
          filled
        />
      </div>

      <button className="mini-server panel" onClick={onManageServers}>
        <span className="server-code">{state.server.code}</span>
        <span className="mini-server-info">
          <strong>{state.server.city}</strong>
          <span>{state.server.country}</span>
        </span>
        <span style={{ color: 'var(--dim)' }}>›</span>
      </button>

      <button className="mini-expand" onClick={onExpand}>
        <ExpandIcon />
        Open dashboard
      </button>
    </div>
  )
}
