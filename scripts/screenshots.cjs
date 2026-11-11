const { spawnSync } = require('node:child_process')
const path = require('node:path')

/**
 * Runs a built Eaglet window offscreen and captures one PNG per theme.
 * Usage: npm run shots
 */
const root = path.resolve(__dirname, '..')
const electron = require('electron')

const result = spawnSync(electron, ['.', '--eaglet-shots'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    EAGLET_SHOT_DIR: path.join(root, 'screenshots')
  }
})

process.exit(result.status ?? 0)
