import { useState, type ReactNode } from 'react'
import type { JsonDoc } from '../model/jsonDoc'
import { readControl } from '../model/dropProject'
import { colorFor } from './palette'
import { selKey } from './Surface'

// Snapshot pads: 4 columns x 5 rows = 20 snapshots per bank. Snapshots are GLOBAL
// (not per-layer); their stored scene captures every layer. id = `<bank:2><col><row>`.
// The "Bank" button flips the same 4x5 grid into a bank selector (banks 1-20).
const SNP_COLS = 4
const SNP_ROWS = 5
const NUM_BANKS = SNP_COLS * SNP_ROWS // 20, shown in the same 4x5 grid

export interface SnapshotGridProps {
  doc: JsonDoc
  bank: number
  selected: Set<string>
  onSelect: (keys: string[], additive: boolean) => void
  onPickBank: (bank: number) => void
  /** when set (save/load mode), a pad click triggers this instead of selecting the pad */
  onPad?: (id: string) => void
  padHint?: 'save' | 'load' | null
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

export function SnapshotGrid({ doc, bank, selected, onSelect, onPickBank, onPad, padHint }: SnapshotGridProps) {
  const [bankMode, setBankMode] = useState(false)

  const rows: ReactNode[] = []
  for (let row = 0; row < SNP_ROWS; row++) {
    const pads: ReactNode[] = []
    for (let col = 0; col < SNP_COLS; col++) {
      if (bankMode) {
        const b = row * SNP_COLS + col
        pads.push(
          <button key={b} className={'pad bank' + (b === bank ? ' sel' : '') + (bankHasSnapshots(doc, b) ? ' filled' : '')}
            title={`Bank ${b + 1}`} onClick={() => { onPickBank(b); setBankMode(false) }}>{b + 1}</button>,
        )
      } else {
        const id = snapshotId(bank, col, row)
        const snp = readControl(doc, 'snp', id)
        const key = selKey('snp', id)
        pads.push(
          <button key={id} className={'pad' + (selected.has(key) ? ' sel' : '') + (snp ? '' : ' empty') + (padHint ? ' armed' : '')}
            title={snp ? snp.name : `empty (${id})`} style={snp ? { background: colorFor(snp.colId) } : undefined}
            onClick={(e) => onPad ? onPad(id) : onSelect([key], e.shiftKey)} />,
        )
      }
    }
    rows.push(<div key={row} className="snp-row">{pads}</div>)
  }

  return (
    <div className="snapshots">
      <div className="snp-head">
        <h3>{bankMode ? 'Select bank' : 'Snapshots'}</h3>
        <button className="bankbtn" onClick={() => setBankMode((m) => !m)}>{bankMode ? 'Cancel' : 'Banks'}</button>
      </div>
      <div className="snp-grid">{rows}</div>
    </div>
  )
}
