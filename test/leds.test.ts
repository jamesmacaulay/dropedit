import { describe, it, expect } from 'vitest'
import { ledSegments, ledLevels, OFF, LIT, HEAD, LED_COUNT, FEEDB_HUE } from '../src/model/leds'

const count = (lit: boolean[]) => lit.filter(Boolean).length
const heads = (lv: number[]) => lv.map((l, i) => (l === HEAD ? i : -1)).filter((i) => i >= 0)

describe('ledSegments / ledLevels', () => {
  it('has 13 segments by default', () => {
    expect(ledSegments(0, 0.5)).toHaveLength(LED_COUNT)
    expect(ledLevels(0, 0.5)).toHaveLength(LED_COUNT)
  })

  it('Line from left (0): bar fills from index 0 up to the value, head at the value position', () => {
    expect(ledLevels(0, 0)).toEqual([HEAD, ...new Array(12).fill(OFF)]) // value 0 -> indicator at start
    expect(ledLevels(0, 1)).toEqual([...new Array(12).fill(LIT), HEAD]) // full bar, head at the end
    const half = ledSegments(0, 0.5)
    expect(half[0]).toBe(true)
    expect(half[12]).toBe(false)
    expect(count(half)).toBe(7) // 0..6
    expect(heads(ledLevels(0, 0.5))).toEqual([6]) // round(0.5*12)
    expect(heads(ledLevels(0, 0.25))).toEqual([3]) // a quarter of the way along
  })

  it('Line from right (29): bar fills from the last index down to the value position', () => {
    const half = ledLevels(29, 0.5)
    expect(half[12]).toBe(LIT)
    expect(half[0]).toBe(OFF)
    expect(count(ledSegments(29, 0.5))).toBe(7)
    expect(heads(half)).toEqual([6]) // mirror of line-from-left
    expect(ledSegments(29, 1)).toEqual(new Array(13).fill(true))
  })

  it('Line from centre (1) is symmetric: centre at 0, growing both ways to the extremes', () => {
    expect(heads(ledLevels(1, 0))).toEqual([6]) // only the centre LED lit, as the indicator
    expect(count(ledSegments(1, 0))).toBe(1)
    const half = ledLevels(1, 0.5) // grows halfway from centre to each extreme
    expect(heads(half)).toEqual([3, 9])
    expect(count(ledSegments(1, 0.5))).toBe(7) // 3..9
    expect(ledSegments(1, 1)).toEqual(new Array(13).fill(true)) // full ring
    expect(heads(ledLevels(1, 1))).toEqual([0, 12])
  })

  it('Dot (2) lights exactly one moving head segment', () => {
    expect(heads(ledLevels(2, 0))).toEqual([0])
    expect(heads(ledLevels(2, 1))).toEqual([12])
    expect(count(ledSegments(2, 0.5))).toBe(1)
    expect(heads(ledLevels(2, 0.5))).toEqual([6])
  })

  it('Step styles (3..26) quantise the bar', () => {
    // "2 Steps" (feedbId 3): value snaps to start or full
    expect(heads(ledLevels(3, 0.2))).toEqual([0])
    expect(count(ledSegments(3, 0.9))).toBe(13)
  })

  it('Hue Color (30) uses the line-from-left lit pattern (its colour cycles in the UI)', () => {
    expect(FEEDB_HUE).toBe(30)
    expect(ledLevels(FEEDB_HUE, 0)).toEqual(ledLevels(0, 0))
    expect(ledLevels(FEEDB_HUE, 0.5)).toEqual(ledLevels(0, 0.5))
    expect(ledLevels(FEEDB_HUE, 1)).toEqual(ledLevels(0, 1))
  })

  it('Blank (27) lights none', () => {
    expect(ledLevels(27, 1)).toEqual(new Array(13).fill(OFF))
  })

  it('clamps out-of-range values and falls back to line-from-left for unknown styles', () => {
    expect(heads(ledLevels(0, -5))).toEqual([0])      // clamps to 0
    expect(ledSegments(0, 5)).toEqual(new Array(13).fill(true))
    expect(ledSegments(28, 1)).toEqual(new Array(13).fill(true)) // Default -> line from left
    expect(ledSegments(999, 1)).toEqual(new Array(13).fill(true))
  })
})
