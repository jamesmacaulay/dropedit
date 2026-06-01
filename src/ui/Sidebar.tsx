import { useEffect, useRef, useState, type ReactNode } from 'react'
import { getPath, type JsonDoc } from '../model/jsonDoc'
import {
  readControl, readStateValue, readDevices, readGroupMember, NUM_SEL_GROUPS,
  type ControlView, type SlotView, type DeviceView,
} from '../model/dropProject'
import type { ControlType } from '../model/controlId'
import type { PresetDevice } from '../model/presetDb'
import { paramLabel } from '../model/presetDb'
import { MSG_TYPE, BEHAV, labelOf } from '../model/enums'
import { COLOR_NAMES } from './palette'
import {
  setControlField, setSlotField, bulkSetControlField, bulkSetSlotField, assignParam, setStateValue,
  addSlot, createControl, saveSnapshot, loadSnapshot, setSlotParam, setGroupMember,
} from '../model/edits'

export interface SidebarProps {
  text: string
  doc: JsonDoc
  deviceFor: (target: number) => PresetDevice | null
  selection: string[]
  defaultColId: number
  onChange: (newText: string) => void
  onSetActive: (targets: { type: ControlType; id: string }[], active: boolean) => void
}

interface Target { type: ControlType; id: string; view: ControlView | undefined }
function parseKey(k: string): { type: ControlType; id: string } {
  const i = k.indexOf(':'); return { type: k.slice(0, i) as ControlType, id: k.slice(i + 1) }
}
const MULTI = Symbol('multi')
function shared<T>(items: Target[], fn: (t: Target) => T): T | typeof MULTI | undefined {
  if (!items.length) return undefined
  const first = fn(items[0])
  return items.every((t) => fn(t) === first) ? first : MULTI
}

export function Sidebar(props: SidebarProps) {
  const { selection } = props
  if (selection.length === 0) {
    return <aside className="sidebar"><p className="hint">Select a control. Shift-click — or click a row/column label — to select several and edit them together.</p></aside>
  }
  if (selection.length === 1 && selection[0].startsWith('snp:')) {
    return <SnapshotEditor {...props} id={selection[0].slice(4)} />
  }
  return <ControlEditor {...props} />
}

function paramOptions(device: PresetDevice): ReactNode {
  const groups = new Map<string, PresetDevice['params']>()
  for (const p of device.params) { const g = groups.get(p.section) ?? []; g.push(p); groups.set(p.section, g) }
  return [...groups.entries()].map(([section, params]) => (
    <optgroup key={section} label={section}>
      {params.map((p) => <option key={p.rowIndex} value={p.rowIndex}>{paramLabel(p)}{p.cc != null ? ` (CC ${p.cc})` : ''}</option>)}
    </optgroup>
  ))
}

// ---------------- snapshot ----------------
function SnapshotEditor({ text, doc, id, defaultColId, onChange }: SidebarProps & { id: string }) {
  const view = readControl(doc, 'snp', id)
  const exists = !!view
  const hasData = !!getPath(doc.root, ['map', 'snp', id, 'data'])
  return (
    <aside className="sidebar">
      <h2>{`Snapshot ${id}`}</h2>
      {!exists && <p className="hint">Empty pad — “Save” captures the current control values into a new snapshot here.</p>}
      {exists && (
        <>
          <label>Name<input type="text" value={view!.name} onChange={(e) => onChange(setControlField(text, 'snp', id, 'name', e.target.value))} /></label>
          <label>Pad color
            <select value={String(view!.colId)} onChange={(e) => onChange(setControlField(text, 'snp', id, 'colId', Number(e.target.value)))}>
              {COLOR_NAMES.map((nm, i) => <option key={i} value={i}>{i} · {nm}</option>)}
            </select>
          </label>
        </>
      )}
      <div className="snp-actions">
        <button onClick={() => onChange(saveSnapshot(text, id, exists ? view!.colId : defaultColId))}>{exists ? 'Save (overwrite)' : 'Save (create)'}</button>
        <button disabled={!hasData} onClick={() => onChange(loadSnapshot(text, id))}>Load</button>
      </div>
      <p className="meta">Save = capture current values → this snapshot. Load = recall this snapshot → live state.</p>
    </aside>
  )
}

// ---------------- controls ----------------
function ControlEditor({ text, doc, deviceFor, selection, defaultColId, onChange, onSetActive }: SidebarProps) {
  const [tab, setTab] = useState<'general' | 'slots' | 'groups'>('general')
  const targets: Target[] = selection.map(parseKey).filter((t) => t.type !== 'snp')
    .map((t) => ({ type: t.type, id: t.id, view: readControl(doc, t.type, t.id) }))
  if (!targets.length) return <aside className="sidebar"><p className="hint">Nothing editable selected.</p></aside>
  const fieldTargets = targets.map((t) => ({ type: t.type, id: t.id }))
  const single = targets.length === 1 ? targets[0] : null
  const devices = readDevices(doc)

  const allActive = targets.every((t) => !!t.view)
  const someActive = targets.some((t) => !!t.view)
  const name = shared(targets, (t) => t.view?.name ?? '')
  const colId = shared(targets, (t) => t.view?.colId)
  const behavId = shared(targets, (t) => t.view?.behavId)
  const feedbId = shared(targets, (t) => t.view?.feedbId)
  const stateVal = shared(targets, (t) => readStateValue(doc, t.type, t.id))

  const onName = (v: string) => onChange(single ? setControlField(text, single.type, single.id, 'name', v) : bulkSetControlField(text, fieldTargets, 'name', v))
  const onColor = (v: number) => onChange(bulkSetControlField(text, fieldTargets, 'colId', v))
  const onField = (f: string, v: number) => onChange(bulkSetControlField(text, fieldTargets, f, v))
  const onStateVal = (v: number) => { let t = text; for (const tg of targets) t = setStateValue(t, tg.type, tg.id, v); onChange(t) }
  const numFld = (labelTxt: string, val: number | typeof MULTI | undefined, onSet: (v: number) => void) => (
    <label>{labelTxt}<input type="number" value={val === MULTI || val === undefined ? '' : (val as number)} placeholder={val === MULTI ? '[multiple]' : ''} onChange={(e) => e.target.value !== '' && onSet(Number(e.target.value))} /></label>
  )

  return (
    <aside className="sidebar">
      <h2>{single ? `${single.type} ${single.id}` : `${targets.length} controls`}</h2>
      <div className="tabs">
        <button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>General</button>
        <button className={tab === 'slots' ? 'active' : ''} onClick={() => setTab('slots')}>Output slots</button>
        <button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}>Groups</button>
      </div>

      <div className="tab-body">
        {tab === 'general' && (
          <>
            <TriCheckbox label="Active" checked={allActive} indeterminate={someActive && !allActive} onToggle={() => onSetActive(fieldTargets, !allActive)} />
            {!someActive && <p className="hint">Inactive — turn Active on to configure it (it’ll remember prior settings this session).</p>}
            {someActive && (
              <>
                <label>Name<input type="text" value={name === MULTI ? '' : (name as string ?? '')} placeholder={name === MULTI ? '[multiple values]' : ''} onChange={(e) => onName(e.target.value)} /></label>
                <label>Color
                  <select value={colId === MULTI || colId === undefined ? '' : String(colId)} onChange={(e) => e.target.value !== '' && onColor(Number(e.target.value))}>
                    {(colId === MULTI || colId === undefined) && <option value="">{colId === MULTI ? '[multiple]' : '— none —'}</option>}
                    {COLOR_NAMES.map((nm, i) => <option key={i} value={i}>{i} · {nm}</option>)}
                  </select>
                </label>
                {numFld('Behavior (behavId)', behavId, (v) => onField('behavId', v))}
                {behavId !== MULTI && behavId !== undefined && <p className="meta">{labelOf(BEHAV, behavId as number)}</p>}
                {numFld('LED style (feedbId)', feedbId, (v) => onField('feedbId', v))}
                <label>Current value (state)<input type="number" step={0.001} value={stateVal === MULTI || stateVal === undefined ? '' : (stateVal as number)} placeholder={stateVal === MULTI ? '[multiple]' : 'unset'} onChange={(e) => e.target.value !== '' && onStateVal(Number(e.target.value))} /></label>
              </>
            )}
          </>
        )}

        {tab === 'slots' && <SlotList text={text} targets={targets} deviceFor={deviceFor} devices={devices} defaultColId={defaultColId} onChange={onChange} />}

        {tab === 'groups' && <SelectionGroups text={text} doc={doc} targets={fieldTargets} onChange={onChange} />}
      </div>
    </aside>
  )
}

interface SlotEntry { type: ControlType; id: string; mapped: boolean; slot: SlotView | undefined }

function SlotList({ text, targets, deviceFor, devices, defaultColId, onChange }: { text: string; targets: Target[]; deviceFor: (t: number) => PresetDevice | null; devices: DeviceView[]; defaultColId: number; onChange: (t: string) => void }) {
  const count = 8 // a Drop control has up to 8 output slots; show them all
  const rows: ReactNode[] = []
  for (let i = 0; i < count; i++) {
    const entries: SlotEntry[] = targets.map((t) => ({ type: t.type, id: t.id, mapped: !!t.view, slot: t.view?.slots.find((s) => Number(s.key) === i) }))
    const inUse = entries.map((e) => !!e.slot && e.slot.inUse === 1)
    const allInUse = inUse.every(Boolean)
    const noneInUse = inUse.every((s) => !s)
    const someInUse = !noneInUse
    const toggle = () => {
      const enable = !allInUse
      let t = text
      for (const e of entries) {
        if (enable) {
          if (!e.mapped) t = createControl(t, e.type, e.id, { name: '', colId: defaultColId })
          t = addSlot(t, e.type, e.id, String(i)) // no-op if the slot already exists
          t = setSlotField(t, e.type, e.id, String(i), 'inUse', 1)
        } else if (e.slot) {
          t = setSlotField(t, e.type, e.id, String(i), 'inUse', 0)
        }
      }
      onChange(t)
    }
    // edit the controls that actually have this slot in use (a subset, when mixed)
    const liveEntries = entries.filter((e) => e.slot && e.slot.inUse === 1) as { type: ControlType; id: string; slot: SlotView }[]
    rows.push(
      <fieldset key={i} className={'slot' + (someInUse ? '' : ' off')}>
        <legend>
          <TriCheckbox checked={allInUse} indeterminate={!allInUse && someInUse} onToggle={toggle} label={`Output slot ${i}`} />
          {!allInUse && someInUse && <span className="meta">{`editing ${liveEntries.length}/${entries.length}`}</span>}
        </legend>
        {someInUse && <SlotFields text={text} entries={liveEntries} deviceFor={deviceFor} devices={devices} onChange={onChange} />}
      </fieldset>,
    )
  }
  return <>{rows}</>
}

function SlotFields({ text, entries, deviceFor, devices, onChange }: { text: string; entries: { type: ControlType; id: string; slot: SlotView }[]; deviceFor: (t: number) => PresetDevice | null; devices: DeviceView[]; onChange: (t: string) => void }) {
  const slots = entries.map((e) => e.slot)
  // params come from the slot's TARGET device's CSV (uses the first selected slot's target)
  const device = deviceFor(slots[0].target)
  const sh = <K extends keyof SlotView>(k: K): SlotView[K] | typeof MULTI => {
    const f = slots[0][k]; return slots.every((s) => s[k] === f) ? f : MULTI
  }
  const set = (f: keyof SlotView, v: number) => { let t = text; for (const e of entries) t = setSlotField(t, e.type, e.id, e.slot.key, f as string, v); onChange(t) }
  const setParam = (rowIndex: number) => { const p = device?.byRowIndex.get(rowIndex); if (!p) return; let t = text; for (const e of entries) t = setSlotParam(t, e.type, e.id, e.slot.key, p); onChange(t) }

  // reflect the shared current param (csvRef low-16 = row, confirmed by cc)
  const paramOf = (s: SlotView) => { const ri = s.csvRef & 0xffff; const cur = device?.byRowIndex.get(ri); return device && cur && s.msgType === 3 && cur.cc === s.msgNr ? ri : null }
  const paramShared = slots.every((s) => paramOf(s) === paramOf(slots[0])) ? paramOf(slots[0]) : null
  const msgType = sh('msgType')

  const num = (labelTxt: string, field: keyof SlotView, extra: Record<string, number> = {}) => {
    const v = sh(field)
    return <label>{labelTxt}<input type="number" {...extra} value={v === MULTI ? '' : (v as number)} placeholder={v === MULTI ? '[multiple]' : ''} onChange={(e) => e.target.value !== '' && set(field, Number(e.target.value))} /></label>
  }
  const sel = (labelTxt: string, field: keyof SlotView, options: ReactNode) => {
    const v = sh(field)
    return <label>{labelTxt}
      <select value={v === MULTI ? '' : String(v)} onChange={(e) => e.target.value !== '' && set(field, Number(e.target.value))}>
        {v === MULTI && <option value="">[multiple]</option>}
        {options}
      </select>
    </label>
  }

  return (
    <div className="slot-fields">
      <label>Parameter {device ? `(${device.device})` : '(no CSV)'}
        <select value={paramShared != null ? String(paramShared) : ''} disabled={!device} onChange={(e) => e.target.value !== '' && setParam(Number(e.target.value))}>
          <option value="">{slots.length > 1 && paramShared == null ? '[multiple values]' : '— pick a parameter —'}</option>
          {device && paramOptions(device)}
        </select>
      </label>
      {sel('Target device', 'target', devices.map((d) => <option key={d.index} value={d.index}>{d.index}: {d.name || '—'}</option>))}
      {sel('Type', 'msgType', Object.entries(MSG_TYPE).map(([n, l]) => <option key={n} value={n}>{l}</option>))}
      {num(msgType === 2 ? 'Note #' : msgType === MULTI ? 'CC / Note #' : 'CC / number', 'msgNr', { min: 0, max: 127 })}
      {num('Channel', 'ch', { min: 1, max: 16 })}
      {num('Min out', 'minOut')}
      {num('Max out', 'maxOut')}
      {num('Curve', 'curveId')}
      {num('csvRef', 'csvRef')}
    </div>
  )
}

function SelectionGroups({ text, doc, targets, onChange }: { text: string; doc: JsonDoc; targets: { type: ControlType; id: string }[]; onChange: (t: string) => void }) {
  const editable = targets.filter((t) => t.type !== 'snp')
  if (!editable.length) return null
  return (
    <fieldset className="groups">
      <legend>Selection groups</legend>
      <div className="group-list">
        {Array.from({ length: NUM_SEL_GROUPS }, (_, g) => {
          const states = editable.map((t) => readGroupMember(doc, g, t.type, t.id))
          const all = states.every(Boolean)
          const none = states.every((s) => !s)
          return <TriCheckbox key={g} label={`Group ${g + 1}`} checked={all} indeterminate={!all && !none}
            onToggle={() => onChange(setGroupMember(text, g, editable, !all))} />
        })}
      </div>
    </fieldset>
  )
}

function TriCheckbox({ label, checked, indeterminate, onToggle }: { label: string; checked: boolean; indeterminate: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return <label className="chk"><input ref={ref} type="checkbox" checked={checked} onChange={onToggle} /> {label}</label>
}
