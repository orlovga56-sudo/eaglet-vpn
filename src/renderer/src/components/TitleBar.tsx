import type { VpnStatus } from '@shared/types'
import { ExpandIcon, ShrinkIcon } from './Icons'

interface Props {
  status: VpnStatus
  protocol: string
  mini: boolean
  onMini: (mini: boolean) => void
}

const STATUS_TEXT: Record<VpnStatus, string> = {
  connected: 'Tunnel up',
  connecting: 'Connecting',
  disconnecting: 'Closing',
  disconnected: 'Offline',
  error: 'Error'
}

export function TitleBar({ status, protocol, mini, onMini }: Props): React.JSX.Element {
  return (
    <header className="titlebar">
      <div className="traffic">
        <button className="dot-close" title="Close" onClick={() => window.eaglet.windowClose()} />
        <button className="dot-min" title="Minimize" onClick={() => window.eaglet.windowMinimize()} />
        <button className="dot-max" title="Maximize" onClick={() => window.eaglet.windowToggleMaximize()} />
      </div>

      <span className="titlebar-title">Eaglet</span>

      <div className="titlebar-right">
        {!mini && (
          <>
            <span className="titlebar-chip">
              <span className="pulse" style={{ opacity: status === 'connected' ? 1 : 0.25 }} />
              {STATUS_TEXT[status]}
            </span>
            <span className="titlebar-chip">{protocol}</span>
          </>
        )}
        <button
          className="icon-button"
          title={mini ? 'Open dashboard' : 'Compact mode'}
          onClick={() => onMini(!mini)}
        >
          {mini ? <ExpandIcon /> : <ShrinkIcon />}
        </button>
      </div>
    </header>
  )
}
