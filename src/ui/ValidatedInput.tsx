import { createContext, useContext, useEffect, useRef, useState } from 'react'

// A text input that owns a local *draft* and only writes valid content back to the model.
//
// Pattern (used for every editable field, including numeric ones):
//   - every keystroke runs `validate`
//   - invalid  -> the input goes red, and (while focused) an error message shows in the footer bar;
//                 the model is NOT updated
//   - valid    -> the model IS updated (via onCommit); empty is "neutral" unless allowEmpty
//   - on blur  -> the draft resets to the model's value and the footer message clears
//
// This keeps the model as the single source of truth while letting the user type freely — e.g.
// you can clear a number field to retype it (a plain controlled `<input type=number>` snaps back
// and won't let you delete the first digit). Loaded-but-invalid data is shown (red border) and
// left untouched, since we never commit unless the content validates — which preserves byte-exact
// round-tripping of values this editor didn't change.
//
// The error *message* lives in one shared spot (the footer, via FieldErrorContext) and only while
// the field is focused, so no per-field space is reserved and nothing reflows.

/** App provides a setter; the focused ValidatedInput pushes its message here (null = clear). */
export const FieldErrorContext = createContext<(msg: string | null) => void>(() => {})

export interface ValidatedInputProps {
  /** the committed model value, formatted for display ('' when empty or mixed across a multi-select) */
  value: string
  /** called with a valid draft (or '' when allowEmpty); the caller parses + applies it */
  onCommit: (raw: string) => void
  /** validate a non-empty draft: return an error message to reject it, or null to accept + commit */
  validate?: (raw: string) => string | null
  /** treat an empty field as a value to commit (e.g. a clearable name). default: empty = neutral (no commit) */
  allowEmpty?: boolean
  placeholder?: string
  inputMode?: 'numeric' | 'decimal' | 'text'
  ariaLabel?: string
  autoFocus?: boolean
}

export function ValidatedInput({ value, onCommit, validate, allowEmpty = false, placeholder, inputMode, ariaLabel, autoFocus }: ValidatedInputProps) {
  const report = useContext(FieldErrorContext)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null) // drives the red border (focused or not)
  const focused = useRef(false)

  const errFor = (raw: string): string | null => (raw === '' || !validate ? null : validate(raw))

  // re-sync from the model when it changes externally (undo, selection switch, a sibling edit
  // re-parsing the doc) — but never clobber what the user is actively typing.
  useEffect(() => {
    if (!focused.current) { setDraft(value); setError(errFor(value)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // if this field unmounts while focused (e.g. the selection changes), clear its footer message
  useEffect(() => () => { if (focused.current) report(null) }, [report])

  const onInput = (raw: string) => {
    setDraft(raw)
    if (raw === '') { setError(null); report(null); if (allowEmpty) onCommit(''); return }
    const err = validate ? validate(raw) : null
    setError(err)
    report(err) // we're focused while typing
    if (err === null) onCommit(raw)
  }

  return (
    <input type="text" inputMode={inputMode} value={draft} placeholder={placeholder} aria-label={ariaLabel} autoFocus={autoFocus}
      aria-invalid={error ? true : undefined} className={error ? 'invalid' : undefined}
      onFocus={() => { focused.current = true; report(error) }}
      onChange={(e) => onInput(e.target.value)}
      onBlur={() => { focused.current = false; report(null); setDraft(value); setError(errFor(value)) }} />
  )
}

// ---- validators: each takes the field's display name, returns a full message or null when valid. ----
//      Called only for non-empty input (empty is handled by the component).

// Drop names: up to 16 chars from a fixed set; empty is allowed (a control can be unnamed).
const NAME_CHARS = /^[A-Za-z0-9()&!.+\- ]*$/
export function validateName(label: string) {
  return (raw: string): string | null => {
    if (raw.length > 16) return `${label} must be 16 characters or fewer`
    if (!NAME_CHARS.test(raw)) return `${label} can only use letters, numbers, spaces and ( ) & ! . + -`
    return null
  }
}

function rangeMsg(label: string, min: number | undefined, max: number | undefined): string {
  if (min != null && max != null) return `${label} must be between ${min} and ${max}`
  if (min != null) return `${label} must be at least ${min}`
  return `${label} must be at most ${max}`
}

export function validateInt(label: string, min?: number, max?: number) {
  return (raw: string): string | null => {
    if (!/^-?\d+$/.test(raw.trim())) return `${label} must be a whole number`
    const n = Number(raw)
    if ((min != null && n < min) || (max != null && n > max)) return rangeMsg(label, min, max)
    return null
  }
}

export function validateNum(label: string, min?: number, max?: number) {
  const fmt = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x))
  return (raw: string): string | null => {
    const n = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(n)) return `${label} must be a number`
    if ((min != null && n < min) || (max != null && n > max)) {
      if (min != null && max != null) return `${label} must be between ${fmt(min)} and ${fmt(max)}`
      if (min != null) return `${label} must be at least ${fmt(min)}`
      return `${label} must be at most ${fmt(max!)}`
    }
    return null
  }
}
