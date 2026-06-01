// Bundled device-preset CSV snapshot. Vite inlines each CSV as a raw string.
// Each entry records the csvPath/csvFile the Drop uses so a project device can be
// matched to its preset. Users can also upload a CSV per device at runtime.
import delugeCsv from './devices/Synthstrom/Deluge.csv?raw'
import { parsePresetCsv, type PresetDevice } from '../model/presetDb'

export interface BundledDevice {
  id: string
  manufacturer: string
  device: string
  /** matches a project device's csvPath */
  path: string
  /** matches a project device's csvFile */
  file: string
  csv: string
}

export const BUNDLED_DEVICES: BundledDevice[] = [
  { id: 'synthstrom-deluge', manufacturer: 'Synthstrom', device: 'Deluge', path: '/midi-main/Synthstrom', file: 'Deluge.csv', csv: delugeCsv },
]

export function parseBundled(id: string): PresetDevice | null {
  const d = BUNDLED_DEVICES.find((x) => x.id === id)
  return d ? parsePresetCsv(d.csv) : null
}

/** Resolve a project device's CSV (by its csvPath + csvFile) to a parsed preset, if bundled. */
export function parseBundledByPathFile(path: string, file: string): PresetDevice | null {
  const d = BUNDLED_DEVICES.find((x) => x.file === file && (x.path === path || path === ''))
  return d ? parsePresetCsv(d.csv) : null
}
