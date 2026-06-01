// Human labels for Drop enum fields. Observed values + a raw fallback for the rest.
// (Not exhaustive — the Drop has more behaviors/curves; UI shows "raw N" when unknown.)

export const MSG_TYPE: Record<number, string> = {
  0: 'Note off', 2: 'Note', 3: 'CC', 4: 'CC 14-bit', 6: 'NRPN',
  7: 'Pitch bend', 8: 'Aftertouch', 9: 'Program change', 10: 'Program+Bank',
}

export const BEHAV: Record<number, string> = {
  1: 'Absolute (rotary)',
  4: 'Mute / toggle',
  5: 'Push function',
  11: 'Fader',
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
