import { useMemo, useState } from 'react'
import type { ServerInfo, Snapshot } from '@shared/types'
import { SearchIcon } from '../components/Icons'

interface Props {
  snap: Snapshot
  onConnect: (serverId: string) => void
  onSelect: (serverId: string) => void
  onDisconnect: () => void
}

export function Servers({ snap, onConnect, onSelect, onDisconnect }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const { state, servers } = snap
  const selectedId = state.server.id
  const connected = state.status === 'connected'

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return servers
    return servers.filter(
      (server) =>
        server.country.toLowerCase().includes(q) ||
        server.city.toLowerCase().includes(q) ||
        server.code.toLowerCase().includes(q)
    )
  }, [query, servers])

  const pingLabel = (server: ServerInfo): string => (server.premium ? 'Dedicated' : 'Shared')

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Network</p>
          <h1 className="page-title">Servers</h1>
          <p className="page-sub">
            {servers.length} encrypted exit nodes across 12 countries. Pick the closest one for the lowest latency.
          </p>
        </div>
      </header>

      <div className="toolbar">
        <div className="search panel">
          <SearchIcon />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search country, city or code…"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="server-list">
        {filtered.map((server) => {
          const isSelected = server.id === selectedId
          const isActive = isSelected && connected
          return (
            <button
              key={server.id}
              className={`server panel ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelect(server.id)}
            >
              <span className="server-code">{server.code}</span>
              <span className="server-name">
                <strong>
                  {server.city}
                  {server.premium && <span className="premium-tag">PRO</span>}
                </strong>
                <span>
                  {server.country} · {pingLabel(server)}
                </span>
              </span>
              <span className="load">
                <span className="load-bar">
                  <span style={{ width: `${server.load}%` }} />
                </span>
                {server.load}%
              </span>
              <span className="ping">
                <strong>{server.ping}</strong> ms
              </span>
              <span
                className={`server-action ${isActive ? 'primary' : ''}`}
                role="button"
                onClick={(event) => {
                  event.stopPropagation()
                  if (isActive) onDisconnect()
                  else onConnect(server.id)
                }}
              >
                {isActive ? 'Disconnect' : state.status === 'connecting' && isSelected ? 'Connecting' : 'Connect'}
              </span>
            </button>
          )
        })}
        {filtered.length === 0 && <div className="empty-hint">No nodes match “{query}”.</div>}
      </div>
    </div>
  )
}
