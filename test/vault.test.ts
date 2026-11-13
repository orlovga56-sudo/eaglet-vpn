import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { safeStorage } from 'electron'
import { Store } from '../src/main/store'
import { SecretVault } from '../src/main/secret-vault'
import { makeProfile, makeSettings } from './helpers'

const LINK = 'vless://11111111-1111-4111-8111-111111111111@example.com:443?security=tls#Node'
const SUBSCRIPTION_URL = 'https://example.com/sub?token=topsecret'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eaglet-store-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('SecretVault', () => {
  it('encrypts values and never stores plaintext', () => {
    const dir = tempDir()
    const file = join(dir, 'secrets.bin')
    const vault = new SecretVault(file)
    vault.set('profile:a', LINK)

    const raw = readFileSync(file, 'utf-8')
    expect(raw).not.toContain('vless://')
    expect(JSON.parse(raw)).toMatchObject({ version: 1, encrypted: true })
    expect(vault.get('profile:a')).toBe(LINK)
    expect(vault.has('profile:a')).toBe(true)
    expect(vault.status()).toBe('encrypted')
  })

  it('reloads, overwrites and deletes entries', () => {
    const file = join(tempDir(), 'secrets.bin')
    const vault = new SecretVault(file)
    vault.set('profile:a', LINK)
    vault.set('profile:a', `${LINK}-updated`)

    const reopened = new SecretVault(file)
    expect(reopened.get('profile:a')).toBe(`${LINK}-updated`)

    reopened.delete('profile:a')
    expect(new SecretVault(file).get('profile:a')).toBeNull()
  })

  it('refuses to write plaintext when the OS keyring is unavailable', () => {
    vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(false)
    const file = join(tempDir(), 'secrets.bin')
    const vault = new SecretVault(file)

    expect(vault.status()).toBe('unavailable')
    expect(() => vault.set('profile:a', LINK)).toThrow(/encrypt|keyring/i)
    expect(existsSync(file)).toBe(false)
    expect(vault.get('profile:a')).toBeNull()
  })

  it('never overwrites a vault it cannot decrypt', () => {
    const dir = tempDir()
    const file = join(dir, 'secrets.bin')
    const corrupt = {
      version: 1,
      encrypted: true,
      data: Buffer.from('not-json-at-all', 'utf-8').toString('base64')
    }
    writeFileSync(file, JSON.stringify(corrupt), 'utf-8')

    const vault = new SecretVault(file)
    expect(vault.status()).toBe('corrupt')
    expect(() => vault.set('profile:a', LINK)).toThrow(/overwrite|read/i)
    expect(readFileSync(file, 'utf-8')).toBe(JSON.stringify(corrupt))
    expect(readdirSync(dir).filter((name) => name.includes('.corrupt-'))).toHaveLength(0)
  })

  it('keeps an encrypted vault locked when this launch has no keyring', () => {
    const file = join(tempDir(), 'secrets.bin')
    const original = new SecretVault(file)
    original.set('profile:a', LINK)
    const before = readFileSync(file, 'utf-8')

    vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(false)
    const locked = new SecretVault(file)
    expect(locked.status()).toBe('unavailable')
    expect(locked.get('profile:a')).toBeNull()
    expect(() => locked.set('profile:b', LINK)).toThrow(/overwrite|keyring/i)
    expect(readFileSync(file, 'utf-8')).toBe(before)
  })

  it('reads a legacy base64 vault once and re-encrypts it', () => {
    const dir = tempDir()
    const file = join(dir, 'secrets.bin')
    const legacy = {
      version: 1,
      encrypted: false,
      data: Buffer.from(JSON.stringify({ 'profile:a': LINK }), 'utf-8').toString('base64')
    }
    writeFileSync(file, JSON.stringify(legacy), 'utf-8')

    const vault = new SecretVault(file)
    expect(vault.get('profile:a')).toBe(LINK)
    expect(vault.status()).toBe('encrypted')
    expect(vault.wasMigrated()).toBe(true)

    const rewritten = JSON.parse(readFileSync(file, 'utf-8')) as { encrypted: boolean; data: string }
    expect(rewritten.encrypted).toBe(true)
    expect(readFileSync(file, 'utf-8')).not.toContain('vless://')
  })

  it('replaces the whole set and ignores blank values', () => {
    const file = join(tempDir(), 'secrets.bin')
    const vault = new SecretVault(file)
    vault.set('old', 'value')
    vault.replaceAll({ a: 'one', b: '   ' })
    const reopened = new SecretVault(file)
    expect(reopened.get('old')).toBeNull()
    expect(reopened.get('a')).toBe('one')
    expect(reopened.get('b')).toBeNull()
  })
})

describe('Store secret migration', () => {
  function legacyConfig(dir: string): string {
    const file = join(dir, 'config.json')
    writeFileSync(
      file,
      JSON.stringify({
        settings: makeSettings({ theme: 'minimal' }),
        profiles: [makeProfile({ raw: LINK })],
        subscriptions: [
          { id: 'sub1', name: 'Sub', url: SUBSCRIPTION_URL, updatedAt: 1, count: 1 }
        ]
      }),
      'utf-8'
    )
    return file
  }

  it('moves share links out of config.json but keeps using them', () => {
    const dir = tempDir()
    const file = legacyConfig(dir)
    const store = new Store(file, new SecretVault(join(dir, 'secrets.bin')))

    expect(store.getProfiles()[0].raw).toBe(LINK)
    expect(store.getSubscriptions()[0].url).toBe(SUBSCRIPTION_URL)
    expect(store.getSettings().theme).toBe('minimal')
    expect(store.getSecretStatus()).toMatchObject({
      secretStorage: 'encrypted',
      plaintextProfiles: 0,
      plaintextSubscriptions: 0
    })

    const config = readFileSync(file, 'utf-8')
    expect(config).not.toContain('vless://')
    expect(config).not.toContain('topsecret')
    const saved = JSON.parse(config) as {
      profiles: Array<{ raw: string; name: string }>
      subscriptions: Array<{ url: string }>
    }
    expect(saved.profiles[0].raw).toBe('')
    expect(saved.profiles[0].name).toBe('Test node')
    expect(saved.subscriptions[0].url).toBe('')

    const vaultRaw = readFileSync(join(dir, 'secrets.bin'), 'utf-8')
    expect(vaultRaw).not.toContain('vless://')
    expect(vaultRaw).not.toContain('topsecret')
  })

  it('hydrates secrets again on the next launch', () => {
    const dir = tempDir()
    const file = legacyConfig(dir)
    new Store(file, new SecretVault(join(dir, 'secrets.bin')))
    const reopened = new Store(file, new SecretVault(join(dir, 'secrets.bin')))
    expect(reopened.getProfiles()[0].raw).toBe(LINK)
  })

  it('keeps the raw link in config when the vault rejects the write', () => {
    const dir = tempDir()
    const file = legacyConfig(dir)
    const vault = new SecretVault(join(dir, 'secrets.bin'))
    vi.spyOn(vault, 'set').mockImplementation(() => {
      throw new Error('keyring unavailable')
    })
    const store = new Store(file, vault)
    expect(store.getProfiles()[0].raw).toBe(LINK)
    expect(readFileSync(file, 'utf-8')).toContain('vless://')
    expect(store.getSecretStatus().plaintextProfiles).toBe(1)
  })

  it('preserves profile metadata when the vault cannot be decrypted', () => {
    const dir = tempDir()
    const file = join(dir, 'config.json')
    writeFileSync(
      file,
      JSON.stringify({
        settings: makeSettings(),
        profiles: [makeProfile({ id: 'p1', raw: '' })],
        subscriptions: []
      }),
      'utf-8'
    )
    writeFileSync(
      join(dir, 'secrets.bin'),
      JSON.stringify({
        version: 1,
        encrypted: true,
        data: Buffer.from('broken', 'utf-8').toString('base64')
      }),
      'utf-8'
    )

    const store = new Store(file, new SecretVault(join(dir, 'secrets.bin')))
    expect(store.getProfiles()).toHaveLength(1)
    expect(store.getProfiles()[0].name).toBe('Test node')
    const security = store.getSecretStatus()
    expect(security.secretStorage).toBe('corrupt')
    expect(security.warnings.join(' ')).toMatch(/could not be decrypted/i)
    expect(existsSync(join(dir, 'secrets.bin'))).toBe(true)
  })

  it('stashes newly imported profiles and removes secrets with the profile', () => {
    const dir = tempDir()
    const file = join(dir, 'config.json')
    const store = new Store(file, new SecretVault(join(dir, 'secrets.bin')))
    store.addProfiles([makeProfile({ id: 'new1', raw: LINK })])

    expect(readFileSync(file, 'utf-8')).not.toContain('vless://')
    expect(store.getProfile('new1')?.raw).toBe(LINK)

    store.removeProfile('new1')
    expect(store.getProfile('new1')).toBeNull()
    expect(new SecretVault(join(dir, 'secrets.bin')).get('profile:new1')).toBeNull()
  })

  it('restores a backup without leaking secrets into config.json', () => {
    const dir = tempDir()
    const file = join(dir, 'config.json')
    const store = new Store(file, new SecretVault(join(dir, 'secrets.bin')))
    store.replaceAll({
      settings: makeSettings(),
      profiles: [makeProfile({ id: 'restored', raw: LINK })],
      subscriptions: [
        { id: 'sub9', name: 'Backup', url: SUBSCRIPTION_URL, updatedAt: 1, count: 2 }
      ],
      scenarios: []
    })

    expect(store.getProfile('restored')?.raw).toBe(LINK)
    expect(store.getSubscriptions()[0].url).toBe(SUBSCRIPTION_URL)
    const config = readFileSync(file, 'utf-8')
    expect(config).not.toContain('vless://')
    expect(config).not.toContain('topsecret')
  })

  it('keeps backup secrets usable in config when the vault is unavailable', () => {
    const dir = tempDir()
    const file = join(dir, 'config.json')
    const vault = new SecretVault(join(dir, 'secrets.bin'))
    vi.spyOn(vault, 'replaceAll').mockImplementation(() => {
      throw new Error('keyring unavailable')
    })
    const store = new Store(file, vault)
    store.replaceAll({
      settings: makeSettings(),
      profiles: [makeProfile({ id: 'fallback', raw: LINK })],
      subscriptions: [
        { id: 'sub2', name: 'Backup', url: SUBSCRIPTION_URL, updatedAt: 1, count: 1 }
      ],
      scenarios: []
    })

    expect(store.getProfile('fallback')?.raw).toBe(LINK)
    expect(store.getSubscriptions()[0].url).toBe(SUBSCRIPTION_URL)
    const config = readFileSync(file, 'utf-8')
    expect(config).toContain('vless://')
    expect(config).toContain('topsecret')
    expect(store.getSecretStatus().plaintextProfiles).toBe(1)
    expect(store.getSecretStatus().plaintextSubscriptions).toBe(1)
  })
})
