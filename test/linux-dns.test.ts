import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { linuxHasStaticDns } from '../src/main/vpn/dns-guard'

describe('Linux DNS Classification', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(process.cwd(), 'test-systemd-network')
    if (!existsSync(testDir)) {
      require('fs').mkdirSync(testDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      require('fs').rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('should detect static DNS configuration', async () => {
    // Create a network file with static DNS
    const networkFile = join(testDir, 'static-dns.network')
    writeFileSync(networkFile, `[Match]
Name=eth0

[Network]
DNS=8.8.8.8
Gateway=192.168.1.1
`)

    // Mock execFile to return our test directory
    const originalExecFile = global.execFile
    global.execFile = async (command: string, args: string[], options: any) => {
      if (command === 'sh' && args[0] === '-c') {
        const cmd = args[1]
        if (cmd.includes('find /etc/systemd/network')) {
          return { stdout: networkFile, stderr: '', status: 0 }
        }
        if (cmd.includes('grep -s')) {
          return { stdout: 'DNS=8.8.8.8', stderr: '', status: 0 }
        }
      }
      return originalExecFile(command, args, options)
    }

    try {
      const result = await linuxHasStaticDns('eth0')
      expect(result).toBe(true)
    } finally {
      global.execFile = originalExecFile
    }
  })

  it('should not detect static DNS when no DNS is configured', async () => {
    // Create a network file without DNS
    const networkFile = join(testDir, 'no-dns.network')
    writeFileSync(networkFile, `[Match]
Name=eth0

[Network]
Gateway=192.168.1.1
`)

    // Mock execFile to return our test directory
    const originalExecFile = global.execFile
    global.execFile = async (command: string, args: string[], options: any) => {
      if (command === 'sh' && args[0] === '-c') {
        const cmd = args[1]
        if (cmd.includes('find /etc/systemd/network')) {
          return { stdout: networkFile, stderr: '', status: 0 }
        }
        if (cmd.includes('grep -s')) {
          return { stdout: '', stderr: '', status: 0 }
        }
      }
      return originalExecFile(command, args, options)
    }

    try {
      const result = await linuxHasStaticDns('eth0')
      expect(result).toBe(false)
    } finally {
      global.execFile = originalExecFile
    }
  })

  it('should handle missing network files', async () => {
    // Mock execFile to simulate no network files found
    const originalExecFile = global.execFile
    global.execFile = async (command: string, args: string[], options: any) => {
      if (command === 'sh' && args[0] === '-c') {
        const cmd = args[1]
        if (cmd.includes('find /etc/systemd/network')) {
          return { stdout: '', stderr: '', status: 0 }
        }
      }
      return originalExecFile(command, args, options)
    }

    try {
      const result = await linuxHasStaticDns('eth0')
      expect(result).toBe(false)
    } finally {
      global.execFile = originalExecFile
    }
  })

  it('should handle file system errors gracefully', async () => {
    // Mock execFile to simulate an error
    const originalExecFile = global.execFile
    global.execFile = async (command: string, args: string[], options: any) => {
      if (command === 'sh' && args[0] === '-c') {
        const cmd = args[1]
        if (cmd.includes('find /etc/systemd/network')) {
          throw new Error('File system error')
        }
      }
      return originalExecFile(command, args, options)
    }

    try {
      const result = await linuxHasStaticDns('eth0')
      expect(result).toBe(false)
    } finally {
      global.execFile = originalExecFile
    }
  })

  it('should detect static DNS in multiple network files', async () => {
    // Create multiple network files
    const file1 = join(testDir, 'eth0.network')
    writeFileSync(file1, `[Match]
Name=eth0

[Network]
Gateway=192.168.1.1
`)

    const file2 = join(testDir, 'static.network')
    writeFileSync(file2, `[Match]
Name=eth1

[Network]
DNS=8.8.8.8
Gateway=192.168.1.2
`)

    // Mock execFile to return our test directory
    const originalExecFile = global.execFile
    global.execFile = async (command: string, args: string[], options: any) => {
      if (command === 'sh' && args[0] === '-c') {
        const cmd = args[1]
        if (cmd.includes('find /etc/systemd/network')) {
          return { stdout: `${file1}\n${file2}`, stderr: '', status: 0 }
        }
        if (cmd.includes('grep -s')) {
          const grepCmd = args[1]
          if (grepCmd.includes(file1)) {
            return { stdout: '', stderr: '', status: 0 }
          }
          if (grepCmd.includes(file2)) {
            return { stdout: 'DNS=8.8.8.8', stderr: '', status: 0 }
          }
        }
      }
      return originalExecFile(command, args, options)
    }

    try {
      const result = await linuxHasStaticDns('eth0')
      expect(result).toBe(false) // eth0 doesn't have static DNS
    } finally {
      global.execFile = originalExecFile
    }
  })
})