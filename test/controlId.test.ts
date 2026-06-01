import { describe, it, expect } from 'vitest'
import {
  parseControlId, formatControlId, withLayer, controlIdsForLayer, layerOfId, hasRow,
} from '../src/model/controlId'

describe('controlId', () => {
  it('parses rotary/rotbut 3-digit ids as layer/col/row', () => {
    expect(parseControlId('rotary', '073')).toEqual({ type: 'rotary', layer: 0, col: 7, row: 3 })
    expect(parseControlId('rotbut', '123')).toEqual({ type: 'rotbut', layer: 1, col: 2, row: 3 })
    expect(parseControlId('rotary', '000')).toEqual({ type: 'rotary', layer: 0, col: 0, row: 0 })
  })

  it('parses fader/mute 2-digit ids as layer/col (no row)', () => {
    expect(parseControlId('fader', '07')).toEqual({ type: 'fader', layer: 0, col: 7 })
    expect(parseControlId('mute', '13')).toEqual({ type: 'mute', layer: 1, col: 3 })
  })

  it('formats ids back', () => {
    expect(formatControlId({ type: 'rotary', layer: 1, col: 2, row: 3 })).toBe('123')
    expect(formatControlId({ type: 'mute', layer: 1, col: 0 })).toBe('10')
    expect(formatControlId({ type: 'fader', layer: 2, col: 7 })).toBe('27')
  })

  it('round-trips parse∘format for all positions', () => {
    for (const type of ['rotary', 'rotbut', 'fader', 'mute'] as const) {
      for (const id of controlIdsForLayer(type, 3)) {
        expect(formatControlId(parseControlId(type, id))).toBe(id)
      }
    }
  })

  it('rewrites the layer digit (copy-layer primitive)', () => {
    expect(withLayer('073', 1)).toBe('173')
    expect(withLayer('07', 2)).toBe('27')
    expect(layerOfId('173')).toBe(1)
    expect(layerOfId('27')).toBe(2)
  })

  it('enumerates a layer: 32 rotaries, 8 faders', () => {
    const rot = controlIdsForLayer('rotary', 0)
    expect(rot).toHaveLength(32)
    expect(rot[0]).toBe('000')
    expect(rot.at(-1)).toBe('073')
    expect(controlIdsForLayer('fader', 1)).toEqual(['10','11','12','13','14','15','16','17'])
    expect(controlIdsForLayer('mute', 5)).toHaveLength(8)
    expect(controlIdsForLayer('snp', 0)).toEqual([])
  })

  it('knows which types have rows', () => {
    expect(hasRow('rotary')).toBe(true)
    expect(hasRow('rotbut')).toBe(true)
    expect(hasRow('fader')).toBe(false)
    expect(hasRow('mute')).toBe(false)
  })
})
