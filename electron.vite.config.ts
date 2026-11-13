import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const CONTENT_SECURITY_POLICY =
  "default-src 'self' file:; script-src 'self' file:; style-src 'self' 'unsafe-inline' file:; img-src 'self' data: blob: file:; font-src 'self' data: file:; connect-src 'self' file:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

/** Injects a strict CSP into the production HTML only (dev needs Vite's inline preamble). */
function cspPlugin(): { name: string; apply: 'build'; transformIndexHtml: (html: string) => string } {
  return {
    name: 'eaglet-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`
      )
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), cspPlugin()]
  }
})
