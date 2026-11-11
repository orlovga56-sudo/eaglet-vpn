import { useMemo, useState } from 'react'
import type { Profile, ProtocolId, Snapshot } from '@shared/types'
import { SearchIcon } from '../components/Icons'

interface Props {
  snap: Snapshot
  onConnect: (profileId: string) => void
  onSelect: (profileId: string) => void
  onDisconnect: () => void
}

const PROTOCOL_LABEL: Record<ProtocolId, string> = {
  vless: 'VLESS',
  vmess: 'VMess',
  trojan: 'Trojan',
  shadowsocks: 'SS',
  hysteria2: 'Hysteria2',
  tuic: 'TUIC',
  socks: 'SOCKS',
  http: 'HTTP',
  direct: 'Direct'
}

function cleanError(error: unknown): string {
  const message = (error as Error)?.message ?? 'Something went wrong'
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

function formatAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  return new Date(timestamp).toLocaleDateString()
}

export function Servers({ snap, onConnect, onSelect, onDisconnect }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const { state, profiles, subscriptions } = snap
  const selectedId = state.profile?.id ?? null
  const connected = state.status === 'connected'
  const busyConnection = state.status === 'connecting'

  const nameForSource = (sourceId: string | null): string | null => {
    if (!sourceId) return null
    return subscriptions.find((item) => item.id === sourceId)?.name ?? null
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter((profile) =>
      [profile.name, profile.host, profile.protocol, nameForSource(profile.sourceId) ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q)
    )
  }, [profiles, query, subscriptions])

  const runImport = async (): Promise<void> => {
    const value = input.trim()
    if (!value || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await window.eaglet.importProfiles(value)
      setInput('')
      setMessage({
        tone: 'ok',
        text: result.subscription
          ? `Subscription saved · ${result.subscription.count} nodes from ${result.subscription.name}`
          : `${result.imported} node(s) added${result.updated ? `, ${result.updated} updated` : ''}`
      })
    } catch (error) {
      setMessage({ tone: 'err', text: cleanError(error) })
    } finally {
      setBusy(false)
    }
  }

  const refresh = async (id: string): Promise<void> => {
    setRefreshing(id)
    setMessage(null)
    try {
      const result = await window.eaglet.updateSubscription(id)
      setMessage({ tone: 'ok', text: `Subscription updated · ${result.subscription?.count ?? 0} nodes` })
    } catch (error) {
      setMessage({ tone: 'err', text: cleanError(error) })
    } finally {
      setRefreshing(null)
    }
  }

  const testAll = async (ids?: string[]): Promise<void> => {
    setTesting(true)
    try {
      await window.eaglet.testProfiles(ids)
    } catch (error) {
      setMessage({ tone: 'err', text: cleanError(error) })
    } finally {
      setTesting(false)
    }
  }

  const removeProfile = async (profile: Profile): Promise<void> => {
    try {
      await window.eaglet.removeProfile(profile.id)
    } catch (error) {
      setMessage({ tone: 'err', text: cleanError(error) })
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Network</p>
          <h1 className="page-title">Servers</h1>
          <p className="page-sub">
            Import a subscription URL or paste share links. Eaglet runs them on the sing-box core — VLESS, VMess,
            Trojan, Shadowsocks, Hysteria2 and TUIC.
          </p>
        </div>
        <button className="btn primary" onClick={() => void testAll()} disabled={testing || profiles.length === 0}>
          {testing ? 'Testing…' : 'Test all'}
        </button>
      </header>

      <div className="import panel">
        <div className="import-head">
          <strong>Add nodes</strong>
          <span>Subscription URL · share link · base64 list</span>
        </div>
        <div className="import-row">
          <input
            className="import-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runImport()
            }}
            placeholder="https://provider.example/sub/abc  ·  vless://…  ·  ss://…"
            spellCheck={false}
          />
          <button className="btn primary" onClick={() => void runImport()} disabled={busy || !input.trim()}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
        {message && <div className={`import-message ${message.tone}`}>{message.text}</div>}
        {!message && (
          <div className="import-hint">
            Happ, v2rayN and Shadowrocket base64 subscriptions work. Use Update on a subscription to refresh its nodes.
          </div>
        )}
      </div>

      {subscriptions.length > 0 && (
        <>
          <div className="section-title">Subscriptions</div>
          <div className="sub-list">
            {subscriptions.map((subscription) => (
              <div className="sub-item panel" key={subscription.id}>
                <div className="sub-main">
                  <strong>{subscription.name}</strong>
                  <span className="sub-url">{subscription.url}</span>
                </div>
                <span className="sub-count">{subscription.count} nodes</span>
                <span className="sub-age">{formatAgo(subscription.updatedAt)}</span>
                <button
                  className="btn small"
                  onClick={() => void refresh(subscription.id)}
                  disabled={refreshing === subscription.id}
                >
                  {refreshing === subscription.id ? 'Updating…' : 'Update'}
                </button>
                <button
                  className="btn small danger"
                  onClick={() => {
                    if (window.confirm(`Remove ${subscription.name} and its nodes?`)) {
                      void window.eaglet.removeSubscription(subscription.id)
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="toolbar">
        <div className="search panel">
          <SearchIcon />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, protocol or host…"
            spellCheck={false}
          />
        </div>
        <span className="toolbar-count">
          {filtered.length} / {profiles.length}
        </span>
      </div>

      {profiles.length === 0 ? (
        <div className="empty-state panel">
          <strong>No nodes yet</strong>
          <span>Paste a subscription URL above. A subscription usually looks like https://provider.example/api/sub/…</span>
        </div>
      ) : (
        <div className="server-list">
          {filtered.map((profile) => {
            const isSelected = profile.id === selectedId
            const isActive = isSelected && connected
            const source = nameForSource(profile.sourceId)
            return (
              <div
                key={profile.id}
                className={`profile panel ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelect(profile.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onSelect(profile.id)
                }}
              >
                <span className="proto-badge">{PROTOCOL_LABEL[profile.protocol]}</span>
                <span className="profile-name">
                  <strong>{profile.name}</strong>
                  <span>
                    {profile.protocol === 'direct' ? 'Built-in direct route' : `${profile.host}:${profile.port}`}
                    {source ? ` · ${source}` : ''}
                  </span>
                </span>
                <span className={`ping ${profile.ping === null ? 'is-idle' : ''}`}>
                  <strong>{profile.ping === null ? '—' : profile.ping}</strong> ms
                </span>
                <span className="profile-actions">
                  <button
                    className="btn tiny"
                    onClick={(event) => {
                      event.stopPropagation()
                      void testAll([profile.id])
                    }}
                    disabled={testing || profile.protocol === 'direct'}
                    title="Measure latency"
                  >
                    Test
                  </button>
                  <button
                    className={`btn tiny ${isActive ? 'primary' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (isActive) onDisconnect()
                      else onConnect(profile.id)
                    }}
                    disabled={busyConnection && isSelected}
                  >
                    {isActive ? 'Disconnect' : busyConnection && isSelected ? 'Connecting' : 'Connect'}
                  </button>
                  <button
                    className="icon-ghost"
                    title="Remove node"
                    onClick={(event) => {
                      event.stopPropagation()
                      void removeProfile(profile)
                    }}
                  >
                    ×
                  </button>
                </span>
              </div>
            )
          })}
          {filtered.length === 0 && <div className="empty-hint">No nodes match “{query}”.</div>}
        </div>
      )}
    </div>
  )
}
