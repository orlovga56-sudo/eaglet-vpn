import { ChartIcon, GearIcon, GlobeIcon, HomeIcon, LogoIcon, RouteIcon, SparkIcon } from './Icons'
import type { PageId } from '../App'

interface Props {
  page: PageId
  onNavigate: (page: PageId) => void
  profileCount: number
  subscriptions: number
  engineName: string
  engineVersion: string | null
  systemProxy: boolean
  protection: boolean
  version: string
}

const ITEMS: Array<{ id: PageId; label: string; icon: React.JSX.Element }> = [
  { id: 'home', label: 'Home', icon: <HomeIcon /> },
  { id: 'servers', label: 'Servers', icon: <GlobeIcon /> },
  { id: 'scenarios', label: 'Scenarios', icon: <SparkIcon /> },
  { id: 'routing', label: 'Routing', icon: <RouteIcon /> },
  { id: 'stats', label: 'Stats', icon: <ChartIcon /> },
  { id: 'settings', label: 'Settings', icon: <GearIcon /> }
]

export function Sidebar({
  page,
  onNavigate,
  profileCount,
  subscriptions,
  engineName,
  engineVersion,
  systemProxy,
  protection,
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
          <span>Engine</span>
          <strong>{engineVersion ? `${engineName} ${engineVersion}` : `${engineName} · not installed`}</strong>
        </div>
        <div className="side-chip">
          <span>Protection</span>
          <strong>{protection ? 'armed' : systemProxy ? 'system proxy' : 'manual'}</strong>
        </div>
        <div className="side-version">
          EAGLET v{version} · {subscriptions} SUB{subscriptions === 1 ? '' : 'S'}
        </div>
      </div>
    </aside>
  )
}
