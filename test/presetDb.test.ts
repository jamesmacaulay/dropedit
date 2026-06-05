import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parsePresetCsv, splitCsvLine, makeCsvRef, paramLabel, deriveControlName, slotParamRow, type PresetParam, type PresetDevice } from '../src/model/presetDb'

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

  it('csvRef = flag | (cc<<23) | rowIndex (hardware-verified, scripts/decode-csvref.mjs)', () => {
    // exact 32-bit values from the hardware capture
    expect(makeCsvRef(15, 52)).toBe(0x5a00000f) // Delay / Amount
    expect(makeCsvRef(16, 53)).toBe(0x5a800010) // Delay / Rate
    expect(makeCsvRef(75, 91)).toBe(0x6d80004b) // Reverb / Reverb amount
    expect(makeCsvRef(46, 81)).toBe(0x6880002e) // High-pass filter / Frequency
    expect(makeCsvRef(57, 7)).toBe(0x43800039)  // Master / Master level
    // field layout: low 16 = row, bits 23-29 = cc, bit 30 set
    const ref = makeCsvRef(15, 52)
    expect(ref & 0xffff).toBe(15)
    expect((ref >>> 23) & 0x7f).toBe(52)
    expect((ref >>> 30) & 1).toBe(1)
  })

  it('builds friendly labels', () => {
    const p = find(dev.params, 'Reverb', 'Reverb amount')!
    expect(paramLabel(p)).toBe('Reverb / Reverb amount')
  })

  describe('slotParamRow', () => {
    // Deluge.csv has 128 distinct CCs (no duplicates), so CC-matching is unambiguous there.
    it('uses csvRef when it points at a row whose CC matches', () => {
      expect(slotParamRow(dev, 3, makeCsvRef(15, 52), 52)).toBe(15) // Delay/Amount: row 15, cc 52
    })
    it('falls back to a unique CC match when csvRef is 0/unset', () => {
      expect(slotParamRow(dev, 3, 0, 52)).toBe(15)   // csvRef 0 but cc 52 is unique -> Delay/Amount
      expect(slotParamRow(dev, 3, 0, 91)).toBe(75)   // Reverb amount, cc 91
    })
    it('returns null when nothing matches or it is not a CC slot', () => {
      expect(slotParamRow(dev, 3, 0, 9999)).toBeNull() // no such CC
      expect(slotParamRow(dev, 2, 0, 52)).toBeNull()   // msgType 2 (Note On), not CC
      expect(slotParamRow(null, 3, 0, 52)).toBeNull()  // no device
    })
    it('does not guess on a device whose CSV repeats a CC', () => {
      const params: PresetParam[] = [
        { rowIndex: 0, section: 'A', name: 'Foo', cc: 7 },
        { rowIndex: 1, section: 'B', name: 'Bar', cc: 7 }, // duplicate cc 7
        { rowIndex: 2, section: 'C', name: 'Baz', cc: 10 },
      ]
      const ambig: PresetDevice = { manufacturer: 'X', device: 'Y', params, byRowIndex: new Map(params.map((p) => [p.rowIndex, p])) }
      expect(slotParamRow(ambig, 3, 0, 7)).toBeNull()  // ambiguous -> don't guess
      expect(slotParamRow(ambig, 3, 0, 10)).toBe(2)    // unique -> resolves
      expect(slotParamRow(ambig, 3, makeCsvRef(1, 7), 7)).toBe(1) // csvRef disambiguates the duplicate
    })
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
