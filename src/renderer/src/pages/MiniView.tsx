import type { Snapshot } from '@shared/types'
import { PowerDial } from '../components/PowerDial'
import { Sparkline } from '../components/Sparkline'
import { ExpandIcon } from '../components/Icons'
import { formatDuration } from '../format'
import { t } from '../i18n'

interface Props {
  snap: Snapshot
  onToggle: () => void
  onManageServers: () => void
  onExpand: () => void
}

export function MiniView({ snap, onToggle, onManageServers, onExpand }: Props): React.JSX.Element {
  const { state } = snap
  const connected = state.status === 'connected'
  const profile = state.profile
  const label =
    state.status === 'connected'
      ? t('Connected')
      : state.status === 'connecting'
        ? t('Connecting')
        : state.status === 'disconnecting'
          ? t('Closing')
          : state.status === 'error'
            ? t('Error')
            : t('Disconnected')

  const place = [state.ip.exit?.city, state.ip.exit?.country].filter(Boolean).join(', ')

  return (
    <div className="mini">
      <PowerDial status={state.status} onToggle={onToggle} />

      <div className="status-block" style={{ minHeight: 0 }}>
        <div className={`status-label ${connected || state.status === 'connecting' ? '' : 'is-off'}`}>
          <span className="pulse" />
          {label}
        </div>
        <div className="status-location">
          {profile ? (
            <>
              <strong>{profile.name}</strong>
            </>
          ) : (
            t('No profile selected')
          )}
        </div>
        <div className="status-meta">
          {connected
            ? formatDuration(state.metrics.sessionSeconds)
            : (profile?.protocol.toUpperCase() ?? t('No tunnel'))}
        </div>
      </div>

      <div className="mini-card panel">
        <div className="mini-metric">
          <span>{t('Ping')}</span>
          <strong>
            {connected ? Math.round(state.metrics.ping) : '—'}
            <em>ms</em>
          </strong>
        </div>
        <div className="mini-metric">
          <span>{t('Down')}</span>
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

      <div className={`mini-ip panel ${state.ip.changed ? 'is-changed' : ''}`}>
        <div>
          <span>{t('Exit IP')}</span>
          <strong>{state.ip.exit?.ip ?? '—'}</strong>
        </div>
        <span className={`ip-badge ${state.ip.changed ? 'ok' : 'idle'}`}>
          {state.ip.changed ? t('Changed') : connected ? t('No change') : t('Standby')}
        </span>
        <div className="mini-ip-place">{place || t('No probe yet')}</div>
      </div>

      <button className="mini-server panel" onClick={onManageServers}>
        <span className="server-code">{state.ip.exit?.countryCode ?? profile?.protocol.slice(0, 2).toUpperCase() ?? '··'}</span>
        <span className="mini-server-info">
          <strong>{profile?.name ?? t('No profile')}</strong>
          <span>
            {profile
              ? t('{count} connections', { count: state.metrics.connections })
              : t('Import a subscription')}
          </span>
        </span>
        <span style={{ color: 'var(--dim)' }}>›</span>
      </button>

      <button className="mini-expand" onClick={onExpand}>
        <ExpandIcon />
        {t('Open dashboard')}
      </button>
    </div>
  )
}
