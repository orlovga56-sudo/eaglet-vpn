import type { ServerInfo, VpnStatus } from '@shared/types'
import worldMap from '../data/worldMap.json'

interface Props {
  server: ServerInfo
  status: VpnStatus
  onManage: () => void
}

const MAP_W = worldMap.width
const MAP_H = worldMap.height
const USER = { x: 0.604, y: 0.2 }

export function WorldMap({ server, status, onManage }: Props): React.JSX.Element {
  const ux = USER.x * MAP_W
  const uy = USER.y * MAP_H
  const sx = server.x * MAP_W
  const sy = server.y * MAP_H

  const dx = sx - ux
  const dy = sy - uy
  const dist = Math.hypot(dx, dy)
  const mx = (ux + sx) / 2
  const my = Math.min(uy, sy) - dist * 0.3
  const arc = `M${ux.toFixed(1)} ${uy.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${sx.toFixed(1)} ${sy.toFixed(1)}`
  const live = status === 'connected' || status === 'connecting'

  return (
    <section className="map-card panel">
      <div className="map-meta">
        <span className="map-title">
          <span className="pulse" style={{ opacity: live ? 1 : 0.3 }} />
          {live ? 'Encrypted route' : 'Standby'}
        </span>
        <button className="map-node" onClick={onManage} title="Change server">
          <span className="code">{server.code}</span>
          {server.city}
          <span style={{ color: 'var(--dim)' }}>›</span>
        </button>
      </div>

      <svg
        className="map-svg"
        viewBox="0 50 1000 300"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label="World map with the active tunnel route"
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
          <linearGradient id="eg-arc" gradientUnits="userSpaceOnUse" x1={ux} y1={uy} x2={sx} y2={sy}>
            <stop offset="0%" stopColor="var(--accent-2)" stopOpacity="0.15" />
            <stop offset="45%" stopColor="var(--accent)" stopOpacity="0.8" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="1" />
          </linearGradient>
        </defs>

        <path d={worldMap.path} fill="url(#eg-dots)" opacity="0.9" />
        <path d={worldMap.path} fill="var(--map-land)" opacity="0.06" />

        <circle cx={sx} cy={sy} r="60" fill="url(#eg-node-glow)" opacity={live ? 1 : 0.45} />

        {live && (
          <>
            <path
              d={arc}
              fill="none"
              stroke="url(#eg-arc)"
              strokeWidth="1.6"
              strokeLinecap="round"
              className="map-arc"
            />
            <circle r="2.4" fill="var(--accent)" opacity="0.95">
              <animateMotion dur="3.4s" repeatCount="indefinite" path={arc} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
            </circle>
            <circle r="6" fill="var(--accent)" opacity="0.18">
              <animateMotion dur="3.4s" repeatCount="indefinite" path={arc} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
            </circle>
          </>
        )}

        <circle cx={ux} cy={uy} r="3" fill="var(--text)" opacity="0.85" />
        <circle cx={ux} cy={uy} r="8" fill="none" stroke="var(--accent-2)" strokeWidth="1" opacity="0.5" />

        <circle cx={sx} cy={sy} r="3.4" fill="var(--accent)" />
        <circle
          cx={sx}
          cy={sy}
          r="7"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.3"
          opacity={live ? 0.9 : 0.4}
          className={live ? 'map-ring' : undefined}
        />
        <text
          x={sx + 12}
          y={sy + 4}
          fill="var(--muted)"
          style={{ fontSize: 9, fontFamily: 'var(--mono)', fontWeight: 600, letterSpacing: '0.14em' }}
        >
          {server.code}
        </text>
      </svg>

      <div className="map-fade" />
    </section>
  )
}
