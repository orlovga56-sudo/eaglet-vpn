import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

interface VaultFile {
  version: number
  /** True when `data` is a safeStorage-encrypted buffer. */
  encrypted: boolean
  data: string
}

/**
 * Stores profile share links and subscription URLs outside config.json.
 *
 * The payload is encrypted with Electron's safeStorage (DPAPI on Windows, the
 * Keychain on macOS and libsecret/kwallet on Linux). If the platform has no
 * usable keyring the vault falls back to a base64 payload *and marks the file
 * accordingly* instead of silently dropping the user's profiles. Every write
 * is atomic: a temp file is renamed over the previous vault.
 */
export class SecretVault {
  private file: string
  private secrets: Record<string, string> = {}

  constructor(file: string) {
    this.file = file
    this.read()
  }

  private read(): void {
    if (!existsSync(this.file)) return
    try {
      const payload = JSON.parse(readFileSync(this.file, 'utf-8')) as VaultFile
      const buffer = Buffer.from(String(payload.data ?? ''), 'base64')
      const json = payload.encrypted ? safeStorage.decryptString(buffer) : buffer.toString('utf-8')
      const parsed = JSON.parse(json) as Record<string, unknown>
      this.secrets = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && value.length > 0) this.secrets[key] = value
      }
    } catch {
      // A vault written by another OS account (or a corrupt file) cannot be
      // decrypted. Keep it for forensic recovery and continue with an empty
      // secret set; the profiles themselves stay in config.json.
      try {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch {
        // ignore
      }
      this.secrets = {}
    }
  }

  private write(): void {
    const json = JSON.stringify(this.secrets)
    let encrypted = false
    let buffer: Buffer
    try {
      encrypted = safeStorage.isEncryptionAvailable()
      buffer = encrypted ? safeStorage.encryptString(json) : Buffer.from(json, 'utf-8')
    } catch {
      encrypted = false
      buffer = Buffer.from(json, 'utf-8')
    }
    const payload: VaultFile = {
      version: 1,
      encrypted,
      data: buffer.toString('base64')
    }
    mkdirSync(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.tmp`
    writeFileSync(temporary, JSON.stringify(payload), 'utf-8')
    renameSync(temporary, this.file)
  }

  get(key: string): string | null {
    return this.secrets[key] ?? null
  }

  set(key: string, value: string): void {
    const clean = value.trim()
    if (!clean) {
      this.delete(key)
      return
    }
    if (this.secrets[key] === clean) return
    this.secrets[key] = clean
    this.write()
  }

  delete(key: string): void {
    if (!(key in this.secrets)) return
    delete this.secrets[key]
    this.write()
  }

  replaceAll(entries: Record<string, string>): void {
    this.secrets = {}
    for (const [key, value] of Object.entries(entries)) {
      if (value.trim()) this.secrets[key] = value.trim()
    }
    this.write()
  }

  has(key: string): boolean {
    return key in this.secrets
  }
}

export function profileSecretKey(id: string): string {
  return `profile:${id}`
}

export function subscriptionSecretKey(id: string): string {
  return `subscription:${id}`
}
