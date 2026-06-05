import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parsePresetCsv, splitCsvLine, makeCsvRef, paramLabel, deriveControlName, type PresetParam } from '../src/model/presetDb'

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

  describe('deriveControlName', () => {
    const within16 = (s: string) => expect(s.length).toBeLessThanOrEqual(16)

    it('keeps the full "Category Name" only when the category is short (<8 chars)', () => {
      expect(deriveControlName('Delay', 'Amount')).toBe('Delay Amount')
    })

    it('always condenses a long category (>=8 chars), even when the full form would fit', () => {
      // "Arpeggiator Rate" is 16 and would fit, but the category is long → shorten it
      expect(deriveControlName('Arpeggiator', 'Rate')).toBe('Arp Rate')
    })

    it('shortens the category first, then the name', () => {
      // "Arp Octave Spread" (17) still too long → shorten both
      expect(deriveControlName('Arpeggiator', 'Octave Spread')).toBe('Arp Oct Spr')
      // category shortened is enough on its own
      expect(deriveControlName('Low Frequency Osc', 'Rate')).toBe('Low Fre Osc Rate')
    })

    it('falls back to first+last words when shortening is not enough', () => {
      const out = deriveControlName('Voltage Controlled Filter', 'Resonance Amount Level')
      expect(out).toBe('Vol Fil Res Lev')
      within16(out)
    })

    it('drops the category when it is a prefix of the param name', () => {
      expect(deriveControlName('Reverb', 'Reverb amount')).toBe('Reverb amount') // not "Rev Rev amo"
      expect(deriveControlName('Filter', 'Filter')).toBe('Filter') // exact match → just the param
      // long after dropping the category → fit the param name with shorten/extraShorten
      expect(deriveControlName('Modulation', 'Modulation Envelope Attack')).toBe('Mod Env Att')
    })

    it('keeps the category when it only partially matches the start of a word (not a whole-word prefix)', () => {
      // "Pan" starts the string "Panic" but isn't a whole word there → category is kept, not dropped
      expect(deriveControlName('Pan', 'Panic button')).toBe('Pan Panic button')
    })

    it('handles an empty category (no leading space)', () => {
      expect(deriveControlName('', 'Rate')).toBe('Rate')
      expect(deriveControlName('', 'Octave Spread Amount')).toBe('Oct Spr Amo')
    })

    it('always stays within 16 chars', () => {
      within16(deriveControlName('Voltage Controlled Oscillator', 'Pulse Width Modulation Depth'))
      within16(deriveControlName('Synthesizer Engine Section', 'Filter Envelope Decay Time'))
    })
  })
})
