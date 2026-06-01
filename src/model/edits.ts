// Pure edit operations. Each takes the current project text and returns new text,
// expressed as splices on the original via jsonDoc (untouched bytes preserved).
// The UI re-parses the returned text for its live view.
import {
  parseJson, getObject, getMember, getPath, applyEdits,
  editSetScalar, editInsertMember, editRemoveMember,
  type JsonDoc, type ScalarNode, type ObjectNode, type Edit,
} from './jsonDoc'
import {
  layerOfId, withLayer, parseControlId, formatControlId, hasRow, isPositional, COLS, ROWS,
  type ControlType, type ControlPos,
} from './controlId'
import { makeCsvRef, type PresetParam } from './presetDb'
import { selGroupLocation } from './dropProject'
import { CONTROL_DEFAULTS } from './enums'

const SECTION_TYPES: ControlType[] = ['rotary', 'rotbut', 'fader', 'mute']

/** Format a value as a JSON token, matching the original token's decimal style if numeric. */
export function formatValue(value: string | number | boolean, originalRaw?: string): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (originalRaw && originalRaw.includes('.')) return value.toFixed(originalRaw.split('.')[1].length)
    return String(value)
  }
  return String(value)
}

function scalarAt(doc: JsonDoc, path: (string | number)[]): ScalarNode | undefined {
  const n = getPath(doc.root, path)
  return n && n.kind === 'scalar' ? n : undefined
}

function tabsOfLineAt(text: string, pos: number): number {
  const nl = text.lastIndexOf('\n', pos - 1)
  let n = 0, i = nl + 1
  while (text[i] === '\t') { n++; i++ }
  return n
}

/** Indentation (in tabs) that a new member's KEY should sit at inside an object. */
function memberKeyTabs(text: string, obj: ObjectNode): number {
  if (obj.members.length) return tabsOfLineAt(text, obj.members[0].span.start)
  return tabsOfLineAt(text, obj.close) + 1
}

// ---- scalar field edits --------------------------------------------------
export function setControlField(text: string, type: ControlType, id: string, field: string, value: string | number): string {
  const doc = parseJson(text)
  const s = scalarAt(doc, ['map', type, id, field])
  if (!s) return text
  return applyEdits(text, [editSetScalar(s, formatValue(value, s.raw))])
}

export function setSlotField(text: string, type: ControlType, id: string, slot: string, field: string, value: string | number): string {
  const doc = parseJson(text)
  const s = scalarAt(doc, ['map', type, id, slot, field])
  if (!s) return text
  return applyEdits(text, [editSetScalar(s, formatValue(value, s.raw))])
}

export interface FieldTarget { type: ControlType; id: string }

/** Set the same control-level field across many controls in one batch (multi-select edit). */
export function bulkSetControlField(text: string, targets: FieldTarget[], field: string, value: string | number): string {
  const doc = parseJson(text)
  const edits: Edit[] = []
  for (const t of targets) {
    const s = scalarAt(doc, ['map', t.type, t.id, field])
    if (s) edits.push(editSetScalar(s, formatValue(value, s.raw)))
  }
  return applyEdits(text, edits)
}

/** Set the same slot field (e.g. ch) across many controls' slot 0 in one batch. */
export function bulkSetSlotField(text: string, targets: FieldTarget[], slot: string, field: string, value: string | number): string {
  const doc = parseJson(text)
  const edits: Edit[] = []
  for (const t of targets) {
    const s = scalarAt(doc, ['map', t.type, t.id, slot, field])
    if (s) edits.push(editSetScalar(s, formatValue(value, s.raw)))
  }
  return applyEdits(text, edits)
}

// ---- create / remove controls -------------------------------------------
export interface CreateInit {
  name: string; colId: number; ch?: number; msgNr?: number; csvRef?: number; msgType?: number
}

function buildControlValue(type: ControlType, init: CreateInit, memberTabs: number, withSlot: boolean): string {
  const d = CONTROL_DEFAULTS[type] ?? CONTROL_DEFAULTS.rotary
  const t = '\t'.repeat(memberTabs)
  const t2 = '\t'.repeat(memberTabs + 1)
  const tc = '\t'.repeat(memberTabs - 1)
  const lines: string[] = ['{']
  lines.push(`${t}"name": ${JSON.stringify(init.name)},`)
  lines.push(`${t}"colId": ${init.colId},`)
  lines.push(`${t}"dropOrder": 0,`)
  lines.push(`${t}"behavId": ${d.behavId},`)
  lines.push(`${t}"feedbSlotVis": 1,`)
  lines.push(`${t}"feedbId": ${d.feedbId},`)
  const hasSlot = withSlot && d.slot != null
  lines.push(`${t}"feedbSlot": ${d.feedbSlot}${hasSlot ? ',' : ''}`)
  if (hasSlot) {
    const slot = d.slot!
    lines.push(`${t}"0": {`)
    lines.push(`${t2}"inUse": 1,`)
    lines.push(`${t2}"target": 0,`)
    lines.push(`${t2}"msgType": ${init.msgType ?? slot.msgType},`)
    lines.push(`${t2}"ch": ${init.ch ?? slot.ch},`)
    lines.push(`${t2}"csvRef": ${init.csvRef ?? 0},`)
    lines.push(`${t2}"msgNr": ${init.msgNr ?? 0},`)
    lines.push(`${t2}"maxOut": 16383,`)
    lines.push(`${t2}"minOut": 0,`)
    lines.push(`${t2}"curveId": ${slot.curveId}`)
    lines.push(`${t}}`)
  }
  lines.push(`${tc}}`)
  return lines.join('\n')
}

export function removeControl(text: string, type: ControlType, id: string): string {
  const doc = parseJson(text)
  const obj = getObject(doc.root, ['map', type])
  if (!obj || !getMember(obj, id)) return text
  const e = editRemoveMember(text, obj, id)
  return e ? applyEdits(text, [e]) : text
}

/** Create (or replace) a control entry. withSlot=false makes "chrome only" (no output slot). */
export function createControl(text: string, type: ControlType, id: string, init: CreateInit, withSlot = true): string {
  let cur = text
  // replace: drop any existing entry first
  cur = removeControl(cur, type, id)
  const doc = parseJson(cur)
  const obj = getObject(doc.root, ['map', type])
  if (!obj) return text
  const memberTabs = memberKeyTabs(cur, obj) + 1
  const valueText = buildControlValue(type, init, memberTabs, withSlot)
  return applyEdits(cur, [editInsertMember(cur, obj, id, valueText)])
}

// ---- assign a CSV param --------------------------------------------------
/** Assign a preset param to a control (creating it if the position is unmapped). */
export function assignParam(text: string, type: ControlType, id: string, param: PresetParam, ch?: number): string {
  const doc = parseJson(text)
  const obj = getPath(doc.root, ['map', type, id])
  const name = param.name.toUpperCase()
  const csvRef = makeCsvRef(param.rowIndex)
  const msgNr = param.cc ?? 0
  const slot0 = getPath(doc.root, ['map', type, id, '0'])
  if (obj && obj.kind === 'object' && slot0 && slot0.kind === 'object') {
    // edit in place: name + slot0 msgType/msgNr/csvRef (+ optional ch)
    const edits: Edit[] = []
    const push = (path: (string | number)[], value: string | number) => {
      const s = scalarAt(doc, path); if (s) edits.push(editSetScalar(s, formatValue(value, s.raw)))
    }
    push(['map', type, id, 'name'], name)
    push(['map', type, id, '0', 'msgType'], 3)
    push(['map', type, id, '0', 'msgNr'], msgNr)
    push(['map', type, id, '0', 'csvRef'], csvRef)
    if (ch != null) push(['map', type, id, '0', 'ch'], ch)
    return applyEdits(text, edits)
  }
  // create fresh
  const colId = readLayerColId(doc, layerOfId(id))
  return createControl(text, type, id, { name, colId, ch, msgNr, csvRef, msgType: 3 })
}

function readLayerColId(doc: JsonDoc, layer: number): number {
  const l = getPath(doc.root, ['layers', String(layer)])
  if (l && l.kind === 'object') {
    const v = getMember(l, 'colId')?.value
    if (v && v.kind === 'scalar' && typeof v.value === 'number') return v.value
  }
  return 0
}

// ---- bulk channel + layer ops --------------------------------------------
/** Set slot-0 channel for every mapped control on a layer (all control types). */
export function setChannelForLayer(text: string, layer: number, ch: number): string {
  const doc = parseJson(text)
  const edits: Edit[] = []
  for (const type of SECTION_TYPES) {
    const obj = getObject(doc.root, ['map', type])
    if (!obj) continue
    for (const m of obj.members) {
      if (layerOfId(m.key) !== layer) continue
      const s = scalarAt(doc, ['map', type, m.key, '0', 'ch'])
      if (s) edits.push(editSetScalar(s, formatValue(ch, s.raw)))
    }
  }
  return applyEdits(text, edits)
}

/** Copy all controls from srcLayer to dstLayer (overwriting dst), across all types. */
export function copyLayer(text: string, srcLayer: number, dstLayer: number): string {
  if (srcLayer === dstLayer) return text
  let cur = text
  for (const type of SECTION_TYPES) {
    // 1) remove existing dst-layer members (iteratively; spans shift each removal)
    while (true) {
      const doc = parseJson(cur)
      const obj = getObject(doc.root, ['map', type])
      if (!obj) break
      const victim = obj.members.find((m) => layerOfId(m.key) === dstLayer)
      if (!victim) break
      const e = editRemoveMember(cur, obj, victim.key)
      if (!e) break
      cur = applyEdits(cur, [e])
    }
    // 2) capture src-layer entries, then insert clones with rewritten ids
    const sdoc = parseJson(cur)
    const sobj = getObject(sdoc.root, ['map', type])
    if (!sobj) continue
    const clones = sobj.members
      .filter((m) => layerOfId(m.key) === srcLayer)
      .map((m) => ({ destId: withLayer(m.key, dstLayer), valueText: cur.slice(m.value.span.start, m.value.span.end) }))
    for (const c of clones) {
      const doc = parseJson(cur)
      const obj = getObject(doc.root, ['map', type])!
      cur = applyEdits(cur, [editInsertMember(cur, obj, c.destId, c.valueText)])
    }
  }
  return cur
}

// ---- output slots (add / remove; field edits via setSlotField) -----------
export function addSlot(text: string, type: ControlType, id: string, slotKey: string): string {
  const doc = parseJson(text)
  const ctrl = getObject(doc.root, ['map', type, id])
  if (!ctrl || getMember(ctrl, slotKey)) return text
  const d = CONTROL_DEFAULTS[type] ?? CONTROL_DEFAULTS.rotary
  const slot = d.slot ?? { msgType: 3, ch: 1, curveId: 0 }
  const tabs = memberKeyTabs(text, ctrl) + 1
  const t = '\t'.repeat(tabs)
  const value = [
    '{',
    `${t}"inUse": 1,`,
    `${t}"target": 0,`,
    `${t}"msgType": ${slot.msgType},`,
    `${t}"ch": ${slot.ch},`,
    `${t}"csvRef": 0,`,
    `${t}"msgNr": 0,`,
    `${t}"maxOut": 16383,`,
    `${t}"minOut": 0,`,
    `${t}"curveId": ${slot.curveId}`,
    `${'\t'.repeat(tabs - 1)}}`,
  ].join('\n')
  return applyEdits(text, [editInsertMember(text, ctrl, slotKey, value)])
}

export function removeSlot(text: string, type: ControlType, id: string, slotKey: string): string {
  const doc = parseJson(text)
  const ctrl = getObject(doc.root, ['map', type, id])
  if (!ctrl) return text
  const e = editRemoveMember(text, ctrl, slotKey)
  return e ? applyEdits(text, [e]) : text
}

// ---- snapshots (save = state→data, load = data→state) --------------------
// Compact pretty-printer for a snapshot scene / state sub-object, tab-indented
// to match the Drop's style. `tabs` is the indent of the value's closing brace.
function prettyScene(v: unknown, tabs: number): string {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const keys = Object.keys(v as Record<string, unknown>)
    if (keys.length === 0) return '{}'
    const t1 = '\t'.repeat(tabs + 1)
    const body = keys.map((k) => `${t1}${JSON.stringify(k)}: ${prettyScene((v as Record<string, unknown>)[k], tabs + 1)}`).join(',\n')
    return `{\n${body}\n${'\t'.repeat(tabs)}}`
  }
  return JSON.stringify(v)
}

function sceneFromState(parsed: any): Record<string, unknown> {
  const s = parsed.state ?? {}
  return { rotary: s.rotary ?? {}, rotbut: s.rotbut ?? {}, mute: s.mute ?? {}, fader: s.fader ?? {} }
}

/** Capture the current `state` values into a snapshot's `data` (creating the snapshot if absent). */
export function saveSnapshot(text: string, id: string, colId = 0): string {
  const parsed = JSON.parse(text)
  const scene = sceneFromState(parsed)
  const doc = parseJson(text)
  const snpSection = getObject(doc.root, ['map', 'snp'])
  if (!snpSection) return text
  const existing = getObject(doc.root, ['map', 'snp', id])
  if (existing) {
    const dataMember = getMember(existing, 'data')
    const keyTabs = memberKeyTabs(text, existing)
    const sceneText = prettyScene(scene, keyTabs)
    if (dataMember) {
      return applyEdits(text, [{ start: dataMember.value.span.start, end: dataMember.value.span.end, text: sceneText }])
    }
    return applyEdits(text, [editInsertMember(text, existing, 'data', sceneText)])
  }
  // create a new snapshot entry
  const tabs = memberKeyTabs(text, snpSection) + 1
  const t = '\t'.repeat(tabs)
  const value = [
    '{',
    `${t}"name": ${JSON.stringify('SNP ' + id)},`,
    `${t}"colId": ${colId},`,
    `${t}"dropOrder": 1,`,
    `${t}"behavId": 4,`,
    `${t}"feedbSlotVis": 1,`,
    `${t}"feedbId": 28,`,
    `${t}"feedbSlot": 0,`,
    `${t}"data": ${prettyScene(scene, tabs)}`,
    `${'\t'.repeat(tabs - 1)}}`,
  ].join('\n')
  return applyEdits(text, [editInsertMember(text, snpSection, id, value)])
}

/** Recall a snapshot's stored scene into the live `state` section. */
export function loadSnapshot(text: string, id: string): string {
  const parsed = JSON.parse(text)
  const data = parsed.map?.snp?.[id]?.data
  if (!data) return text
  const doc = parseJson(text)
  const stateObj = getObject(doc.root, ['state'])
  if (!stateObj) return text
  const keyTabs = memberKeyTabs(text, stateObj)
  const edits: Edit[] = []
  for (const type of ['rotary', 'rotbut', 'mute', 'fader']) {
    const node = getPath(doc.root, ['state', type])
    if (node) edits.push({ start: node.span.start, end: node.span.end, text: prettyScene(data[type] ?? {}, keyTabs) })
  }
  return applyEdits(text, edits)
}

// ---- assign a preset param to ONE slot -----------------------------------
export function setSlotParam(text: string, type: ControlType, id: string, slot: string, param: PresetParam): string {
  let t = text
  t = setSlotField(t, type, id, slot, 'msgType', 3)
  t = setSlotField(t, type, id, slot, 'msgNr', param.cc ?? 0)
  t = setSlotField(t, type, id, slot, 'csvRef', makeCsvRef(param.rowIndex))
  return t
}

// ---- selection-group membership ------------------------------------------
/** Add or remove all given controls to/from a selection group (bit flips in the 80-byte mask). */
export function setGroupMember(text: string, group: number, targets: FieldTarget[], included: boolean): string {
  const doc = parseJson(text)
  const acc = new Map<number, { node: ScalarNode; value: number; mask: number }>()
  for (const t of targets) {
    const pos = parseControlId(t.type, t.id)
    const loc = selGroupLocation(t.type, pos.layer, pos.col, pos.row ?? 0)
    if (!loc) continue
    const node = scalarAt(doc, ['settings', 'selGroup', String(group), 'data', loc.index])
    if (!node) continue
    let e = acc.get(loc.index)
    if (!e) { e = { node, value: typeof node.value === 'number' ? node.value : 0, mask: 0 }; acc.set(loc.index, e) }
    e.mask |= loc.mask
  }
  const edits: Edit[] = []
  for (const e of acc.values()) {
    const v = included ? (e.value | e.mask) : (e.value & ~e.mask)
    if (v !== e.value) edits.push(editSetScalar(e.node, formatValue(v, e.node.raw)))
  }
  return applyEdits(text, edits)
}

// ---- device (target) config ----------------------------------------------
/** Set a field on one of the project's 8 target devices (device.<index>.<field>). */
export function setDeviceField(text: string, index: number, field: string, value: string | number): string {
  const doc = parseJson(text)
  const s = scalarAt(doc, ['device', String(index), field])
  if (!s) return text
  return applyEdits(text, [editSetScalar(s, formatValue(value, s.raw))])
}

/** Point a device at a preset CSV (sets csvInUse + csvPath + csvFile together). */
export function setDeviceCsv(text: string, index: number, path: string, file: string): string {
  let t = setDeviceField(text, index, 'csvInUse', file ? 1 : 0)
  t = setDeviceField(t, index, 'csvPath', path)
  t = setDeviceField(t, index, 'csvFile', file)
  return t
}

// ---- live state value ----------------------------------------------------
/** Set a control's current value in the `state` section (creating the entry if missing). */
export function setStateValue(text: string, type: ControlType, id: string, value: number): string {
  const doc = parseJson(text)
  const s = scalarAt(doc, ['state', type, id])
  if (s) return applyEdits(text, [editSetScalar(s, formatValue(value, s.raw))])
  const obj = getObject(doc.root, ['state', type])
  if (!obj) return text
  return applyEdits(text, [editInsertMember(text, obj, id, formatValue(value))])
}

// ---- copy / paste a single control ---------------------------------------
export function copyControlText(text: string, type: ControlType, id: string): string | null {
  const doc = parseJson(text)
  const m = getObject(doc.root, ['map', type]) && getMember(getObject(doc.root, ['map', type])!, id)
  if (!m) return null
  return text.slice(m.value.span.start, m.value.span.end)
}

export function pasteControl(text: string, type: ControlType, destId: string, valueText: string): string {
  let cur = removeControl(text, type, destId)
  const doc = parseJson(cur)
  const obj = getObject(doc.root, ['map', type])
  if (!obj) return text
  return applyEdits(cur, [editInsertMember(cur, obj, destId, valueText)])
}

// ---- multi-control copy / paste (positional, anchor-relative) -------------
// Selection is positional (layer-independent): copied controls are keyed by their
// offset from a SINGLE anchor = the control in the topmost row, then the leftmost
// column, across all selected types together (faders/mutes count as row 0). Paste lays
// the whole block down at (destination anchor + offset) regardless of type, so a single
// selected control anchors the entire clipboard (Excel "block from anchor"); off-grid
// targets drop. snp and other non-positional types are ignored.

export interface CopiedControl {
  type: ControlType
  dCol: number
  dRow: number
  /** the control's map value text, or null if that selected position was empty (paste clears dest) */
  valueText: string | null
}

export interface SelectedControl {
  type: ControlType
  id: string
}

const rowOf = (p: ControlPos) => p.row ?? 0

/** The anchor of a selection: the position in the topmost row, then the leftmost column. */
function anchorOf(positions: ControlPos[]): { col: number; row: number } | null {
  let a: ControlPos | null = null
  for (const p of positions) {
    if (!a || rowOf(p) < rowOf(a) || (rowOf(p) === rowOf(a) && p.col < a.col)) a = p
  }
  return a ? { col: a.col, row: rowOf(a) } : null
}

const positionsOf = (sel: SelectedControl[]) =>
  sel.filter((s) => isPositional(s.type)).map((s) => parseControlId(s.type, s.id))

/** Capture the selected positional controls, keyed by anchor-relative offset.
 *  Empty selected positions are captured as null so paste can clear their destination. */
export function copyControls(text: string, sel: SelectedControl[]): CopiedControl[] {
  const anchor = anchorOf(positionsOf(sel))
  if (!anchor) return []
  const doc = parseJson(text)
  const out: CopiedControl[] = []
  for (const type of SECTION_TYPES) {
    const obj = getObject(doc.root, ['map', type])
    for (const id of sel.filter((s) => s.type === type).map((s) => s.id)) {
      const p = parseControlId(type, id)
      const m = obj && getMember(obj, id)
      out.push({
        type,
        dCol: p.col - anchor.col,
        dRow: rowOf(p) - anchor.row,
        valueText: m ? text.slice(m.value.span.start, m.value.span.end) : null,
      })
    }
  }
  return out
}

/** Paste copied controls into the destination selection on `layer`.
 *  - broadcast: if exactly one control was copied, paste it onto every selected position
 *    of the same type.
 *  - anchor: otherwise lay the whole block down at (destination anchor + offset), where the
 *    anchor is the single topmost-row leftmost selected control; the destination selection's
 *    shape is otherwise ignored and off-grid targets drop.
 *  Targets whose destination already holds the pasted value are skipped, so pasting a
 *  selection back onto itself is a true no-op. */
export function pasteControls(text: string, clip: CopiedControl[], destSel: SelectedControl[], layer: number): string {
  if (!clip.length || !destSel.length) return text
  const targets: { type: ControlType; id: string; valueText: string | null }[] = []

  if (clip.length === 1) {
    const src = clip[0]
    if (src.valueText == null) return text
    for (const d of destSel) {
      if (d.type === src.type) targets.push({ type: d.type, id: d.id, valueText: src.valueText })
    }
  } else {
    const anchor = anchorOf(positionsOf(destSel))
    if (!anchor) return text
    for (const e of clip) {
      const col = anchor.col + e.dCol
      const row = anchor.row + e.dRow
      if (col < 0 || col >= COLS) continue
      if (hasRow(e.type) && (row < 0 || row >= ROWS)) continue
      const id = formatControlId({ type: e.type, layer, col, row: hasRow(e.type) ? row : undefined })
      targets.push({ type: e.type, id, valueText: e.valueText })
    }
  }

  let cur = text
  for (const t of targets) {
    const doc = parseJson(cur)
    const obj = getObject(doc.root, ['map', t.type])
    const m = obj && getMember(obj, t.id)
    const curText = m ? cur.slice(m.value.span.start, m.value.span.end) : null
    if (t.valueText == null) {
      if (curText != null) cur = removeControl(cur, t.type, t.id) // clear an emptied position
    } else if (curText !== t.valueText) {
      cur = pasteControl(cur, t.type, t.id, t.valueText) // skip when already identical (no-op)
    }
  }
  return cur
}
