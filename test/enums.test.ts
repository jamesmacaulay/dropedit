import { describe, it, expect } from 'vitest'
import { storedToDisplay, displayToStored, unpackXY, packXY, STORE_MAX } from '../src/model/enums'

// Slot Min/Max are stored as a 14-bit value over the message type's display range
// (verified by hardware capture). msgType codes: 3=CC (0-127), 7=CC14 (0-16383), 5=Pitch bend (±8192).
describe('slot Min/Max scaling', () => {
  it('scales CC (0-127) to/from the 14-bit store', () => {
    expect(storedToDisplay(STORE_MAX, 3)).toBe(127)
    expect(storedToDisplay(8256, 3)).toBe(64)   // captured: CC Max 64 -> 8256
    expect(storedToDisplay(129, 3)).toBe(1)      // captured: CC Max 1 -> 129
    expect(displayToStored(127, 3)).toBe(16383)
    expect(displayToStored(64, 3)).toBe(8256)
    expect(displayToStored(1, 3)).toBe(129)
  })
  it('is 1:1 for 14-bit types (CC14/NRPN)', () => {
    expect(storedToDisplay(8191, 7)).toBe(8191)
    expect(displayToStored(16383, 8)).toBe(16383)
  })
  it('offsets pitch bend (-8192..8191 <-> 0..16383)', () => {
    expect(storedToDisplay(0, 5)).toBe(-8192)
    expect(storedToDisplay(STORE_MAX, 5)).toBe(8191)
    expect(displayToStored(-8192, 5)).toBe(0)
    expect(displayToStored(8191, 5)).toBe(16383)
  })
})

describe('Flex curve XY packing', () => {
  it('packs/unpacks (x<<7)|y, matching the capture', () => {
    expect(packXY(10, 20)).toBe(1300)   // captured XY1 (10,20)
    expect(packXY(90, 100)).toBe(11620) // captured XY2 (90,100)
    expect(unpackXY(1300)).toEqual({ x: 10, y: 20 })
    expect(unpackXY(11620)).toEqual({ x: 90, y: 100 })
  })
})
