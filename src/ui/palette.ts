// The Drop's 12 control colours, in colId order 0-11 (per the device).
// Hexes are approximations chosen to be distinct and readable in the editor.
export const COLOR_NAMES = [
  'amber', 'gold', 'spring', 'turquoise', 'cyan', 'aqua',
  'violet', 'magenta', 'white', 'red', 'green', 'blue',
] as const

const HEX = [
  '#ff8a00', '#ffc400', '#00e676', '#1de9b6', '#00e5ff', '#00b0ff',
  '#7c4dff', '#ff2bd6', '#f5f5f5', '#ff3b30', '#2ecc40', '#2d6cff',
]

export const NUM_COLORS = COLOR_NAMES.length

export function colorFor(colId: number): string {
  const n = HEX.length
  return HEX[((colId % n) + n) % n]
}

export function colorName(colId: number): string {
  const n = COLOR_NAMES.length
  return COLOR_NAMES[((colId % n) + n) % n]
}
