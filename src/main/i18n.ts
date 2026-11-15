/**
 * Main-process translator. The renderer owns the persisted `language` setting,
 * so `src/main/index.ts` pushes every update here before emitting notifications,
 * diagnostics or engine log lines.
 */
import { DEFAULT_LANGUAGE, translate, type Vars } from '@shared/i18n'
import type { Language } from '@shared/types'

let current: Language = DEFAULT_LANGUAGE

export function setMainLanguage(language: Language): void {
  current = language
}

export function getMainLanguage(): Language {
  return current
}

/** Translate an English source string into the active language. */
export function t(key: string, vars?: Vars): string {
  return translate(current, key, vars)
}
