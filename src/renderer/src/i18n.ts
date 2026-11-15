/**
 * Renderer-side translator. `App` calls `setLanguage` whenever the persisted
 * settings change, and every component calls `t` during render. Because the app
 * holds no memoised children, a language switch re-renders the whole tree.
 */
import { DEFAULT_LANGUAGE, translate, type Vars } from '@shared/i18n'
import type { Language } from '@shared/types'

let current: Language = DEFAULT_LANGUAGE

export function setLanguage(language: Language): void {
  current = language
}

export function getLanguage(): Language {
  return current
}

/** Translate an English source string into the active language. */
export function t(key: string, vars?: Vars): string {
  return translate(current, key, vars)
}
