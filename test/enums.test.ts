import { describe, it, expect } from 'vitest'
import { storedToDisplay, displayToStored, unpackXY, packXY, unpackBank, packBank, STORE_MAX,
  allowedFor, MSG_TYPE_BY_KIND, BEHAV_BY_KIND, CURVE_BY_KIND,
  FOURTEEN_BIT_TYPES, formatBankFloat } from '../src/model/enums'

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
  it('treats Program Change value as a 0-127 program number', () => {
    expect(storedToDisplay(9933, 9)).toBe(77)   // captured: Program 77 -> maxOut 9933
    expect(storedToDisplay(11352, 10)).toBe(88) // captured: Program+Bank 88 -> maxOut 11352
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

describe('per-control-type option subsets (allowedFor)', () => {
  it('restricts to a single kind’s options', () => {
    // rotaries are linear: CC family + PB + AT, but never Note On (2)
    expect(allowedFor(MSG_TYPE_BY_KIND, ['rotary'])).not.toContain(2)
    // buttons are binary: Note On is allowed
    expect(allowedFor(MSG_TYPE_BY_KIND, ['rotbut'])).toContain(2)
    // buttons only get On/Off-50 (9) or Feedback-Only (34) curves
    expect(allowedFor(CURVE_BY_KIND, ['mute'])).toEqual([9, 34])
  })
  it('intersects across a mixed selection', () => {
    // rotary+mute share the linear msgTypes minus Note On (mute has it, rotary doesn’t)
    expect(allowedFor(MSG_TYPE_BY_KIND, ['rotary', 'mute'])).not.toContain(2)
  })
  it('returns null when kinds have no common option, so the field stays unrestricted', () => {
    // rotary behaviors (0-2) and fader behaviors (11,12) are disjoint
    expect(allowedFor(BEHAV_BY_KIND, ['rotary', 'fader'])).toBeNull()
    expect(allowedFor(BEHAV_BY_KIND, [])).toBeNull()
  })
})

describe('Program+Bank msgNr float packing', () => {
  it('packs/unpacks MSB.LSB, matching the capture', () => {
    expect(unpackBank(5.009)).toEqual({ msb: 5, lsb: 9 }) // captured bank fields 5 then 9
    expect(packBank(5, 9)).toBe(5.009)
    expect(unpackBank(packBank(12, 90))).toEqual({ msb: 12, lsb: 90 }) // round-trips, incl. trailing zero
  })
})

// The 14-bit message types reuse the same MSB.LSB float packing for their message NUMBER (msgNr).
// Values below are from a real Drop export (test/fixtures/nrpn-14bit.json): NRPN/CC14/CC14-LSB-first
// set by hand to MSB/LSB pairs, with csvRef left at 0.
describe('14-bit (CC14 / NRPN / CC14 LSB first) msgNr float packing', () => {
  it('covers the three 14-bit message types', () => {
    expect([...FOURTEEN_BIT_TYPES].sort((a, b) => a - b)).toEqual([7, 8, 12])
  })
  it('packs/unpacks the captured MSB/LSB addresses', () => {
    expect(packBank(3, 14)).toBe(3.014)   // NRPN 3/14 -> 3.014
    expect(packBank(1, 100)).toBe(1.1)    // NRPN 1/100 -> 1.100
    expect(packBank(5, 0)).toBe(5)        // NRPN 5/0  -> 5.000
    expect(packBank(0, 64)).toBe(0.064)   // NRPN 0/64 -> 0.064
    expect(unpackBank(1.1)).toEqual({ msb: 1, lsb: 100 }) // .1 is LSB 100, not 1
    expect(unpackBank(0.064)).toEqual({ msb: 0, lsb: 64 })
  })
  it('formats the float exactly as the Drop writes it (always 3 decimals)', () => {
    expect(formatBankFloat(3.014)).toBe('3.014')
    expect(formatBankFloat(1.1)).toBe('1.100')
    expect(formatBankFloat(5)).toBe('5.000')
    expect(formatBankFloat(0.064)).toBe('0.064')
  })
})
