import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      // The main process imports Electron; unit tests must not start it.
      electron: fileURLToPath(new URL('./test/electron-stub.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    restoreMocks: true
  }
})
