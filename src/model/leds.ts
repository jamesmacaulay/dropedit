// Pure logic for a rotary's LED ring: given its style (feedbId) and live value (0-1), the lit
// pattern across the ring's segments. The Drop's rotaries have a 13-LED ring; the style decides how
// the lit segments grow with the value (from the left, from the right, symmetrically from the
// centre, a single moving dot, …). Rendering (colour, geometry) lives in the UI; this is just the
// per-segment level so it can be unit-tested without a DOM.

export const LED_COUNT = 13

// "Hue Color" feedbId: the ring uses a Line-from-left lit pattern, but its COLOUR cycles with the
// value rather than being fixed (the colour is applied in the UI; see palette.hueCycleColor).
export const FEEDB_HUE = 30

// Per-segment brightness level.
export const OFF = 0    // dim (unlit)
export const LIT = 1    // bright (part of the lit bar)
export const HEAD = 2   // brightest — the segment(s) at the value position, like the hardware

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * Per-segment levels for a ring of `count` segments, index 0 = first (left/start) … count-1 = last
 * (right/end). `feedbId` is the control's LED-ring style (see FEEDB in enums.ts); `value` is the
 * control's live position in 0-1. Returns one of OFF/LIT/HEAD per segment — the HEAD segment(s) sit
 * at the value position (the moving extremes of the lit chain), which burn brightest.
 */
export function ledLevels(feedbId: number, value: number, count = LED_COUNT): number[] {
  const v = clamp01(value)
  const lv = new Array<number>(count).fill(OFF)
  const last = count - 1
  const at = (n: number) => Math.max(0, Math.min(last, n))
  const bar = (a: number, b: number) => { for (let i = a; i <= b; i++) lv[i] = LIT } // lit run
  const head = (i: number) => { lv[at(i)] = HEAD }                                    // value indicator

  // "N Steps" styles (feedbId 3..26 == 2 Steps .. 25 Steps): quantise the value, then fill from the
  // left up to the (quantised) value position like a coarse bar.
  if (feedbId >= 3 && feedbId <= 26) {
    const steps = feedbId - 1
    const level = Math.round(v * (steps - 1))      // 0..steps-1
    const h = Math.round((level / (steps - 1)) * last)
    bar(0, h); head(h)
    return lv
  }

  switch (feedbId) {
    case 0:        // Line from left
    case FEEDB_HUE: // Hue Color — same line-from-left lit pattern; the ring COLOUR cycles in the UI
    case 31:  // MIDI Level      ┐ MIDI-driven styles have no live value here, so we approximate
    case 32:  // MIDI Clip LED   ┘ them with the nearest static behaviour
    case 34: { // MIDI Col Line from left
      const h = Math.round(v * last) // value position; the bar fills from the left up to it
      bar(0, h); head(h)
      return lv
    }

    case 29:  // Line from right
    case 36: { // MIDI Col Line from right
      const h = last - Math.round(v * last) // value position measured from the right
      bar(h, last); head(h)
      return lv
    }

    case 1:   // Line from centre — symmetric: value 0 lights only the centre, then the bar grows
    case 35: { // MIDI Col Line from centre   both ways to the extremes, each end the value indicator
      const mid = Math.floor(count / 2)
      const reach = Math.round(v * mid)
      bar(mid - reach, mid + reach)
      head(mid - reach); head(mid + reach) // both moving ends (the same segment when reach = 0)
      return lv
    }

    case 2:   // Dot (single moving segment)
    case 33:  // MIDI Col Dot
      head(Math.round(v * last))
      return lv

    case 27:  // Blank — nothing lit
      return lv

    default: { // 28 Default + any unknown/future style: behave like Line from left
      const h = Math.round(v * last)
      bar(0, h); head(h)
      return lv
    }
  }
}

/**
 * Convenience boolean view of {@link ledLevels}: true where a segment is lit (LIT or HEAD).
 */
export function ledSegments(feedbId: number, value: number, count = LED_COUNT): boolean[] {
  return ledLevels(feedbId, value, count).map((l) => l > OFF)
}
