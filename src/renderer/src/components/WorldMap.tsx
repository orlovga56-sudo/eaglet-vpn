import type { IpInfo, VpnStatus } from '@shared/types'
import worldMap from '../data/worldMap.json'

interface Props {
  direct: IpInfo | null
  exit: IpInfo | null
  status: VpnStatus
  onManage: () => void
}

const MAP_W = worldMap.width
const MAP_H = worldMap.height

/** Equirectangular projection used by the bundled world path. */
function project(info: IpInfo): { x: number; y: number } {
  return {
    x: ((info.lon + 180) / 360) * MAP_W,
    y: ((90 - info.lat) / 180) * MAP_H
  }
}

export function WorldMap({ direct, exit, status, onManage }: Props): React.JSX.Element {
  const live = status === 'connected' || status === 'connecting'
  const from = direct ? project(direct) : null
  const to = exit ? project(exit) : null

  let arc = ''
  if (from && to) {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dist = Math.hypot(dx, dy)
    const mx = (from.x + to.x) / 2
    const my = Math.min(from.y, to.y) - dist * 0.3
    arc = `M${from.x.toFixed(1)} ${from.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`
  }

  const place = [exit?.city, exit?.country].filter(Boolean).join(', ')

  return (
    <section className="map-card panel">
      <div className="map-meta">
        <span className="map-title">
          <span className="pulse" style={{ opacity: live ? 1 : 0.3 }} />
          {live ? 'Encrypted route' : 'Standby'}
        </span>
        <button className="map-node" onClick={onManage} title="Manage servers">
          {exit?.countryCode ? <span className="code">{exit.countryCode}</span> : null}
          {place || 'Add a node'}
          <span style={{ color: 'var(--dim)' }}>›</span>
        </button>
      </div>

      <svg
        className="map-svg"
        viewBox="0 50 1000 300"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label="World map with the real direct and tunnel exit locations"
      >
        <defs>
          <pattern id="eg-dots" width="6.5" height="6.5" patternUnits="userSpaceOnUse">
            <circle cx="1.6" cy="1.6" r="1.15" fill="var(--map-dot)" />
          </pattern>
          <radialGradient id="eg-node-glow">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.55" />
            <stop offset="45%" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
          {from && to && (
            <linearGradient id="eg-arc" gradientUnits="userSpaceOnUse" x1={from.x} y1={from.y} x2={to.x} y2={to.y}>
              <stop offset="0%" stopColor="var(--accent-2)" stopOpacity="0.15" />
              <stop offset="45%" stopColor="var(--accent)" stopOpacity="0.8" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="1" />
            </linearGradient>
          )}
        </defs>

        <path d={worldMap.path} fill="url(#eg-dots)" opacity="0.9" />
        <path d={worldMap.path} fill="var(--map-land)" opacity="0.06" />

        {to && <circle cx={to.x} cy={to.y} r="60" fill="url(#eg-node-glow)" opacity={live ? 1 : 0.45} />}

        {from && to && (
          <>
            <path
              d={arc}
              fill="none"
              stroke="url(#eg-arc)"
              strokeWidth="1.6"
              strokeLinecap="round"
              className={live ? 'map-arc' : undefined}
              opacity={live ? 1 : 0.5}
            />
            {live && (
              <>
                <circle r="2.4" fill="var(--accent)" opacity="0.95">
                  <animateMotion dur="3.4s" repeatCount="indefinite" path={arc} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
                </circle>
                <circle r="6" fill="var(--accent)" opacity="0.18">
                  <animateMotion dur="3.4s" repeatCount="indefinite" path={arc} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
                </circle>
              </>
            )}
          </>
        )}

        {from && (
          <>
            <circle cx={from.x} cy={from.y} r="3" fill="var(--text)" opacity="0.85" />
            <circle cx={from.x} cy={from.y} r="8" fill="none" stroke="var(--accent-2)" strokeWidth="1" opacity="0.5" />
            <text
              x={from.x + 12}
              y={from.y + 4}
              fill="var(--dim)"
              style={{ fontSize: 9, fontFamily: 'var(--mono)', fontWeight: 600, letterSpacing: '0.14em' }}
            >
              YOU
            </text>
          </>
        )}

        {to && (
          <>
            <circle cx={to.x} cy={to.y} r="3.4" fill="var(--accent)" />
            <circle
              cx={to.x}
              cy={to.y}
              r="7"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.3"
              opacity={live ? 0.9 : 0.4}
              className={live ? 'map-ring' : undefined}
            />
            <text
              x={to.x + 12}
              y={to.y + 4}
              fill="var(--muted)"
              style={{ fontSize: 9, fontFamily: 'var(--mono)', fontWeight: 600, letterSpacing: '0.14em' }}
            >
              {exit?.countryCode || 'EXIT'}
            </text>
          </>
        )}
      </svg>

      <div className="map-fade" />
    </section>
  )
}
