import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SecretStorageStatus } from '@shared/types'

interface VaultFile {
  version: number
  /** True when `data` is a safeStorage-encrypted buffer. */
  encrypted: boolean
  data: string
}

export class SecretVaultError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretVaultError'
  }
}

/**
 * Stores profile share links and subscription URLs outside config.json.
 *
 * The payload is encrypted with Electron's safeStorage (DPAPI on Windows, the
 * Keychain on macOS and libsecret/kwallet on Linux). Base64 is encoding, not
 * encryption: when the OS keyring is unavailable the vault refuses to write
 * and reports `unavailable` instead of pretending the data is protected. The
 * caller can then keep the profile in config.json while the UI warns the user.
 *
 * A vault that cannot be decrypted (another OS account, a damaged keyring or a
 * corrupt file) is left exactly as it is. It is never renamed or overwritten,
 * so the profiles can be recovered once the keychain is available again.
 */
export class SecretVault {
  private file: string
  private secrets: Record<string, string> = {}
  private statusValue: SecretStorageStatus
  private lastError: string | null = null
  private migrated = false
  /** True when an encrypted file exists that this launch could not open. */
  private locked = false

  constructor(file: string) {
    this.file = file
    this.statusValue = safeStorage.isEncryptionAvailable() ? 'encrypted' : 'unavailable'
    this.read()
  }

  private read(): void {
    if (!existsSync(this.file)) return

    let payload: VaultFile
    try {
      payload = JSON.parse(readFileSync(this.file, 'utf-8')) as VaultFile
    } catch (error) {
      this.statusValue = 'corrupt'
      this.lastError = `The secret vault is not valid JSON: ${(error as Error).message}`
      return
    }

    let json: string
    try {
      const buffer = Buffer.from(String(payload.data ?? ''), 'base64')
      if (payload.encrypted) {
        if (!safeStorage.isEncryptionAvailable()) {
          this.statusValue = 'unavailable'
          this.locked = true
          this.lastError = 'The OS keyring is unavailable, so the encrypted vault cannot be opened'
          return
        }
        json = safeStorage.decryptString(buffer)
      } else {
        // Older Eaglet builds wrote a base64 (not encrypted) payload. Read it
        // once so profiles keep working, then rewrite it with real encryption.
        json = buffer.toString('utf-8')
        this.statusValue = 'unavailable'
        this.lastError = 'The secret vault uses the legacy base64 format and is not encrypted'
      }

      const parsed = JSON.parse(json) as Record<string, unknown>
      this.secrets = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && value.length > 0) this.secrets[key] = value
      }
    } catch (error) {
      this.secrets = {}
      this.statusValue = 'corrupt'
      this.lastError = `The secret vault could not be decrypted: ${(error as Error).message}`
      return
    }

    if (!payload.encrypted && safeStorage.isEncryptionAvailable()) {
      try {
        this.write()
        this.migrated = true
      } catch (error) {
        // Keep the original file and the values in memory; a later launch can
        // retry the migration.
        this.lastError = `The legacy vault could not be re-encrypted: ${(error as Error).message}`
      }
    }
  }

  private write(): void {
    if (this.locked) {
      throw new SecretVaultError(
        'The encrypted secret vault could not be opened this launch; refusing to overwrite it'
      )
    }
    if (this.statusValue === 'corrupt') {
      throw new SecretVaultError(
        'The encrypted secret vault could not be read; refusing to overwrite it'
      )
    }
    if (!safeStorage.isEncryptionAvailable()) {
      this.statusValue = 'unavailable'
      this.lastError = 'No OS keyring is available; refusing to store secrets without encryption'
      throw new SecretVaultError(this.lastError)
    }

    const json = JSON.stringify(this.secrets)
    let buffer: Buffer
    try {
      buffer = safeStorage.encryptString(json)
    } catch (error) {
      this.statusValue = 'unavailable'
      this.lastError = `The OS keyring rejected the encryption request: ${(error as Error).message}`
      throw new SecretVaultError(this.lastError)
    }

    const payload: VaultFile = {
      version: 1,
      encrypted: true,
      data: buffer.toString('base64')
    }
    mkdirSync(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.tmp`
    writeFileSync(temporary, JSON.stringify(payload), 'utf-8')
    renameSync(temporary, this.file)
    this.statusValue = 'encrypted'
    this.lastError = null
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
    const previous = this.secrets[key]
    this.secrets[key] = clean
    try {
      this.write()
    } catch (error) {
      if (previous === undefined) delete this.secrets[key]
      else this.secrets[key] = previous
      throw error
    }
  }

  delete(key: string): void {
    if (!(key in this.secrets)) return
    const previous = this.secrets[key]
    delete this.secrets[key]
    try {
      this.write()
    } catch (error) {
      this.secrets[key] = previous
      throw error
    }
  }

  replaceAll(entries: Record<string, string>): void {
    const previous = this.secrets
    this.secrets = {}
    for (const [key, value] of Object.entries(entries)) {
      if (value.trim()) this.secrets[key] = value.trim()
    }
    try {
      this.write()
    } catch (error) {
      this.secrets = previous
      throw error
    }
  }

  has(key: string): boolean {
    return key in this.secrets
  }

  status(): SecretStorageStatus {
    return this.statusValue
  }

  error(): string | null {
    return this.lastError
  }

  wasMigrated(): boolean {
    return this.migrated
  }
}

export function profileSecretKey(id: string): string {
  return `profile:${id}`
}

export function subscriptionSecretKey(id: string): string {
  return `subscription:${id}`
}
