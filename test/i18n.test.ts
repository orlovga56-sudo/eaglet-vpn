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

describe('interface language', () => {
  it('defaults to Russian and offers both languages', () => {
    expect(DEFAULT_LANGUAGE).toBe('ru')
    expect(LANGUAGES.map((language) => language.id).sort()).toEqual(['en', 'ru'])
  })

  it('has a Russian translation for every source string', () => {
    const missing = sourceKeys().filter((key) => !hasTranslation('ru', key))
    expect(missing).toEqual([])
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
