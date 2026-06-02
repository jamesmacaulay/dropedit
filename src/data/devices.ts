// Bundled MIDI device-preset database, vendored from pencilresearch/midi (CC-BY-SA-4.0)
// under src/data/devices/<Manufacturer>/<Device>.csv. See scripts/sync-midi-db.mjs to refresh.
//
// Each CSV is loaded LAZILY (its own chunk) so the main bundle stays small: only the devices a
// project actually references — or one the user picks in the device editor — are fetched + parsed.
// The manifest (BUNDLED_DEVICES) is built synchronously from the glob keys (just strings).
import { parsePresetCsv, type PresetDevice } from '../model/presetDb'

const loaders = import.meta.glob('./devices/**/*.csv', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>

export interface BundledDevice {
  id: string
  manufacturer: string
  device: string
  /** matches a project device's csvPath, e.g. "/midi-main/Arturia" */
  path: string
  /** matches a project device's csvFile, e.g. "MicroFreak.csv" */
  file: string
  /** internal: key into the lazy loader map */
  glob: string
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export const BUNDLED_DEVICES: BundledDevice[] = (() => {
  const seen = new Set<string>()
  return Object.keys(loaders).map((glob) => {
    const rel = glob.replace(/^\.\/devices\//, '') // "Arturia/MicroFreak.csv"
    const i = rel.indexOf('/')
    const manufacturer = rel.slice(0, i)
    const file = rel.slice(i + 1)
    const device = file.replace(/\.csv$/i, '')
    let id = slug(`${manufacturer}-${device}`)
    while (seen.has(id)) id += '-x' // keep ids unique even if two slugs collide
    seen.add(id)
    return { id, manufacturer, device, path: `/midi-main/${manufacturer}`, file, glob }
  }).sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.device.localeCompare(b.device))
})()

const cache = new Map<string, PresetDevice>()
async function loadDevice(d: BundledDevice): Promise<PresetDevice> {
  const hit = cache.get(d.glob)
  if (hit) return hit
  const pd = parsePresetCsv(await loaders[d.glob]())
  cache.set(d.glob, pd)
  return pd
}

export async function loadBundled(id: string): Promise<PresetDevice | null> {
  const d = BUNDLED_DEVICES.find((x) => x.id === id)
  return d ? loadDevice(d) : null
}

/** Resolve a project device's CSV (by its csvPath + csvFile) to a parsed preset, if bundled. */
export async function loadBundledByPathFile(path: string, file: string): Promise<PresetDevice | null> {
  const d = BUNDLED_DEVICES.find((x) => x.file === file && (x.path === path || path === ''))
  return d ? loadDevice(d) : null
}
