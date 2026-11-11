import type { Snapshot } from '@shared/types'
import { PowerDial } from '../components/PowerDial'
import { Sparkline } from '../components/Sparkline'
import { WorldMap } from '../components/WorldMap'
import { ArrowDownIcon, ArrowUpIcon, SignalIcon } from '../components/Icons'
import { formatDuration, formatSpeed } from '../format'

interface Props {
  snap: Snapshot
  onToggle: () => void
  onManageServers: () => void
}

export function Home({ snap, onToggle, onManageServers }: Props): React.JSX.Element {
  const { state, settings } = snap
  const { status, server, metrics, history } = state
  const connected = status === 'connected'
  const busy = status === 'connecting' || status === 'disconnecting'

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

  const location = connected || status === 'connecting' ? (
    <>
      <strong>{server.city}</strong> · {server.country}
    </>
  ) : (
    <>No active tunnel</>
  )

  const meta = connected
    ? `Session ${formatDuration(metrics.sessionSeconds)} · ${settings.protocol}`
    : busy
      ? (state.stage ?? 'Working…')
      : 'Tap the dial to connect'

  const downSeries = history.map((point) => point.down)
  const upSeries = history.map((point) => point.up)

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
            <Sparkline
              className="stat-spark"
              values={history.map((point) => point.ping)}
              width={56}
              height={24}
            />
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
          {connected && <Sparkline className="stat-spark" values={downSeries} width={56} height={24} />}
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
          {connected && <Sparkline className="stat-spark" values={upSeries} width={56} height={24} />}
        </div>
      </section>

      <WorldMap server={server} status={status} onManage={onManageServers} />
    </div>
  )
}
