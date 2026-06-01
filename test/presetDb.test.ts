import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parsePresetCsv, splitCsvLine, makeCsvRef, paramLabel, type PresetParam } from '../src/model/presetDb'

const here = dirname(fileURLToPath(import.meta.url))
const csv = readFileSync(join(here, '..', 'src', 'data', 'devices', 'Synthstrom', 'Deluge.csv'), 'utf8')

const find = (params: PresetParam[], section: string, name: string) =>
  params.find((p) => p.section === section && p.name === name)

describe('presetDb', () => {
  const dev = parsePresetCsv(csv)

  it('reads manufacturer/device', () => {
    expect(dev.manufacturer).toBe('Synthstrom')
    expect(dev.device).toBe('Deluge')
  })

  it('maps params to the correct rowIndex + cc (matches verified csvRef low bytes)', () => {
    // CSV line numbers → rowIndex = line - 2; these indices equal the low 16 of real csvRefs.
    expect(find(dev.params, 'Delay', 'Amount')).toMatchObject({ rowIndex: 15, cc: 52 })
    expect(find(dev.params, 'Delay', 'Rate')).toMatchObject({ rowIndex: 16, cc: 53 })
    expect(find(dev.params, 'Reverb', 'Reverb amount')).toMatchObject({ rowIndex: 75, cc: 91 })
    expect(find(dev.params, 'High-pass filter', 'Frequency')).toMatchObject({ rowIndex: 46, cc: 81 })
    expect(find(dev.params, 'Master', 'Master level')).toMatchObject({ rowIndex: 57, cc: 7 })
  })

  it('includes the mappable-CC pool and master controls', () => {
    expect(find(dev.params, 'Master', 'Master pan')).toMatchObject({ cc: 10 })
    expect(find(dev.params, 'Mappable CCs', 'Mappable CC 000')).toMatchObject({ cc: 0 })
    // every row got an index; count is large
    expect(dev.params.length).toBeGreaterThan(100)
  })

  it('csvRef low 16 bits equal the rowIndex (verified half)', () => {
    for (const idx of [15, 16, 75, 46, 57]) {
      expect(makeCsvRef(idx) & 0xffff).toBe(idx)
    }
  })

  it('builds friendly labels', () => {
    const p = find(dev.params, 'Reverb', 'Reverb amount')!
    expect(paramLabel(p)).toBe('Reverb / Reverb amount')
  })

  it('splitCsvLine handles quoted fields with commas', () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd'])
    expect(splitCsvLine('x,,y')).toEqual(['x', '', 'y'])
  })
})
