import { join } from 'node:path'
import { tmpdir } from 'node:os'

const base = join(tmpdir(), 'eaglet-test')

/**
 * Minimal Electron surface for unit tests. `safeStorage` performs a reversible
 * XOR so tests can assert that vault files never contain plaintext.
 */
export const app = {
  getPath: (name: string): string => join(base, name),
  getAppPath: (): string => process.cwd(),
  getVersion: (): string => '0.0.0-test',
  isPackaged: false,
  setAppUserModelId: (): void => undefined
}

export const safeStorage = {
  isEncryptionAvailable: (): boolean => true,
  encryptString: (value: string): Buffer => {
    const bytes = Buffer.from(value, 'utf-8')
    for (let index = 0; index < bytes.length; index += 1) bytes[index] ^= 0x5a
    return bytes
  },
  decryptString: (value: Buffer): string => {
    const bytes = Buffer.from(value)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] ^= 0x5a
    return bytes.toString('utf-8')
  }
}

export const shell = {
  openExternal: async (): Promise<void> => undefined
}

export default { app, safeStorage, shell }
