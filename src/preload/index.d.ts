import type { EagletApi } from '@shared/types'

declare global {
  interface Window {
    eaglet: EagletApi
    __eagletSetTheme?: (theme: string) => void
    __eagletSetPage?: (page: string) => void
    __eagletConnect?: () => void
  }
}

export {}
