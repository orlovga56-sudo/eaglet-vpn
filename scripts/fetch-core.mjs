import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * Downloads the sing-box release used by the desktop build into resources/bin.
 * Usage: npm run core
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = join(root, 'resources', 'bin')

const platformTag =
  process.platform === 'win32'
    ? `windows-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`
    : process.platform === 'darwin'
      ? `darwin-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`
      : `linux-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`

const headers = { 'User-Agent': 'Eaglet-build' }

console.log('Looking up the latest sing-box release…')
const releaseResponse = await fetch('https://api.github.com/repos/SagerNet/sing-box/releases/latest', { headers })
if (!releaseResponse.ok) throw new Error(`GitHub lookup failed (${releaseResponse.status})`)
const release = await releaseResponse.json()
const asset = release.assets.find(
  (item) => item.name.includes(`-${platformTag}.`) && item.name.endsWith('.zip') && !item.name.includes('legacy')
)
if (!asset) throw new Error(`No sing-box build for ${platformTag}`)

const archive = join(tmpdir(), `eaglet-core-${Date.now()}.zip`)
console.log(`Downloading ${asset.name}…`)
const download = await fetch(asset.browser_download_url, { headers })
if (!download.ok || !download.body) throw new Error(`Download failed (${download.status})`)
await pipeline(Readable.fromWeb(download.body), createWriteStream(archive))

const extracted = join(tmpdir(), `eaglet-core-${Date.now()}`)
mkdirSync(extracted, { recursive: true })
execFileSync('tar', ['-xf', archive, '-C', extracted], { stdio: 'inherit' })

const walk = (dir) => {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else files.push(full)
  }
  return files
}

mkdirSync(destination, { recursive: true })
for (const file of walk(extracted)) {
  const name = file.split(/[\\/]/).pop()
  if (name.endsWith('.exe') || name.endsWith('.dll') || name === 'sing-box' || name === 'LICENSE') {
    const target = join(destination, name)
    writeFileSync(target, readFileSync(file))
    if (name === 'sing-box' && process.platform !== 'win32') execFileSync('chmod', ['+x', target])
  }
}

rmSync(archive, { force: true })
rmSync(extracted, { recursive: true, force: true })

const binary = join(destination, process.platform === 'win32' ? 'sing-box.exe' : 'sing-box')
if (!existsSync(binary)) throw new Error('The release did not contain a sing-box binary')
console.log(`Core ready at ${binary} (${release.tag_name})`)
