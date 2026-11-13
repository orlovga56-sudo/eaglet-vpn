import { describe, expect, it } from 'vitest'
import { prepareDohTarget } from '../src/main/vpn/dns-guard'
import { makeSettings } from './helpers'

describe('pre-resolved DoH target', () => {
  it('pins Cloudflare by default', async () => {
    const target = await prepareDohTarget(makeSettings())
    expect(target).toMatchObject({
      endpoint: 'https://1.1.1.1/dns-query',
      hostname: '1.1.1.1',
      address: '1.1.1.1',
      family: 4,
      port: 443,
      path: '/dns-query'
    })
  })

  it('pins Google when selected', async () => {
    const target = await prepareDohTarget(makeSettings({ dns: 'google' }))
    expect(target.address).toBe('8.8.8.8')
    expect(target.hostname).toBe('8.8.8.8')
  })

  it('keeps the pinned IP, SNI host and explicit port for a custom IPv6 endpoint', async () => {
    const target = await prepareDohTarget(
      makeSettings({ dns: 'custom', customDns: 'https://[2606:4700:4700::1111]:8443/custom?x=1' })
    )
    expect(target).toEqual({
      endpoint: 'https://[2606:4700:4700::1111]:8443/custom?x=1',
      hostname: '2606:4700:4700::1111',
      address: '2606:4700:4700::1111',
      family: 6,
      port: 8443,
      path: '/custom?x=1'
    })
  })

  it('defaults the path when the endpoint has none', async () => {
    const target = await prepareDohTarget(
      makeSettings({ dns: 'custom', customDns: 'https://8.8.4.4' })
    )
    expect(target.path).toBe('/dns-query')
    expect(target.port).toBe(443)
  })

  it('refuses plaintext endpoints', async () => {
    await expect(
      prepareDohTarget(makeSettings({ dns: 'custom', customDns: 'http://1.1.1.1/dns-query' }))
    ).rejects.toThrow(/https/)
  })
})
