// Human labels for Drop enum fields. Observed values + a raw fallback for the rest.
// (Not exhaustive — the Drop has more behaviors/curves; UI shows "raw N" when unknown.)

// Message type (msgType). 2/3/5/6/7/8/9/10/12 decoded from hardware captures (rotary slots +
// snapshot pads); 0/1/4/11 are labels from the firmware JSON spec (not yet capture-verified — they
// aren't selectable on FW 2.01, and their value encoding is left at the default display range).
export const MSG_TYPE: Record<number, string> = {
  0: 'Off', 1: 'Note Off', 2: 'Note On', 3: 'CC', 4: 'Poly Aftertouch', 5: 'Pitch bend',
  6: 'Aftertouch', 7: 'CC14', 8: 'NRPN', 9: 'Program Change', 10: 'Program+Bank',
  11: 'Song Position', 12: 'CC14 LSB first',
}

// A slot's Min/Max is stored as a 14-bit value (0-STORE_MAX) spanning the message type's display
// range (verified by capture: CC 64 -> 8256, pitchbend -8192..8191 -> 0..16383). The display range
// is per msgType, so the editor shows e.g. 0-127 for CC while the file holds 0-16383.
export const STORE_MAX = 16383
const MSG_RANGE: Record<number, { min: number; max: number }> = {
  2: { min: 0, max: 127 }, 3: { min: 0, max: 127 }, 6: { min: 0, max: 127 }, // Note On / CC / Aftertouch
  5: { min: -8192, max: 8191 },                                              // Pitch bend
  7: { min: 0, max: 16383 }, 8: { min: 0, max: 16383 }, 12: { min: 0, max: 16383 }, // CC14 / NRPN / CC14 LSB
  9: { min: 0, max: 127 }, 10: { min: 0, max: 127 }, // Program Change / Program+Bank: value (maxOut) = program #
}
export function slotRange(msgType: number): { min: number; max: number } {
  return MSG_RANGE[msgType] ?? { min: 0, max: 127 } // sensible default for unknown types
}
export function storedToDisplay(stored: number, msgType: number): number {
  const { min, max } = slotRange(msgType)
  return Math.round(min + (stored / STORE_MAX) * (max - min))
}
export function displayToStored(display: number, msgType: number): number {
  const { min, max } = slotRange(msgType)
  return max === min ? 0 : Math.round(((display - min) / (max - min)) * STORE_MAX)
}

// The Flex curve (curveId 33) packs its two points into maxOut (XY1) and minOut (XY2),
// each as (x << 7) | y with x,y in 0-127 (verified: (10,20)->1300, (90,100)->11620).
export const FLEX_CURVE_ID = 33
export function unpackXY(packed: number): { x: number; y: number } {
  return { x: (packed >> 7) & 0x7f, y: packed & 0x7f }
}
export function packXY(x: number, y: number): number {
  return ((x & 0x7f) << 7) | (y & 0x7f)
}

// Program+Bank (msgType 10) packs its two bank values into msgNr as a float: the integer part is
// the first bank value and the fractional part (×1000) is the second (verified: 5.009 = 5, 9).
export const PROGRAM_TYPES = new Set([9, 10]) // Program Change, Program+Bank — value (maxOut) = program #
export function unpackBank(packed: number): { msb: number; lsb: number } {
  const msb = Math.floor(packed)
  return { msb, lsb: Math.round((packed - msb) * 1000) }
}
export function packBank(msb: number, lsb: number): number {
  return Number((msb + lsb / 1000).toFixed(3))
}

// The 14-bit message types (CC14, NRPN, CC14 LSB first) store their message *number* as the SAME
// MSB.LSB float as Program+Bank: msgNr = MSB + LSB/1000 (hardware-confirmed — set by hand on a Drop,
// raw bytes: NRPN 3/14 -> 3.014, 1/100 -> 1.100, 5/0 -> 5.000, 0/64 -> 0.064; CC14 and CC14-LSB-first
// match). So packBank/unpackBank serve both. (MSB,LSB span 0-127 each; csvRef stays 0 when hand-set.)
export const FOURTEEN_BIT_TYPES = new Set([7, 8, 12]) // CC14, NRPN, CC14 LSB first
// Serialize an MSB.LSB float the way the Drop writes it: ALWAYS three decimal places (5/0 -> "5.000",
// 1/100 -> "1.100"). We write this verbatim rather than via formatValue, whose "mirror the original
// token's decimals" rule would clip the LSB if the prior msgNr had fewer than 3 (e.g. a bare "52").
export function formatBankFloat(packed: number): string {
  return packed.toFixed(3)
}

// Behavior — a single global enum across control types (decoded from a hardware capture).
export const BEHAV: Record<number, string> = {
  0: 'Precision', 1: 'Dynamic Pot', 2: 'Dynamic Fast',
  3: 'Toggle', 4: 'Temporary', 5: 'Quick Turn',
  6: 'Reset Left', 7: 'Reset Mid', 8: 'Reset Right', 9: 'Reset L/R', 10: 'Reset R/L',
  11: 'One per Layer', 12: 'Layer A only',
}

// LED ring style (feedbId), rotary-knob turn. Codes are firmware-assigned, not menu order
// (e.g. "Line from right" = 29). 28 ("Default") is the feedback id non-rotary elements carry.
export const FEEDB: Record<number, string> = {
  0: 'Line from left', 1: 'Line from center', 2: 'Dot',
  3: '2 Steps', 4: '3 Steps', 5: '4 Steps', 6: '5 Steps', 7: '6 Steps', 8: '7 Steps', 9: '8 Steps',
  10: '9 Steps', 11: '10 Steps', 12: '11 Steps', 13: '12 Steps', 14: '13 Steps', 15: '14 Steps',
  16: '15 Steps', 17: '16 Steps', 18: '17 Steps', 19: '18 Steps', 20: '19 Steps', 21: '20 Steps',
  22: '21 Steps', 23: '22 Steps', 24: '23 Steps', 25: '24 Steps', 26: '25 Steps',
  27: 'Blank', 28: 'Default', 29: 'Line from right', 30: 'Hue Color',
  31: 'MIDI Level', 32: 'MIDI Clip LED',
  33: 'MIDI Col Dot', 34: 'MIDI Col Line from left', 35: 'MIDI Col Line from center', 36: 'MIDI Col Line from right',
}

// Output curve (curveId), faders & turning rotaries. "Flex" = 33 (appended out of menu order).
export const CURVE: Record<number, string> = {
  0: 'Linear', 1: 'Exp-', 2: 'Exp+',
  3: 'Lin Half R', 4: 'Exp- Half R', 5: 'Exp+ Half R', 6: 'Lin Half L', 7: 'Exp- Half L', 8: 'Exp+ Half L',
  9: 'On/Off 50', 10: 'On/Off 25', 11: 'On/Off 75', 12: 'On/Off 1', 13: 'On/Off 99',
  14: '3 Steps', 15: '4 Steps', 16: '5 Steps', 17: '6 Steps', 18: '7 Steps', 19: '8 Steps', 20: '9 Steps',
  21: '10 Steps', 22: '11 Steps', 23: '12 Steps', 24: '13 Steps', 25: '14 Steps', 26: '15 Steps', 27: '16 Steps',
  28: '25 Steps',
  29: 'Relative 1 (signed bit)', 30: 'Relative 2 (binary offset)', 31: 'Relative 3 (twos complement)',
  32: 'Relative 4 (signed bit 2)', 33: 'Flex', 34: 'Feedback Only',
}

// Device MIDI port (portOut / portIn), 0-indexed. Verified against hardware capture.
export const PORT: Record<number, string> = {
  0: 'Off', 1: 'USB1', 2: 'USB2', 3: 'TRS1', 4: 'TRS2', 5: 'TRS3', 6: 'TRS4',
}

export function labelOf(map: Record<number, string>, n: number): string {
  return map[n] ?? `raw ${n}`
}

/** Default output-slot shape per control type (from real projects). */
export interface SlotDefaults { msgType: number; ch: number; curveId: number }
export interface ControlDefaults { behavId: number; feedbId: number; feedbSlot: number; slot: SlotDefaults | null }

export const CONTROL_DEFAULTS: Record<string, ControlDefaults> = {
  rotary: { behavId: 1, feedbId: 0, feedbSlot: 1, slot: { msgType: 3, ch: 1, curveId: 0 } },
  fader: { behavId: 11, feedbId: 28, feedbSlot: 1, slot: { msgType: 3, ch: 1, curveId: 0 } },
  mute: { behavId: 4, feedbId: 28, feedbSlot: 1, slot: { msgType: 2, ch: 2, curveId: 9 } },
  rotbut: { behavId: 5, feedbId: 28, feedbSlot: 0, slot: null },
}

// ---- per-control-type valid option subsets -------------------------------------------------------
// Not every enum value is offered for every control type. These mirror Neuzeit's firmware valList_*
// arrays (rotary/fader = linear, rotbut/mute = binary, snp = snapshot). The full label maps above
// still name every value; these only gate which options a dropdown OFFERS. EnumField also always
// keeps a control's current value selectable, so existing/older data is never hidden.
const STEP_CURVES = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28] // 3..16 Steps, 25 Steps

export const MSG_TYPE_BY_KIND: Record<string, number[]> = {
  rotary: [3, 7, 12, 8, 5, 6],            // CC, CC14, CC14-LSB, NRPN, PB, AT
  fader: [3, 7, 12, 8, 5, 6],
  rotbut: [3, 7, 12, 8, 2, 5, 6],         // + Note On (buttons)
  mute: [3, 7, 12, 8, 2, 5, 6],
  snp: [2, 3, 7, 12, 8, 5, 6, 9, 10],     // + Program Change / Program+Bank
}
export const BEHAV_BY_KIND: Record<string, number[]> = {
  rotary: [0, 1, 2],
  rotbut: [3, 4, 5, 6, 7, 8, 9, 10],
  mute: [3, 4],
  fader: [11, 12],
  snp: [4],
}
export const CURVE_BY_KIND: Record<string, number[]> = {
  rotary: [0, 1, 2, 3, 4, 5, 6, 7, 8, 33, 9, 10, 11, 12, 13, ...STEP_CURVES, 29, 30, 31, 32, 34],
  fader: [0, 1, 2, 3, 4, 5, 6, 7, 8, 33, 9, 10, 11, 12, 13, ...STEP_CURVES, 34], // no relative modes
  rotbut: [9, 34],  // binary: On/Off-50 or Feedback-Only
  mute: [9, 34],
  snp: [9, 34],
}
// Rotaries get every line/dot/step + hue + MIDI style (all but Default=28); binary/fader controls
// get Default + the MIDI-driven styles only.
const FEEDB_BINARY = [28, 31, 32, 33, 34, 35, 36]
export const FEEDB_BY_KIND: Record<string, number[]> = {
  rotary: Object.keys(FEEDB).map(Number).filter((n) => n !== 28),
  rotbut: FEEDB_BINARY,
  mute: FEEDB_BINARY,
  fader: FEEDB_BINARY,
  snp: FEEDB_BINARY,
}

/** The option values shared by ALL the given control kinds (intersection). Returns null when the
 *  kinds have no common option (e.g. a rotary+fader behavior selection) — the caller then leaves the
 *  dropdown unrestricted rather than showing an empty list. */
export function allowedFor(byKind: Record<string, number[]>, kinds: string[]): number[] | null {
  const sets = kinds.map((k) => byKind[k]).filter(Boolean)
  if (!sets.length) return null
  const inter = sets.reduce((acc, s) => acc.filter((n) => s.includes(n)))
  return inter.length ? inter : null
}
