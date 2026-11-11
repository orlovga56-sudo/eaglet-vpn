import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { feature } from 'topojson-client'

/**
 * Pre-renders a lightweight land outline (Natural Earth 110m, public domain)
 * into an SVG path so the renderer ships without a mapping dependency.
 *
 * Usage: npm run map
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const atlasPath = join(__dirname, '..', 'node_modules', 'world-atlas', 'land-110m.json')
const outPath = join(__dirname, '..', 'src', 'renderer', 'src', 'data', 'worldMap.json')

const WIDTH = 1000
const HEIGHT = 520

const topology = JSON.parse(readFileSync(atlasPath, 'utf-8'))
const land = feature(topology, topology.objects.land)

const round = (n) => Math.round(n * 10) / 10

function ringToPath(ring) {
  return ring
    .map(([lon, lat], index) => {
      const x = ((lon + 180) / 360) * WIDTH
      const y = ((90 - lat) / 180) * HEIGHT
      return `${index === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`
    })
    .join(' ')
}

const paths = []
const features = land.features ?? [land]
for (const f of features) {
  const geometry = f.geometry
  if (!geometry) continue
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  for (const polygon of polygons) {
    for (const ring of polygon) {
      paths.push(`${ringToPath(ring)} Z`)
    }
  }
}

const output = { width: WIDTH, height: HEIGHT, path: paths.join(' ') }
writeFileSync(outPath, JSON.stringify(output), 'utf-8')
console.log(`world map written: ${outPath} (${(output.path.length / 1024).toFixed(1)} KB)`)
