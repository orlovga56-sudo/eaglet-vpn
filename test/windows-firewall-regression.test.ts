import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createWindowsKillSwitch, type PolicyBackup } from '../src/main/vpn/firewall/windows'

const mockBackupPath = join(process.cwd(), 'test-firewall-backup.json')

describe('Windows Firewall Regression Tests', () => {
  let killSwitch: ReturnType<typeof createWindowsKillSwitch>

  beforeEach(() => {
    // Clean up any existing backup
    if (existsSync(mockBackupPath)) {
      rmSync(mockBackupPath)
    }
    
    killSwitch = createWindowsKillSwitch({
      backupPath: mockBackupPath,
      runner: {
        run: async (script: string) => {
          if (script.includes('Remove-NetFirewallRule')) {
            return '' // Simulate successful rule removal
          }
          if (script.includes('Get-NetFirewallRule')) {
            return '0' // No rules remaining
          }
          if (script.includes('Set-NetFirewallProfile')) {
            return '' // Simulate successful profile restoration
          }
          if (script.includes('Get-NetFirewallProfile')) {
            return 'Domain=Block,Private=Block,Public=Block'
          }
          return ''
        },
        runSync: (script: string) => {
          if (script.includes('Remove-NetFirewallRule')) {
            return '' // Simulate successful rule removal
          }
          if (script.includes('Get-NetFirewallRule')) {
            return '0' // No rules remaining
          }
          if (script.includes('Set-NetFirewallProfile')) {
            return '' // Simulate successful profile restoration
          }
          if (script.includes('Get-NetFirewallProfile')) {
            return 'Domain=Block,Private=Block,Public=Block'
          }
          return ''
        }
      },
      store: {
        exists: (path) => existsSync(path),
        read: (path) => readFileSync(path, 'utf-8'),
        writeAtomic: (path, data) => writeFileSync(path, data),
        remove: (path) => rmSync(path, { force: true })
      }
    })
  })

  afterEach(() => {
    // Clean up after tests
    if (existsSync(mockBackupPath)) {
      rmSync(mockBackupPath)
    }
  })

  it('should handle failed rule removal during rollback', async () => {
    // Create a backup
    const backup: PolicyBackup = {
      at: Date.now(),
      profiles: { Domain: 'Block', Private: 'Block', Public: 'Block' }
    }
    writeFileSync(mockBackupPath, JSON.stringify(backup))

    // Mock runner to simulate rule removal failure
    const originalRun = killSwitch.runner.run
    killSwitch.runner.run = async (script: string) => {
      if (script.includes('Remove-NetFirewallRule')) {
        throw new Error('Access denied')
      }
      return originalRun.call(killSwitch.runner, script)
    }

    try {
      const result = await killSwitch['rollback'](backup)
      expect(result.restored).toBe(false)
      expect(result.error).toContain('Access denied')
      
      // Check that backup is preserved
      expect(existsSync(mockBackupPath)).toBe(true)
    } finally {
      killSwitch.runner.run = originalRun
    }
  })

  it('should detect remaining rules after rollback', async () => {
    // Create a backup
    const backup: PolicyBackup = {
      at: Date.now(),
      profiles: { Domain: 'Block', Private: 'Block', Public: 'Block' }
    }
    writeFileSync(mockBackupPath, JSON.stringify(backup))

    // Mock runner to simulate rules still present
    const originalRun = killSwitch.runner.run
    killSwitch.runner.run = async (script: string) => {
      if (script.includes('Get-NetFirewallRule')) {
        return '1' // One rule still present
      }
      return originalRun.call(killSwitch.runner, script)
    }

    try {
      const result = await killSwitch['rollback'](backup)
      expect(result.restored).toBe(false)
      expect(result.error).toContain('1 kill-switch firewall rules are still present')
      
      // Check that backup is preserved
      expect(existsSync(mockBackupPath)).toBe(true)
    } finally {
      killSwitch.runner.run = originalRun
    }
  })

  it('should handle profile mismatches after rollback', async () => {
    // Create a backup
    const backup: PolicyBackup = {
      at: Date.now(),
      profiles: { Domain: 'Block', Private: 'Block', Public: 'Block' }
    }
    writeFileSync(mockBackupPath, JSON.stringify(backup))

    // Mock runner to simulate profile mismatch
    const originalRun = killSwitch.runner.run
    killSwitch.runner.run = async (script: string) => {
      if (script.includes('Get-NetFirewallProfile')) {
        return 'Domain=Allow,Private=Block,Public=Block' // Domain mismatch
      }
      return originalRun.call(killSwitch.runner, script)
    }

    try {
      const result = await killSwitch['rollback'](backup)
      expect(result.restored).toBe(false)
      expect(result.error).toContain('Domain: expected Block, got Allow')
      
      // Check that backup is preserved
      expect(existsSync(mockBackupPath)).toBe(true)
    } finally {
      killSwitch.runner.run = originalRun
    }
  })

  it('should handle missing backup during disable', async () => {
    // Ensure no backup exists
    if (existsSync(mockBackupPath)) {
      rmSync(mockBackupPath)
    }

    // Mock runner to simulate successful rule removal
    const originalRun = killSwitch.runner.run
    let ruleRemovalCount = 0
    killSwitch.runner.run = async (script: string) => {
      if (script.includes('Remove-NetFirewallRule')) {
        ruleRemovalCount++
        return '' // Simulate successful rule removal
      }
      if (script.includes('Get-NetFirewallRule')) {
        return ruleRemovalCount === 0 ? '1' : '0' // Check rules after removal
      }
      return originalRun.call(killSwitch.runner, script)
    }

    try {
      await killSwitch.disable()
      // Should succeed since no backup exists and rules are removed
    } finally {
      killSwitch.runner.run = originalRun
    }
  })

  it('should handle profile restoration failure during disable', async () => {
    // Create a backup
    const backup: PolicyBackup = {
      at: Date.now(),
      profiles: { Domain: 'Block', Private: 'Block', Public: 'Block' }
    }
    writeFileSync(mockBackupPath, JSON.stringify(backup))

    // Mock runner to simulate profile restoration failure
    const originalRun = killSwitch.runner.run
    killSwitch.runner.run = async (script: string) => {
      if (script.includes('Set-NetFirewallProfile')) {
        throw new Error('Profile not found')
      }
      return originalRun.call(killSwitch.runner, script)
    }

    try {
      await expect(killSwitch.disable()).rejects.toThrow('The Windows firewall policy could not be fully restored')
      
      // Check that backup is preserved
      expect(existsSync(mockBackupPath)).toBe(true)
    } finally {
      killSwitch.runner.run = originalRun
    }
  })

  it('should handle synchronous disable with remaining rules', () => {
    // Create a backup
    const backup: PolicyBackup = {
      at: Date.now(),
      profiles: { Domain: 'Block', Private: 'Block', Public: 'Block' }
    }
    writeFileSync(mockBackupPath, JSON.stringify(backup))

    // Mock runner to simulate rules still present
    const originalRunSync = killSwitch.runner.runSync
    killSwitch.runner.runSync = (script: string) => {
      if (script.includes('Get-NetFirewallRule')) {
        return '1' // One rule still present
      }
      return originalRunSync.call(killSwitch.runner, script)
    }

    try {
      expect(() => {
        killSwitch.disableSync()
      }).toThrow('Kill switch could not be fully disabled')
      
      // Check that backup is preserved
      expect(existsSync(mockBackupPath)).toBe(true)
    } finally {
      killSwitch.runner.runSync = originalRunSync
    }
  })
})