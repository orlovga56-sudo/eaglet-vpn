import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { 
  startDnsGuard, 
  stopDnsGuard, 
  stopDnsGuardSync, 
  restoreSystemDns, 
  restoreSystemDnsSync,
  recoverStaleDns,
  dnsGuardStats 
} from '../src/main/vpn/dns-guard'
import type { Settings } from '../src/shared/types'

const mockSettings: Settings = {
  language: 'en',
  theme: 'cyber',
  engine: 'sing-box',
  engineId: 'default',
  routingMode: 'proxy',
  dns: 'doh',
  customDns: [],
  autoUpdateSubscriptions: true,
  subscriptionIntervalHours: 24,
  mini: false,
  tray: true,
  launchAtStartup: false,
  systemProxy: false,
  scenarios: []
}

describe('DNS Guard Regression Tests', () => {
  let backupPath: string

  beforeEach(() => {
    backupPath = join(process.cwd(), 'test-dns-backup.json')
    // Clean up any existing backup
    if (existsSync(backupPath)) {
      rmSync(backupPath)
    }
  })

  afterEach(() => {
    // Clean up after tests
    if (existsSync(backupPath)) {
      rmSync(backupPath)
    }
  })

  it('should handle failed synchronous DNS restore', () => {
    // Create a backup file
    writeFileSync(backupPath, JSON.stringify({
      version: 2,
      platform: 'win32',
      at: Date.now(),
      services: [
        {
          name: 'Ethernet',
          index: 12,
          v4: ['8.8.8.8'],
          v6: ['2001:4860:4860::8888'],
          method: 'static'
        }
      ]
    }))

    // Mock execFileSync to throw an error
    const originalExecFileSync = global.execFileSync
    global.execFileSync = () => {
      throw new Error('Restore failed')
    }

    try {
      expect(() => {
        restoreSystemDnsSync()
      }).toThrow('System DNS restore verification failed, backup preserved for retry')
      
      // Check that backup is preserved
      expect(existsSync(backupPath)).toBe(true)
    } finally {
      global.execFileSync = originalExecFileSync
    }
  })

  it('should preserve backup on failed synchronous stop', () => {
    // Create a backup file
    writeFileSync(backupPath, JSON.stringify({
      version: 2,
      platform: 'win32',
      at: Date.now(),
      services: [
        {
          name: 'Ethernet',
          index: 12,
          v4: ['8.8.8.8'],
          v6: ['2001:4860:4860::8888'],
          method: 'static'
        }
      ]
    }))

    // Mock execFileSync to throw an error
    const originalExecFileSync = global.execFileSync
    global.execFileSync = () => {
      throw new Error('Restore failed')
    }

    try {
      expect(() => {
        stopDnsGuardSync()
      }).toThrow('System DNS restore verification failed, backup preserved for retry')
      
      // Check that backup is preserved
      expect(existsSync(backupPath)).toBe(true)
      
      // Check that restore error is set
      const stats = dnsGuardStats()
      expect(stats.restoreError).toBeDefined()
    } finally {
      global.execFileSync = originalExecFileSync
    }
  })

  it('should handle user DNS changes during VPN session', async () => {
    // Create a backup file
    writeFileSync(backupPath, JSON.stringify({
      version: 2,
      platform: 'win32',
      at: Date.now(),
      services: [
        {
          name: 'Ethernet',
          index: 12,
          v4: ['8.8.8.8'],
          v6: ['2001:4860:4860::8888'],
          method: 'static'
        }
      ]
    }))

    // Mock readCurrentDns to simulate user changed DNS
    const originalReadCurrentDns = global.readCurrentDns
    global.readCurrentDns = async () => [
      {
        name: 'Ethernet',
        index: 12,
        v4: ['1.1.1.1'], // User changed from 8.8.8.8 to 1.1.1.1
        v6: ['2001:4860:4860::8888'],
        method: 'static'
      }
    ]

    try {
      const result = await restoreSystemDns()
      expect(result.skipped).toContain('Ethernet')
      expect(result.restored).toEqual([])
      
      // Check that backup is preserved
      expect(existsSync(backupPath)).toBe(true)
    } finally {
      global.readCurrentDns = originalReadCurrentDns
    }
  })

  it('should handle failed async DNS restore', async () => {
    // Create a backup file
    writeFileSync(backupPath, JSON.stringify({
      version: 2,
      platform: 'win32',
      at: Date.now(),
      services: [
        {
          name: 'Ethernet',
          index: 12,
          v4: ['8.8.8.8'],
          v6: ['2001:4860:4860::8888'],
          method: 'static'
        }
      ]
    }))

    // Mock readCurrentDns to throw an error
    const originalReadCurrentDns = global.readCurrentDns
    global.readCurrentDns = async () => {
      throw new Error('Failed to read current DNS')
    }

    try {
      await expect(restoreSystemDns()).rejects.toThrow('Failed to read current DNS')
      
      // Check that backup is preserved
      expect(existsSync(backupPath)).toBe(true)
    } finally {
      global.readCurrentDns = originalReadCurrentDns
    }
  })

  it('should recover stale DNS on next launch', () => {
    // Create a backup file to simulate crash
    writeFileSync(backupPath, JSON.stringify({
      version: 2,
      platform: 'win32',
      at: Date.now(),
      services: [
        {
          name: 'Ethernet',
          index: 12,
          v4: ['8.8.8.8'],
          v6: ['2001:4860:4860::8888'],
          method: 'static'
        }
      ]
    }))

    // Mock stopDnsGuardSync to verify it's called
    const originalStopDnsGuardSync = global.stopDnsGuardSync
    let callCount = 0
    global.stopDnsGuardSync = () => {
      callCount++
    }

    try {
      recoverStaleDns()
      expect(callCount).toBe(1)
    } finally {
      global.stopDnsGuardSync = originalStopDnsGuardSync
    }
  })

  it('should not attempt recovery if no backup exists', () => {
    // Ensure no backup exists
    if (existsSync(backupPath)) {
      rmSync(backupPath)
    }

    // Mock stopDnsGuardSync to verify it's not called
    const originalStopDnsGuardSync = global.stopDnsGuardSync
    let callCount = 0
    global.stopDnsGuardSync = () => {
      callCount++
    }

    try {
      recoverStaleDns()
      expect(callCount).toBe(0)
    } finally {
      global.stopDnsGuardSync = originalStopDnsGuardSync
    }
  })
})