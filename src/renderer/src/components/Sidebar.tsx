import { ChartIcon, GearIcon, GlobeIcon, HomeIcon, LogoIcon, RouteIcon, SparkIcon } from './Icons'
import { t } from '../i18n'
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

function navItems(): Array<{ id: PageId; label: string; icon: React.JSX.Element }> {
  return [
    { id: 'home', label: t('Home'), icon: <HomeIcon /> },
    { id: 'servers', label: t('Servers'), icon: <GlobeIcon /> },
    { id: 'scenarios', label: t('Scenarios'), icon: <SparkIcon /> },
    { id: 'routing', label: t('Routing'), icon: <RouteIcon /> },
    { id: 'stats', label: t('Stats'), icon: <ChartIcon /> },
    { id: 'settings', label: t('Settings'), icon: <GearIcon /> }
  ]
}

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
          <span className="brand-tag">{t('Private network')}</span>
        </div>
      </div>

      <nav className="nav">
        {navItems().map((item) => (
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
          <span>{t('Engine')}</span>
          <strong>{engineVersion ? `${engineName} ${engineVersion}` : t('{engine} · not installed', { engine: engineName })}</strong>
        </div>
        <div className="side-chip">
          <span>{t('Protection')}</span>
          <strong>{protection ? t('armed') : systemProxy ? t('system proxy') : t('manual')}</strong>
        </div>
        <div className="side-version">
          {subscriptions === 1
            ? t('EAGLET v{version} · {count} SUB', { version, count: subscriptions })
            : t('EAGLET v{version} · {count} SUBS', { version, count: subscriptions })}
        </div>
      </div>
    </aside>
  )
}
