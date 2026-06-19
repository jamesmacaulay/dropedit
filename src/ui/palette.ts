// The Drop's 12 control colours, in colId order 0-11 (per the device).
// Hexes are approximations chosen to be distinct and readable in the editor.
export const COLOR_NAMES = [
  'amber', 'gold', 'spring', 'turquoise', 'cyan', 'aqua',
  'violet', 'magenta', 'white', 'red', 'green', 'blue',
] as const

// Hue order taken from a photo of Drop hardware (one colId per rotary), then regularised: the three
// primaries and three secondaries are snapped pure — red 0°, gold/yellow 60°, green 120°, cyan 180°,
// blue 240°, magenta 300° — white is pure #ffffff, and the five remaining colours are spaced through
// the arcs between (amber 30°, spring 140°, turquoise 160°, aqua 210°, violet 270°). All at S=0.9, V=1.
const HEX = [
  '#ff8c19', '#ffff19', '#19ff66', '#19ffb2', '#19ffff', '#198cff',
  '#8c19ff', '#ff19ff', '#ffffff', '#ff1919', '#19ff19', '#1919ff',
]

export const NUM_COLORS = COLOR_NAMES.length

export function colorFor(colId: number): string {
  const n = HEX.length
  return HEX[((colId % n) + n) % n]
}

// "Hue Color" LED style: as a rotary's value moves 0→1 it steps through 10 evenly-spaced phases,
// cycling red → amber → gold → spring → turquoise → cyan → aqua → violet → magenta → back to red.
const HUE_CYCLE = [9, 0, 1, 2, 3, 4, 5, 6, 7, 9] // colIds (red, then amber…magenta, then red again)
export function hueCycleColor(value: number): string {
  const v = value < 0 ? 0 : value > 1 ? 1 : value
  return colorFor(HUE_CYCLE[Math.min(HUE_CYCLE.length - 1, Math.floor(v * HUE_CYCLE.length))])
}

export function colorName(colId: number): string {
  const n = COLOR_NAMES.length
  return COLOR_NAMES[((colId % n) + n) % n]
}
