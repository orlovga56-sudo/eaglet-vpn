import type { VpnStatus } from '@shared/types'
import { PowerIcon } from './Icons'

interface Props {
  status: VpnStatus
  onToggle: () => void
}

export function PowerDial({ status, onToggle }: Props): React.JSX.Element {
  return (
    <button
      className="dial"
      data-status={status}
      onClick={onToggle}
      title={status === 'connected' ? 'Disconnect' : 'Connect'}
      aria-label={status === 'connected' ? 'Disconnect' : 'Connect'}
    >
      <span className="dial-halo" />
      <span className="dial-ring dial-ring--outer" />
      <span className="dial-ring dial-ring--mid" />
      <span className="dial-ring dial-ring--inner" />
      <span className="dial-core">
        <PowerIcon />
      </span>
    </button>
  )
}
