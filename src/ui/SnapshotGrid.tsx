import { type ReactNode } from 'react'
import type { JsonDoc } from '../model/jsonDoc'
import { readControl } from '../model/dropProject'
import { setControlField } from '../model/edits'
import { colorFor, COLOR_NAMES } from './palette'
import { ValidatedInput, validateName } from './ValidatedInput'
import { selKey, modeOf, type SelectMode } from './Surface'

// Snapshot pads: 4 columns x 5 rows = 20 snapshots per bank. Snapshots are GLOBAL
// (not per-layer); their stored scene captures every layer. id = `<bank:2><col><row>`.
// `bankMode` flips the same 4x5 grid into a bank selector (banks 1-20).
const SNP_COLS = 4
const SNP_ROWS = 5 // 20 banks, shown in the same 4x5 grid in bank mode

export interface SnapshotGridProps {
  doc: JsonDoc
  bank: number
  bankMode: boolean
  selected: Set<string>
  onSelect: (keys: string[], mode: SelectMode) => void
  onPickBank: (bank: number) => void
  /** when set (save/load/edit mode), a pad click triggers this instead of selecting the pad */
  onPad?: (id: string) => void
  padHint?: 'save' | 'load' | 'edit' | null
  /** the snapshot currently being edited — highlighted distinctly from the selection */
  editing?: string | null
}

export function snapshotId(bank: number, col: number, row: number) {
  return `${String(bank).padStart(2, '0')}${col}${row}`
}

function bankHasSnapshots(doc: JsonDoc, bank: number): boolean {
  for (let c = 0; c < SNP_COLS; c++) for (let r = 0; r < SNP_ROWS; r++) {
    if (readControl(doc, 'snp', snapshotId(bank, c, r))) return true
  }
  return false
}

export function SnapshotGrid({ doc, bank, bankMode, selected, onSelect, onPickBank, onPad, padHint, editing }: SnapshotGridProps) {
  const rows: ReactNode[] = []
  for (let row = 0; row < SNP_ROWS; row++) {
    const pads: ReactNode[] = []
    for (let col = 0; col < SNP_COLS; col++) {
      if (bankMode) {
        const b = row * SNP_COLS + col
        pads.push(
          <button key={b} className={'pad bank' + (b === bank ? ' sel' : '') + (bankHasSnapshots(doc, b) ? ' filled' : '')}
            title={`Bank ${b + 1}`} onClick={() => onPickBank(b)}>{b + 1}</button>,
        )
      } else {
        const id = snapshotId(bank, col, row)
        const snp = readControl(doc, 'snp', id)
        const key = selKey('snp', id)
        // in edit mode only filled pads are pickable (you can't edit an empty snapshot)
        const armed = padHint === 'edit' ? !!snp : !!padHint
        pads.push(
          <button key={id} className={'pad' + (selected.has(key) ? ' sel' : '') + (editing === id ? ' editing' : '') + (snp ? '' : ' empty') + (armed ? ' armed' : '')}
            title={snp ? snp.name : `empty (${id})`} style={snp ? { background: colorFor(snp.colId) } : undefined}
            onClick={(e) => onPad ? onPad(id) : onSelect([key], modeOf(e))} />,
        )
      }
    }
    rows.push(<div key={row} className="snp-row">{pads}</div>)
  }
  return <div className="snp-grid">{rows}</div>
}

// Name + pad colour of the current snapshot, shown directly below the grid (editable any time a
// snapshot is the focus — a selected pad or the one being edited).
export function SnapshotMeta({ text, doc, id, onChange }: { text: string; doc: JsonDoc; id: string; onChange: (t: string, coalesce?: boolean) => void }) {
  const view = readControl(doc, 'snp', id)
  if (!view) return <p className="snp-meta-empty">Empty pad {id} — use <strong>Save</strong> to capture values here.</p>
  return (
    <div className="snp-meta">
      <label>Name<ValidatedInput value={view.name} allowEmpty validate={validateName('Name')} onCommit={(raw) => onChange(setControlField(text, 'snp', id, 'name', raw), true)} /></label>
      <label>Pad color
        <select value={String(view.colId)} onChange={(e) => onChange(setControlField(text, 'snp', id, 'colId', Number(e.target.value)))}>
          {COLOR_NAMES.map((nm, i) => <option key={i} value={i}>[{i}] {nm}</option>)}
        </select>
      </label>
    </div>
  )
}
