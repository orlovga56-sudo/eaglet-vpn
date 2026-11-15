import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_LANGUAGE, hasTranslation, LANGUAGES, translate } from '../src/shared/i18n'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(path)
  }
  return out
}

/** Every English source string passed to `t(...)` in the app. */
function sourceKeys(): string[] {
  const keys = new Set<string>()
  const pattern = /\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g
  for (const file of walk(join(process.cwd(), 'src'))) {
    const source = readFileSync(file, 'utf-8')
    for (const match of source.matchAll(pattern)) {
      const raw = match[1] ?? match[2] ?? ''
      keys.add(raw.replace(/\\'/g, "'").replace(/\\"/g, '"'))
    }
  }
  return [...keys].sort()
}

/** Find user-facing strings that might need translation */
function findUserFacingStrings(): string[] {
  const strings = new Set<string>()
  const patterns = [
    // Regular t() calls
    /\bt\(\s*['"]([^'"]+)['"][^)]*\)/g,
    // Direct user-facing strings (not technical identifiers)
    /(?:title|placeholder|label|text|message|error|warning|notification)\s*[:=]\s*['"]([^'"]+)['"]/gi,
    // Alert/confirm dialogs
    /window\.(alert|confirm)\(\s*['"]([^'"]+)['"][^)]*\)/g,
    // Document titles
    /document\.title\s*=\s*['"]([^'"]+)['"]/g,
    // aria-labels
    /aria-label\s*=\s*['"]([^'"]+)['"]/g
  ]
  
  // Exclude technical strings, IPs, file paths, protocol names
  const excludePatterns = [
    /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/, // IP addresses
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, // UUIDs
    /^https?:\/\/.+$/, // URLs
    /^\/.*\.json$/i, // file paths
    /^[a-f0-9]{64}$/i, // hashes
    /^(TCP|UDP|HTTP|HTTPS|VLESS|VMess|Trojan|Shadowsocks|Hysteria2|TUIC|SOCKS|IPv4|IPv6|DNS|DoH|TUN|sing-box|Xray-core|Mihomo)$/i, // protocols/tech terms
    /^[A-Z]{2,4}$/ // country codes
  ]
  
  for (const file of walk(join(process.cwd(), 'src'))) {
    const source = readFileSync(file, 'utf-8')
    
    // Find all t() calls
    for (const match of source.matchAll(/\bt\(\s*['"]([^'"]+)['"][^)]*\)/g)) {
      const key = match[1]
      if (!excludePatterns.some(pattern => pattern.test(key))) {
        strings.add(key)
      }
    }
    
    // Find other user-facing strings
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const str = match[1] || match[2]
        if (str.length > 2 && !excludePatterns.some(pattern => pattern.test(str))) {
          strings.add(str)
        }
      }
    }
  }
  
  return [...strings].sort()
}

describe('interface language', () => {
  it('defaults to Russian and offers both languages', () => {
    expect(DEFAULT_LANGUAGE).toBe('ru')
    expect(LANGUAGES.map((language) => language.id).sort()).toEqual(['en', 'ru'])
  })

  it('has a Russian translation for every source string', () => {
    const missing = sourceKeys().filter((key) => !hasTranslation('ru', key))
    expect(missing).toEqual([])
  })

  it('checks for untranslated user-facing strings', () => {
    const userStrings = findUserFacingStrings()
    const untranslated = userStrings.filter((str) => 
      str.length > 3 && 
      !/^[A-Z\s]+$/.test(str) && // All caps (likely technical)
      !hasTranslation('ru', str) &&
      !str.includes('{') && // Template variables
      !str.startsWith('http') &&
      !/^[0-9.]+$/.test(str) // Numbers
    )
    
    // Log untranslated strings for debugging
    if (untranslated.length > 0) {
      console.log('Untranslated strings found:', untranslated.slice(0, 10))
    }
    
    expect(untranslated).toEqual([])
  })

  it('keeps English as the source language', () => {
    expect(translate('en', 'Connect')).toBe('Connect')
    expect(translate('en', 'Connect', {})).toBe('Connect')
  })

  it('interpolates named placeholders', () => {
    expect(translate('ru', '{name} installed', { name: 'Mihomo' })).toBe('Mihomo установлен')
    expect(translate('ru', '{count} protocols', { count: 4 })).toBe('протоколов: 4')
    // Unknown placeholders are left untouched instead of turning into "undefined".
    expect(translate('ru', '{ping} ms', {})).toBe('{ping} мс')
  })

  it('falls back to the English source for unknown keys', () => {
    expect(translate('ru', 'A string with no translation')).toBe('A string with no translation')
  })
})
