import type { VpnStatus } from '@shared/types'
import { ExpandIcon, ShrinkIcon } from './Icons'
import { t } from '../i18n'

interface Props {
  status: VpnStatus
  protocol: string
  mini: boolean
  onMini: (mini: boolean) => void
}

function statusText(): Record<VpnStatus, string> {
  return {
    connected: t('Tunnel up'),
    connecting: t('Connecting'),
    disconnecting: t('Closing'),
    disconnected: t('Offline'),
    error: t('Error')
  }
}

export function TitleBar({ status, protocol, mini, onMini }: Props): React.JSX.Element {
  return (
    <header className="titlebar">
      <div className="traffic">
        <button className="dot-close" title={t('Close')} onClick={() => window.eaglet.windowClose()} />
        <button className="dot-min" title={t('Minimize')} onClick={() => window.eaglet.windowMinimize()} />
        <button className="dot-max" title={t('Maximize')} onClick={() => window.eaglet.windowToggleMaximize()} />
      </div>

      <span className="titlebar-title">Eaglet</span>

      <div className="titlebar-right">
        {!mini && (
          <>
            <span className="titlebar-chip">
              <span className="pulse" style={{ opacity: status === 'connected' ? 1 : 0.25 }} />
              {statusText()[status]}
            </span>
            <span className="titlebar-chip">{protocol}</span>
          </>
        )}
        <button
          className="icon-button"
          title={mini ? t('Open dashboard') : t('Compact mode')}
          onClick={() => onMini(!mini)}
        >
          {mini ? <ExpandIcon /> : <ShrinkIcon />}
        </button>
      </div>
    </header>
  )
}
