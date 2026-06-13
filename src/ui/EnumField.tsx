import { useState } from 'react'
import { ValidatedInput, validateInt } from './ValidatedInput'

// A labelled dropdown for a Drop enum field (behavior / LED style / curve / port) that stays
// robust to firmware adding options we don't have labels for:
//   - pick a known option from the map, or
//   - pick "Custom…" to type an arbitrary raw value, and
//   - a stored value with no label auto-shows as Custom with its raw number editable.
export function EnumField({ label, value, multi, map, allow, onSet }: {
  label: string
  /** current numeric value, or undefined if unset */
  value: number | undefined
  /** true when a multi-selection holds differing values */
  multi?: boolean
  map: Record<number, string>
  /** restrict the offered options to these values; the current value stays selectable regardless.
   *  null/undefined = offer every entry in `map`. */
  allow?: number[] | null
  onSet: (v: number) => void
}) {
  const has = (c: number) => Object.prototype.hasOwnProperty.call(map, c)
  const known = value !== undefined && has(value)
  const [custom, setCustom] = useState(false)
  const showInput = !multi && (custom || (value !== undefined && !known))
  const selValue = multi || value === undefined ? '' : (known && !custom ? String(value) : '__custom__')
  const base = allow && allow.length ? allow.filter(has) : Object.keys(map).map(Number)
  // keep the current value offered even if it's outside the allowed subset (never hide real data)
  const opts = known && !base.includes(value as number) ? [...base, value as number] : base
  return (
    <label>{label}
      <select value={selValue} onChange={(e) => {
        const v = e.target.value
        if (v === '__custom__') setCustom(true)
        else if (v !== '') { setCustom(false); onSet(Number(v)) }
      }}>
        {(multi || value === undefined) && <option value="">{multi ? '[multiple]' : '—'}</option>}
        {opts.sort((a, b) => a - b).map((c) => (
          <option key={c} value={c}>[{c}] {map[c]}</option>
        ))}
        <option value="__custom__">Custom…</option>
      </select>
      {showInput && (
        <ValidatedInput inputMode="numeric" value={value === undefined ? '' : String(value)} placeholder={multi ? '[multiple]' : 'raw value'}
          autoFocus={custom} validate={validateInt(label)} onCommit={(raw) => onSet(Number(raw))} />
      )}
    </label>
  )
}
