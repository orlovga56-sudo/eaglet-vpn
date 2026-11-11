import { ChartIcon, GearIcon, GlobeIcon, HomeIcon, LogoIcon, RouteIcon } from './Icons'
import type { PageId } from '../App'

interface Props {
  page: PageId
  onNavigate: (page: PageId) => void
  profileCount: number
  subscriptions: number
  coreVersion: string | null
  systemProxy: boolean
  version: string
}

const ITEMS: Array<{ id: PageId; label: string; icon: React.JSX.Element }> = [
  { id: 'home', label: 'Home', icon: <HomeIcon /> },
  { id: 'servers', label: 'Servers', icon: <GlobeIcon /> },
  { id: 'routing', label: 'Routing', icon: <RouteIcon /> },
  { id: 'stats', label: 'Stats', icon: <ChartIcon /> },
  { id: 'settings', label: 'Settings', icon: <GearIcon /> }
]

export function Sidebar({
  page,
  onNavigate,
  profileCount,
  subscriptions,
  coreVersion,
  systemProxy,
  version
}: Props): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <LogoIcon />
        </div>
        <div>
          <span className="brand-name">Eaglet</span>
          <span className="brand-tag">Private network</span>
        </div>
      </div>

      <nav className="nav">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            {item.icon}
            {item.label}
            {item.id === 'servers' && <span className="badge">{profileCount}</span>}
          </button>
        ))}
      </nav>

      <div className="side-foot">
        <div className="side-chip">
          <span>Core</span>
          <strong>{coreVersion ? `sing-box ${coreVersion}` : 'not found'}</strong>
        </div>
        <div className="side-chip">
          <span>Routing</span>
          <strong>{systemProxy ? 'system proxy' : 'manual'}</strong>
        </div>
        <div className="side-version">
          EAGLET v{version} · {subscriptions} SUB{subscriptions === 1 ? '' : 'S'}
        </div>
      </div>
    </aside>
  )
}
