import { ChartIcon, GearIcon, GlobeIcon, HomeIcon, LogoIcon, RouteIcon } from './Icons'
import type { PageId } from '../App'

interface Props {
  page: PageId
  onNavigate: (page: PageId) => void
  protocol: string
  serverCount: number
  version: string
}

const ITEMS: Array<{ id: PageId; label: string; icon: React.JSX.Element }> = [
  { id: 'home', label: 'Home', icon: <HomeIcon /> },
  { id: 'servers', label: 'Servers', icon: <GlobeIcon /> },
  { id: 'routing', label: 'Routing', icon: <RouteIcon /> },
  { id: 'stats', label: 'Stats', icon: <ChartIcon /> },
  { id: 'settings', label: 'Settings', icon: <GearIcon /> }
]

export function Sidebar({ page, onNavigate, protocol, serverCount, version }: Props): React.JSX.Element {
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
            {item.id === 'servers' && <span className="badge">{serverCount}</span>}
          </button>
        ))}
      </nav>

      <div className="side-foot">
        <div className="side-chip">
          <span>Protocol</span>
          <strong>{protocol}</strong>
        </div>
        <div className="side-version">EAGLET CORE v{version}</div>
      </div>
    </aside>
  )
}
