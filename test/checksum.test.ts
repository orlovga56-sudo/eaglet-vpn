import { describe, expect, it } from 'vitest'
import { parseChecksumDigest, signatureStatusAllowed } from '../src/main/vpn/engines/manager'

const HASH = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

describe('release checksum parsing', () => {
  it('reads sha256sum output', () => {
    expect(parseChecksumDigest(`${HASH}  sing-box-1.14.4-windows-amd64.zip`, 'sing-box-1.14.4-windows-amd64.zip')).toBe(HASH)
  })

  it('accepts a leading ./ and a binary-mode asterisk', () => {
    expect(parseChecksumDigest(`${HASH} *./Xray-windows-64.zip\n`, 'Xray-windows-64.zip')).toBe(HASH)
    expect(parseChecksumDigest(`${HASH}  ./mihomo-windows-amd64.zip`, 'mihomo-windows-amd64.zip')).toBe(HASH)
  })

  it("reads Xray's SHA2-256 digest files", () => {
    expect(parseChecksumDigest(`SHA2-256= ${HASH}\n`, 'Xray-windows-64.zip')).toBe(HASH)
    expect(parseChecksumDigest(`SHA2-256: ${HASH}`, 'anything.zip')).toBe(HASH)
  })

  it('reads "name hash" pairs and normalises case', () => {
    expect(parseChecksumDigest(`Xray-windows-64.zip ${HASH.toUpperCase()}`, 'Xray-windows-64.zip')).toBe(HASH)
  })

  it('ignores hashes for other assets', () => {
    expect(parseChecksumDigest(`${OTHER}  other.zip\n${HASH}  wanted.zip`, 'wanted.zip')).toBe(HASH)
    expect(parseChecksumDigest(`${OTHER}  other.zip`, 'wanted.zip')).toBeNull()
  })

  it('returns null for malformed or empty input', () => {
    expect(parseChecksumDigest('', 'a.zip')).toBeNull()
    expect(parseChecksumDigest('not a checksum file', 'a.zip')).toBeNull()
    expect(parseChecksumDigest(`${HASH.slice(1)}  a.zip`, 'a.zip')).toBeNull()
  })
})

describe('Authenticode policy', () => {
  it('accepts valid and unsigned builds', () => {
    expect(signatureStatusAllowed('Valid')).toBe(true)
    expect(signatureStatusAllowed('NotSigned')).toBe(true)
  })

  it('rejects tampered or untrusted binaries', () => {
    for (const status of ['HashMismatch', 'NotTrusted', 'UnknownError', 'PublisherMismatch']) {
      expect(signatureStatusAllowed(status)).toBe(false)
    }
  })
})
