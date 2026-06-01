import type { ReactNode } from 'react'
import type { JsonDoc } from '../model/jsonDoc'
import { readControl } from '../model/dropProject'
import { COLS, ROWS } from '../model/controlId'
import { colorFor } from './palette'

export const selKey = (type: string, id: string) => `${type}:${id}`

export interface SurfaceProps {
  doc: JsonDoc
  layer: number
  selected: Set<string>
  onSelect: (keys: string[], additive: boolean) => void
}

const PAD = 16, LEFT = 46, COLW = 104, ROT_R = 19, ROT_GAP = 56, TOP = 48, MUTE_H = 24, FADER_H = 120
const LBL_H = 22

function trunc(s: string): string {
  return s.length > 12 ? s.slice(0, 11) + '…' : s
}

export function Surface({ doc, layer, selected, onSelect }: SurfaceProps) {
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

  // a rounded-rect label "button" that selects a group of controls
  const labelBtn = (key: string, x: number, y: number, w: number, text: string, keys: () => string[]) => {
    const on = full(keys())
    return (
      <g key={key} style={{ cursor: 'pointer' }} onClick={(e) => onSelect(keys(), e.shiftKey)}>
        <rect x={x} y={y} width={w} height={LBL_H} rx={6} fill={on ? '#2f3340' : '#23232a'} stroke={on ? '#fff' : '#454552'} strokeWidth={on ? 2 : 1} />
        <text x={x + w / 2} y={y + LBL_H / 2 + 3.5} textAnchor="middle" fontSize={10} fill={on ? '#fff' : '#9aa0ad'}>{text}</text>
      </g>
    )
  }

  // top-left corner: "All" selects every control on this layer
  const headerY = 8
  cells.push(labelBtn('all', PAD, headerY, LEFT - 8, 'All', allKeys))

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
          <circle cx={cx} cy={cy} r={ROT_R} fill={rot ? colorFor(rot.colId) : '#26262c'}
            stroke={rsel ? '#fff' : '#54545e'} strokeWidth={rsel ? 3 : 1} style={{ cursor: 'pointer' }}
            onClick={(e) => onSelect([selKey('rotary', id)], e.shiftKey)} />
          <circle cx={cx} cy={cy} r={5} fill={rb ? colorFor(rb.colId) : '#141418'}
            stroke={bsel ? '#fff' : '#3a3a42'} strokeWidth={bsel ? 2 : 1} style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onSelect([selKey('rotbut', id)], e.shiftKey) }} />
          <text x={cx} y={cy + ROT_R + 11} textAnchor="middle" fontSize={8} fill="#c4c8d0">{rot ? trunc(rot.name) : ''}</text>
        </g>,
      )
    }
    const lc = `${layer}${col}`
    const mv = readControl(doc, 'mute', lc)
    const msel = selected.has(selKey('mute', lc))
    cells.push(
      <g key={`m${lc}`}>
        <rect x={cx - 17} y={muteY} width={34} height={MUTE_H} rx={6} fill={mv ? colorFor(mv.colId) : '#26262c'}
          stroke={msel ? '#fff' : '#54545e'} strokeWidth={msel ? 3 : 1} style={{ cursor: 'pointer' }}
          onClick={(e) => onSelect([selKey('mute', lc)], e.shiftKey)} />
        <text x={cx} y={muteY + 15} textAnchor="middle" fontSize={8} fill="#c4c8d0">{mv ? trunc(mv.name) : ''}</text>
      </g>,
    )
    const fv = readControl(doc, 'fader', lc)
    const fsel = selected.has(selKey('fader', lc))
    cells.push(
      <g key={`f${lc}`}>
        <rect x={cx - 13} y={faderY} width={26} height={FADER_H} rx={5} fill={fv ? colorFor(fv.colId) : '#26262c'}
          stroke={fsel ? '#fff' : '#54545e'} strokeWidth={fsel ? 3 : 1} style={{ cursor: 'pointer' }}
          onClick={(e) => onSelect([selKey('fader', lc)], e.shiftKey)} />
        <text x={cx} y={faderY + FADER_H + 12} textAnchor="middle" fontSize={8} fill="#c4c8d0">{fv ? trunc(fv.name) : ''}</text>
      </g>,
    )
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Drop layer ${layer + 1}`} className="surface"
      style={{ background: '#1b1b1f', borderRadius: 10, maxWidth: '100%' }}
      onClick={(e) => { if (e.target === e.currentTarget) onSelect([], false) }}>
      {cells}
    </svg>
  )
}
