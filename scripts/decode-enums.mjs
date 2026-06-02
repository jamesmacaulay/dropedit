#!/usr/bin/env node
// Decode the Drop's enum fields (behavId / feedbId / curveId / port) from a single
// "capture" project you build ON THE DEVICE. The capture LAYOUT below pre-assigns a named
// option to a specific control position, so a download decodes automatically — no need to
// report names back. Names come from the Drop manual (v1.01); the device is the source of truth.
//
//   node scripts/decode-enums.mjs instructions      # print the capture checklist
//   node scripts/decode-enums.mjs decode <file.json> [...more.json]   # decode -> {code:name} maps
//
// Build ONE project that fills every section, then `decode` it. Sections are independent, so
// you can also do them in separate projects and pass multiple files.

import { readFileSync } from 'node:fs'

// LED ring styles (rotary turn), in manual v2.01 menu order — 36 options.
const LED_STYLES = [
  'Line from left', 'Line from center', 'Line from right', 'Dot',
  ...Array.from({ length: 24 }, (_, i) => `${i + 2} Steps`), // 2 Steps .. 25 Steps
  'Blank', 'Hue Color',
  'MIDI Col Dot', 'MIDI Col Line from left', 'MIDI Col Line from center', 'MIDI Col Line from right',
  'MIDI Clip LED', 'MIDI Level',
]
// 36 styles > one layer's 32 rotaries, so lay them out row-major starting on LAYER 2 and
// spilling onto LAYER 3 (id = "<layerIndex><col><row>"; layerIndex 1 = "Layer 2").
const ledRows = (names) => names.map((name, idx) => {
  const layer = 1 + Math.floor(idx / 32)
  const p = idx % 32, col = p % 8, row = Math.floor(p / 8)
  return { map: 'rotary', id: `${layer}${col}${row}`, name, how: `Layer ${layer + 1}, ROT col ${col + 1} row ${row + 1}: LED style / ${name}` }
})

// Output curve types, in menu order (captured on hardware). Notes for the eventual UI:
//   - 'Flex' replaces Min/Max with two XY points (XY1/XY2, each {x,y}).
//   - 'Relative 1..4' show a sub-label (signed bit / binary offset / two's complement / signed bit 2)
//     and have no Min/Max; 'Feedback Only' also has Min/Max disabled (input-only slot).
const CURVE_TYPES = [
  'Linear', 'Exp-', 'Exp+', 'Lin Half R', 'Exp- Half R', 'Exp+ Half R', 'Lin Half L', 'Exp- Half L',
  'Exp+ Half L', 'Flex', 'On/Off 50', 'On/Off 25', 'On/Off 75', 'On/Off 1', 'On/Off 99', '3 Steps',
  '4 Steps', '5 Steps', '6 Steps', '7 Steps', '8 Steps', '9 Steps', '10 Steps', '11 Steps',
  '12 Steps', '13 Steps', '14 Steps', '15 Steps', '16 Steps', '25 Steps',
  'Relative 1 (signed bit)', 'Relative 2 (binary offset)', 'Relative 3 (twos complement)', 'Relative 4 (signed bit 2)',
  'Feedback Only',
]
// curves are captured one-per-rotary (slot 1's curveId), row-major from LAYER 4 onto LAYER 5
const curveRows = (names) => names.map((name, idx) => {
  const layer = 3 + Math.floor(idx / 32)
  const p = idx % 32, col = p % 8, row = Math.floor(p / 8)
  return { map: 'rotary', id: `${layer}${col}${row}`, slot: '0', name, how: `Layer ${layer + 1}, ROT col ${col + 1} row ${row + 1}, slot 1: Curve / ${name}` }
})

// pos describes where to read the code from a parsed project:
//   {map:'rotary', id:'000', field:'behavId'}            -> proj.map.rotary['000'].behavId
//   {device:0, field:'portOut'}                           -> proj.device['0'].portOut
//   {map:'rotary', id:'200', slot:'0', field:'curveId'}   -> proj.map.rotary['200']['0'].curveId
const SECTIONS = [
  {
    field: 'behavId',
    title: 'Behavior (behavId) — on LAYER 1',
    intro: 'Behavior differs per control type, so each type is set on its own elements (Layer 1).',
    rows: [
      { map: 'rotary', id: '000', name: 'Precision',     how: 'ROT col 1 row 1: Behavior / Precision' },
      { map: 'rotary', id: '001', name: 'Dynamic Pot',   how: 'ROT col 1 row 2: Behavior / Dynamic Pot' },
      { map: 'rotary', id: '002', name: 'Dynamic Fast',  how: 'ROT col 1 row 3: Behavior / Dynamic Fast' },
      { map: 'rotbut', id: '010', name: 'Toggle',        how: 'ROTBUT col 2 row 1: Behavior / Toggle' },
      { map: 'rotbut', id: '011', name: 'Temporary',     how: 'ROTBUT col 2 row 2: Behavior / Temporary' },
      { map: 'rotbut', id: '012', name: 'Quick Turn',    how: 'ROTBUT col 2 row 3: Behavior / Quick Turn' },
      { map: 'rotbut', id: '013', name: 'Reset Left',    how: 'ROTBUT col 2 row 4: Behavior / Reset Left' },
      { map: 'rotbut', id: '020', name: 'Reset Mid',     how: 'ROTBUT col 3 row 1: Behavior / Reset Mid' },
      { map: 'rotbut', id: '021', name: 'Reset Right',   how: 'ROTBUT col 3 row 2: Behavior / Reset Right' },
      { map: 'rotbut', id: '022', name: 'Reset L/R',     how: 'ROTBUT col 3 row 3: Behavior / Reset L/R' },
      { map: 'rotbut', id: '023', name: 'Reset R/L',     how: 'ROTBUT col 3 row 4: Behavior / Reset R/L' },
      { map: 'mute',   id: '00',  name: 'Toggle',        how: 'MUTE col 1: Behavior / Toggle' },
      { map: 'mute',   id: '01',  name: 'Temporary',     how: 'MUTE col 2: Behavior / Temporary' },
      { map: 'fader',  id: '00',  name: 'One per Layer',  how: 'FADER col 1: Behavior / One per Layer' },
      { map: 'fader',  id: '01',  name: 'Layer A only',   how: 'FADER col 2: Behavior / Layer A only' },
    ],
  },
  {
    field: 'feedbId',
    title: 'LED style (feedbId) — on LAYERS 2 & 3',
    intro: 'LED style applies to rotary-knob turn. Set rotaries row-major (left→right then down):\n    36 styles fill all of Layer 2 (32) then the first 4 of Layer 3.',
    rows: ledRows(LED_STYLES),
  },
  {
    field: 'portOut',
    title: 'Output port (portOut) — in MENU > Devices',
    intro: 'Set the OUTPUT port of the first 6 devices (this decodes the port enum).',
    rows: [
      { device: 0, name: 'USB1', how: 'Device 1: Output / USB1' },
      { device: 1, name: 'USB2', how: 'Device 2: Output / USB2' },
      { device: 2, name: 'TRS1', how: 'Device 3: Output / TRS1' },
      { device: 3, name: 'TRS2', how: 'Device 4: Output / TRS2' },
      { device: 4, name: 'TRS3', how: 'Device 5: Output / TRS3' },
      { device: 5, name: 'TRS4', how: 'Device 6: Output / TRS4' },
    ],
  },
  {
    field: 'portIn',
    title: 'Input port (portIn) — in MENU > Devices  [optional cross-check]',
    intro: 'Optional: set each device’s INPUT to the SAME port as its output. Decodes portIn to confirm\n    it shares the port enum with portOut.',
    rows: [
      { device: 0, name: 'USB1', how: 'Device 1: Input / USB1' },
      { device: 1, name: 'USB2', how: 'Device 2: Input / USB2' },
      { device: 2, name: 'TRS1', how: 'Device 3: Input / TRS1' },
      { device: 3, name: 'TRS2', how: 'Device 4: Input / TRS2' },
      { device: 4, name: 'TRS3', how: 'Device 5: Input / TRS3' },
      { device: 5, name: 'TRS4', how: 'Device 6: Input / TRS4' },
    ],
  },
  {
    field: 'cableIdOut',
    title: 'Virt. Cable indexing (cableIdOut) — in MENU > Devices  [USB only]',
    intro: 'Virt. Cable is a plain number, not a named enum — we just need its indexing. On the two USB\n    devices set Virt. Cable to 1 and 2; the decode shows whether "cable 1" stores as 0 or 1.',
    rows: [
      { device: 0, name: 'you set Virt. Cable = 1', how: 'Device 1 (USB1): Virt. Cable / 1' },
      { device: 1, name: 'you set Virt. Cable = 2', how: 'Device 2 (USB2): Virt. Cable / 2' },
    ],
  },
  {
    field: 'curveId',
    title: 'Curve (curveId) — on LAYERS 4 & 5',
    intro: 'One curve per rotary (set the rotary’s first output slot’s Curve), row-major:\n    35 curve types fill Layers 4 (all 32) then the first 3 of Layer 5.',
    rows: curveRows(CURVE_TYPES),
  },
  {
    field: 'msgType',
    title: 'Message type (msgType) — on LAYER 6 row 3 (+ a mute)',
    intro: 'Set each control’s FIRST output slot Type. Note On is button/snapshot only (so it’s a mute);\n' +
      '    Program Change / Program+Bank are snapshot-only — capture those separately if you want them.',
    rows: [
      { map: 'rotary', id: '502', slot: '0', name: 'CC',             how: 'Layer 6, ROT col 1 row 3, slot 1: Type=CC' },
      { map: 'rotary', id: '512', slot: '0', name: 'CC14',           how: 'Layer 6, ROT col 2 row 3, slot 1: Type=CC14 (MSB first)' },
      { map: 'rotary', id: '522', slot: '0', name: 'CC14 LSB first', how: 'Layer 6, ROT col 3 row 3, slot 1: Type=CC14 LSB first' },
      { map: 'rotary', id: '532', slot: '0', name: 'NRPN',           how: 'Layer 6, ROT col 4 row 3, slot 1: Type=NRPN' },
      { map: 'rotary', id: '542', slot: '0', name: 'Pitch bend',     how: 'Layer 6, ROT col 5 row 3, slot 1: Type=Pitch bend' },
      { map: 'rotary', id: '552', slot: '0', name: 'Aftertouch',     how: 'Layer 6, ROT col 6 row 3, slot 1: Type=Aftertouch' },
      { map: 'mute',   id: '50',  slot: '0', name: 'Note On',        how: 'Layer 6, MUTE col 1, slot 1: Type=Note On' },
    ],
  },
  {
    raw: true, // dump the whole slot object rather than build a code->name map
    title: 'Min/Max + Flex XY encoding — on LAYER 6  [raw inspection]',
    intro: 'One rotary per test; set its FIRST output slot exactly as listed. We read the stored\n' +
      '    minOut/maxOut (and the Flex slot) to learn how displayed values are encoded.',
    rows: [
      { map: 'rotary', id: '500', slot: '0', label: 'CC  Min 0  Max 127',     how: 'Layer 6, ROT col 1 row 1, slot 1: Type=CC,        Min=0,     Max=127' },
      { map: 'rotary', id: '510', slot: '0', label: 'CC  Min 0  Max 64',      how: 'Layer 6, ROT col 2 row 1, slot 1: Type=CC,        Min=0,     Max=64' },
      { map: 'rotary', id: '520', slot: '0', label: 'CC  Min 0  Max 1',       how: 'Layer 6, ROT col 3 row 1, slot 1: Type=CC,        Min=0,     Max=1' },
      { map: 'rotary', id: '530', slot: '0', label: 'CC  Min 64 Max 127',     how: 'Layer 6, ROT col 4 row 1, slot 1: Type=CC,        Min=64,    Max=127' },
      { map: 'rotary', id: '540', slot: '0', label: 'CC14 Min 0 Max 16383',   how: 'Layer 6, ROT col 5 row 1, slot 1: Type=CC14, Min=0,     Max=16383' },
      { map: 'rotary', id: '550', slot: '0', label: 'CC14 Min 0 Max 8191',    how: 'Layer 6, ROT col 6 row 1, slot 1: Type=CC14, Min=0,     Max=8191' },
      { map: 'rotary', id: '560', slot: '0', label: 'NRPN Min 0 Max 16383',   how: 'Layer 6, ROT col 7 row 1, slot 1: Type=NRPN,      Min=0,     Max=16383' },
      { map: 'rotary', id: '570', slot: '0', label: 'Pitchbend Min -8192 Max 8191', how: 'Layer 6, ROT col 8 row 1, slot 1: Type=Pitch bend, Min=-8192, Max=8191' },
      { map: 'rotary', id: '501', slot: '0', label: 'Flex XY1(10,20) XY2(90,100)',  how: 'Layer 6, ROT col 1 row 2, slot 1: Type=CC, Curve=Flex, XY1 x=10 y=20, XY2 x=90 y=100' },
    ],
  },
  {
    raw: true,
    title: 'Snapshot output message types — bank 1  [raw inspection / structure discovery]',
    intro: 'Program Change / Program+Bank are snapshot-only. Save a snapshot on each pad, then map its\n' +
      '    OUTPUT Type as listed (use the distinctive number so it’s easy to spot). We dump the snp\n' +
      '    entry to find WHERE the message type/number live (scene "data" is omitted).',
    rows: [
      { map: 'snp', id: '0000', label: 'Note On (Note# 61)',      how: 'Bank 1, pad col 1 row 1: save snapshot → Mapping: Type=Note On,        Note#=61' },
      { map: 'snp', id: '0001', label: 'Program Change (Prog 77)', how: 'Bank 1, pad col 1 row 2: save snapshot → Mapping: Type=Program Change, Program=77' },
      { map: 'snp', id: '0002', label: 'Program+Bank (Prog 88)',   how: 'Bank 1, pad col 1 row 3: save snapshot → Mapping: Type=Program+Bank,   Program=88' },
    ],
  },
]

function readNode(proj, r) {
  if (r.device != null) return proj?.device?.[String(r.device)]
  let node = proj?.map?.[r.map]?.[r.id]
  if (r.slot != null) node = node?.[r.slot]
  return node
}
function read(proj, r, field) {
  const node = readNode(proj, r)
  return node?.[field]
}

function printInstructions() {
  console.log('\nDrop enum capture — build a project on the device with these settings, then download it.\n')
  console.log('Activate each element first (it must exist in the file), then set the listed option.\n')
  for (const s of SECTIONS) {
    console.log(`■ ${s.title}`)
    console.log(`    ${s.intro}`)
    for (const r of s.rows) console.log(`    - ${r.how}`)
    console.log('')
  }
  console.log('Download the project and run:  node scripts/decode-enums.mjs decode <file.json>\n')
}

function decode(files) {
  const projs = files.map((f) => JSON.parse(readFileSync(f, 'utf8')))
  for (const s of SECTIONS) {
    if (s.raw) { // inspection section: dump the captured objects, don't build a code->name map
      console.log(`\n=== ${s.title.split('  [')[0]} (raw) ===`)
      const show = (n) => JSON.stringify(n && typeof n === 'object' && 'data' in n ? { ...n, data: '…(scene omitted)' } : n)
      for (const r of s.rows) {
        let node
        for (const p of projs) { const n = readNode(p, r); if (n != null) { node = n; break } }
        console.log(`  ${r.label.padEnd(26)} ${node ? show(node) : '(not found)'}`)
      }
      continue
    }
    const map = new Map() // code -> name
    const conflicts = []
    const missing = []
    for (const r of s.rows) {
      let code
      for (const p of projs) { const v = read(p, r, s.field); if (v != null) { code = v; break } }
      if (code == null) { missing.push(r.name); continue }
      if (map.has(code) && map.get(code) !== r.name) conflicts.push(`${code}: "${map.get(code)}" vs "${r.name}"`)
      else map.set(code, r.name)
    }
    console.log(`\n=== ${s.field} ===`)
    const entries = [...map.entries()].sort((a, b) => a[0] - b[0])
    console.log('{')
    for (const [code, name] of entries) console.log(`  ${code}: ${JSON.stringify(name)},`)
    console.log('}')
    if (missing.length) console.log(`  (not found in capture — skipped: ${missing.join(', ')})`)
    if (conflicts.length) console.log(`  ⚠ same code, different option — needs a closer look:\n    ${conflicts.join('\n    ')}`)
  }
  console.log('')
}

const [mode, ...files] = process.argv.slice(2)
if (mode === 'instructions') printInstructions()
else if (mode === 'decode' && files.length) decode(files)
else { console.log('usage: node scripts/decode-enums.mjs instructions | decode <file.json> [...]'); process.exit(1) }
