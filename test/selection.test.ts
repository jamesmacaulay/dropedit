import { describe, it, expect } from 'vitest'
import { rangeSelect, rangeSelectSnapshots } from '../src/model/selection'

const set = (keys: string[]) => new Set(keys)

describe('rangeSelect', () => {
  it('adds the target when there is nothing to anchor to', () => {
    expect(rangeSelect([], ['rotary:022'])).toEqual(['rotary:022'])
    // anchor only on another layer -> no box, just add the target
    expect(set(rangeSelect(['rotary:100'], ['rotary:022']))).toEqual(set(['rotary:100', 'rotary:022']))
  })

  it('fills the rectangle between a single anchor and the target (rotary rows take push buttons too)', () => {
    const out = set(rangeSelect(['rotary:000'], ['rotary:022'])) // box cols 0-2, rows 0-2
    for (const col of [0, 1, 2]) for (const row of [0, 1, 2]) {
      expect(out.has(`rotary:0${col}${row}`)).toBe(true)
      expect(out.has(`rotbut:0${col}${row}`)).toBe(true) // Option A: push buttons included
    }
    expect(out.has('rotary:003')).toBe(false) // row 3 outside the box
    expect(out.has('rotary:033')).toBe(false) // col 3 outside the box
    expect(out.has('mute:00')).toBe(false)     // mute/fader bands outside rows 0-2
    expect(out.has('fader:00')).toBe(false)
    expect(out.size).toBe(2 /*types*/ * 3 * 3)
  })

  it('reaches the mute and fader bands when the box extends down to a fader', () => {
    const out = set(rangeSelect(['rotary:000'], ['fader:01'])) // box cols 0-1, vrows 0-5
    expect(out.has('mute:00')).toBe(true)
    expect(out.has('mute:01')).toBe(true)
    expect(out.has('fader:00')).toBe(true)
    expect(out.has('fader:01')).toBe(true)
    expect(out.has('rotary:013')).toBe(true)
    expect(out.has('rotbut:013')).toBe(true)
  })

  it('preserves selections on other layers untouched (they do not anchor the box)', () => {
    const out = set(rangeSelect(['rotary:100', 'rotary:000'], ['rotary:011']))
    expect(out.has('rotary:100')).toBe(true) // layer 1 — kept, but not used to build the layer-0 box
    expect(out.has('rotary:000')).toBe(true)
    expect(out.has('rotary:011')).toBe(true)
    expect(out.has('rotbut:011')).toBe(true)
  })

  it('a column target acts like ranging to every control in the column', () => {
    const col3 = [
      ...['0', '1', '2', '3'].flatMap((r) => [`rotary:03${r}`, `rotbut:03${r}`]),
      'mute:03', 'fader:03',
    ]
    const out = set(rangeSelect(['rotary:000'], col3)) // anchor top-left, range to all of column 3
    // should fill cols 0-3 across every band
    expect(out.has('fader:00')).toBe(true)
    expect(out.has('mute:02')).toBe(true)
    expect(out.has('rotary:033')).toBe(true)
    expect(out.has('rotbut:013')).toBe(true)
  })

  it('snapshots: fills the rectangle between an anchor pad and the clicked pad (same bank)', () => {
    // bank 00; anchor pad (col0,row0)="0000", click (col2,row1)="0021" -> box cols 0-2, rows 0-1
    const out = set(rangeSelectSnapshots(['snp:0000'], ['snp:0021']))
    for (const col of [0, 1, 2]) for (const row of [0, 1]) expect(out.has(`snp:00${col}${row}`)).toBe(true)
    expect(out.has('snp:0003')).toBe(false) // row 3 outside
    expect(out.has('snp:0030')).toBe(false) // col 3 outside
    expect(out.size).toBe(3 * 2)
  })

  it('snapshots: only anchors on pads in the same bank, and adds the target with no anchor', () => {
    const out = set(rangeSelectSnapshots(['snp:0100'], ['snp:0011'])) // anchor in bank 01, click in bank 00
    expect(out.has('snp:0100')).toBe(true) // preserved
    expect(out.has('snp:0011')).toBe(true) // added (no same-bank anchor → no box)
    expect(out.has('snp:0000')).toBe(false)
    expect(rangeSelectSnapshots([], ['snp:0011'])).toEqual(['snp:0011'])
  })

  it('produces an L-shape for a disjoint prior selection (not the filled bounding box)', () => {
    // anchors at top-left (0,0) and bottom-right (col5? capped) — use rows within 0-3 to stay in band
    // anchors (col0,row0) and (col2,row2); click (col2,row0) -> union of box((0,0)->(2,0)) and box((2,2)->(2,0))
    const out = set(rangeSelect(['rotary:000', 'rotary:022'], ['rotary:020']))
    expect(out.has('rotary:000')).toBe(true) // top edge
    expect(out.has('rotary:010')).toBe(true)
    expect(out.has('rotary:020')).toBe(true)
    expect(out.has('rotary:021')).toBe(true) // right edge down
    expect(out.has('rotary:022')).toBe(true)
    expect(out.has('rotary:011')).toBe(false) // interior NOT filled -> it's an L, not a block
  })
})
