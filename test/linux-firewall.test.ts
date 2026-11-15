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

describe('Linux Firewall', () => {
  let markerPath: string

  beforeEach(() => {
    markerPath = join(process.cwd(), 'test-marker.json')
    // Clean up any existing marker
    if (existsSync(markerPath)) {
      rmSync(markerPath)
    }
  })

  afterEach(() => {
    // Clean up after tests
    if (existsSync(markerPath)) {
      rmSync(markerPath)
    }
  })

  it('should handle failed IPv4 chain removal', async () => {
    // Create a marker to simulate existing chains
    writeFileSync(markerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    // Mock the iptables commands to simulate failure
    const originalIptables = global.iptables
    global.iptables = async (args: string[], command = 'iptables') => {
      if (args.includes('-D') && args.includes('OUTPUT')) {
        throw new Error('Permission denied')
      }
    }

    try {
      await expect(linuxKillSwitch.disable()).rejects.toThrow('Kill switch could not be fully disabled')
      
      // Check that marker is preserved with cleanupFailed flag
      expect(existsSync(markerPath)).toBe(true)
      const marker = JSON.parse(readFileSync(markerPath, 'utf-8'))
      expect(marker.cleanupFailed).toBe(true)
    } finally {
      global.iptables = originalIptables
    }
  })

  it('should handle failed IPv6 chain removal', async () => {
    // Create a marker to simulate existing chains
    writeFileSync(markerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    // Mock the iptables commands to simulate IPv6 failure
    const originalIptables = global.iptables
    global.iptables = async (args: string[], command = 'iptables') => {
      if (command === 'ip6tables' && args.includes('-D') && args.includes('OUTPUT')) {
        throw new Error('Permission denied')
      }
    }

    try {
      await expect(linuxKillSwitch.disable()).rejects.toThrow('Kill switch could not be fully disabled')
      
      // Check that marker is preserved with cleanupFailed flag
      expect(existsSync(markerPath)).toBe(true)
      const marker = JSON.parse(readFileSync(markerPath, 'utf-8'))
      expect(marker.cleanupFailed).toBe(true)
    } finally {
      global.iptables = originalIptables
    }
  })

  it('should retry recovery after failed cleanup', () => {
    // Create a marker with cleanupFailed flag
    writeFileSync(markerPath, JSON.stringify({ 
      at: Date.now(), 
      ipv4: false, 
      ipv6: false, 
      cleanupFailed: true,
      serverIps: mockContext.serverIps,
      ipv4: true,
      ipv6: true 
    }))

    // Mock the disableSync method
    const originalDisableSync = linuxKillSwitch.disableSync
    let callCount = 0
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
    writeFileSync(markerPath, JSON.stringify({ at: Date.now(), ipv4: true, ipv6: true }))

    // Mock checkEagletChains to return true (chains still exist)
    const originalCheckChains = global.checkEagletChains
    global.checkEagletChains = async () => ({ ipv4: true, ipv6: false })

    try {
      await expect(linuxKillSwitch.disable()).rejects.toThrow('Kill switch could not be fully disabled')
      
      // Check that marker is preserved with chainsStillExist flag
      expect(existsSync(markerPath)).toBe(true)
      const marker = JSON.parse(readFileSync(markerPath, 'utf-8'))
      expect(marker.chainsStillExist).toBe(true)
    } finally {
      global.checkEagletChains = originalCheckChains
    }
  })
})