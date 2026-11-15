import { useState } from 'react'
import type { DnsMode, EngineChoice, EngineId, Language, Settings, Snapshot, ThemeId } from '@shared/types'
import { LANGUAGES } from '@shared/i18n'
import { CheckIcon, GlobeIcon, LogoIcon, PowerIcon, ServerIcon, ShieldIcon } from '../components/Icons'
import { Toggle } from '../components/Toggle'
import { t } from '../i18n'

interface Props {
  snap: Snapshot
  onUpdate: (patch: Partial<Settings>) => void
}

interface ThemeMeta {
  id: ThemeId
  name: string
  sub: string
  background: string
  window: string
  accent: string
}

const themes = (): ThemeMeta[] => [
  {
    id: 'cyber',
    name: t('Electric Cyber'),
    sub: t('Electric blue on deep space'),
    background:
      'radial-gradient(120% 95% at 50% -20%, rgba(34,211,238,.55), transparent 62%), radial-gradient(80% 60% at 88% 110%, rgba(59,130,246,.5), transparent 62%), #04101f',
    window: 'rgba(9,22,40,.72)',
    accent: '#22d3ee'
  },
  {
    id: 'glass',
    name: t('Glassmorphism'),
    sub: t('Frosted layers, violet light'),
    background:
      'radial-gradient(circle at 22% 18%, #6d4fe0, transparent 55%), radial-gradient(circle at 82% 24%, #9b7bf5, transparent 52%), radial-gradient(circle at 60% 100%, #2563eb, transparent 58%), #1a1333',
    window: 'rgba(255,255,255,.14)',
    accent: '#c7c8ff'
  },
  {
    id: 'minimal',
    name: t('Minimal Dark'),
    sub: t('Quiet, typographic, precise'),
    background: 'radial-gradient(100% 70% at 50% -10%, rgba(255,255,255,.05), transparent 60%), #0a0a0c',
    window: '#121216',
    accent: '#3b82f6'
  },
  {
    id: 'hud',
    name: t('HUD / Scifi'),
    sub: t('Telemetry green on black'),
    background:
      'linear-gradient(rgba(45,212,191,.16) 1px, transparent 1px) 0 0/16px 16px, linear-gradient(90deg, rgba(45,212,191,.16) 1px, transparent 1px) 0 0/16px 16px, radial-gradient(80% 60% at 50% 0%, rgba(45,212,191,.28), transparent 65%), #041716',
    window: 'rgba(4,30,30,.72)',
    accent: '#2dd4bf'
  },
  {
    id: 'neon',
    name: t('Neon Purple'),
    sub: t('Violet bloom after dark'),
    background:
      'radial-gradient(80% 70% at 20% 0%, rgba(168,85,247,.5), transparent 60%), radial-gradient(70% 60% at 90% 20%, rgba(217,70,239,.34), transparent 62%), #08020f',
    window: 'rgba(30,9,52,.72)',
    accent: '#c084fc'
  },
  {
    id: 'aurora',
    name: t('Nature Aurora'),
    sub: t('Northern lights over teal'),
    background:
      'radial-gradient(80% 60% at 18% -6%, rgba(53,224,184,.5), transparent 58%), radial-gradient(70% 50% at 80% 6%, rgba(96,165,250,.4), transparent 60%), #04121a',
    window: 'rgba(7,32,40,.72)',
    accent: '#35e0b8'
  }
]

export function SettingsPage({ snap, onUpdate }: Props): React.JSX.Element {
  const { settings, state, version } = snap
  const [refreshing, setRefreshing] = useState(false)
  const [engineBusy, setEngineBusy] = useState<EngineId | 'check' | null>(null)
  const [engineMessage, setEngineMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const refreshCore = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await window.eaglet.refreshEngines()
    } finally {
      setRefreshing(false)
    }
  }

  const engineAction = async (id: EngineId): Promise<void> => {
    setEngineBusy(id)
    setEngineMessage(null)
    try {
      const engine = state.engines.find((item) => item.id === id)
      if (engine?.installed) await window.eaglet.removeEngine(id)
      else await window.eaglet.installEngine(id)
      setEngineMessage({ tone: 'ok', text: engine?.installed ? t('Engine removed') : t('Engine installed') })
    } catch (error) {
      setEngineMessage({
        tone: 'err',
        text: (error as Error).message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
      })
    } finally {
      setEngineBusy(null)
    }
  }

  const checkUpdates = async (): Promise<void> => {
    setEngineBusy('check')
    setEngineMessage(null)
    try {
      const engines = await window.eaglet.checkEngineUpdates()
      const updates = engines.filter((engine) => engine.updateAvailable)
      setEngineMessage({
        tone: 'ok',
        text:
          updates.length > 0
            ? t('Updates available: {list}', {
                list: updates.map((engine) => `${engine.name} ${engine.latestVersion}`).join(', ')
              })
            : t('All installed engines are up to date')
      })
    } catch (error) {
      setEngineMessage({ tone: 'err', text: (error as Error).message })
    } finally {
      setEngineBusy(null)
    }
  }

  const setEngine = async (choice: EngineChoice): Promise<void> => {
    try {
      const updated = await window.eaglet.setEngine(choice)
      onUpdate(updated)
    } catch (error) {
      setEngineMessage({ tone: 'err', text: (error as Error).message })
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{t('Preferences')}</p>
          <h1 className="page-title">{t('Settings')}</h1>
          <p className="page-sub">{t('Six interface styles ship with Eaglet. Pick the one that fits your desk.')}</p>
        </div>
      </header>

      <div className="theme-grid">
        {themes().map((theme) => (
          <button
            key={theme.id}
            className={`theme-card panel ${settings.theme === theme.id ? 'active' : ''}`}
            onClick={() => onUpdate({ theme: theme.id })}
          >
            <div className="theme-preview" style={{ background: theme.background }}>
              <div
                className="tp-window"
                style={{ background: theme.window, color: theme.accent, backdropFilter: 'blur(4px)' }}
              >
                <span
                  className="tp-ring"
                  style={{ boxShadow: `0 0 12px ${theme.accent}66`, background: `${theme.accent}14` }}
                >
                  <PowerIcon />
                </span>
              </div>
            </div>
            <div className="theme-card-name">
              {theme.name}
              <CheckIcon />
            </div>
            <div className="theme-card-sub">{theme.sub}</div>
          </button>
        ))}
      </div>

      <div className="section-title">{t('Interface language')}</div>
      <div className="rows panel">
        <div className="row">
          <span className="row-icon">
            <GlobeIcon />
          </span>
          <span className="row-main">
            <strong>{t('Language')}</strong>
            <span>{t('Choose the language used across the app. It applies immediately.')}</span>
          </span>
          <select
            value={settings.language}
            onChange={(event) => onUpdate({ language: event.target.value as Language })}
          >
            {LANGUAGES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="section-title">{t('Connection')}</div>
      {snap.security.warnings.length > 0 && (
        <div className="free-warning">
          <strong>
            {t('Secret storage:')}{' '}
            {snap.security.secretStorage === 'encrypted'
              ? t('encrypted')
              : snap.security.secretStorage === 'corrupt'
                ? t('unreadable vault')
                : t('OS keyring unavailable')}
          </strong>
          {snap.security.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}
      <div className="settings-cols">
        <div className="rows panel">
          <div className="row">
            <span className="row-main">
              <strong>{t('System proxy')}</strong>
              <span>{t('Point WinINet apps at the local mixed inbound while the tunnel is up.')}</span>
            </span>
            <Toggle
              checked={settings.systemProxy}
              label={t('System proxy')}
              onChange={(value) => onUpdate({ systemProxy: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>{t('TUN mode')}</strong>
              <span>{t('Capture every process through a virtual adapter. Needs admin and a reconnect.')}</span>
            </span>
            <Toggle checked={settings.tunMode} label={t('TUN mode')} onChange={(value) => onUpdate({ tunMode: value })} />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>{t('Kill switch')}</strong>
              <span>{t('Keep the tunnel-only policy after an unexpected drop.')}</span>
            </span>
            <Toggle
              checked={settings.killSwitch}
              label={t('Kill switch')}
              onChange={(value) => onUpdate({ killSwitch: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>{t('Network protection')}</strong>
              <span>{t('Master switch: arms the kill switch and the local DNS guard together.')}</span>
            </span>
            <Toggle
              checked={settings.networkProtection}
              label={t('Network protection')}
              onChange={(value) => onUpdate({ networkProtection: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>{t('DNS protection')}</strong>
              <span>{t('Run a real DoH relay on 127.0.0.1 and point the system resolver at it.')}</span>
            </span>
            <Toggle
              checked={settings.dnsProtection}
              label={t('DNS protection')}
              onChange={(value) => onUpdate({ dnsProtection: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>{t('IPv6')}</strong>
              <span>{t('Off rejects IPv6 inside the tunnel so leaks cannot bypass the core.')}</span>
            </span>
            <Toggle checked={settings.ipv6} label={t('IPv6')} onChange={(value) => onUpdate({ ipv6: value })} />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>{t('Auto-reconnect')}</strong>
              <span>{t('If the core drops, retry up to three times with a growing delay.')}</span>
            </span>
            <Toggle
              checked={settings.autoReconnect}
              label={t('Auto-reconnect')}
              onChange={(value) => onUpdate({ autoReconnect: value })}
            />
          </div>
        </div>

        <div className="rows panel">
          <div className="row">
            <span className="row-main">
              <strong>{t('Auto-connect on launch')}</strong>
              <span>{t('Bring the tunnel up as soon as Eaglet starts.')}</span>
            </span>
            <Toggle
              checked={settings.autoConnect}
              label={t('Auto-connect')}
              onChange={(value) => onUpdate({ autoConnect: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>{t('Launch at startup')}</strong>
              <span>{t('Start Eaglet automatically when the computer boots.')}</span>
            </span>
            <Toggle
              checked={settings.launchAtStartup}
              label={t('Launch at startup')}
              onChange={(value) => onUpdate({ launchAtStartup: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>{t('Compact mode')}</strong>
              <span>{t('Shrink Eaglet to an always-on-top mini window.')}</span>
            </span>
            <Toggle checked={settings.mini} label={t('Compact mode')} onChange={(value) => onUpdate({ mini: value })} />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>{t('Desktop notifications')}</strong>
              <span>{t('Notify on connect, disconnect, drops and exit-IP changes.')}</span>
            </span>
            <Toggle
              checked={settings.notifications}
              label={t('Notifications')}
              onChange={(value) => onUpdate({ notifications: value })}
            />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>{t('Keep in tray')}</strong>
              <span>{t('Keep Eaglet and the tunnel running from the system tray.')}</span>
            </span>
            <Toggle checked={settings.tray} label={t('System tray')} onChange={(value) => onUpdate({ tray: value })} />
          </div>
          <div className="row">
            <span className="row-main">
              <strong>{t('Close to tray')}</strong>
              <span>{t('The window hides instead of quitting when you press close.')}</span>
            </span>
            <Toggle
              checked={settings.closeToTray}
              label={t('Close to tray')}
              onChange={(value) => onUpdate({ closeToTray: value })}
            />
          </div>
        </div>
      </div>

      <div className="section-title">{t('DNS')}</div>
      <div className="rows panel">
        <div className="row">
          <span className="row-icon">
            <GlobeIcon />
          </span>
          <span className="row-main">
            <strong>{t('Resolver')}</strong>
            <span>{t('Pinned resolvers are queried inside the tunnel.')}</span>
          </span>
          <select value={settings.dns} onChange={(event) => onUpdate({ dns: event.target.value as DnsMode })}>
            <option value="auto">{t('Automatic (core)')}</option>
            <option value="cloudflare">{t('Cloudflare · 1.1.1.1')}</option>
            <option value="google">{t('Google · 8.8.8.8')}</option>
            <option value="custom">{t('Custom…')}</option>
          </select>
        </div>
        {settings.dns === 'custom' && (
          <div className="row">
            <span className="row-icon">
              <GlobeIcon />
            </span>
            <span className="row-main">
              <strong>{t('Custom resolver')}</strong>
              <span>{t('DoH endpoint used for tunnelled queries.')}</span>
            </span>
            <input
              value={settings.customDns}
              placeholder="https://…/dns-query"
              onChange={(event) => onUpdate({ customDns: event.target.value })}
            />
          </div>
        )}
      </div>

      <div className="section-title">{t('Tunnel engines')}</div>
      <div className="rows panel engine-choice">
        <div className="row">
          <span className="row-icon">
            <ServerIcon />
          </span>
          <span className="row-main">
            <strong>{t('Global engine')}</strong>
            <span>
              {t(
                'Auto prefers an installed core that supports the profile protocol and TUN when it is enabled. Profiles can override this choice individually.'
              )}
            </span>
          </span>
          <select value={settings.engine} onChange={(event) => void setEngine(event.target.value as EngineChoice)}>
            <option value="auto">{t('Auto · best installed')}</option>
            <option value="sing-box">sing-box</option>
            <option value="xray">Xray-core</option>
            <option value="mihomo">Mihomo</option>
          </select>
        </div>
      </div>

      <div className="engine-grid">
        {state.engines.map((engine) => (
          <div
            className={`engine-card panel ${engine.id === state.engine ? 'is-active' : ''} ${
              engine.installed ? '' : 'is-missing'
            }`}
            key={engine.id}
          >
            <div className="engine-card-head">
              <span className="engine-icon">
                <ServerIcon />
              </span>
              <div>
                <strong>{engine.name}</strong>
                <span>
                  {engine.installed ? (engine.version ? `v${engine.version}` : t('Installed')) : t('Not installed')}
                </span>
              </div>
              <span className={`status-pill ${engine.installed ? 'ok' : 'warn'}`}>
                {engine.running ? t('Running') : engine.installed ? t('Ready') : t('Missing')}
              </span>
            </div>
            <div className="engine-tags">
              <span>{engine.supportsTun ? 'TUN' : t('No TUN')}</span>
              <span>{engine.telemetry ? t('Live counters') : t('Basic counters')}</span>
              <span>{t('{count} protocols', { count: engine.protocols.length })}</span>
              <span className={`platform-${engine.platformSupport}`}>{engine.platformSupport}</span>
            </div>
            <div className="engine-path mono-path">{engine.path ?? t('Eaglet downloads it on first use')}</div>
            {engine.updateAvailable && (
              <div className="engine-update">
                {t('Update available · {version}', { version: engine.latestVersion ?? '' })}
              </div>
            )}
            <div className="engine-card-actions">
              <button
                className="btn small"
                onClick={() => void engineAction(engine.id)}
                disabled={engineBusy !== null || (engine.removable === false && engine.installed)}
              >
                {engineBusy === engine.id
                  ? t('Working…')
                  : engine.installed
                    ? engine.removable
                      ? t('Remove')
                      : t('Bundled')
                    : t('Install')}
              </button>
              {engine.id === state.engine && <span className="engine-current">{t('Active engine')}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="engine-toolbar">
        <button className="btn small" onClick={() => void refreshCore()} disabled={refreshing}>
          {refreshing ? t('Detecting…') : t('Re-detect engines')}
        </button>
        <button className="btn small" onClick={() => void checkUpdates()} disabled={engineBusy !== null}>
          {engineBusy === 'check' ? t('Checking…') : t('Check updates')}
        </button>
        {engineMessage && <span className={`engine-message ${engineMessage.tone}`}>{engineMessage.text}</span>}
      </div>

      <div className="section-title">{t('Subscriptions')}</div>
      <div className="rows panel">
        <div className="row">
          <span className="row-main">
            <strong>{t('Automatic updates')}</strong>
            <span>{t('Refresh HTTP subscriptions in the background so nodes and keys stay current.')}</span>
          </span>
          <Toggle
            checked={settings.autoUpdateSubscriptions}
            label={t('Automatic subscription updates')}
            onChange={(value) => onUpdate({ autoUpdateSubscriptions: value })}
          />
        </div>
        <div className="row">
          <span className="row-main">
            <strong>{t('Update interval')}</strong>
            <span>{t('How often a due subscription is refreshed.')}</span>
          </span>
          <select
            value={settings.subscriptionIntervalHours}
            onChange={(event) => onUpdate({ subscriptionIntervalHours: Number(event.target.value) })}
            disabled={!settings.autoUpdateSubscriptions}
          >
            <option value={1}>{t('Every hour')}</option>
            <option value={3}>{t('Every 3 hours')}</option>
            <option value={6}>{t('Every 6 hours')}</option>
            <option value={12}>{t('Every 12 hours')}</option>
            <option value={24}>{t('Every 24 hours')}</option>
          </select>
        </div>
        <div className="row">
          <span className="row-icon">
            <ShieldIcon />
          </span>
          <span className="row-main">
            <strong>{t('Refresh all now')}</strong>
            <span>{t('Force an update of every HTTP subscription, ignoring the interval.')}</span>
          </span>
          <button className="btn small" onClick={() => void window.eaglet.updateAllSubscriptions()}>
            {t('Update all')}
          </button>
        </div>
      </div>

      <div className="section-title">{t('About')}</div>
      <div className="about panel">
        <div className="about-logo">
          <LogoIcon />
        </div>
        <div>
          <strong>{t('Eaglet {version}', { version })}</strong>
          <p>
            {t(
              'A private desktop VPN client with three tunnel cores — sing-box, Xray-core and Mihomo. Six interchangeable themes, live core telemetry, real exit-IP verification and subscription import in one window.'
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
