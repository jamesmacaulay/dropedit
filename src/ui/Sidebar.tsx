import { useEffect, useRef, useState, type ReactNode } from 'react'
import { type JsonDoc, parseJson } from '../model/jsonDoc'
import {
  readControl, readStateValue, readDevices, readGroupMember, readSnapshotMember, readSnapshotValue, NUM_SEL_GROUPS,
  type ControlView, type SlotView, type DeviceView,
} from '../model/dropProject'
import type { ControlType } from '../model/controlId'
import type { PresetDevice } from '../model/presetDb'
import { paramLabel, deriveControlName, slotParamRow, makeCsvRef } from '../model/presetDb'
import {
  MSG_TYPE, BEHAV, FEEDB, CURVE,
  MSG_TYPE_BY_KIND, BEHAV_BY_KIND, FEEDB_BY_KIND, CURVE_BY_KIND, allowedFor,
  slotRange, storedToDisplay, displayToStored, FLEX_CURVE_ID, unpackXY, packXY,
  PROGRAM_TYPES, unpackBank, packBank,
} from '../model/enums'
import { EnumField } from './EnumField'
import { ValidatedInput, validateName, validateInt, validateNum } from './ValidatedInput'
import { COLOR_NAMES } from './palette'
import { MOD_KEY } from './platform'
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
    return <aside className="sidebar"><p className="hint">Click to select a control or snapshot. <strong>{MOD_KEY}-click</strong> adds or removes controls from the selection; <strong>Shift-click</strong> selects a range. Click a row/column label to grab a whole row or column.</p><p className="hint"><strong>{MOD_KEY}-C/X/V</strong> to copy/cut/paste controls and snapshots. <strong>{MOD_KEY}-Z</strong> to undo, <strong>{MOD_KEY}-Shift-Z</strong> to redo.</p><p className="hint">Adjust the values of rotaries and faders by dragging them up and down. Double-click rotary buttons and mute buttons to toggle them on and off.</p></aside>
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
// snapshot's own one-shot MIDI output slots; with controls selected it edits their stored values.
export function SnapshotEditPanel({ text, doc, editSnap, selection, deviceFor, onChange }: {
  text: string; doc: JsonDoc; editSnap: string | null; selection: string[]
  deviceFor: (target: number) => PresetDevice | null; onChange: (t: string, coalesce?: boolean) => void
}) {
  if (!editSnap) {
    return <aside className="sidebar"><h2>Edit snapshot</h2>
      <p className="hint">Click a filled snapshot pad to edit it. On the surface, green = stored in the snapshot, red = not.</p></aside>
  }
  const hasControls = selection.some((k) => !k.startsWith('snp:'))
  if (hasControls) return <SnapshotControlEditor text={text} doc={doc} snpId={editSnap} selection={selection} onChange={onChange} />
  const view = readControl(doc, 'snp', editSnap)
  return (
    <aside className="sidebar">
      <h2>{`Snapshot ${editSnap}`}</h2>
      <p className="hint">The snapshot’s own one-shot MIDI output slots — fired when it executes (e.g. a Program Change / Bank). Select controls on the surface to edit the values it stores instead.</p>
      <SlotList text={text} targets={[{ type: 'snp', id: editSnap, view }]} deviceFor={deviceFor} devices={readDevices(doc)} defaultColId={view?.colId ?? 0} onChange={onChange} />
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
          <label>Stored value (0–1)<ValidatedInput inputMode="decimal"
            value={valueShared === MULTI || valueShared === undefined ? '' : String(valueShared)}
            placeholder={valueShared === MULTI ? '[multiple]' : ''}
            validate={validateNum('Stored value', 0, 1)} onCommit={(raw) => onValue(Number(raw))} /></label>
        </>)}
    </aside>
  )
}

// the name we'd auto-generate from a control's preset param (the lowest in-use slot that resolves to
// a CSV param), or null if it has none — used by the "Generate" link to offer re-deriving the name.
function presetDerivedName(view: ControlView | undefined, deviceFor: (t: number) => PresetDevice | null): string | null {
  if (!view) return null
  const slots = view.slots.filter((s) => s.inUse === 1).sort((a, b) => Number(a.key) - Number(b.key))
  for (const s of slots) {
    const dev = deviceFor(s.target)
    const row = slotParamRow(dev, s.msgType, s.csvRef, s.msgNr)
    if (row != null) { const p = dev!.byRowIndex.get(row)!; return deriveControlName(p.section, p.name) }
  }
  return null
}

// ---------------- controls ----------------
function ControlEditor({ text, doc, deviceFor, selection, defaultColId, onChange, onSetActive }: SidebarProps) {
  const [tab, setTab] = useState<'config' | 'groups'>('config')
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
  // valid behavior / LED options depend on the selected control type(s)
  const ctrlKinds = [...new Set(active.map((t) => t.type as string))]

  const onName = (v: string) => onChange(single ? setControlField(text, single.type, single.id, 'name', v) : bulkSetControlField(text, fieldTargets, 'name', v), true)
  const onColor = (v: number) => onChange(bulkSetControlField(text, fieldTargets, 'colId', v))
  const onField = (f: string, v: number) => onChange(bulkSetControlField(text, fieldTargets, f, v), true)
  const onStateVal = (v: number) => { let t = text; for (const tg of targets) t = setStateValue(t, tg.type, tg.id, v, true); onChange(t, true) }

  // "Generate" link: selected controls whose preset param implies a name different from the current
  // one. Clicking re-derives the name for exactly those controls (then the link self-hides).
  const regen = targets.map((t) => ({ t, gen: presetDerivedName(t.view, deviceFor) }))
    .filter((x) => x.gen != null && x.gen !== x.t.view?.name)
  const onGenerate = () => { let tx = text; for (const { t, gen } of regen) tx = setControlField(tx, t.type, t.id, 'name', gen!); onChange(tx) }

  return (
    <aside className="sidebar">
      <h2>{single ? `${single.type} ${single.id}` : `${targets.length} controls`}</h2>
      <div className="tabs">
        <button className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}>Config</button>
        <button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}>Groups</button>
      </div>

      <div className="tab-body">
        {tab === 'config' && (
          <>
            <TriCheckbox label="Active" checked={allActive} indeterminate={someActive && !allActive} onToggle={() => onSetActive(fieldTargets, !allActive)} />
            {!someActive && <p className="hint">Inactive — turn Active on to configure it (it’ll remember prior settings this session).</p>}
            {someActive && (
              // Name spans the full width; then a [Value | Behavior] row and a [Color | LED style] row.
              <div className="field-grid">
                <label className="field-span">
                  <span className="field-head">Name{regen.length > 0 && <button type="button" className="linkbtn" onClick={onGenerate}>Generate</button>}</span>
                  <ValidatedInput value={name === MULTI ? '' : (name as string ?? '')} placeholder={name === MULTI ? '[multiple values]' : ''} allowEmpty validate={validateName('Name')} onCommit={(raw) => onName(raw)} />
                </label>
                <label>Value<ValidatedInput inputMode="decimal" value={stateVal === MULTI || stateVal === undefined ? '' : String(stateVal)} placeholder={stateVal === MULTI ? '[multiple]' : 'unset'} validate={validateNum('Value', 0, 1)} onCommit={(raw) => onStateVal(Number(raw))} /></label>
                <EnumField key={`behav-${selection.join('|')}`} label="Behavior" map={BEHAV} allow={allowedFor(BEHAV_BY_KIND, ctrlKinds)}
                  value={behavId === MULTI || behavId === undefined ? undefined : (behavId as number)} multi={behavId === MULTI}
                  onSet={(v) => onField('behavId', v)} />
                <label>Color
                  <select value={colId === MULTI || colId === undefined ? '' : String(colId)} onChange={(e) => e.target.value !== '' && onColor(Number(e.target.value))}>
                    {(colId === MULTI || colId === undefined) && <option value="">{colId === MULTI ? '[multiple]' : '— none —'}</option>}
                    {COLOR_NAMES.map((nm, i) => <option key={i} value={i}>[{i}] {nm}</option>)}
                  </select>
                </label>
                <EnumField key={`feedb-${selection.join('|')}`} label="LED style" map={FEEDB} allow={allowedFor(FEEDB_BY_KIND, ctrlKinds)}
                  value={feedbId === MULTI || feedbId === undefined ? undefined : (feedbId as number)} multi={feedbId === MULTI}
                  onSet={(v) => onField('feedbId', v)} />
              </div>
            )}
            <h3 className="section">Output slots</h3>
            <SlotList text={text} targets={targets} deviceFor={deviceFor} devices={devices} defaultColId={defaultColId} onChange={onChange} />
          </>
        )}

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
  // editing a slot's mapping *identity* by hand (target device / message type / number) means it's no
  // longer a CSV-preset assignment, so clear csvRef per the firmware docs ("leave this at 0 otherwise").
  // (Picking a parameter from the dropdown goes through setSlotParam, which sets csvRef itself.)
  const set = (f: keyof SlotView, v: number, coalesce = false) => {
    let t = text
    for (const e of entries) {
      t = setSlotField(t, e.type, e.id, e.slot.key, f as string, v)
      if (f === 'target' || f === 'msgType' || f === 'msgNr') t = setSlotField(t, e.type, e.id, e.slot.key, 'csvRef', 0)
    }
    onChange(t, coalesce)
  }
  const setParam = (rowIndex: number) => {
    const p = device?.byRowIndex.get(rowIndex); if (!p) return
    const derived = deriveControlName(p.section, p.name)
    const d = parseJson(text)
    let t = text
    for (const e of entries) {
      // refresh the control's name from the new param when it was auto-named and untouched: i.e. it's
      // blank, OR it still equals the name we'd derive from the slot's *current* param (so picking a
      // few params in a row keeps updating, but a name the user actually typed is left alone).
      const curName = (readControl(d, e.type, e.id)?.name ?? '').trim()
      const cur = e.slot.msgType === 3 ? device?.byRowIndex.get(e.slot.csvRef & 0xffff) : undefined
      const autoNamed = cur != null && cur.cc === e.slot.msgNr && curName === deriveControlName(cur.section, cur.name)
      t = setSlotParam(t, e.type, e.id, e.slot.key, p)
      if (curName === '' || autoNamed) t = setControlField(t, e.type, e.id, 'name', derived)
    }
    onChange(t)
  }

  // reflect the shared current param (csvRef low-16 = row, confirmed by cc)
  const paramOf = (s: SlotView) => slotParamRow(device, s.msgType, s.csvRef, s.msgNr)
  const paramShared = slots.every((s) => paramOf(s) === paramOf(slots[0])) ? paramOf(slots[0]) : null
  const msgType = sh('msgType')
  // valid message-type / curve options depend on the slot's control type(s)
  const slotKinds = [...new Set(entries.map((e) => e.type as string))]

  const num = (labelTxt: string, field: keyof SlotView, range?: { min: number; max: number }) => {
    const v = sh(field)
    return <label>{labelTxt}<ValidatedInput inputMode="numeric" value={v === MULTI ? '' : String(v)} placeholder={v === MULTI ? '[multiple]' : ''}
      validate={range ? validateInt(labelTxt, range.min, range.max) : validateInt(labelTxt)} onCommit={(raw) => set(field, Number(raw), true)} /></label>
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
  const curveId = sh('curveId')
  const isFlex = curveId === FLEX_CURVE_ID
  // Program Change / Program+Bank: the program # IS the value (maxOut, 0-127); Program+Bank also
  // packs its two bank values into msgNr as a float. So those types get a bespoke layout.
  const isProgram = msgType !== MULTI && PROGRAM_TYPES.has(msgType as number)
  const isProgBank = msgType === 10
  // The output value editor (range / Flex XY / program #) is laid out and scaled per the message
  // type AND curve; with those mixed across the selection it would be meaningless, so hide it.
  const valueUniform = msgType !== MULTI && curveId !== MULTI
  // Min/Max are stored as 14-bit; show them scaled to the message type's display range.
  const rangeNum = (labelTxt: string, field: 'minOut' | 'maxOut') => {
    const v = sh(field)
    const r = msgType === MULTI ? null : slotRange(msgType as number)
    const disp = v === MULTI ? '' : String(r ? storedToDisplay(v as number, msgType as number) : (v as number))
    return <label>{labelTxt}<ValidatedInput inputMode="numeric" value={disp} placeholder={v === MULTI ? '[multiple]' : ''}
      validate={validateInt(labelTxt, r?.min ?? 0, r?.max ?? 16383)}
      onCommit={(raw) => set(field, r ? displayToStored(Number(raw), msgType as number) : Number(raw), true)} /></label>
  }
  // Flex curve packs its two points into maxOut (XY1) / minOut (XY2) as (x<<7)|y, x,y in 0-127.
  const xyPoint = (labelTxt: string, field: 'minOut' | 'maxOut') => {
    const v = sh(field)
    const multi = v === MULTI
    const xy = multi ? { x: 0, y: 0 } : unpackXY(v as number)
    return <label>{labelTxt}
      <span className="xy-pair">
        <span className="xy-cell"><ValidatedInput inputMode="numeric" placeholder="x" value={multi ? '' : String(xy.x)} validate={validateInt('X', 0, 127)} onCommit={(raw) => set(field, packXY(Number(raw), xy.y), true)} /></span>
        <span className="xy-cell"><ValidatedInput inputMode="numeric" placeholder="y" value={multi ? '' : String(xy.y)} validate={validateInt('Y', 0, 127)} onCommit={(raw) => set(field, packXY(xy.x, Number(raw)), true)} /></span>
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
        <span className="xy-cell"><ValidatedInput inputMode="numeric" placeholder="MSB" value={multi ? '' : String(msb)} validate={validateInt('MSB', 0, 127)} onCommit={(raw) => set('msgNr', packBank(Number(raw), lsb), true)} /></span>
        <span className="xy-cell"><ValidatedInput inputMode="numeric" placeholder="LSB" value={multi ? '' : String(lsb)} validate={validateInt('LSB', 0, 127)} onCommit={(raw) => set('msgNr', packBank(msb, Number(raw)), true)} /></span>
      </span>
    </label>
  }

  // friendly param picker — fills msgType + CC + csvRef from the target device's CSV. csvRef is shown
  // read-only beneath it (it's fully derived from the picked param's CC + row): non-zero = the CSV
  // link is stored, 0 = none (the param above is then inferred from the CC).
  const csvRefVal = sh('csvRef')
  const csvRefText = csvRefVal === MULTI ? '[multiple]'
    : csvRefVal === 0 ? '0' : '0x' + (csvRefVal >>> 0).toString(16).toUpperCase().padStart(8, '0')
  const paramPicker = (
    <label>Parameter {device ? `(${device.device})` : '(no CSV)'}
      <select value={paramShared != null ? String(paramShared) : ''} disabled={!device} onChange={(e) => e.target.value !== '' && setParam(Number(e.target.value))}>
        <option value="">{slots.length > 1 && paramShared == null ? '[multiple values]' : '— pick a parameter —'}</option>
        {device && paramOptions(device)}
      </select>
    </label>
  )
  // the csvRef a slot *should* have given its detected preset param (or null if none is detected)
  const correctCsvRef = (e: { slot: SlotView }) => {
    const dev = deviceFor(e.slot.target)
    const row = slotParamRow(dev, e.slot.msgType, e.slot.csvRef, e.slot.msgNr)
    return row != null && dev ? makeCsvRef(row, dev.byRowIndex.get(row)?.cc ?? 0, e.slot.target) : null
  }
  // ↻ stamps csvRef from the detected preset (disabled when there's nothing to stamp / it'd be a no-op);
  // ✕ clears it to 0. Both write csvRef directly, so they skip the "clear on manual edit" rule in `set`.
  const canRefresh = entries.some((e) => { const c = correctCsvRef(e); return c != null && c !== (e.slot.csvRef >>> 0) })
  const canClear = entries.some((e) => e.slot.csvRef !== 0)
  const refreshCsvRef = () => { let t = text; for (const e of entries) { const c = correctCsvRef(e); if (c != null) t = setSlotField(t, e.type, e.id, e.slot.key, 'csvRef', c) } if (t !== text) onChange(t) }
  const clearCsvRef = () => { let t = text; for (const e of entries) if (e.slot.csvRef !== 0) t = setSlotField(t, e.type, e.id, e.slot.key, 'csvRef', 0); if (t !== text) onChange(t) }
  // read-only value, OUTSIDE the label (so clicking it doesn't open the dropdown; selectable to copy)
  const csvRefLine = device ? (
    <div className="slot-ref">
      csvRef <code>{csvRefText}</code>
      <button type="button" className="ref-btn" title="Set csvRef from the detected preset" disabled={!canRefresh} onClick={refreshCsvRef}>↻</button>
      <button type="button" className="ref-btn" title="Clear csvRef (set to 0)" disabled={!canClear} onClick={clearCsvRef}>✕</button>
    </div>
  ) : null

  return (
    <div className="slot-fields">
      {sel('Target device', 'target', devices.map((d) => <option key={d.index} value={d.index}>{d.index}: {d.name || '—'}</option>))}
      {num('Channel', 'ch', { min: 1, max: 16 })}
      <EnumField key={`type-${idKey}`} label="Message Type" map={MSG_TYPE} allow={allowedFor(MSG_TYPE_BY_KIND, slotKinds)}
        value={msgType === MULTI ? undefined : (msgType as number)} multi={msgType === MULTI}
        onSet={(v) => set('msgType', v)} />
      {paramPicker}
      {csvRefLine}
      {/* msgNr is the note/CC number for normal types; for program types it's hidden (Program+Bank's
          two bank values live there, edited via the Bank fields below). */}
      {!isProgram && num(msgType === 2 ? 'Note #' : msgType === MULTI ? 'CC / Note #' : 'CC / number', 'msgNr', { min: 0, max: 127 })}
      <EnumField key={`curve-${idKey}`} label="Curve" map={CURVE} allow={allowedFor(CURVE_BY_KIND, slotKinds)}
        value={curveId === MULTI ? undefined : (curveId as number)} multi={curveId === MULTI}
        onSet={(v) => set('curveId', v, true)} />
      {valueUniform
        ? (isProgram
          ? (<>{rangeNum('Program #', 'maxOut')}{isProgBank && bankFields()}</>)
          : isFlex
            ? (<>{xyPoint('XY 1 (x · y)', 'maxOut')}{xyPoint('XY 2 (x · y)', 'minOut')}</>)
            : (<>{rangeNum('Max out', 'maxOut')}{rangeNum('Min out', 'minOut')}</>))
        : <p className="meta">Output range hidden — the selected slots have different message types or curves (the value is scaled per type). Set a single Message Type and Curve to edit it.</p>}
    </div>
  )
}

function SelectionGroups({ text, doc, targets, onChange }: { text: string; doc: JsonDoc; targets: { type: ControlType; id: string }[]; onChange: (t: string, coalesce?: boolean) => void }) {
  const editable = targets.filter((t) => t.type !== 'snp')
  if (!editable.length) return null
  // per-group state across the selected controls: all = every control in the group, none = no control
  const per = Array.from({ length: NUM_SEL_GROUPS }, (_, g) => {
    const states = editable.map((t) => readGroupMember(doc, g, t.type, t.id))
    return { all: states.every(Boolean), none: states.every((s) => !s) }
  })
  // "All groups" master: checked = in every group, unchecked = in none, indeterminate otherwise
  const allGroups = per.every((p) => p.all)
  const noGroups = per.every((p) => p.none)
  const toggleAll = () => {
    const include = !allGroups
    let t = text
    for (let g = 0; g < NUM_SEL_GROUPS; g++) t = setGroupMember(t, g, editable, include)
    onChange(t)
  }
  return (
    <fieldset className="groups">
      <legend>Selection groups</legend>
      <div className="all-groups">
        <TriCheckbox label="All groups" checked={allGroups} indeterminate={!allGroups && !noGroups} onToggle={toggleAll} />
      </div>
      <div className="group-list">
        {per.map((p, g) => (
          <TriCheckbox key={g} label={`Group ${g + 1}`} checked={p.all} indeterminate={!p.all && !p.none}
            onToggle={() => onChange(setGroupMember(text, g, editable, !p.all))} />
        ))}
      </div>
    </fieldset>
  )
}

function TriCheckbox({ label, checked, indeterminate, onToggle }: { label: string; checked: boolean; indeterminate: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return <label className="chk"><input ref={ref} type="checkbox" checked={checked} onChange={onToggle} /> {label}</label>
}
