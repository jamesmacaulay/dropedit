// Range ("shift-click") selection over the control surface.
//
// The surface is a visual grid: columns 0-7, and vertical bands where rotary rows 0-3 each share
// their band with that rotary's push button (rotbut), then a mute band, then a fader band. We map
// every control to a (layer, col, vrow):
//   rotary/rotbut row r -> vrow r (0-3)   |   mute -> vrow 4   |   fader -> vrow 5
//
// A shift-click extends the selection by the UNION of the rectangles drawn between the clicked
// control(s) and EVERY currently-selected control on the same layer (no "anchor" cell). A box covers
// everything visually inside it (Option A): bands 0-3 take both the rotary and its push button, band
// 4 the mute, band 5 the fader — matching what the row/column labels already select.

import { type ControlType, parseControlId, snapshotPos, formatSnapshotId } from './controlId'

const VROW_MUTE = 4, VROW_FADER = 5

const splitKey = (k: string): { type: ControlType; id: string } => {
  const i = k.indexOf(':')
  return { type: k.slice(0, i) as ControlType, id: k.slice(i + 1) }
}
const makeKey = (type: ControlType, id: string) => `${type}:${id}`

interface GridPos { layer: number; col: number; vrow: number }

/** Visual-grid position of a control selection key, or null for snapshots / unparseable keys. */
function posOf(key: string): GridPos | null {
  const { type, id } = splitKey(key)
  if (type === 'snp') return null
  const p = parseControlId(type, id)
  const vrow = type === 'fader' ? VROW_FADER : type === 'mute' ? VROW_MUTE : (p.row ?? 0)
  return { layer: p.layer, col: p.col, vrow }
}

/** The control keys occupying one visual cell (Option A: all types present at that position). */
function keysAt(layer: number, col: number, vrow: number): string[] {
  if (vrow <= 3) return [makeKey('rotary', `${layer}${col}${vrow}`), makeKey('rotbut', `${layer}${col}${vrow}`)]
  if (vrow === VROW_MUTE) return [makeKey('mute', `${layer}${col}`)]
  return [makeKey('fader', `${layer}${col}`)]
}

/**
 * Union-of-boxes range select: add `targets` plus every control inside a box drawn from each target
 * to each already-selected control on the target's layer. Selections on other layers are preserved
 * but don't anchor the box. With nothing on the layer to anchor to, it just adds the targets.
 */
export function rangeSelect(selected: string[], targets: string[]): string[] {
  const result = new Set(selected)
  const ts = targets.map(posOf).filter((p): p is GridPos => p != null)
  if (!ts.length) { targets.forEach((t) => result.add(t)); return [...result] }
  const layer = ts[0].layer
  const anchors = selected.map(posOf).filter((p): p is GridPos => p != null && p.layer === layer)
  if (!anchors.length) { targets.forEach((t) => result.add(t)); return [...result] }
  for (const c of ts) {
    for (const a of anchors) {
      const c0 = Math.min(a.col, c.col), c1 = Math.max(a.col, c.col)
      const r0 = Math.min(a.vrow, c.vrow), r1 = Math.max(a.vrow, c.vrow)
      for (let col = c0; col <= c1; col++) {
        for (let vrow = r0; vrow <= r1; vrow++) {
          for (const k of keysAt(layer, col, vrow)) result.add(k)
        }
      }
    }
  }
  return [...result]
}

/**
 * Range selection within the snapshot grid (4x5 pads of the current bank) — mirrors rangeSelect: the
 * union of the rectangles drawn from the clicked pad(s) to every already-selected pad in the same bank.
 */
export function rangeSelectSnapshots(selected: string[], targets: string[]): string[] {
  const result = new Set(selected)
  const isSnp = (k: string) => k.startsWith('snp:')
  const posOf = (k: string) => { const id = k.slice(4); const p = snapshotPos(id); return { bank: id.slice(0, 2), col: p.col, row: p.row } }
  const ts = targets.filter(isSnp).map(posOf)
  if (!ts.length) { targets.forEach((t) => result.add(t)); return [...result] }
  const bank = ts[0].bank
  const anchors = selected.filter(isSnp).map(posOf).filter((p) => p.bank === bank)
  if (!anchors.length) { targets.forEach((t) => result.add(t)); return [...result] }
  for (const c of ts) {
    for (const a of anchors) {
      const c0 = Math.min(a.col, c.col), c1 = Math.max(a.col, c.col)
      const r0 = Math.min(a.row, c.row), r1 = Math.max(a.row, c.row)
      for (let col = c0; col <= c1; col++) {
        for (let row = r0; row <= r1; row++) result.add(makeKey('snp', formatSnapshotId(Number(bank), col, row)))
      }
    }
  }
  return [...result]
}
