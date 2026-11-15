import { useMemo, useState } from 'react'
import type { EngineId, FreeDiscoveryResult, Profile, ProtocolId, Snapshot } from '@shared/types'
import { CheckIcon, ClipboardIcon, CopyIcon, GlobeIcon, SearchIcon, StarIcon } from '../components/Icons'
import { Sparkline } from '../components/Sparkline'
import { t } from '../i18n'

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
  const message = (error as Error)?.message ?? t('Something went wrong')
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

function formatAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return t('just now')
  if (seconds < 3600) return t('{count} min ago', { count: Math.round(seconds / 60) })
  if (seconds < 86400) return t('{count} h ago', { count: Math.round(seconds / 3600) })
  return new Date(timestamp).toLocaleDateString('en-US')
}

export function Servers({ snap, onConnect, onSelect, onDisconnect }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'favorites'>('all')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [free, setFree] = useState<FreeDiscoveryResult | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [selectedFree, setSelectedFree] = useState<Set<string>>(new Set())

  const { state, profiles, subscriptions } = snap
  const selectedId = state.profile?.id ?? null
  const connected = state.status === 'connected'
  const busyConnection = state.status === 'connecting'
  const favoriteCount = profiles.filter((profile) => profile.favorite).length

  const nameForSource = (sourceId: string | null): string | null => {
    if (!sourceId) return null
    return subscriptions.find((item) => item.id === sourceId)?.name ?? null
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...profiles]
      .filter((profile) => (filter === 'favorites' ? profile.favorite : true))
      .filter((profile) => {
        if (!q) return true
        return [profile.name, profile.host, profile.protocol, nameForSource(profile.sourceId) ?? '']
          .join(' ')
          .toLowerCase()
          .includes(q)
      })
      .sort((left, right) => Number(right.favorite) - Number(left.favorite) || right.addedAt - left.addedAt)
  }, [profiles, query, subscriptions, filter])

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
          ? t('Subscription saved · {count} nodes from {name}', {
              count: result.subscription.count,
              name: result.subscription.name
            })
          : t('{count} node(s) added{updated}', {
              count: result.imported,
              updated: result.updated ? t(', {count} updated', { count: result.updated }) : ''
            })
      })
    } catch (error) {
      setMessage({ tone: 'err', text: cleanError(error) })
    } finally {
      setBusy(false)
    }
  }

  const importQr = async (): Promise<void> => {
    setMessage(null)
    try {
      const result = await window.eaglet.importQr()
      setMessage({ tone: 'ok', text: t('QR code decoded · {count} node(s) added', { count: result.imported }) })
    } catch (error) {
      setMessage({ tone: 'err', text: cleanError(error) })
    }
  }

  const updateAll = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const results = await window.eaglet.updateAllSubscriptions()
      const nodes = results.reduce((sum, item) => sum + item.imported + item.updated, 0)
      setMessage({
        tone: 'ok',
        text:
          results.length > 0
            ? t('{count} subscription(s) refreshed · {nodes} nodes', { count: results.length, nodes })
            : t('No HTTP subscriptions to refresh')
      })
    } catch (error) {
      setMessage({ tone: 'err', text: cleanError(error) })
    } finally {
      setBusy(false)
    }
  }

  const pinEngine = async (profile: Profile, engine: EngineId | null): Promise<void> => {
    try {
      await window.eaglet.setProfileEngine(profile.id, engine)
    } catch (error) {
      setMessage({ tone: 'err', text: cleanError(error) })
    }
  }

  const refresh = async (id: string): Promise<void> => {
    setRefreshing(id)
    setMessage(null)
    try {
      const result = await window.eaglet.updateSubscription(id)
      setMessage({ tone: 'ok', text: t('Subscription updated · {count} nodes', { count: result.subscription?.count ?? 0 }) })
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

  const toggleFavorite = async (profile: Profile): Promise<void> => {
    try {
      await window.eaglet.setFavorite(profile.id, !profile.favorite)
    } catch (error) {
      setMessage({ tone: 'err', text: cleanError(error) })
    }
  }

  const copyLink = async (profile: Profile): Promise<void> => {
    try {
      await window.eaglet.copyProfileLink(profile.id)
      setCopied(profile.id)
      window.setTimeout(() => setCopied((current) => (current === profile.id ? null : current)), 1400)
    } catch (error) {
      setMessage({ tone: 'err', text: cleanError(error) })
    }
  }

  const pasteFromClipboard = async (): Promise<void> => {
    try {
      // The main process reads and validates the clipboard itself; share links
      // (and their passwords/tokens) never enter the renderer.
      const result = await window.eaglet.importClipboard()
      const total = result.imported + result.updated
      setMessage({
        tone: 'ok',
        text:
          total > 0
            ? t('Imported {count} node(s) from the clipboard.', { count: total })
            : t('Nothing new was imported.')
      })
    } catch (error) {
      setMessage({ tone: 'err', text: cleanError(error) })
    }
  }

  const findFree = async (): Promise<void> => {
    if (discovering) return
    setDiscovering(true)
    setFree(null)
    setMessage(null)
    try {
      const result = await window.eaglet.discoverFree()
      setFree(result)
      setSelectedFree(new Set(result.profiles.slice(0, result.defaultSelection).map((profile) => profile.id)))
    } catch (error) {
      setMessage({ tone: 'err', text: cleanError(error) })
    } finally {
      setDiscovering(false)
    }
  }

  const toggleFree = (id: string): void => {
    setSelectedFree((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const addSelectedFree = async (): Promise<void> => {
    if (!free || selectedFree.size === 0) return
    try {
      const result = await window.eaglet.addFreeProfiles([...selectedFree])
      setFree(null)
      setSelectedFree(new Set())
      setMessage({
        tone: 'ok',
        text: t('Added {count} free {nodeLabel}. Use Test all, then Connect — public nodes are often slow.', {
          count: result.imported,
          nodeLabel: result.imported === 1 ? t('node') : t('nodes')
        })
      })
    } catch (error) {
      setMessage({ tone: 'err', text: cleanError(error) })
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{t('Network')}</p>
          <h1 className="page-title">{t('Servers')}</h1>
          <p className="page-sub">
            {t(
              'Import a subscription URL or paste share links. Eaglet runs them on the sing-box core — VLESS, VMess, Trojan, Shadowsocks, Hysteria2 and TUIC.'
            )}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => void importQr()} title={t('Decode a QR code from an image file')}>
            {t('QR import')}
          </button>
          <button className="btn" onClick={() => void findFree()} disabled={discovering}>
            <GlobeIcon />
            {discovering ? t('Searching…') : t('Find free servers')}
          </button>
          <button className="btn primary" onClick={() => void testAll()} disabled={testing || profiles.length === 0}>
            {testing ? t('Testing…') : t('Test all')}
          </button>
        </div>
      </header>

      <div className="import panel">
        <div className="import-head">
          <strong>{t('Add nodes')}</strong>
          <span>{t('Subscription URL · share link · base64 list')}</span>
        </div>
        <div className="import-row">
          <input
            className="import-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void runImport()
            }}
            placeholder={t('https://provider.example/sub/abc  ·  vless://…  ·  ss://…')}
            spellCheck={false}
          />
          <button
            className="btn"
            onClick={() => void pasteFromClipboard()}
            title={t('Read the clipboard in the main process and import it')}
          >
            <ClipboardIcon />
            {t('Paste & import')}
          </button>
          <button className="btn primary" onClick={() => void runImport()} disabled={busy || !input.trim()}>
            {busy ? t('Importing…') : t('Import')}
          </button>
        </div>
        {message && <div className={`import-message ${message.tone}`}>{message.text}</div>}
        {!message && (
          <div className="import-hint">
            {t(
              'Happ, v2rayN and Shadowrocket base64 subscriptions work. Use Update on a subscription to refresh its nodes.'
            )}
          </div>
        )}
      </div>

      {(discovering || free) && (
        <section className="free panel">
          <div className="free-head">
            <div className="free-title">
              <strong>{t('Free public servers')}</strong>
              <span>
                {discovering
                  ? t('Fetching community catalogs and testing latency…')
                  : t('{working} working · {reachable} reachable · {found} found in catalogs', {
                      working: free?.profiles.length ?? 0,
                      reachable: free?.reachable ?? 0,
                      found: free?.found ?? 0
                    })}
              </span>
            </div>
            {!discovering && (
              <button className="icon-ghost" onClick={() => setFree(null)} title={t('Close')}>
                ×
              </button>
            )}
          </div>

          {discovering ? (
            <div className="free-loading">
              <span className="boot-ring" />
              <p>
                {t(
                  'This can take up to two minutes. Each candidate is started in a throwaway sing-box instance to confirm real traffic, so only working nodes are listed.'
                )}
              </p>
            </div>
          ) : free ? (
            <>
              <div className="free-sources">
                {free.sources.map((source) => (
                  <span
                    key={source.name}
                    className={`free-chip ${source.error ? 'is-bad' : ''}`}
                    title={source.error ? `${source.name}: ${source.error}` : source.url}
                  >
                    {source.name} · {source.error ? t('offline') : source.count}
                  </span>
                ))}
              </div>

              <div className="free-warning">
                {t(
                  "Public nodes are run by unknown people. Don't sign in to banking, work or other sensitive accounts while using them — treat this as a quick way to test the tunnel, not as a trustworthy provider."
                )}
              </div>

              {!free.verified && (
                <div className="free-warning">
                  {t(
                    'The sing-box core was unavailable, so these nodes were only port-checked and may not actually carry traffic.'
                  )}
                </div>
              )}

              {free.profiles.length === 0 ? (
                <div className="free-empty">
                  <strong>{t('No working nodes right now')}</strong>
                  <span>
                    {t(
                      'The catalogs responded, but none of the sampled nodes carried real traffic. Try again in a minute — these lists change constantly.'
                    )}
                  </span>
                  <button className="btn small" onClick={() => void findFree()}>
                    {t('Retry')}
                  </button>
                </div>
              ) : (
                <>
                  <div className="free-list">
                    {free.profiles.map((profile) => (
                      <label
                        key={profile.id}
                        className={`free-row ${selectedFree.has(profile.id) ? 'is-picked' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedFree.has(profile.id)}
                          onChange={() => toggleFree(profile.id)}
                        />
                        <span className="proto-badge">{PROTOCOL_LABEL[profile.protocol]}</span>
                        <span className="free-name">
                          <strong>{profile.name || profile.host}</strong>
                          <span>
                            {profile.host}:{profile.port}
                          </span>
                        </span>
                        <span className="ping">
                          <strong>{profile.ping}</strong> ms
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="free-actions">
                    <span className="free-count">{t('{count} selected', { count: selectedFree.size })}</span>
                    <button
                      className="btn small"
                      onClick={() => setSelectedFree(new Set(free.profiles.map((profile) => profile.id)))}
                    >
                      {t('Select all')}
                    </button>
                    <button className="btn small" onClick={() => setSelectedFree(new Set())}>
                      {t('Clear')}
                    </button>
                    <button
                      className="btn small primary"
                      onClick={() => void addSelectedFree()}
                      disabled={selectedFree.size === 0}
                    >
                      {t('Add selected')}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : null}
        </section>
      )}

      {subscriptions.length > 0 && (
        <>
          <div className="section-title section-title-row">
            <span>{t('Subscriptions')}</span>
            <button className="btn small" onClick={() => void updateAll()} disabled={busy}>
              {t('Update all')}
            </button>
          </div>
          <div className="sub-list">
            {subscriptions.map((subscription) => (
              <div className="sub-item panel" key={subscription.id}>
                <div className="sub-main">
                  <strong>{subscription.name}</strong>
                  <span className="sub-url">{subscription.url}</span>
                </div>
                <span className="sub-count">
                  {subscription.count} {subscription.count === 1 ? t('node') : t('nodes')}
                </span>
                <span className="sub-age">{formatAgo(subscription.updatedAt)}</span>
                {subscription.url.startsWith('eaglet://') ? (
                  <span className="status-pill">{t('Finder')}</span>
                ) : (
                  <button
                    className="btn small"
                    onClick={() => void refresh(subscription.id)}
                    disabled={refreshing === subscription.id}
                  >
                    {refreshing === subscription.id ? t('Updating…') : t('Update')}
                  </button>
                )}
                <button
                  className="btn small danger"
                  onClick={() => {
                    if (window.confirm(t('Remove {name} and its nodes?', { name: subscription.name }))) {
                      void window.eaglet.removeSubscription(subscription.id)
                    }
                  }}
                >
                  {t('Remove')}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="toolbar">
        <div className="filter-chips">
          <button
            className={`filter-chip ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            {t('All')} <span>{profiles.length}</span>
          </button>
          <button
            className={`filter-chip ${filter === 'favorites' ? 'active' : ''}`}
            onClick={() => setFilter('favorites')}
          >
            <StarIcon filled={filter === 'favorites'} /> {t('Favourites')} <span>{favoriteCount}</span>
          </button>
        </div>
        <div className="search panel">
          <SearchIcon />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Search name, protocol or host…')}
            spellCheck={false}
          />
        </div>
        <span className="toolbar-count">
          {filtered.length} / {profiles.length}
        </span>
      </div>

      {profiles.length === 0 ? (
        <div className="empty-state panel">
          <strong>{t('No nodes yet')}</strong>
          <span>
            {t('Paste a subscription URL above. A subscription usually looks like https://provider.example/api/sub/…')}
          </span>
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
                <button
                  className={`profile-star ${profile.favorite ? 'is-on' : ''}`}
                  title={profile.favorite ? t('Remove from favourites') : t('Pin to favourites')}
                  onClick={(event) => {
                    event.stopPropagation()
                    void toggleFavorite(profile)
                  }}
                >
                  <StarIcon filled={profile.favorite} />
                </button>
                <span className="proto-badge">{PROTOCOL_LABEL[profile.protocol]}</span>
                <span className="profile-name">
                  <strong>{profile.name}</strong>
                  <span>
                    {profile.protocol === 'direct'
                      ? t('Built-in direct route')
                      : `${profile.host}:${profile.port}`}
                    {profile.geo ? ` · ${[profile.geo.city, profile.geo.country].filter(Boolean).join(', ')}` : ''}
                    {source ? ` · ${source}` : ''}
                  </span>
                </span>
                {profile.quality.length > 1 && (
                  <Sparkline className="profile-quality" values={profile.quality} width={52} height={22} />
                )}
                {profile.protocol !== 'direct' && (
                  <select
                    className="engine-select"
                    value={profile.engine ?? ''}
                    title={t('Per-profile engine override')}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => void pinEngine(profile, (event.target.value || null) as EngineId | null)}
                  >
                    <option value="">{t('Auto')}</option>
                    {snap.state.engines.map((engine) => (
                      <option key={engine.id} value={engine.id}>
                        {engine.name}
                      </option>
                    ))}
                  </select>
                )}
                <span className={`ping ${profile.ping === null ? 'is-idle' : ''}`}>
                  <strong>{profile.ping === null ? '—' : profile.ping}</strong> ms
                </span>
                <span className="profile-actions">
                  <button
                    className={`icon-btn ${copied === profile.id ? 'is-ok' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      void copyLink(profile)
                    }}
                    title={t('Copy share link')}
                  >
                    {copied === profile.id ? <CheckIcon /> : <CopyIcon />}
                  </button>
                  <button
                    className="btn tiny"
                    onClick={(event) => {
                      event.stopPropagation()
                      void testAll([profile.id])
                    }}
                    disabled={testing || profile.protocol === 'direct'}
                    title={t('Measure latency')}
                  >
                    {t('Test')}
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
                    {isActive ? t('Disconnect') : busyConnection && isSelected ? t('Connecting') : t('Connect')}
                  </button>
                  <button
                    className="icon-ghost"
                    title={t('Remove node')}
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
          {filtered.length === 0 && (
            <div className="empty-hint">
              {filter === 'favorites'
                ? t('No favourites yet — tap the star on any node to pin it here.')
                : t('No nodes match “{query}”.', { query })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
