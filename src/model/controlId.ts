// Control IDs in a Drop project encode physical position.
//   rotary / rotbut : 3 digits  "<layer><col><row>"   (layer 0-7, col 0-7, row 0-3)
//   fader  / mute    : 2 digits  "<layer><col>"
//   snp (snapshots)  : 4 digits  — separate grid; opaque in v1 (we only read the layer digit)
// The FIRST digit is always the layer, which makes "copy a layer" a digit rewrite.

export type ControlType = 'rotary' | 'rotbut' | 'fader' | 'mute' | 'snp'

export const CONTROL_TYPES: ControlType[] = ['rotary', 'rotbut', 'fader', 'mute', 'snp']
export const LAYERS = 8
export const COLS = 8
export const ROWS = 4

export interface ControlPos {
  type: ControlType
  layer: number
  col: number
  /** row 0-3 for rotary/rotbut; undefined for fader/mute */
  row?: number
}

const POSITIONAL = new Set<ControlType>(['rotary', 'rotbut', 'fader', 'mute'])

export function hasRow(type: ControlType): boolean {
  return type === 'rotary' || type === 'rotbut'
}

/** Layer index (0-based) encoded by an id's first digit, for any control type. */
export function layerOfId(id: string): number {
  return Number(id[0])
}

export function parseControlId(type: ControlType, id: string): ControlPos {
  const layer = Number(id[0])
  if (hasRow(type)) {
    return { type, layer, col: Number(id[1]), row: Number(id[2]) }
  }
  // fader / mute (2-digit). snp falls through with col from 2nd digit (best effort).
  return { type, layer, col: Number(id[1]) }
}

export function formatControlId(pos: ControlPos): string {
  if (hasRow(pos.type)) return `${pos.layer}${pos.col}${pos.row ?? 0}`
  return `${pos.layer}${pos.col}`
}

/** Rewrite the layer of an id (used by copy-layer). Works for every control type. */
export function withLayer(id: string, newLayer: number): string {
  return `${newLayer}${id.slice(1)}`
}

/** All control ids of a given type on a layer, in column-major then row order. */
export function controlIdsForLayer(type: ControlType, layer: number): string[] {
  if (type === 'snp') return [] // snapshots not enumerated in v1
  const out: string[] = []
  for (let col = 0; col < COLS; col++) {
    if (hasRow(type)) {
      for (let row = 0; row < ROWS; row++) out.push(`${layer}${col}${row}`)
    } else {
      out.push(`${layer}${col}`)
    }
  }
  return out
}

export function isPositional(type: ControlType): boolean {
  return POSITIONAL.has(type)
}

// ---- snapshots --------------------------------------------------------------
// snp id = "<bank:2><col><row>" on a 4-col x 5-row grid per bank (banks 0-19).
// Snapshots are a separate positional grid: the bank plays the role the layer plays
// for controls, and the (col,row) within it is the position preserved across banks.
export const SNP_COLS = 4
export const SNP_ROWS = 5

export function snapshotPos(id: string): { col: number; row: number } {
  return { col: Number(id[2]), row: Number(id[3]) }
}
export function formatSnapshotId(bank: number, col: number, row: number): string {
  return `${String(bank).padStart(2, '0')}${col}${row}`
}
/** Rewrite the bank of a snapshot id (used when switching banks keeps the selection). */
export function withBank(id: string, bank: number): string {
  return `${String(bank).padStart(2, '0')}${id.slice(2)}`
}
