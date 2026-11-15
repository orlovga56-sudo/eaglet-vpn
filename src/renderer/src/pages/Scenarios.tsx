import { useState } from 'react'
import type { EngineChoice, RoutingMode, Scenario, ServerStrategy, Snapshot } from '@shared/types'
import { BoltIcon, CheckIcon, GearIcon, RouteIcon, ShieldIcon, SignalIcon, SparkIcon } from '../components/Icons'
import { t } from '../i18n'

interface Props {
  snap: Snapshot
}

const ICON: Record<Scenario['icon'], React.JSX.Element> = {
  game: <BoltIcon />,
  speed: <SignalIcon />,
  shield: <ShieldIcon />,
  manual: <GearIcon />,
  custom: <SparkIcon />
}

function engineLabel(): Record<EngineChoice, string> {
  return {
    auto: t('Auto engine'),
    'sing-box': 'sing-box',
    xray: 'Xray-core',
    mihomo: 'Mihomo'
  }
}

function strategyLabel(): Record<ServerStrategy, string> {
  return {
    fastest: t('Fastest node'),
    favorite: t('Favourite node'),
    selected: t('Keep selection')
  }
}

function routingModes(): Array<{ id: RoutingMode; label: string }> {
  return [
    { id: 'global', label: t('Global') },
    { id: 'smart', label: t('Smart') },
    { id: 'direct', label: t('Direct') }
  ]
}

function routingLabel(mode: RoutingMode): string {
  return routingModes().find((item) => item.id === mode)?.label ?? mode
}

function summarize(scenario: Scenario): string[] {
  const settings = scenario.settings
  const chips: string[] = [strategyLabel()[scenario.serverStrategy]]
  if (settings.tunMode) chips.push('TUN')
  else if (settings.systemProxy) chips.push(t('System proxy'))
  if (settings.killSwitch || settings.networkProtection) chips.push(t('Kill switch'))
  if (settings.dnsProtection || settings.networkProtection) chips.push(t('Encrypted DNS'))
  if (settings.ipv6) chips.push('IPv6')
  else chips.push(t('IPv4 only'))
  if (settings.routingMode)
    chips.push(t('{mode} routing', { mode: routingLabel(settings.routingMode) }))
  return chips
}

function ScenarioCard({
  scenario,
  onApply,
  onRemove,
  busy
}: {
  scenario: Scenario
  onApply: (id: string) => void
  onRemove: (id: string) => void
  busy: string | null
}): React.JSX.Element {
  return (
    <div className={`scenario-card panel ${scenario.builtin ? '' : 'is-custom'}`}>
      <div className="scenario-top">
        <span className="scenario-icon">{ICON[scenario.icon]}</span>
        <div className="scenario-title">
          <strong>{scenario.name}</strong>
          <span>{scenario.builtin ? t('Built-in') : t('Custom')}</span>
        </div>
        <span className="scenario-engine">{engineLabel()[scenario.engine]}</span>
      </div>
      <p className="scenario-text">{scenario.description}</p>
      <div className="scenario-chips">
        {summarize(scenario).map((chip) => (
          <span className="scenario-chip" key={chip}>
            {chip}
          </span>
        ))}
      </div>
      <div className="scenario-actions">
        <button className="btn small primary" onClick={() => onApply(scenario.id)} disabled={busy !== null}>
          {busy === scenario.id ? t('Applying…') : t('Apply scenario')}
        </button>
        {!scenario.builtin && (
          <button className="btn small danger" onClick={() => onRemove(scenario.id)} disabled={busy !== null}>
            {t('Delete')}
          </button>
        )}
      </div>
    </div>
  )
}

export function Scenarios({ snap }: Props): React.JSX.Element {
  const { state } = snap
  const connected = state.status === 'connected' || state.status === 'connecting'
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [custom, setCustom] = useState({
    name: '',
    description: '',
    engine: 'auto' as EngineChoice,
    strategy: 'selected' as ServerStrategy,
    routingMode: 'smart' as RoutingMode,
    tunMode: false,
    systemProxy: true,
    killSwitch: false,
    dnsProtection: true,
    ipv6: true
  })

  const apply = async (id: string): Promise<void> => {
    setBusy(id)
    setError(null)
    setNotice(null)
    try {
      await window.eaglet.applyScenario(id)
      setNotice(
        t('Scenario applied. Reconnect if a tunnel is already running so the new engine and routing take effect.')
      )
    } catch (caught) {
      setError((caught as Error).message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, ''))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm(t('Delete this custom scenario?'))) return
    setBusy(id)
    try {
      await window.eaglet.removeScenario(id)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const save = async (): Promise<void> => {
    if (!custom.name.trim()) {
      setError(t('Give the scenario a name first.'))
      return
    }
    setBusy('new')
    setError(null)
    try {
      await window.eaglet.saveScenario({
        id: `custom-${Date.now()}`,
        name: custom.name.trim(),
        description: custom.description.trim(),
        icon: 'custom',
        builtin: false,
        engine: custom.engine,
        serverStrategy: custom.strategy,
        settings: {
          routingMode: custom.routingMode,
          tunMode: custom.tunMode,
          systemProxy: custom.systemProxy,
          killSwitch: custom.killSwitch,
          networkProtection: custom.killSwitch && custom.dnsProtection,
          dnsProtection: custom.dnsProtection,
          ipv6: custom.ipv6
        }
      })
      setCustom({ ...custom, name: '', description: '' })
      setNotice(t('Custom scenario saved.'))
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{t('Profiles of behaviour')}</p>
          <h1 className="page-title">{t('Scenarios')}</h1>
          <p className="page-sub">
            {t(
              'One click applies a tested combination of engine, routing, DNS and protection settings. Everything here is a real setting — nothing is cosmetic.'
            )}
          </p>
        </div>
        <span className={`status-pill ${connected ? 'ok' : ''}`}>
          {connected ? t('Live tunnel') : t('Ready')}
        </span>
      </header>

      {error && <div className="callout danger">{error}</div>}
      {notice && <div className="callout">{notice}</div>}

      <div className="scenario-grid">
        {snap.scenarios.map((scenario) => (
          <ScenarioCard
            key={scenario.id}
            scenario={scenario}
            onApply={(id) => void apply(id)}
            onRemove={(id) => void remove(id)}
            busy={busy}
          />
        ))}
      </div>

      <div className="section-title">{t('Create a custom scenario')}</div>
      <div className="scenario-form panel">
        <div className="form-grid">
          <label>
            <span>{t('Name')}</span>
            <input
              value={custom.name}
              placeholder={t('Low-latency gaming')}
              onChange={(event) => setCustom({ ...custom, name: event.target.value })}
            />
          </label>
          <label>
            <span>{t('Engine')}</span>
            <select
              value={custom.engine}
              onChange={(event) => setCustom({ ...custom, engine: event.target.value as EngineChoice })}
            >
              <option value="auto">{t('Auto (best installed)')}</option>
              <option value="sing-box">sing-box</option>
              <option value="xray">Xray-core</option>
              <option value="mihomo">Mihomo</option>
            </select>
          </label>
          <label>
            <span>{t('Server strategy')}</span>
            <select
              value={custom.strategy}
              onChange={(event) => setCustom({ ...custom, strategy: event.target.value as ServerStrategy })}
            >
              <option value="selected">{t('Keep my selection')}</option>
              <option value="fastest">{t('Fastest node')}</option>
              <option value="favorite">{t('Favourite node')}</option>
            </select>
          </label>
          <label>
            <span>{t('Routing')}</span>
            <select
              value={custom.routingMode}
              onChange={(event) => setCustom({ ...custom, routingMode: event.target.value as RoutingMode })}
            >
              {routingModes().map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="form-wide">
          <span>{t('Description')}</span>
          <input
            value={custom.description}
            placeholder={t('What is this preset for?')}
            onChange={(event) => setCustom({ ...custom, description: event.target.value })}
          />
        </label>

        <div className="scenario-toggles">
          {(
            [
              ['tunMode', t('TUN capture')],
              ['systemProxy', t('System proxy')],
              ['killSwitch', t('Kill switch')],
              ['dnsProtection', t('Encrypted DNS')],
              ['ipv6', 'IPv6']
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={`toggle-chip ${custom[key] ? 'active' : ''}`}
              onClick={() => setCustom({ ...custom, [key]: !custom[key] })}
            >
              {custom[key] && <CheckIcon />}
              {label}
            </button>
          ))}
        </div>

        <div className="scenario-form-foot">
          <span className="form-hint">
            <RouteIcon />{' '}
            {t('TUN and system proxy are mutually exclusive — Eaglet uses TUN when both are enabled.')}
          </span>
          <button className="btn primary" onClick={() => void save()} disabled={busy !== null}>
            {busy === 'new' ? t('Saving…') : t('Save scenario')}
          </button>
        </div>
      </div>
    </div>
  )
}
