import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { linuxKillSwitch } from '../src/main/vpn/firewall/linux'
import type { KillSwitchContext } from '../src/main/vpn/firewall/types'

const mockContext: KillSwitchContext = {
  appPath: '/path/to/eaglet',
  corePath: '/path/to/core',
  serverIps: ['1.2.3.4'],
  serverPorts: [443],
  dnsProtected: true,
  dnsServers: ['8.8.8.8'],
  dohIps: ['1.1.1.1'],
  dohPorts: [443],
  appEndpoints: [
    {
      ips: ['example.com'],
      ports: [80, 443]
    }
  ]
}

// Mock functions for testing
let mockIptablesCall: ((args: string[], command?: string) => Promise<void>) | null = null
let mockCheckEagletChainsCall: (() => Promise<{ ipv4: boolean; ipv6: boolean }>) | null = null
let mockMarkerPath: string | null = null

// Override the marker function to use a test path
function overrideMarkerPath(path: string): void {
  mockMarkerPath = path
}

// Override iptables function
function overrideIptables(fn: (args: string[], command?: string) => Promise<void>): void {
  mockIptablesCall = fn
}

// Override checkEagletChains function
function overrideCheckEagletChains(fn: () => Promise<{ ipv4: boolean; ipv6: boolean }>): void {
  mockCheckEagletChainsCall = fn
}

// Helper to get the actual marker path
function getActualMarkerPath(): string {
  if (mockMarkerPath) {
    return mockMarkerPath
  }
  // Import the module to get the original marker path
  const { app } = require('electron')
  return join(app.getPath('userData'), 'iptables-marker.json')
}

describe('Linux Firewall', () => {
  beforeEach(() => {
    // Use a test marker path
    const testMarkerPath = join(process.cwd(), 'test-marker.json')
    overrideMarkerPath(testMarkerPath)
    
    // Clean up any existing marker
    if (existsSync(testMarkerPath)) {
      rmSync(testMarkerPath)
    }
    
    // Reset mocks
    mockIptablesCall = null
    mockCheckEagletChainsCall = null
  })

  afterEach(() => {
    // Clean up after tests
    const testMarkerPath = getActualMarkerPath()
    if (existsSync(testMarkerPath)) {
      rmSync(testMarkerPath)
    }
    
    // Reset mocks
    mockIptablesCall = null
    mockCheckEagletChainsCall = null
  })

  it('should handle failed IPv4 chain removal', async () => {
    // Create a marker to simulate existing chains
    const testMarkerPath = getActualMarkerPath()
    writeFileSync(testMarkerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    // Mock the iptables commands to simulate failure
    overrideIptables(async (args: string[], command = 'iptables') => {
      if (args.includes('-D') && args.includes('OUTPUT')) {
        throw new Error('Permission denied')
      }
      // Allow other commands to pass
    })

    // Mock checkEagletChains to simulate chains still exist
    overrideCheckEagletChains(async () => ({ ipv4: true, ipv6: false }))

    try {
      await expect(linuxKillSwitch.disable()).rejects.toThrow('Kill switch could not be fully disabled')
      
      // Check that marker is preserved with cleanupFailed flag
      expect(existsSync(testMarkerPath)).toBe(true)
      const marker = JSON.parse(readFileSync(testMarkerPath, 'utf-8'))
      expect(marker.cleanupFailed).toBe(true)
      expect(marker.ipv4Error).toContain('Permission denied')
    } finally {
      // Reset mocks
      mockIptablesCall = null
      mockCheckEagletChainsCall = null
    }
  })

  it('should handle failed IPv6 chain removal', async () => {
    // Create a marker to simulate existing chains
    const testMarkerPath = getActualMarkerPath()
    writeFileSync(testMarkerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    // Mock the iptables commands to simulate IPv6 failure
    overrideIptables(async (args: string[], command = 'iptables') => {
      if (command === 'ip6tables' && args.includes('-D') && args.includes('OUTPUT')) {
        throw new Error('Permission denied')
      }
      // Allow other commands to pass
    })

    // Mock checkEagletChains to simulate chains still exist
    overrideCheckEagletChains(async () => ({ ipv4: false, ipv6: true }))

    try {
      await expect(linuxKillSwitch.disable()).rejects.toThrow('Kill switch could not be fully disabled')
      
      // Check that marker is preserved with cleanupFailed flag
      expect(existsSync(testMarkerPath)).toBe(true)
      const marker = JSON.parse(readFileSync(testMarkerPath, 'utf-8'))
      expect(marker.cleanupFailed).toBe(true)
      expect(marker.ipv6Error).toContain('Permission denied')
    } finally {
      // Reset mocks
      mockIptablesCall = null
      mockCheckEagletChainsCall = null
    }
  })

  it('should handle successful removal of both chains', async () => {
    // Create a marker to simulate existing chains
    const testMarkerPath = getActualMarkerPath()
    writeFileSync(testMarkerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    // Mock the iptables commands to simulate successful removal
    overrideIptables(async (args: string[], command = 'iptables') => {
      // Allow all commands to pass
    })

    // Mock checkEagletChains to simulate chains no longer exist
    overrideCheckEagletChains(async () => ({ ipv4: false, ipv6: false }))

    try {
      await linuxKillSwitch.disable()
      
      // Check that marker is removed
      expect(existsSync(testMarkerPath)).toBe(false)
    } finally {
      // Reset mocks
      mockIptablesCall = null
      mockCheckEagletChainsCall = null
    }
  })

  it('should handle case when chains already do not exist', async () => {
    // Create a marker to simulate existing chains
    const testMarkerPath = getActualMarkerPath()
    writeFileSync(testMarkerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    // Mock the iptables commands to simulate chains already removed
    overrideIptables(async (args: string[], command = 'iptables') => {
      // Simulate that rules don't exist
      if (args.includes('-D') && args.includes('OUTPUT')) {
        throw new Error('No such rule')
      }
      // Allow other commands to pass
    })

    // Mock checkEagletChains to simulate chains don't exist
    overrideCheckEagletChains(async () => ({ ipv4: false, ipv6: false }))

    try {
      await linuxKillSwitch.disable()
      
      // Check that marker is removed
      expect(existsSync(testMarkerPath)).toBe(false)
    } finally {
      // Reset mocks
      mockIptablesCall = null
      mockCheckEagletChainsCall = null
    }
  })

  it('should handle failure to check chain status', async () => {
    // Create a marker to simulate existing chains
    const testMarkerPath = getActualMarkerPath()
    writeFileSync(testMarkerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    // Mock the iptables commands to simulate successful removal
    overrideIptables(async (args: string[], command = 'iptables') => {
      // Allow all commands to pass
    })

    // Mock checkEagletChains to simulate failure
    overrideCheckEagletChains(async () => {
      throw new Error('Failed to check chains')
    })

    try {
      await expect(linuxKillSwitch.disable()).rejects.toThrow('Kill switch could not be fully disabled')
      
      // Check that marker is preserved
      expect(existsSync(testMarkerPath)).toBe(true)
      const marker = JSON.parse(readFileSync(testMarkerPath, 'utf-8'))
      expect(marker.cleanupFailed).toBe(true)
    } finally {
      // Reset mocks
      mockIptablesCall = null
      mockCheckEagletChainsCall = null
    }
  })

  it('should retry recovery after failed cleanup', () => {
    // Create a marker with cleanupFailed flag
    const testMarkerPath = getActualMarkerPath()
    writeFileSync(testMarkerPath, JSON.stringify({ 
      at: Date.now(), 
      ipv4: false, 
      ipv6: false, 
      cleanupFailed: true,
      serverIps: mockContext.serverIps,
      ipv4: true,
      ipv6: true 
    }))

    // Mock the disableSync method
    let callCount = 0
    const originalDisableSync = linuxKillSwitch.disableSync
    linuxKillSwitch.disableSync = () => {
      callCount++
      if (callCount === 1) {
        throw new Error('First attempt failed')
      }
    }

    try {
      linuxKillSwitch.recover()
      expect(callCount).toBe(1) // Should call disableSync once
    } finally {
      linuxKillSwitch.disableSync = originalDisableSync
    }
  })

  it('should not remove marker if chains still exist after cleanup', async () => {
    // Create a marker
    const testMarkerPath = getActualMarkerPath()
    writeFileSync(testMarkerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    // Mock iptables to simulate successful removal
    overrideIptables(async (args: string[], command = 'iptables') => {
      // Allow all commands to pass
    })

    // Mock checkEagletChains to return true (chains still exist)
    overrideCheckEagletChains(async () => ({ ipv4: true, ipv6: false }))

    try {
      await expect(linuxKillSwitch.disable()).rejects.toThrow('Kill switch could not be fully disabled')
      
      // Check that marker is preserved with chainsStillExist flag
      expect(existsSync(testMarkerPath)).toBe(true)
      const marker = JSON.parse(readFileSync(testMarkerPath, 'utf-8'))
      expect(marker.chainsStillExist).toBe(true)
    } finally {
      // Reset mocks
      mockIptablesCall = null
      mockCheckEagletChainsCall = null
    }
  })

  it('should handle partial removal with one chain remaining', async () => {
    // Create a marker
    const testMarkerPath = getActualMarkerPath()
    writeFileSync(testMarkerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    // Mock iptables to simulate IPv4 removal failure but IPv6 success
    overrideIptables(async (args: string[], command = 'iptables') => {
      if (command === 'iptables' && args.includes('-D') && args.includes('OUTPUT')) {
        throw new Error('IPv4 rule not found')
      }
      // Allow other commands to pass
    })

    // Mock checkEagletChains to show IPv4 still exists
    overrideCheckEagletChains(async () => ({ ipv4: true, ipv6: false }))

    try {
      await expect(linuxKillSwitch.disable()).rejects.toThrow('Kill switch could not be fully disabled')
      
      // Check that marker is preserved
      expect(existsSync(testMarkerPath)).toBe(true)
      const marker = JSON.parse(readFileSync(testMarkerPath, 'utf-8'))
      expect(marker.cleanupFailed).toBe(true)
      expect(marker.ipv4Error).toContain('IPv4 rule not found')
      expect(marker.chainsStillExist).toBe(true)
    } finally {
      // Reset mocks
      mockIptablesCall = null
      mockCheckEagletChainsCall = null
    }
  })
})