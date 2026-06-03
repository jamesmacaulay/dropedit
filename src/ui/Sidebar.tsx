import { useEffect, useRef, useState, type ReactNode } from 'react'
import { type JsonDoc } from '../model/jsonDoc'
import {
  readControl, readStateValue, readDevices, readGroupMember, readSnapshotMember, readSnapshotValue, NUM_SEL_GROUPS,
  type ControlView, type SlotView, type DeviceView,
} from '../model/dropProject'
import type { ControlType } from '../model/controlId'
import type { PresetDevice } from '../model/presetDb'
import { paramLabel } from '../model/presetDb'
import {
  MSG_TYPE, BEHAV, FEEDB, CURVE,
  slotRange, storedToDisplay, displayToStored, FLEX_CURVE_ID, unpackXY, packXY,
  PROGRAM_TYPES, unpackBank, packBank,
} from '../model/enums'
import { EnumField } from './EnumField'
import { COLOR_NAMES } from './palette'
import {
  setControlField, setSlotField, bulkSetControlField, bulkSetSlotField, assignParam, setStateValue,
  addSlot, createControl, setSlotParam, setGroupMember, setSnapshotValue, setSnapshotMembers,
} from '../model/edits'

export interface SidebarProps {
  text: string
  doc: JsonDoc
  deviceFor: (target: number) => PresetDevice | null
  selection: string[]
  defaultColId: number
  // coalesce=true marks a rapid text/number-input edit: the view updates now, but the history
  // entry + localStorage write are debounced so a typing burst collapses to one undo step.
  onChange: (newText: string, coalesce?: boolean) => void
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

// ---------------- snapshot (read-only context; name/colour live below the grid) ----------------
function SnapshotEditor({ doc, id }: SidebarProps & { id: string }) {
  const view = readControl(doc, 'snp', id)
  return (
    <aside className="sidebar">
      <h2>{`Snapshot ${id}`}</h2>
      {!view
        ? <p className="hint">Empty pad — <strong>Save</strong> captures the current control values into a new snapshot here.</p>
        : <p className="hint">Edit its name &amp; colour below the grid. Use <strong>Edit</strong> to change the values it stores, or <strong>Jump/Load</strong> to recall it.</p>}
    </aside>
  )
}

// ---------------- snapshot edit mode ----------------
// Sidebar while editing snapshot `editSnap`. Auto-adapts: with no control selected it shows the
// snapshot (its slots — coming in a follow-up); with controls selected it edits their stored values.
export function SnapshotEditPanel({ text, doc, editSnap, selection, onChange }: {
  text: string; doc: JsonDoc; editSnap: string | null; selection: string[]; onChange: (t: string, coalesce?: boolean) => void
}) {
  if (!editSnap) {
    return <aside className="sidebar"><h2>Edit snapshot</h2>
      <p className="hint">Click a filled snapshot pad to edit it. On the surface, green = stored in the snapshot, red = not.</p></aside>
  }
  const hasControls = selection.some((k) => !k.startsWith('snp:'))
  if (hasControls) return <SnapshotControlEditor text={text} doc={doc} snpId={editSnap} selection={selection} onChange={onChange} />
  return (
    <aside className="sidebar">
      <h2>{`Snapshot ${editSnap}`}</h2>
      <p className="hint">Select controls on the surface to edit the values this snapshot stores. Use <strong>Select/Deselect/Toggle</strong> (S/D/T) below the faders to change which controls it stores.</p>
      <p className="meta">Its one-shot MIDI output slots will be editable here in an upcoming update.</p>
    </aside>
  )
}

// Edit the stored value (and membership) of the selected control(s) within one snapshot.
function SnapshotControlEditor({ text, doc, snpId, selection, onChange }: {
  text: string; doc: JsonDoc; snpId: string; selection: string[]; onChange: (t: string, coalesce?: boolean) => void
}) {
  const targets = selection.map(parseKey).filter((t) => t.type !== 'snp')
    .map((t) => ({ type: t.type, id: t.id, member: readSnapshotMember(doc, snpId, t.type, t.id), value: readSnapshotValue(doc, snpId, t.type, t.id) }))
  if (!targets.length) return <aside className="sidebar"><p className="hint">Nothing editable selected.</p></aside>
  const single = targets.length === 1 ? targets[0] : null
  const fieldTargets = targets.map((t) => ({ type: t.type, id: t.id }))
  const members = targets.filter((t) => t.member)
  const allMember = targets.every((t) => t.member)
  const someMember = members.length > 0
  const vals = members.map((m) => m.value)
  const valueShared = !vals.length ? undefined : vals.every((v) => v === vals[0]) ? vals[0] : MULTI

  const toggleMembership = () => onChange(setSnapshotMembers(text, snpId, fieldTargets, !allMember))
  const onValue = (v: number) => { let t = text; for (const m of members) t = setSnapshotValue(t, snpId, m.type, m.id, v); onChange(t, true) }

  return (
    <aside className="sidebar">
      <h2>{single ? `${single.type} ${single.id}` : `${targets.length} controls`}</h2>
      <p className="meta">Editing what snapshot {snpId} stores.</p>
      <TriCheckbox label="Stored in this snapshot" checked={allMember} indeterminate={someMember && !allMember} onToggle={toggleMembership} />
      {!someMember
        ? <p className="hint">Not stored. Check the box (or press <strong>S</strong>) to add — it captures the control’s current live value.</p>
        : (<>
            {!allMember && <p className="meta">Editing the {members.length} stored of {targets.length} selected.</p>}
            <label>Stored value (0–1)<input type="number" step={0.001} min={0} max={1}
              value={valueShared === MULTI || valueShared === undefined ? '' : (valueShared as number)}
              placeholder={valueShared === MULTI ? '[multiple]' : ''}
              onChange={(e) => e.target.value !== '' && onValue(Number(e.target.value))} /></label>
          </>)}
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
  // config values reflect the ACTIVE controls only — inactive ones have no config, so they must
  // not drag a uniform value into "[multiple values]" when the selection is mixed.
  const active = targets.filter((t) => t.view)
  const name = shared(active, (t) => t.view!.name)
  const colId = shared(active, (t) => t.view!.colId)
  const behavId = shared(active, (t) => t.view!.behavId)
  const feedbId = shared(active, (t) => t.view!.feedbId)
  const stateVal = shared(active, (t) => readStateValue(doc, t.type, t.id))

  const onName = (v: string) => onChange(single ? setControlField(text, single.type, single.id, 'name', v) : bulkSetControlField(text, fieldTargets, 'name', v), true)
  const onColor = (v: number) => onChange(bulkSetControlField(text, fieldTargets, 'colId', v))
  const onField = (f: string, v: number) => onChange(bulkSetControlField(text, fieldTargets, f, v), true)
  const onStateVal = (v: number) => { let t = text; for (const tg of targets) t = setStateValue(t, tg.type, tg.id, v); onChange(t, true) }

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
                <EnumField key={`behav-${selection.join('|')}`} label="Behavior" map={BEHAV}
                  value={behavId === MULTI || behavId === undefined ? undefined : (behavId as number)} multi={behavId === MULTI}
                  onSet={(v) => onField('behavId', v)} />
                <EnumField key={`feedb-${selection.join('|')}`} label="LED style" map={FEEDB}
                  value={feedbId === MULTI || feedbId === undefined ? undefined : (feedbId as number)} multi={feedbId === MULTI}
                  onSet={(v) => onField('feedbId', v)} />
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

function SlotList({ text, targets, deviceFor, devices, defaultColId, onChange }: { text: string; targets: Target[]; deviceFor: (t: number) => PresetDevice | null; devices: DeviceView[]; defaultColId: number; onChange: (t: string, coalesce?: boolean) => void }) {
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

function SlotFields({ text, entries, deviceFor, devices, onChange }: { text: string; entries: { type: ControlType; id: string; slot: SlotView }[]; deviceFor: (t: number) => PresetDevice | null; devices: DeviceView[]; onChange: (t: string, coalesce?: boolean) => void }) {
  const slots = entries.map((e) => e.slot)
  // params come from the slot's TARGET device's CSV (uses the first selected slot's target)
  const device = deviceFor(slots[0].target)
  const sh = <K extends keyof SlotView>(k: K): SlotView[K] | typeof MULTI => {
    const f = slots[0][k]; return slots.every((s) => s[k] === f) ? f : MULTI
  }
  const set = (f: keyof SlotView, v: number, coalesce = false) => { let t = text; for (const e of entries) t = setSlotField(t, e.type, e.id, e.slot.key, f as string, v); onChange(t, coalesce) }
  const setParam = (rowIndex: number) => { const p = device?.byRowIndex.get(rowIndex); if (!p) return; let t = text; for (const e of entries) t = setSlotParam(t, e.type, e.id, e.slot.key, p); onChange(t) }

  // reflect the shared current param (csvRef low-16 = row, confirmed by cc)
  const paramOf = (s: SlotView) => { const ri = s.csvRef & 0xffff; const cur = device?.byRowIndex.get(ri); return device && cur && s.msgType === 3 && cur.cc === s.msgNr ? ri : null }
  const paramShared = slots.every((s) => paramOf(s) === paramOf(slots[0])) ? paramOf(slots[0]) : null
  const msgType = sh('msgType')

  const num = (labelTxt: string, field: keyof SlotView, extra: Record<string, number> = {}) => {
    const v = sh(field)
    return <label>{labelTxt}<input type="number" {...extra} value={v === MULTI ? '' : (v as number)} placeholder={v === MULTI ? '[multiple]' : ''} onChange={(e) => e.target.value !== '' && set(field, Number(e.target.value), true)} /></label>
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
  const idKey = entries.map((e) => e.id + ':' + e.slot.key).join(',')
  const isFlex = sh('curveId') === FLEX_CURVE_ID
  // Program Change / Program+Bank: the program # IS the value (maxOut, 0-127); Program+Bank also
  // packs its two bank values into msgNr as a float. So those types get a bespoke layout.
  const isProgram = msgType !== MULTI && PROGRAM_TYPES.has(msgType as number)
  const isProgBank = msgType === 10
  // Min/Max are stored as 14-bit; show them scaled to the message type's display range.
  const rangeNum = (labelTxt: string, field: 'minOut' | 'maxOut') => {
    const v = sh(field)
    const r = msgType === MULTI ? null : slotRange(msgType as number)
    const disp = v === MULTI ? '' : (r ? storedToDisplay(v as number, msgType as number) : (v as number))
    return <label>{labelTxt}<input type="number" min={r?.min} max={r?.max} value={v === MULTI ? '' : disp} placeholder={v === MULTI ? '[multiple]' : ''}
      onChange={(e) => e.target.value !== '' && set(field, r ? displayToStored(Number(e.target.value), msgType as number) : Number(e.target.value), true)} /></label>
  }
  // Flex curve packs its two points into maxOut (XY1) / minOut (XY2) as (x<<7)|y, x,y in 0-127.
  const xyPoint = (labelTxt: string, field: 'minOut' | 'maxOut') => {
    const v = sh(field)
    const multi = v === MULTI
    const xy = multi ? { x: 0, y: 0 } : unpackXY(v as number)
    return <label>{labelTxt}
      <span className="xy-pair">
        <input type="number" min={0} max={127} placeholder="x" value={multi ? '' : xy.x} onChange={(e) => e.target.value !== '' && set(field, packXY(Number(e.target.value), xy.y), true)} />
        <input type="number" min={0} max={127} placeholder="y" value={multi ? '' : xy.y} onChange={(e) => e.target.value !== '' && set(field, packXY(xy.x, Number(e.target.value)), true)} />
      </span>
    </label>
  }
  // Program+Bank stores its two bank values packed into msgNr as MSB.LSB float.
  const bankFields = () => {
    const v = sh('msgNr')
    const multi = v === MULTI
    const { msb, lsb } = multi ? { msb: 0, lsb: 0 } : unpackBank(v as number)
    return <label>Bank (MSB · LSB)
      <span className="xy-pair">
        <input type="number" min={0} max={127} placeholder="MSB" value={multi ? '' : msb} onChange={(e) => e.target.value !== '' && set('msgNr', packBank(Number(e.target.value), lsb), true)} />
        <input type="number" min={0} max={127} placeholder="LSB" value={multi ? '' : lsb} onChange={(e) => e.target.value !== '' && set('msgNr', packBank(msb, Number(e.target.value)), true)} />
      </span>
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
      <EnumField key={`type-${idKey}`} label="Type" map={MSG_TYPE}
        value={msgType === MULTI ? undefined : (msgType as number)} multi={msgType === MULTI}
        onSet={(v) => set('msgType', v)} />
      {/* msgNr is the note/CC number for normal types; for program types it's hidden (Program+Bank's
          two bank values live there, edited via the Bank fields below). */}
      {!isProgram && num(msgType === 2 ? 'Note #' : msgType === MULTI ? 'CC / Note #' : 'CC / number', 'msgNr', { min: 0, max: 127 })}
      {num('Channel', 'ch', { min: 1, max: 16 })}
      {isProgram
        ? (<>{rangeNum('Program #', 'maxOut')}{isProgBank && bankFields()}</>)
        : isFlex
          ? (<>{xyPoint('XY 1 (x · y)', 'maxOut')}{xyPoint('XY 2 (x · y)', 'minOut')}</>)
          : (<>{rangeNum('Max out', 'maxOut')}{rangeNum('Min out', 'minOut')}</>)}
      <EnumField key={`curve-${idKey}`} label="Curve" map={CURVE}
        value={sh('curveId') === MULTI ? undefined : (sh('curveId') as number)} multi={sh('curveId') === MULTI}
        onSet={(v) => set('curveId', v, true)} />
      {num('csvRef', 'csvRef')}
    </div>
  )
}

function SelectionGroups({ text, doc, targets, onChange }: { text: string; doc: JsonDoc; targets: { type: ControlType; id: string }[]; onChange: (t: string, coalesce?: boolean) => void }) {
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
