import { describe, expect, it } from 'vitest'
import { EngineManager } from '../src/main/vpn/engines/manager'
import { makeProfile, makeSettings } from './helpers'

type Installed = Array<'sing-box' | 'xray' | 'mihomo'>

/** Installs a set of fake cores without touching the disk. */
function managerWith(installed: Installed): EngineManager {
  const manager = new EngineManager()
  manager.getPath = (id) => (installed.includes(id) ? `/fake/bin/${id}` : null)
  return manager
}

describe('engine selection', () => {
  it('honours a per-profile override', () => {
    const manager = managerWith(['sing-box', 'xray', 'mihomo'])
    const profile = makeProfile({ engine: 'mihomo', protocol: 'vless' })
    expect(manager.choose(profile, makeSettings({ engine: 'xray' }))).toEqual({
      id: 'mihomo',
      reason: 'profile'
    })
  })

  it('falls back to the global choice when the profile has none', () => {
    const manager = managerWith(['sing-box', 'xray', 'mihomo'])
    expect(manager.choose(makeProfile(), makeSettings({ engine: 'xray' }))).toEqual({
      id: 'xray',
      reason: 'global'
    })
  })

  it('ignores an override the engine cannot carry', () => {
    const manager = managerWith(['sing-box', 'xray'])
    // Xray-core has no Hysteria2 support at all.
    const profile = makeProfile({ protocol: 'hysteria2', engine: 'xray' })
    const choice = manager.choose(profile, makeSettings({ engine: 'xray' }))
    expect(choice.id).toBe('sing-box')
    expect(choice.reason).toBe('auto')
  })

  it('rejects legacy Shadowsocks ciphers for Xray', () => {
    const manager = managerWith(['xray'])
    const profile = makeProfile({
      protocol: 'shadowsocks',
      engine: 'xray',
      raw: 'ss://YWVzLTI1Ni1jZmI6cGFzcw==@example.com:8388'
    })
    expect(manager.supportsProfile('xray', profile)).toBe(false)
    // Nothing else is installed, and Xray is unusable, so the capability
    // fallback still points at a core that can carry the profile.
    expect(manager.choose(profile, makeSettings({ engine: 'xray' })).id).toBe('sing-box')
  })

  it('accepts AEAD Shadowsocks ciphers for Xray', () => {
    const manager = managerWith(['xray'])
    const profile = makeProfile({
      protocol: 'shadowsocks',
      raw: 'ss://YWVzLTI1Ni1nY206cGFzcw==@example.com:8388'
    })
    expect(manager.supportsProfile('xray', profile)).toBe(true)
  })

  it('never selects Xray for TUN mode', () => {
    const manager = managerWith(['xray', 'mihomo'])
    const choice = manager.choose(makeProfile(), makeSettings({ tunMode: true, engine: 'auto' }))
    expect(choice.id).toBe('mihomo')
    const profileChoice = manager.choose(
      makeProfile({ engine: 'xray' }),
      makeSettings({ tunMode: true, engine: 'xray' })
    )
    expect(profileChoice.id).not.toBe('xray')
  })

  it('prefers an installed core in a stable order', () => {
    expect(managerWith(['mihomo', 'xray']).choose(makeProfile(), makeSettings()).id).toBe('mihomo')
    expect(managerWith(['sing-box', 'mihomo']).choose(makeProfile(), makeSettings()).id).toBe('sing-box')
  })

  it('still returns a capable core when nothing is installed', () => {
    const manager = managerWith([])
    const choice = manager.choose(makeProfile(), makeSettings())
    expect(choice.id).toBe('sing-box')
    expect(manager.getPath(choice.id)).toBeNull()
  })
})
