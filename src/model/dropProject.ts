// Typed read-views over a parsed Drop project (for rendering). Editing lives in edits.ts;
// both operate on the same span-preserving jsonDoc so saves stay byte-faithful.
import {
  parseJson, getObject, getMember, getPath,
  type JsonDoc, type JsonNode,
} from './jsonDoc'
import { parseControlId, type ControlType } from './controlId'

export interface SlotView {
  key: string
  inUse: number; target: number; msgType: number; ch: number
  csvRef: number; msgNr: number; maxOut: number; minOut: number; curveId: number
}
export interface ControlView {
  type: ControlType; id: string
  name: string; colId: number; behavId: number; feedbId: number
  slots: SlotView[]
}
export interface LayerView { index: number; name: string; colId: number }
export interface DeviceView {
  index: number; name: string; inUse: number; ch: number
  portOut: number; portIn: number; cableIdOut: number; cableIdIn: number; preDrop: number
  csvInUse: number; csvPath: string; csvFile: string
}

export function load(text: string): JsonDoc { return parseJson(text) }

function sval(node?: JsonNode): string | number | boolean | null | undefined {
  return node && node.kind === 'scalar' ? node.value : undefined
}
function snum(obj: JsonNode | undefined, key: string, d = 0): number {
  if (!obj || obj.kind !== 'object') return d
  const v = sval(getMember(obj, key)?.value)
  return typeof v === 'number' ? v : d
}
function sstr(obj: JsonNode | undefined, key: string, d = ''): string {
  if (!obj || obj.kind !== 'object') return d
  const v = sval(getMember(obj, key)?.value)
  return v == null ? d : String(v)
}

export function readControl(doc: JsonDoc, type: ControlType, id: string): ControlView | undefined {
  const obj = getPath(doc.root, ['map', type, id])
  if (!obj || obj.kind !== 'object') return undefined
  const slots: SlotView[] = []
  for (const m of obj.members) {
    if (/^\d+$/.test(m.key) && m.value.kind === 'object') {
      const s = m.value
      slots.push({
        key: m.key,
        inUse: snum(s, 'inUse'), target: snum(s, 'target'), msgType: snum(s, 'msgType'),
        ch: snum(s, 'ch', 1), csvRef: snum(s, 'csvRef'), msgNr: snum(s, 'msgNr'),
        maxOut: snum(s, 'maxOut', 16383), minOut: snum(s, 'minOut'), curveId: snum(s, 'curveId'),
      })
    }
  }
  return { type, id, name: sstr(obj, 'name'), colId: snum(obj, 'colId'), behavId: snum(obj, 'behavId'), feedbId: snum(obj, 'feedbId'), slots }
}

/** ids present in map.<type> (any layer). */
export function mappedIds(doc: JsonDoc, type: ControlType): Set<string> {
  const obj = getObject(doc.root, ['map', type])
  return new Set(obj ? obj.members.map((m) => m.key) : [])
}

export function readLayers(doc: JsonDoc): LayerView[] {
  const obj = getObject(doc.root, ['layers'])
  const out: LayerView[] = []
  if (!obj) return out
  for (const m of obj.members) {
    if (/^\d+$/.test(m.key) && m.value.kind === 'object') {
      const i = Number(m.key)
      out.push({ index: i, name: sstr(m.value, 'name', `Layer ${i + 1}`), colId: snum(m.value, 'colId') })
    }
  }
  return out.sort((a, b) => a.index - b.index)
}

// ---- selection groups (settings.selGroup.<g>.data: 80 bytes) -------------
// Each byte is one row of one layer; layout per layer (10 rows):
//   [rot r1..r4, rotbut r1..r4, mute, fader]. Bit = column, MSB-first
//   (column 1 = bit 7, column 8 = bit 0), per the device's bitmask convention.
export const NUM_SEL_GROUPS = 8

function rowKindOf(type: ControlType, row: number): number | null {
  if (type === 'rotary') return row          // 0-3
  if (type === 'rotbut') return 4 + row      // 4-7
  if (type === 'mute') return 8
  if (type === 'fader') return 9
  return null // snp has no selection-group membership
}

export function selGroupLocation(type: ControlType, layer: number, col: number, row = 0): { index: number; mask: number } | null {
  const rk = rowKindOf(type, row)
  if (rk == null) return null
  return { index: layer * 10 + rk, mask: 1 << (7 - col) }
}

export function readGroupMember(doc: JsonDoc, group: number, type: ControlType, id: string): boolean {
  const pos = parseControlId(type, id)
  const loc = selGroupLocation(type, pos.layer, pos.col, pos.row ?? 0)
  if (!loc) return false
  const node = getPath(doc.root, ['settings', 'selGroup', String(group), 'data', loc.index])
  const v = node && node.kind === 'scalar' && typeof node.value === 'number' ? node.value : 0
  return (v & loc.mask) !== 0
}

/** Current (live) value of a control from the `state` section, if present. */
export function readStateValue(doc: JsonDoc, type: ControlType, id: string): number | undefined {
  const n = getPath(doc.root, ['state', type, id])
  return n && n.kind === 'scalar' && typeof n.value === 'number' ? n.value : undefined
}

// ---- snapshot stored scene (map.snp.<id>.data.<type>.<ctrlId>) -----------
/** Value a snapshot stores for a control, if it stores one (else undefined). */
export function readSnapshotValue(doc: JsonDoc, snpId: string, type: ControlType, id: string): number | undefined {
  const n = getPath(doc.root, ['map', 'snp', snpId, 'data', type, id])
  return n && n.kind === 'scalar' && typeof n.value === 'number' ? n.value : undefined
}

/** Whether a snapshot stores (will recall) a given control — i.e. its id is present in `data`. */
export function readSnapshotMember(doc: JsonDoc, snpId: string, type: ControlType, id: string): boolean {
  return !!getPath(doc.root, ['map', 'snp', snpId, 'data', type, id])
}

export function readDevices(doc: JsonDoc): DeviceView[] {
  const obj = getObject(doc.root, ['device'])
  const out: DeviceView[] = []
  if (!obj) return out
  for (const m of obj.members) {
    if (m.value.kind === 'object') {
      out.push({
        index: Number(m.key), name: sstr(m.value, 'name'), inUse: snum(m.value, 'inUse'), ch: snum(m.value, 'ch', 1),
        portOut: snum(m.value, 'portOut'), portIn: snum(m.value, 'portIn'),
        cableIdOut: snum(m.value, 'cableIdOut'), cableIdIn: snum(m.value, 'cableIdIn'), preDrop: snum(m.value, 'preDrop'),
        csvInUse: snum(m.value, 'csvInUse'), csvPath: sstr(m.value, 'csvPath'), csvFile: sstr(m.value, 'csvFile'),
      })
    }
  }
  return out.sort((a, b) => a.index - b.index)
}
