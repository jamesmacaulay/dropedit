import type { ReactNode } from 'react'
import type { JsonDoc } from '../model/jsonDoc'
import { readControl, readGroupMember, readSnapshotMember } from '../model/dropProject'
import { COLS, ROWS, type ControlType } from '../model/controlId'
import { colorFor } from './palette'

export const selKey = (type: string, id: string) => `${type}:${id}`

// how a click changes the selection: replace it, toggle the clicked items, or range-extend (shift).
export type SelectMode = 'replace' | 'toggle' | 'range'
// cmd (mac) / ctrl (win-linux) = toggle; shift = range. On mac a ctrl-click is a context-menu, so
// mac users use cmd — metaKey covers that; we never need to special-case it here.
export const modeOf = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): SelectMode =>
  e.shiftKey ? 'range' : (e.metaKey || e.ctrlKey) ? 'toggle' : 'replace'

// snapshot save / edit modes: controls tint green (included) / red (not)
const SAVE_GREEN = '#22c55e', SAVE_RED = '#ef4444'

export interface SurfaceProps {
  doc: JsonDoc
  layer: number
  selected: Set<string>
  onSelect: (keys: string[], mode: SelectMode) => void
  /** save mode: tint each control green (in this selection group) / red (not) */
  saveGroup?: number | null
  /** snapshot edit mode: tint each control green (stored in this snapshot) / red (not) */
  editSnap?: string | null
  /** keyboard hint (e.g. "⌘A") shown on the "All" label button */
  selectAllHint?: string
}

const PAD = 16, LEFT = 46, COLW = 104, ROT_R = 19, ROT_GAP = 56, TOP = 48, MUTE_H = 24, FADER_H = 120
const LBL_H = 22

function trunc(s: string): string {
  return s.length > 12 ? s.slice(0, 11) + '…' : s
}

export function Surface({ doc, layer, selected, onSelect, saveGroup, editSnap, selectAllHint }: SurfaceProps) {
  // membership tint: in save mode by selection group, in snapshot edit mode by stored scene; null = off
  const memberOf = (type: ControlType, id: string): boolean | null => {
    if (saveGroup != null) return readGroupMember(doc, saveGroup, type, id)
    if (editSnap != null) return readSnapshotMember(doc, editSnap, type, id)
    return null
  }
  // when tinting, a control's fill shows membership (green/red); else its colour or empty grey
  const fillFor = (type: ControlType, id: string, view: { colId: number } | undefined, empty: string) => {
    const m = memberOf(type, id)
    if (m != null) return m ? SAVE_GREEN : SAVE_RED
    return view ? colorFor(view.colId) : empty
  }
  const tinting = saveGroup != null || editSnap != null
  const colX = (col: number) => PAD + LEFT + col * COLW + COLW / 2
  const rotCY = (row: number) => TOP + row * ROT_GAP + ROT_R
  const muteY = TOP + ROWS * ROT_GAP + 12
  const faderY = muteY + MUTE_H + 22
  const width = PAD * 2 + LEFT + COLS * COLW
  const height = faderY + FADER_H + 24 + PAD

  const colKeys = (col: number) => [
    ...Array.from({ length: ROWS }, (_, r) => selKey('rotary', `${layer}${col}${r}`)),
    ...Array.from({ length: ROWS }, (_, r) => selKey('rotbut', `${layer}${col}${r}`)),
    selKey('fader', `${layer}${col}`), selKey('mute', `${layer}${col}`),
  ]
  const rotRowKeys = (row: number) => [
    ...Array.from({ length: COLS }, (_, c) => selKey('rotary', `${layer}${c}${row}`)),
    ...Array.from({ length: COLS }, (_, c) => selKey('rotbut', `${layer}${c}${row}`)),
  ]
  const faderRowKeys = () => Array.from({ length: COLS }, (_, c) => selKey('fader', `${layer}${c}`))
  const muteRowKeys = () => Array.from({ length: COLS }, (_, c) => selKey('mute', `${layer}${c}`))
  const allKeys = () => Array.from({ length: COLS }, (_, c) => colKeys(c)).flat()
  const full = (keys: string[]) => keys.length > 0 && keys.every((k) => selected.has(k))

  const cells: ReactNode[] = []

  // a rounded-rect label "button" that selects a group of controls (with an optional shortcut hint)
  const labelBtn = (key: string, x: number, y: number, w: number, text: string, keys: () => string[], hint?: string) => {
    const on = full(keys())
    return (
      <g key={key} style={{ cursor: 'pointer' }} onClick={(e) => onSelect(keys(), modeOf(e))}>
        <rect x={x} y={y} width={w} height={LBL_H} rx={6} fill={on ? '#2f3340' : '#23232a'} stroke={on ? '#fff' : '#454552'} strokeWidth={on ? 2 : 1} />
        <text x={x + w / 2} y={y + LBL_H / 2 + 3.5} textAnchor="middle" fontSize={10} fill={on ? '#fff' : '#9aa0ad'}>
          {text}{hint && <tspan dx={3} fontSize={8} fillOpacity={0.55}>{hint}</tspan>}
        </text>
      </g>
    )
  }

  // top-left corner: "All" selects every control on this layer (also Cmd/Ctrl+A)
  const headerY = 8
  cells.push(labelBtn('all', PAD, headerY, LEFT - 8, 'All', allKeys, selectAllHint))

  // column header buttons
  for (let col = 0; col < COLS; col++) {
    const cx = colX(col)
    cells.push(labelBtn(`h${col}`, cx - 34, headerY, 68, `Col ${col + 1}`, () => colKeys(col)))
  }
  // row label buttons (left gutter)
  for (let r = 0; r < ROWS; r++) cells.push(labelBtn(`lr${r}`, PAD, rotCY(r) - LBL_H / 2, LEFT - 8, `R${r + 1}`, () => rotRowKeys(r)))
  cells.push(labelBtn('lmute', PAD, muteY + MUTE_H / 2 - LBL_H / 2, LEFT - 8, 'Mut', muteRowKeys))
  cells.push(labelBtn('lfader', PAD, faderY + FADER_H / 2 - LBL_H / 2, LEFT - 8, 'Fdr', faderRowKeys))

  // controls
  for (let col = 0; col < COLS; col++) {
    const cx = colX(col)
    for (let row = 0; row < ROWS; row++) {
      const id = `${layer}${col}${row}`
      const cy = rotCY(row)
      const rot = readControl(doc, 'rotary', id)
      const rb = readControl(doc, 'rotbut', id)
      const rsel = selected.has(selKey('rotary', id))
      const bsel = selected.has(selKey('rotbut', id))
      cells.push(
        <g key={`r${id}`}>
          <circle cx={cx} cy={cy} r={ROT_R} fill={fillFor('rotary', id, rot, '#26262c')}
            stroke={rsel ? '#fff' : '#54545e'} strokeWidth={rsel ? 3 : 1} style={{ cursor: 'pointer' }}
            onClick={(e) => onSelect([selKey('rotary', id)], modeOf(e))} />
          <circle cx={cx} cy={cy} r={5} fill={tinting ? (rb ? fillFor('rotbut', id, rb, '#141418') : '#141418') : (rb ? colorFor(rb.colId) : '#141418')}
            stroke={bsel ? '#fff' : '#3a3a42'} strokeWidth={bsel ? 2 : 1} style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onSelect([selKey('rotbut', id)], modeOf(e)) }} />
          <text x={cx} y={cy + ROT_R + 11} textAnchor="middle" fontSize={8} fill="#c4c8d0">{rot ? trunc(rot.name) : ''}</text>
        </g>,
      )
    }
    const lc = `${layer}${col}`
    const mv = readControl(doc, 'mute', lc)
    const msel = selected.has(selKey('mute', lc))
    cells.push(
      <g key={`m${lc}`}>
        <rect x={cx - 17} y={muteY} width={34} height={MUTE_H} rx={6} fill={fillFor('mute', lc, mv, '#26262c')}
          stroke={msel ? '#fff' : '#54545e'} strokeWidth={msel ? 3 : 1} style={{ cursor: 'pointer' }}
          onClick={(e) => onSelect([selKey('mute', lc)], modeOf(e))} />
        <text x={cx} y={muteY + MUTE_H + 11} textAnchor="middle" fontSize={8} fill="#c4c8d0">{mv ? trunc(mv.name) : ''}</text>
      </g>,
    )
    const fv = readControl(doc, 'fader', lc)
    const fsel = selected.has(selKey('fader', lc))
    cells.push(
      <g key={`f${lc}`}>
        <rect x={cx - 13} y={faderY} width={26} height={FADER_H} rx={5} fill={fillFor('fader', lc, fv, '#26262c')}
          stroke={fsel ? '#fff' : '#54545e'} strokeWidth={fsel ? 3 : 1} style={{ cursor: 'pointer' }}
          onClick={(e) => onSelect([selKey('fader', lc)], modeOf(e))} />
        <text x={cx} y={faderY + FADER_H + 12} textAnchor="middle" fontSize={8} fill="#c4c8d0">{fv ? trunc(fv.name) : ''}</text>
      </g>,
    )
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Drop layer ${layer + 1}`} className="surface"
      style={{ background: '#1b1b1f', borderRadius: 10, maxWidth: '100%' }}
      onClick={(e) => { if (e.target === e.currentTarget) onSelect([], 'replace') }}>
      {cells}
    </svg>
  )
}
