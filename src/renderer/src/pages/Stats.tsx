import { useState } from 'react'
import type {
  DiagnosticsResult,
  EngineId,
  HistoryPoint,
  ProtectionLayerState,
  Snapshot,
  SpeedTestResult
} from '@shared/types'
import { average, formatBytes, formatClock, formatDateTime, formatDuration, formatSpeed } from '../format'
import { ChartIcon, CheckIcon, HistoryIcon, ServerIcon } from '../components/Icons'
import { t } from '../i18n'

interface Props {
  snap: Snapshot
}

type ChartKey = 'down' | 'up' | 'ping' | 'jitter' | 'loss'

/** Never claims a requested layer is armed when the engine reports otherwise. */
function protectionText(layer: ProtectionLayerState): string {
  if (layer === 'active') return t('Armed')
  if (layer === 'unsupported') return t('Unsupported')
  if (layer === 'error') return t('Error')
  return t('Off')
}

function protectionTone(layer: ProtectionLayerState): string {
  if (layer === 'active') return 'is-ok'
  if (layer === 'error' || layer === 'unsupported') return 'is-bad'
  return ''
}

interface Series {
  key: ChartKey
  label: string
  color: string
  fill?: boolean
}

function Chart({ history, series, unit }: { history: HistoryPoint[]; series: Series[]; unit: string }): React.JSX.Element {
  const W = 620
  const H = 150
  const data: HistoryPoint[] =
    history.length > 1
      ? history
      : Array.from({ length: 2 }, (_, index) => ({
          t: index,
          down: 0,
          up: 0,
          ping: 0,
          jitter: 0,
          loss: 0
        }))
  const max = Math.max(1, ...data.flatMap((point) => series.map((item) => Number(point[item.key]))))

  const path = (key: ChartKey): string =>
    data
      .map((point, index) => {
        const x = (index / (data.length - 1)) * W
        const y = H - 10 - (Number(point[key]) / max) * (H - 24)
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')

  return (
    <div className="chart-wrap">
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" fill="none">
        <defs>
          {series.map((item) => (
            <linearGradient id={`eg-fill-${item.key}`} key={item.key} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={item.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={item.color} stopOpacity="0" />
            </linearGradient>
          ))}
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
        {series.map((item) =>
          item.fill ? (
            <path
              key={`fill-${item.key}`}
              d={`${path(item.key)} L${W} ${H} L0 ${H} Z`}
              fill={`url(#eg-fill-${item.key})`}
            />
          ) : null
        )}
        {series.map((item) => (
          <path
            key={item.key}
            d={path(item.key)}
            stroke={item.color}
            strokeWidth="1.7"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </svg>
      <div className="chart-legend">
        {series.map((item) => (
          <span key={item.key} style={{ color: item.color }}>
            <i style={{ background: item.color }} /> {item.label}
          </span>
        ))}
        <span className="chart-scale">
          {t('max')} {max.toFixed(max < 10 ? 1 : 0)} {unit}
        </span>
      </div>
    </div>
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

const ENGINE_LABEL: Record<EngineId, string> = {
  'sing-box': 'sing-box',
  xray: 'Xray-core',
  mihomo: 'Mihomo'
}

function cleanError(error: unknown): string {
  const message = (error as Error)?.message ?? t('Something went wrong')
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

export function Stats({ snap }: Props): React.JSX.Element {
  const { state, settings, subscriptions } = snap
  const { metrics, history, ip } = state
  const live = state.status === 'connected'
  const pingAvg = average(history.map((point) => point.ping).filter((value) => value > 0))
  const currentEngine = state.engines.find((engine) => engine.id === state.engine)
  const [speed, setSpeed] = useState<SpeedTestResult | null>(null)
  const [speedBusy, setSpeedBusy] = useState(false)
  const [speedError, setSpeedError] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResult | null>(null)
  const [diagnosing, setDiagnosing] = useState(false)
  const [action, setAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const runSpeed = async (): Promise<void> => {
    setSpeedBusy(true)
    setSpeedError(null)
    try {
      const result = await window.eaglet.runSpeedTest()
      setSpeed(result)
    } catch (error) {
      setSpeedError(cleanError(error))
    } finally {
      setSpeedBusy(false)
    }
  }

  const diagnose = async (): Promise<void> => {
    setDiagnosing(true)
    setActionError(null)
    try {
      setDiagnostics(await window.eaglet.diagnose())
    } catch (error) {
      setActionError(cleanError(error))
    } finally {
      setDiagnosing(false)
    }
  }

  const exportBackup = async (): Promise<void> => {
    setAction('backup')
    setActionError(null)
    try {
      const path = await window.eaglet.exportBackup()
      setAction(path ? t('Backup saved to {path}', { path }) : null)
    } catch (error) {
      setActionError(cleanError(error))
    }
  }

  const importBackup = async (): Promise<void> => {
    setAction('restore')
    setActionError(null)
    try {
      const restored = await window.eaglet.importBackup()
      setAction(restored ? t('Backup restored · {count} profiles', { count: restored.profiles.length }) : null)
    } catch (error) {
      setActionError(cleanError(error))
    }
  }

  const exportConfig = async (): Promise<void> => {
    setAction('config')
    setActionError(null)
    try {
      const path = await window.eaglet.exportConfig()
      setAction(path ? t('Core configuration saved to {path}', { path }) : null)
    } catch (error) {
      setActionError(cleanError(error))
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{t('Telemetry')}</p>
          <h1 className="page-title">{t('Stats')}</h1>
          <p className="page-sub">
            {t(
              'Numbers come straight from the running core’s native telemetry. Latency, jitter and loss are measured by real probes; history resets on every reconnect.'
            )}
          </p>
        </div>
        <span className={`status-pill ${live ? 'ok' : ''}`}>{live ? t('Live session') : t('Offline')}</span>
      </header>

      <div className="tile-grid">
        <div className="tile panel">
          <div className="tile-label">{t('Session')}</div>
          <div className="tile-value">{formatDuration(metrics.sessionSeconds)}</div>
          <div className="tile-foot">
            {live ? t('{count} active connections', { count: metrics.connections }) : t('Not connected')}
          </div>
        </div>
        <div className="tile panel">
          <div className="tile-label">{t('Downloaded')}</div>
          <div className="tile-value">{formatBytes(metrics.downTotal)}</div>
          <div className="tile-foot">{t('{count} latency probes', { count: metrics.probes })}</div>
        </div>
        <div className="tile panel">
          <div className="tile-label">{t('Uploaded')}</div>
          <div className="tile-value">{formatBytes(metrics.upTotal)}</div>
          <div className="tile-foot">{t('{count} failed probes', { count: metrics.probeFailures })}</div>
        </div>
        <div className="tile panel">
          <div className="tile-label">{t('Latency')}</div>
          <div className="tile-value">
            {live ? Math.round(metrics.ping) : '—'}
            <span className="unit">ms</span>
          </div>
          <div className="tile-foot">
            {live
              ? t('{avg} ms avg · jitter {jitter} ms · {loss}% loss', {
                  avg: Math.round(pingAvg),
                  jitter: Math.round(metrics.jitter),
                  loss: metrics.loss.toFixed(1)
                })
              : t('Waiting for a tunnel')}
          </div>
        </div>
      </div>

      <div className="speed-card panel">
        <div className="speed-main">
          <div className="tile-label">{t('Speed test')}</div>
          <div className="speed-value">
            {speedBusy ? '…' : speed ? formatSpeed(speed.mbps) : '—'}
            <span className="unit">Mbps</span>
          </div>
          <div className="speed-foot">
            {speedBusy
              ? t('Downloading 10 MB through the tunnel…')
              : speed
                ? t('{bytes} in {seconds}s · measured at {clock}', {
                    bytes: formatBytes(speed.bytes),
                    seconds: speed.seconds.toFixed(1),
                    clock: formatClock(speed.at)
                  })
                : live
                  ? t('Measure real throughput through the active core')
                  : t('Connect a tunnel to run the test')}
          </div>
        </div>
        <button className="btn primary" onClick={() => void runSpeed()} disabled={!live || speedBusy}>
          {speedBusy ? t('Testing…') : t('Run speed test')}
        </button>
      </div>
      {speedError && <div className="callout danger">{speedError}</div>}

      <div className="chart-card panel">
        <div className="chart-head">
          <div className="tile-label" style={{ margin: 0 }}>
            {t('Throughput · Mbps')}
          </div>
        </div>
        <Chart
          history={history}
          unit="Mbps"
          series={[
            { key: 'down', label: t('Download'), color: 'var(--chart)', fill: true },
            { key: 'up', label: t('Upload'), color: 'var(--accent-2)' }
          ]}
        />
      </div>

      <div className="chart-pair">
        <div className="chart-card panel">
          <div className="chart-head">
            <div className="tile-label" style={{ margin: 0 }}>
              {t('Latency & jitter · ms')}
            </div>
          </div>
          <Chart
            history={history}
            unit="ms"
            series={[
              { key: 'ping', label: t('Latency'), color: 'var(--accent)', fill: true },
              { key: 'jitter', label: t('Jitter'), color: 'var(--accent-2)' }
            ]}
          />
        </div>
        <div className="chart-card panel">
          <div className="chart-head">
            <div className="tile-label" style={{ margin: 0 }}>
              {t('Packet loss · %')}
            </div>
          </div>
          <Chart
            history={history}
            unit="%"
            series={[{ key: 'loss', label: t('Loss'), color: 'var(--danger)', fill: true }]}
          />
        </div>
      </div>

      <div className="section-title">{t('Engine')}</div>
      <div className="engine-live panel">
        <div className="engine-live-main">
          <span className="engine-badge">
            <ServerIcon />
            {ENGINE_LABEL[state.engine]}
          </span>
          <div>
            <strong>{currentEngine?.version ? `v${currentEngine.version}` : t('Version unknown')}</strong>
            <span className="mono-path">{state.core.path ?? t('Binary not found')}</span>
          </div>
        </div>
        <div className="usage-grid">
          <div className="usage-cell">
            <span>{t('Core CPU')}</span>
            <strong>{state.usage.cpu.toFixed(1)}%</strong>
          </div>
          <div className="usage-cell">
            <span>{t('Core memory')}</span>
            <strong>{formatBytes(state.usage.memory)}</strong>
          </div>
          <div className="usage-cell">
            <span>{t('PID')}</span>
            <strong>{state.usage.pid ?? '—'}</strong>
          </div>
          <div className="usage-cell">
            <span>{t('Kill switch')}</span>
            <strong className={protectionTone(state.protection.killSwitch)}>
              {protectionText(state.protection.killSwitch)}
            </strong>
          </div>
          <div className="usage-cell">
            <span>{t('DNS guard')}</span>
            <strong className={protectionTone(state.protection.dns)}>
              {protectionText(state.protection.dns)}
            </strong>
          </div>
        </div>
      </div>

      <div className="comparison panel">
        <div className="session-head">
          <span className="tile-label" style={{ margin: 0 }}>
            {t('Engine comparison')}
          </span>
          <span className="muted-note">{t('Aggregated from your recorded sessions')}</span>
        </div>
        <div className="comparison-table">
          <div className="comparison-row is-head">
            <span>{t('Engine')}</span>
            <span>{t('Sessions')}</span>
            <span>{t('Downloaded')}</span>
            <span>{t('Uploaded')}</span>
            <span>{t('Avg latency')}</span>
            <span>{t('Last used')}</span>
          </div>
          {state.comparison.map((row) => (
            <div className={`comparison-row ${row.engine === state.engine ? 'is-active' : ''}`} key={row.engine}>
              <span className="comparison-engine">{ENGINE_LABEL[row.engine]}</span>
              <span>{row.sessions}</span>
              <span>{formatBytes(row.downTotal)}</span>
              <span>{formatBytes(row.upTotal)}</span>
              <span>{row.avgPing !== null ? t('{ping} ms', { ping: row.avgPing }) : '—'}</span>
              <span>{row.lastUsedAt ? formatDateTime(row.lastUsedAt) : '—'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title">{t('Session history')}</div>
      <div className="sessions panel">
        {snap.sessions.length === 0 ? (
          <div className="empty-hint">{t('No finished sessions yet. Connect and disconnect to record one.')}</div>
        ) : (
          <>
            <div className="session-head">
              <span className="tile-label" style={{ margin: 0 }}>
                {t('Recent sessions · {count}', { count: snap.sessions.length })}
              </span>
              <button className="btn small danger" onClick={() => void window.eaglet.clearSessions()}>
                {t('Clear history')}
              </button>
            </div>
            <div className="session-table">
              <div className="session-row is-head">
                <span>{t('Node')}</span>
                <span>{t('Engine')}</span>
                <span>{t('Started')}</span>
                <span>{t('Duration')}</span>
                <span>{t('Down')}</span>
                <span>{t('Up')}</span>
                <span>{t('Quality')}</span>
                <span>{t('Exit')}</span>
              </div>
              {snap.sessions.map((session) => (
                <div className="session-row" key={session.id}>
                  <span className="session-node">
                    <strong>{session.profileName}</strong>
                    <span>{session.protocol.toUpperCase()}</span>
                  </span>
                  <span className="session-engine">{ENGINE_LABEL[session.engine]}</span>
                  <span>{formatDateTime(session.startedAt)}</span>
                  <span>{formatDuration(session.durationSeconds)}</span>
                  <span>{formatBytes(session.downTotal)}</span>
                  <span>{formatBytes(session.upTotal)}</span>
                  <span>
                    {session.ping !== null ? t('{ping} ms', { ping: Math.round(session.ping) }) : '—'}
                    {session.jitter !== null ? t(' · ±{jitter}', { jitter: Math.round(session.jitter) }) : ''}
                    {session.loss !== null ? t(' · {loss}%', { loss: session.loss.toFixed(1) }) : ''}
                  </span>
                  <span className="session-exit">
                    {session.exitIp ?? '—'}
                    {session.exitCountry ? t(' · {country}', { country: session.exitCountry }) : ''}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="section-title">{t('Engine switch history')}</div>
      <div className="engine-history panel">
        {snap.engineHistory.length === 0 ? (
          <div className="empty-hint">{t('No engine switches recorded yet.')}</div>
        ) : (
          <>
            <div className="session-head">
              <span className="tile-label" style={{ margin: 0 }}>
                {t('Last {count} switches', { count: snap.engineHistory.length })}
              </span>
              <button className="btn small" onClick={() => void window.eaglet.clearEngineHistory()}>
                {t('Clear')}
              </button>
            </div>
            {snap.engineHistory.slice(0, 12).map((record) => (
              <div className="history-row" key={record.id}>
                <span className={`history-dot ${record.reason}`} />
                <span className="history-engine">
                  {record.from ? ENGINE_LABEL[record.from] : t('none')} → {ENGINE_LABEL[record.to]}
                </span>
                <span className="history-reason">{record.reason}</span>
                <span className="history-profile">{record.profileName ?? '—'}</span>
                <span className="history-time">{formatDateTime(record.at)}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="section-title">{t('Diagnostics & maintenance')}</div>
      <div className="diag panel">
        <div className="diag-head">
          <div>
            <strong>{t('Real checks against the running system')}</strong>
            <span>
              {settings.tunMode ? t('TUN mode · ') : settings.systemProxy ? t('System proxy · ') : ''}
              {settings.killSwitch || settings.networkProtection ? t('Kill switch · ') : ''}
              {settings.dnsProtection || settings.networkProtection ? t('DNS guard') : t('Standard DNS')}
            </span>
          </div>
          <button className="btn primary" onClick={() => void diagnose()} disabled={diagnosing}>
            {diagnosing ? t('Checking…') : t('Run diagnostics')}
          </button>
        </div>

        {diagnostics && (
          <div className="diag-list">
            <div className="diag-summary">
              <HistoryIcon />
              <strong>{diagnostics.summary}</strong>
              <span>{formatDateTime(diagnostics.at)}</span>
            </div>
            {diagnostics.checks.map((check) => (
              <div className={`diag-row ${check.status}`} key={check.id}>
                <span className="diag-status">
                  {check.status === 'pass' ? <CheckIcon /> : check.status === 'fail' ? '✕' : check.status === 'warn' ? '!' : '–'}
                </span>
                <span className="diag-label">{check.label}</span>
                <span className="diag-detail">{check.detail}</span>
              </div>
            ))}
          </div>
        )}

        <div className="maintenance-row">
          <button className="btn small" onClick={() => void exportBackup()} disabled={action !== null}>
            {t('Export backup')}
          </button>
          <button className="btn small" onClick={() => void importBackup()} disabled={action !== null}>
            {t('Restore backup')}
          </button>
          <button className="btn small" onClick={() => void exportConfig()} disabled={action !== null}>
            {t('Export core config')}
          </button>
          <button className="btn small" onClick={() => void window.eaglet.checkEngineUpdates()}>
            {t('Check engine updates')}
          </button>
        </div>
        {action && <div className="import-message ok">{action}</div>}
        {actionError && <div className="callout danger">{actionError}</div>}
      </div>

      <div className="section-title">{t('Tunnel facts')}</div>
      <div className="facts panel">
        <Fact label={t('Profile')} value={state.profile?.name ?? t('None selected')} />
        <Fact label={t('Protocol')} value={state.profile?.protocol.toUpperCase() ?? '—'} />
        <Fact label={t('Engine')} value={ENGINE_LABEL[state.engine]} />
        <Fact label={t('Exit IP')} value={ip.exit?.ip ?? '—'} />
        <Fact label={t('Exit location')} value={[ip.exit?.city, ip.exit?.country].filter(Boolean).join(', ') || '—'} />
        <Fact
          label={t('Core')}
          value={currentEngine?.version ? `${ENGINE_LABEL[state.engine]} ${currentEngine.version}` : t('Not installed')}
        />
        <Fact label={t('Routing')} value={settings.routingMode.toUpperCase()} />
        <Fact label={t('IPv6')} value={settings.ipv6 ? t('Enabled') : t('Blocked')} />
        <Fact label={t('Subscriptions')} value={subscriptions.length ? String(subscriptions.length) : '—'} />
      </div>

      <div className="section-title">{t('Event log')}</div>
      <div className="log-panel panel">
        {state.logs.length === 0 && <div className="empty-hint">{t('Nothing logged yet.')}</div>}
        {state.logs.map((entry) => (
          <div className="log-row" key={entry.id}>
            <span className="log-time">{formatClock(entry.time)}</span>
            <span className={`log-level ${entry.level}`}>{entry.level}</span>
            <span className="log-msg">{entry.message}</span>
          </div>
        ))}
      </div>
      <div className="chart-note">
        <ChartIcon /> {t('Session data, engine comparisons and diagnostics are stored locally on this machine.')}
      </div>
    </div>
  )
}
