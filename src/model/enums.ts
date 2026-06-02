// Human labels for Drop enum fields. Observed values + a raw fallback for the rest.
// (Not exhaustive — the Drop has more behaviors/curves; UI shows "raw N" when unknown.)

export const MSG_TYPE: Record<number, string> = {
  0: 'Note off', 2: 'Note', 3: 'CC', 4: 'CC 14-bit', 6: 'NRPN',
  7: 'Pitch bend', 8: 'Aftertouch', 9: 'Program change', 10: 'Program+Bank',
}

// Behavior — a single global enum across control types (decoded from a hardware capture).
export const BEHAV: Record<number, string> = {
  0: 'Precision', 1: 'Dynamic Pot', 2: 'Dynamic Fast',
  3: 'Toggle', 4: 'Temporary', 5: 'Quick Turn',
  6: 'Reset Left', 7: 'Reset Mid', 8: 'Reset Right', 9: 'Reset L/R', 10: 'Reset R/L',
  11: 'One per Layer', 12: 'Layer A only',
}

// LED ring style (feedbId), rotary-knob turn. Codes are firmware-assigned, not menu order
// (e.g. "Line from right" = 29). 28 is unused here — it's the feedback id non-rotary elements use.
export const FEEDB: Record<number, string> = {
  0: 'Line from left', 1: 'Line from center', 2: 'Dot',
  3: '2 Steps', 4: '3 Steps', 5: '4 Steps', 6: '5 Steps', 7: '6 Steps', 8: '7 Steps', 9: '8 Steps',
  10: '9 Steps', 11: '10 Steps', 12: '11 Steps', 13: '12 Steps', 14: '13 Steps', 15: '14 Steps',
  16: '15 Steps', 17: '16 Steps', 18: '17 Steps', 19: '18 Steps', 20: '19 Steps', 21: '20 Steps',
  22: '21 Steps', 23: '22 Steps', 24: '23 Steps', 25: '24 Steps', 26: '25 Steps',
  27: 'Blank', 29: 'Line from right', 30: 'Hue Color',
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
