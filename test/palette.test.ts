import { describe, it, expect } from 'vitest'
import { colorFor, hueCycleColor } from '../src/ui/palette'

describe('hueCycleColor (Hue Color LED style)', () => {
  // 10 evenly-spaced phases: red, amber, gold, spring, turquoise, cyan, aqua, violet, magenta, red
  const seq = [9, 0, 1, 2, 3, 4, 5, 6, 7, 9]

  it('steps through the 10 phases red→…→magenta→red', () => {
    for (let phase = 0; phase < 10; phase++) {
      const mid = phase / 10 + 0.05 // middle of the phase band
      expect(hueCycleColor(mid)).toBe(colorFor(seq[phase]))
    }
  })

  it('starts and ends on red', () => {
    expect(hueCycleColor(0)).toBe(colorFor(9))
    expect(hueCycleColor(1)).toBe(colorFor(9))
    expect(hueCycleColor(0.95)).toBe(colorFor(9))
  })

  it('clamps out-of-range values', () => {
    expect(hueCycleColor(-1)).toBe(colorFor(9))
    expect(hueCycleColor(2)).toBe(colorFor(9))
  })

  it('magenta is the last distinct phase (0.8–0.9)', () => {
    expect(hueCycleColor(0.85)).toBe(colorFor(7))
  })
})
