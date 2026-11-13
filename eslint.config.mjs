import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'release/**',
      'screenshots/**',
      '*.tsbuildinfo',
      'scripts/*.cjs'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Defensive initialisation and rethrow wrappers are intentional in the
      // VPN control paths; these new core rules add noise without catching bugs.
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      // ANSI escape stripping needs a control-character match.
      'no-control-regex': 'off'
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser }
    }
  }
)
