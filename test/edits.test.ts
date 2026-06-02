import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { load, readControl, readLayers, readDevices, mappedIds, readStateValue, readGroupMember, selGroupLocation } from '../src/model/dropProject'
import {
  setControlField, setSlotField, bulkSetSlotField, assignParam, createControl, removeControl,
  setChannelForLayer, copyLayer, copyControlText, pasteControl, copyControls, pasteControls,
  copySnapshots, pasteSnapshots, formatValue, setStateValue,
  addSlot, removeSlot, saveSnapshot, loadSnapshot, setSlotParam, setGroupMember,
  setDeviceField, setDeviceCsv,
} from '../src/model/edits'
import type { PresetParam } from '../src/model/presetDb'
import { loadBundledByPathFile } from '../src/data/devices'

const here = dirname(fileURLToPath(import.meta.url))
const EXP = readFileSync(join(here, 'fixtures', 'deluge-exp.json'), 'utf8')
const OLD = readFileSync(join(here, 'fixtures', 'old-daw-init.json'), 'utf8')
const obj = (t: string) => JSON.parse(t)

const MASTER_LEVEL: PresetParam = { rowIndex: 57, section: 'Master', name: 'Master level', cc: 7 }

describe('dropProject read-views', () => {
  const doc = load(EXP)
  it('reads a control with its slot', () => {
    const c = readControl(doc, 'rotary', '000')!
    expect(c.name).toBe('AMOUNT')
    expect(c.colId).toBe(9)
    expect(c.behavId).toBe(1)
    expect(c.slots[0]).toMatchObject({ key: '0', msgType: 3, ch: 1, msgNr: 52 })
  })
  it('reads layers and devices', () => {
    expect(readLayers(doc)).toHaveLength(8)
    const dev = readDevices(doc)
    expect(dev[0]).toMatchObject({ index: 0, name: 'Deluge', inUse: 1, csvFile: 'Deluge.csv' })
  })
  it('lists mapped ids', () => {
    expect(mappedIds(doc, 'rotary').has('000')).toBe(true)
    expect(mappedIds(doc, 'mute').size).toBe(0)
  })
})

describe('scalar edits stay localized', () => {
  it('setControlField changes only that control', () => {
    const out = setControlField(EXP, 'rotary', '000', 'name', 'CUTOFF')
    expect(readControl(load(out), 'rotary', '000')!.name).toBe('CUTOFF')
    expect(readControl(load(out), 'rotary', '001')!.name).toBe('RATE') // neighbour intact
    expect(obj(out).map.rotary['000']['0'].msgNr).toBe(52) // slot intact
  })
  it('setSlotField changes a slot value', () => {
    const out = setSlotField(EXP, 'rotary', '000', '0', 'ch', 9)
    expect(readControl(load(out), 'rotary', '000')!.slots[0].ch).toBe(9)
  })
  it('bulkSetSlotField sets ch across many controls at once', () => {
    const targets = ['000', '010', '020', '030'].map((id) => ({ type: 'rotary' as const, id }))
    const out = bulkSetSlotField(EXP, targets, '0', 'ch', 4)
    for (const id of ['000', '010', '020', '030']) {
      expect(obj(out).map.rotary[id]['0'].ch).toBe(4)
    }
    expect(obj(out).map.rotary['001']['0'].ch).toBe(1) // untouched
  })
  it('formatValue matches the original token decimal style', () => {
    expect(formatValue(53, '52.000')).toBe('53.000')
    expect(formatValue(53, '52')).toBe('53')
    expect(formatValue('HI')).toBe('"HI"')
  })
})

describe('assignParam', () => {
  it('edits an existing control in place', () => {
    const out = assignParam(EXP, 'rotary', '000', MASTER_LEVEL)
    const c = obj(out).map.rotary['000']
    expect(c.name).toBe('MASTER LEVEL')
    expect(c['0']).toMatchObject({ msgType: 3, msgNr: 7, csvRef: 57 })
  })
  it('creates a control at an unmapped position', () => {
    expect(mappedIds(load(EXP), 'rotary').has('100')).toBe(false)
    const out = assignParam(EXP, 'rotary', '100', MASTER_LEVEL, 2)
    const c = obj(out).map.rotary['100']
    expect(c).toMatchObject({ name: 'MASTER LEVEL', behavId: 1 })
    expect(c['0']).toMatchObject({ msgType: 3, msgNr: 7, csvRef: 57, ch: 2, inUse: 1 })
    // everything else still valid + untouched
    expect(obj(out).map.rotary['000'].name).toBe('AMOUNT')
  })
})

describe('create / remove', () => {
  it('creates then removes a mute (note-type defaults)', () => {
    const created = createControl(EXP, 'mute', '00', { name: 'MUTE 1', colId: 3, ch: 2, msgNr: 60 })
    const m = obj(created).map.mute['00']
    expect(m).toMatchObject({ name: 'MUTE 1', behavId: 4 })
    expect(m['0']).toMatchObject({ msgType: 2, ch: 2, msgNr: 60, curveId: 9 })
    const removed = removeControl(created, 'mute', '00')
    expect(obj(removed).map.mute['00']).toBeUndefined()
    // removing the only mute returns the section to {}
    expect(obj(removed).map.mute).toEqual({})
  })
  it('creates a chrome-only control (no output slot) for the Active toggle', () => {
    const out = createControl(EXP, 'rotary', '100', { name: 'X', colId: 3 }, false)
    const c = obj(out).map.rotary['100']
    expect(c).toMatchObject({ name: 'X', colId: 3, behavId: 1 })
    expect(c['0']).toBeUndefined() // no slot — active but no MIDI output yet
  })
})

describe('layer + channel ops', () => {
  it('sets channel for an entire layer', () => {
    const out = setChannelForLayer(EXP, 0, 5)
    const m = obj(out).map
    for (const id of Object.keys(m.rotary)) expect(m.rotary[id]['0'].ch).toBe(5)
    for (const id of Object.keys(m.fader)) expect(m.fader[id]['0'].ch).toBe(5)
  })
  it('copies a whole layer to another layer', () => {
    const out = copyLayer(EXP, 0, 1)
    const m = obj(out).map
    // layer 1 rotaries now exist (32) cloned from layer 0
    const layer1Rot = Object.keys(m.rotary).filter((k) => k[0] === '1')
    expect(layer1Rot).toHaveLength(32)
    expect(m.rotary['100'].name).toBe('AMOUNT') // clone of '000'
    expect(m.rotary['103'].name).toBe('FREQUENCY') // clone of '003'
    expect(Object.keys(m.fader).filter((k) => k[0] === '1')).toHaveLength(8)
    // layer 0 untouched
    expect(m.rotary['000'].name).toBe('AMOUNT')
  })
  it('copyLayer is a no-op when src===dst', () => {
    expect(copyLayer(EXP, 0, 0)).toBe(EXP)
  })
})

describe('state (current value) edits', () => {
  it('edits an existing state value', () => {
    expect(readStateValue(load(EXP), 'fader', '00')).toBe(0.49928)
    const out = setStateValue(EXP, 'fader', '00', 0.5)
    expect(obj(out).state.fader['00']).toBe(0.5)
    expect(readStateValue(load(out), 'fader', '00')).toBe(0.5)
  })
  it('creates a state value when missing (into an empty state section)', () => {
    expect(obj(EXP).state.mute).toEqual({})
    const out = setStateValue(EXP, 'mute', '00', 0.25)
    expect(obj(out).state.mute['00']).toBe(0.25)
    // other state untouched
    expect(obj(out).state.fader['00']).toBe(0.49928)
  })
})

describe('output slots', () => {
  it('adds a second slot then removes it', () => {
    expect(obj(EXP).map.rotary['000']['1']).toBeUndefined()
    const added = addSlot(EXP, 'rotary', '000', '1')
    expect(obj(added).map.rotary['000']['1']).toMatchObject({ inUse: 1, msgType: 3, ch: 1, target: 0 })
    expect(obj(added).map.rotary['000']['0'].msgNr).toBe(52) // slot 0 untouched
    const removed = removeSlot(added, 'rotary', '000', '1')
    expect(obj(removed).map.rotary['000']['1']).toBeUndefined()
  })
  it('toggles a slot inUse via setSlotField, and edits target', () => {
    let t = setSlotField(EXP, 'rotary', '000', '0', 'inUse', 0)
    expect(obj(t).map.rotary['000']['0'].inUse).toBe(0)
    t = setSlotField(t, 'rotary', '000', '0', 'target', 1)
    expect(obj(t).map.rotary['000']['0'].target).toBe(1)
  })
})

describe('snapshots', () => {
  it('saves current state into an existing snapshot data', () => {
    const stateFader = obj(OLD).state.fader
    const out = saveSnapshot(OLD, '0000')
    expect(obj(out).map.snp['0000'].data.fader).toEqual(stateFader)
    expect(obj(out).map.snp['0000'].data.rotary).toEqual(obj(OLD).state.rotary)
    expect(obj(out).map.snp['0000'].name).toBe('SNP 01-1-1') // chrome untouched
  })
  it('creates a snapshot at an empty pad, capturing state', () => {
    expect(obj(OLD).map.snp['0044']).toBeUndefined()
    const out = saveSnapshot(OLD, '0044', 7)
    expect(obj(out).map.snp['0044']).toMatchObject({ behavId: 4, colId: 7, name: 'SNP 0044' })
    expect(obj(out).map.snp['0044'].data.fader).toEqual(obj(OLD).state.fader)
  })
  it('loads a snapshot scene into live state', () => {
    const snapData = obj(OLD).map.snp['0000'].data
    const out = loadSnapshot(OLD, '0000')
    expect(obj(out).state.fader).toEqual(snapData.fader)
    expect(obj(out).state.rotary).toEqual(snapData.rotary)
    // mappings untouched
    expect(obj(out).map.rotary['100'].name).toBe('ROT B-1-1')
  })
})

describe('devices', () => {
  it('edits device fields', () => {
    expect(obj(setDeviceField(EXP, 1, 'name', 'Synth A')).device['1'].name).toBe('Synth A')
    expect(obj(setDeviceField(EXP, 0, 'ch', 9)).device['0'].ch).toBe(9)
    expect(obj(setDeviceField(EXP, 0, 'portOut', 2)).device['0'].portOut).toBe(2)
  })
  it('points a device at a preset CSV (csvInUse + path + file together)', () => {
    const out = setDeviceCsv(EXP, 2, '/midi-main/Synthstrom', 'Deluge.csv')
    expect(obj(out).device['2']).toMatchObject({ csvInUse: 1, csvPath: '/midi-main/Synthstrom', csvFile: 'Deluge.csv' })
    const cleared = setDeviceCsv(out, 2, '', '')
    expect(obj(cleared).device['2']).toMatchObject({ csvInUse: 0, csvFile: '' })
  })
  it('resolves bundled CSV by path/file', async () => {
    const d = await loadBundledByPathFile('/midi-main/Synthstrom', 'Deluge.csv')
    expect(d?.device).toBe('Deluge')
    expect((d?.params.length ?? 0)).toBeGreaterThan(100)
    expect(await loadBundledByPathFile('/midi-main/Whatever', 'Nope.csv')).toBeNull()
  })
})

describe('per-slot param assign', () => {
  it('sets a slot to a CSV param (msgType/msgNr/csvRef)', () => {
    const out = setSlotParam(EXP, 'rotary', '000', '0', { rowIndex: 57, section: 'Master', name: 'Master level', cc: 7 })
    expect(obj(out).map.rotary['000']['0']).toMatchObject({ msgType: 3, msgNr: 7 })
    expect(obj(out).map.rotary['000']['0'].csvRef & 0xffff).toBe(57)
  })
})

describe('selection groups', () => {
  it('locates a control in the 80-byte mask (layer*10 + rowKind, MSB-first column)', () => {
    expect(selGroupLocation('rotary', 0, 1, 0)).toEqual({ index: 0, mask: 1 << 6 }) // L0 rot row1 col2
    expect(selGroupLocation('rotary', 0, 0, 1)).toEqual({ index: 1, mask: 1 << 7 }) // row2 col1
    expect(selGroupLocation('rotbut', 0, 0, 0)).toEqual({ index: 4, mask: 1 << 7 })
    expect(selGroupLocation('mute', 1, 0, 0)).toEqual({ index: 18, mask: 1 << 7 })
    expect(selGroupLocation('fader', 0, 7, 0)).toEqual({ index: 9, mask: 1 << 0 })
    expect(selGroupLocation('snp', 0, 0, 0)).toBeNull()
  })
  it('reads membership against the real group-0 mask', () => {
    const doc = load(EXP) // exp group0 data[0..9] = [0,255,255,0,0,0,0,0,0,255]
    expect(readGroupMember(doc, 0, 'rotary', '011')).toBe(true)  // row2 (index1=255)
    expect(readGroupMember(doc, 0, 'rotary', '000')).toBe(false) // row1 (index0=0)
    expect(readGroupMember(doc, 0, 'fader', '00')).toBe(true)    // index9=255
    expect(readGroupMember(doc, 0, 'mute', '00')).toBe(false)    // index8=0
  })
  it('adds and removes controls from a group, combining bits per row', () => {
    // add rot 000 (col0→bit7) and 010 (col1→bit6) to group0 → data[0] = 0|128|64 = 192
    const added = setGroupMember(EXP, 0, [{ type: 'rotary', id: '000' }, { type: 'rotary', id: '010' }], true)
    expect(obj(added).settings.selGroup['0'].data[0]).toBe(192)
    expect(readGroupMember(load(added), 0, 'rotary', '000')).toBe(true)
    // remove just 000 → data[0] back to 64
    const removed = setGroupMember(added, 0, [{ type: 'rotary', id: '000' }], false)
    expect(obj(removed).settings.selGroup['0'].data[0]).toBe(64)
  })
})

describe('copy / paste a control', () => {
  it('copies a control value and pastes it to an unmapped position', () => {
    const vt = copyControlText(EXP, 'rotary', '000')!
    expect(vt).toContain('"AMOUNT"')
    const out = pasteControl(EXP, 'rotary', '150', vt)
    expect(obj(out).map.rotary['150'].name).toBe('AMOUNT')
    expect(obj(out).map.rotary['000'].name).toBe('AMOUNT') // source intact
  })
})

describe('multi-control copy / paste (positional)', () => {
  const sel = (...ks: string[]) => ks.map((k) => { const i = k.indexOf(':'); return { type: k.slice(0, i) as any, id: k.slice(i + 1) } })

  it('keys copies to per-type anchor offsets (topmost row, then leftmost col)', () => {
    // 000 = col0,row0 (AMOUNT); 001 = col0,row1 (RATE). Anchor = 000 (topmost row).
    const clip = copyControls(EXP, sel('rotary:000', 'rotary:001'))
    expect(clip).toHaveLength(2)
    expect(clip.find((c) => c.dCol === 0 && c.dRow === 0)!.valueText).toContain('"AMOUNT"')
    expect(clip.find((c) => c.dCol === 0 && c.dRow === 1)!.valueText).toContain('"RATE"')
  })

  it('anchors the whole multi-type block to a single destination control', () => {
    // copy column 0: rotaries rows 0-3 + the fader. Paste onto a single rotary anchor.
    const clip = copyControls(EXP, sel('rotary:000', 'rotary:001', 'rotary:002', 'rotary:003', 'fader:00'))
    const out = obj(pasteControls(EXP, clip, sel('rotary:150'), 1)) // single anchor, empty layer 1, col5
    expect(out.map.rotary['150'].name).toBe('AMOUNT')        // anchor + (0,0)
    expect(out.map.rotary['153'].name).toBe('FREQUENCY')     // anchor + (0,3)
    expect(out.map.fader['15'].name).toBe('MASTER LEVEL')    // fader pasted to the same column despite the lone rotary anchor
  })

  it('pastes a block at the destination anchor on another layer', () => {
    const clip = copyControls(EXP, sel('rotary:000', 'rotary:001')) // AMOUNT / RATE, vertical pair
    // dest of the same shape on layer 1 at col3: anchor 130 (col3,row0)
    const out = obj(pasteControls(EXP, clip, sel('rotary:130', 'rotary:131'), 1))
    expect(out.map.rotary['130'].name).toBe('AMOUNT')
    expect(out.map.rotary['131'].name).toBe('RATE')
    expect(out.map.rotary['000'].name).toBe('AMOUNT') // source intact
  })

  it('anchors to the topmost-row leftmost control, not the leftmost-column control', () => {
    const clip = copyControls(EXP, sel('rotary:000', 'rotary:001')) // offsets (0,0)=AMOUNT, (0,1)=RATE
    // dest on empty layer 1: 130 = col3,row0 ; 111 = col1,row1. Topmost-row anchor = 130 (row0).
    // A leftmost-column anchor would (wrongly) be 111 and land in col1.
    const out = obj(pasteControls(EXP, clip, sel('rotary:130', 'rotary:111'), 1))
    expect(out.map.rotary['130'].name).toBe('AMOUNT') // anchor + (0,0)
    expect(out.map.rotary['131'].name).toBe('RATE')   // anchor + (0,1)
    expect(out.map.rotary['111']).toBeUndefined()     // not the anchor
    expect(out.map.rotary['112']).toBeUndefined()     // where leftmost-col anchoring would have put RATE
  })

  it('pasting a multi-selection back onto itself is a no-op', () => {
    const s = sel('rotary:000', 'rotary:002', 'fader:00', 'fader:03')
    const clip = copyControls(EXP, s)
    expect(pasteControls(EXP, clip, s, 0)).toBe(EXP)
  })

  it('broadcasts a single copied control onto every selected position of its type', () => {
    const clip = copyControls(EXP, sel('rotary:001')) // RATE
    expect(clip).toHaveLength(1)
    const out = obj(pasteControls(EXP, clip, sel('rotary:020', 'rotary:030', 'fader:00'), 0))
    expect(out.map.rotary['020'].name).toBe('RATE')
    expect(out.map.rotary['030'].name).toBe('RATE')
    expect(out.map.fader['00'].name).toBe('MASTER LEVEL') // fader untouched (cross-type ignored)
  })

  it('copying a layer (select all) and pasting on another layer mirrors it, clearing empties', () => {
    // every rotary + rotbut + fader position on layer 0 (rotbut is entirely empty here)
    const all: string[] = []
    for (let c = 0; c < 8; c++) {
      for (let r = 0; r < 4; r++) { all.push(`rotary:0${c}${r}`); all.push(`rotbut:0${c}${r}`) }
      all.push(`fader:0${c}`)
    }
    const clip = copyControls(EXP, sel(...all))
    // pre-seed layer 1 with a stray rotbut that the mirror must clear (its source pos is empty)
    const seeded = createControl(EXP, 'rotbut', '100', { name: 'STRAY', colId: 0 }, false)
    const destAll = all.map((k) => k.replace(/:0/, ':1'))
    const out = obj(pasteControls(seeded, clip, sel(...destAll), 1))
    expect(out.map.rotary['100'].name).toBe('AMOUNT')
    expect(out.map.rotary['102'].name).toBe('REVERB AMOUNT')
    expect(out.map.fader['10'].name).toBe('MASTER LEVEL')
    expect(out.map.rotbut?.['100']).toBeUndefined() // empty source position cleared the seeded stray
  })

  it('drops paste targets that fall off the grid', () => {
    const clip = copyControls(EXP, sel('rotary:000', 'rotary:070')) // span cols 0..7, anchor col0
    // dest anchor at col6 -> the +7 offset target (col13) is off-grid and dropped
    const out = obj(pasteControls(EXP, clip, sel('rotary:160', 'rotary:170'), 1))
    expect(out.map.rotary['160'].name).toBe('AMOUNT') // anchor lands
    expect(Object.keys(out.map.rotary).filter((k) => k[0] === '1' && Number(k[1]) > 7)).toHaveLength(0)
  })
})

describe('snapshot copy / paste / delete (positional within a bank)', () => {
  // OLD has snapshots in bank 00: 0000-0003 (col0), 0010-0012 (col1), 0020 (col2)
  const sel = (...ks: string[]) => ks.map((k) => { const i = k.indexOf(':'); return { type: k.slice(0, i) as any, id: k.slice(i + 1) } })

  it('keys copies to anchor offsets within the bank (id = bank,col,row)', () => {
    const clip = copySnapshots(OLD, sel('snp:0000', 'snp:0001')) // col0 row0 / row1 -> anchor 0000
    expect(clip).toHaveLength(2)
    expect(clip.find((c) => c.dCol === 0 && c.dRow === 0)!.valueText).toContain('SNP 01-1-1')
    expect(clip.find((c) => c.dCol === 0 && c.dRow === 1)!.valueText).toContain('SNP 01-1-2')
  })

  it('pastes a block at the destination anchor in another bank', () => {
    const clip = copySnapshots(OLD, sel('snp:0000', 'snp:0001'))
    // dest anchor in bank 1 at col2,row3 -> 0123 ; second lands at col2,row4 -> 0124
    const out = obj(pasteSnapshots(OLD, clip, sel('snp:0123'), 1))
    expect(out.map.snp['0123'].name).toBe('SNP 01-1-1')
    expect(out.map.snp['0124'].name).toBe('SNP 01-1-2')
    expect(out.map.snp['0000'].name).toBe('SNP 01-1-1') // source intact
  })

  it('broadcasts a single copied snapshot onto every selected slot', () => {
    const clip = copySnapshots(OLD, sel('snp:0000')) // 1 item -> broadcast
    const out = obj(pasteSnapshots(OLD, clip, sel('snp:0010', 'snp:0011'), 0))
    expect(out.map.snp['0010'].name).toBe('SNP 01-1-1')
    expect(out.map.snp['0011'].name).toBe('SNP 01-1-1')
  })

  it('pasting a snapshot selection back onto itself is a no-op', () => {
    const s = sel('snp:0000', 'snp:0002', 'snp:0010')
    expect(pasteSnapshots(OLD, copySnapshots(OLD, s), s, 0)).toBe(OLD)
  })

  it('drops snapshot paste targets that fall off the 4x5 grid', () => {
    const clip = copySnapshots(OLD, sel('snp:0000', 'snp:0020')) // cols 0 and 2, anchor col0
    const out = obj(pasteSnapshots(OLD, clip, sel('snp:0030'), 0)) // anchor col3 -> +2 col5 off-grid
    expect(out.map.snp['0030'].name).toBe('SNP 01-1-1')           // anchor lands
    expect(Object.keys(out.map.snp).filter((k) => Number(k[2]) > 3)).toHaveLength(0)
  })

  it('deletes snapshots via removeControl', () => {
    const out = obj(removeControl(OLD, 'snp', '0000'))
    expect(out.map.snp['0000']).toBeUndefined()
    expect(out.map.snp['0001'].name).toBe('SNP 01-1-2') // siblings intact
  })
})
