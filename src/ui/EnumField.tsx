import { useState } from 'react'

// A labelled dropdown for a Drop enum field (behavior / LED style / curve / port) that stays
// robust to firmware adding options we don't have labels for:
//   - pick a known option from the map, or
//   - pick "Custom…" to type an arbitrary raw value, and
//   - a stored value with no label auto-shows as Custom with its raw number editable.
export function EnumField({ label, value, multi, map, onSet }: {
  label: string
  /** current numeric value, or undefined if unset */
  value: number | undefined
  /** true when a multi-selection holds differing values */
  multi?: boolean
  map: Record<number, string>
  onSet: (v: number) => void
}) {
  const known = value !== undefined && Object.prototype.hasOwnProperty.call(map, value)
  const [custom, setCustom] = useState(false)
  const showInput = !multi && (custom || (value !== undefined && !known))
  const selValue = multi || value === undefined ? '' : (known && !custom ? String(value) : '__custom__')
  return (
    <label>{label}
      <select value={selValue} onChange={(e) => {
        const v = e.target.value
        if (v === '__custom__') setCustom(true)
        else if (v !== '') { setCustom(false); onSet(Number(v)) }
      }}>
        {(multi || value === undefined) && <option value="">{multi ? '[multiple]' : '—'}</option>}
        {Object.keys(map).map(Number).sort((a, b) => a - b).map((c) => (
          <option key={c} value={c}>{c} · {map[c]}</option>
        ))}
        <option value="__custom__">Custom…</option>
      </select>
      {showInput && (
        <input type="number" value={value ?? ''} placeholder={multi ? '[multiple]' : 'raw value'} autoFocus={custom}
          onChange={(e) => e.target.value !== '' && onSet(Number(e.target.value))} />
      )}
    </label>
  )
}
