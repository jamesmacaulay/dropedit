#!/usr/bin/env node
// FOCUSED capture for ONLY the open spec-vs-app discrepancies (FW 2.05 doc review) — so you don't
// have to repeat the full decode-enums.mjs sweep of things already hardware-verified. Everything
// lives on a fresh area of the device (Layer 8 + snapshot Bank 2) so it can't collide with prior work.
//
//   node scripts/capture-open.mjs instructions          # the short checklist to set on the device
//   node scripts/capture-open.mjs decode <file.json>    # read it back and diff against the app's beliefs
//
// For the LED-style (#4) and behavId (#2) checks the dispute is the *name*, which the file can't tell
// us — so jot the on-screen menu label for those; the decode prints the raw code beside it.

import { readFileSync } from 'node:fs'

// What the app currently believes (the values under test) — used only to annotate the decode.
const APP_CURVE = { 28: '25 Steps', 29: 'Relative 1', 32: 'Relative 4', 33: 'Flex', 34: 'Feedback Only' }
const SPEC_CURVE = { 29: '25 Steps', 30: 'Relative 1', 33: 'Relative 4', 34: 'Flex', 35: 'Feedback only' }
const APP_FEEDB = { 30: 'Hue Color', 31: 'MIDI Level', 32: 'MIDI Clip LED', 33: 'MIDI Col Dot', 34: 'MIDI Col Line from left', 35: 'MIDI Col Line from center', 36: 'MIDI Col Line from right' }
const APP_MSG = { 0: 'Off', 1: 'Note Off', 4: 'Poly Aftertouch', 11: 'Song Position' }

// --- the focused capture layout -------------------------------------------------------------------
// #5 curveId tail — one curve per rotary, Layer 8 row 1, in each rotary's FIRST output slot.
const CURVES = [
  { id: '700', menu: '25 Steps' },
  { id: '710', menu: 'Relative 1' },
  { id: '720', menu: 'Relative 4' },
  { id: '730', menu: 'Flex' },
  { id: '740', menu: 'Feedback Only' },
]
// #4 feedbId tail — Layer 8 row 2. Set knobs to consecutive LED-style menu entries from "Hue Color"
// to the END of the list (however many there are) and note each on-screen name.
const FEEDB_IDS = ['701', '711', '721', '731', '741', '751', '761']
// #6 msgType extras — Layer 8 row 4, FIRST output slot Type. Only the ones your Type menu offers.
const MSGTYPES = [
  { id: '703', menu: 'Off' },
  { id: '713', menu: 'Note Off' },
  { id: '723', menu: 'Poly Aftertouch' },
  { id: '733', menu: 'Song Position' },
]
const FADER_BEHAV = '70'   // #2  Layer 8 fader col 1: set Behavior to the option after "Reset R/L"
const NAME_ID = '702'      // #7  Layer 8 ROT col 1 row 3: name it the 16-char string below
const NAME_TEST = 'ABCDEFGHIJKLMNOP'
const SNP_ID = '0100'      // #8  Bank 2 pad col 1 row 1: save a snapshot, then add ONE output slot

function instructions() {
  const L = (s) => console.log(s)
  L('\nFocused capture — ONLY the open spec-vs-app conflicts. Build on Layer 8 + Bank 2, then export.\n')
  L('#5  CURVES — Layer 8, row 1. For each rotary set its FIRST output slot’s Curve:')
  CURVES.forEach((c, i) => L(`      ROT col ${i + 1} row 1  →  Curve / ${c.menu}`))
  L('\n#4  LED STYLES — Layer 8, row 2. Set each knob to consecutive LED-style menu entries, starting')
  L('      at "Hue Color" and going to the END of the list. WRITE DOWN each on-screen name in order:')
  FEEDB_IDS.forEach((_, i) => L(`      ROT col ${i + 1} row 2  →  LED style / entry ${i + 1} (Hue Color = entry 1)   name: __________`))
  L('\n#6  MSG TYPES — Layer 8, row 4. FIRST output slot Type — ONLY if your Type menu lists it:')
  MSGTYPES.forEach((m, i) => L(`      ROT col ${i + 1} row 4  →  Type / ${m.menu}`))
  L('\n#2  BEHAVIOR — Layer 8, FADER col 1. Set Behavior to the option right after "Reset R/L".')
  L('      WRITE DOWN its on-screen name: __________   (app calls it "One per Layer")')
  L(`\n#7  NAME — Layer 8, ROT col 1 row 3. Name it exactly (16 chars):  ${NAME_TEST}`)
  L('\n#8  SNAPSHOT — Bank 2, pad col 1 row 1. Save a snapshot there, then add ONE output slot to it')
  L('      (any Type/CC). We just need to see where the slot lands in the file.')
  L('\nExport, then:  node scripts/capture-open.mjs decode <file.json>\n')
}

function decode(file) {
  const p = JSON.parse(readFileSync(file, 'utf8'))
  const rotSlot = (id) => p?.map?.rotary?.[id]?.['0']
  const mark = (got, want) => (got === want ? '✓' : '✗')

  console.log('\n#5  curveId tail  (app vs spec; ✓ = matches that side)')
  for (const c of CURVES) {
    const code = rotSlot(c.id)?.curveId
    if (code == null) { console.log(`   ${c.menu.padEnd(16)} (not found — ${c.id})`); continue }
    const appCode = Object.keys(APP_CURVE).find((k) => APP_CURVE[k] === c.menu)
    const specCode = Object.keys(SPEC_CURVE).find((k) => SPEC_CURVE[k] === c.menu || SPEC_CURVE[k] === c.menu.toLowerCase())
    console.log(`   ${c.menu.padEnd(16)} code=${String(code).padStart(2)}   app=${appCode}${mark(+appCode, code)}  spec=${specCode}${mark(+specCode, code)}`)
  }

  console.log('\n#4  feedbId tail  (raw codes — match against the names you wrote down)')
  for (const id of FEEDB_IDS) {
    const code = p?.map?.rotary?.[id]?.feedbId
    if (code == null) continue
    console.log(`   ${id}: feedbId=${code}   app-label: ${APP_FEEDB[code] ?? '(none — app has no label here)'}`)
  }

  console.log('\n#6  msgType extras  (confirms the labels we added; check value range with a stored Min/Max)')
  for (const m of MSGTYPES) {
    const slot = rotSlot(m.id)
    if (slot?.msgType == null) { console.log(`   ${m.menu.padEnd(16)} (not found / not in Type menu)`); continue }
    console.log(`   ${m.menu.padEnd(16)} msgType=${slot.msgType}  app-label: ${APP_MSG[slot.msgType] ?? '(unlabeled)'}   minOut=${slot.minOut} maxOut=${slot.maxOut}`)
  }

  console.log('\n#2  behavId  (raw code — match against the name you wrote down)')
  const bh = p?.map?.fader?.[FADER_BEHAV]?.behavId
  console.log(`   fader ${FADER_BEHAV}: behavId=${bh ?? '(not found)'}   app calls 11 = "One per Layer", spec calls 11 = "Layer AB dual"`)

  console.log('\n#7  name length')
  const nm = p?.map?.rotary?.[NAME_ID]?.name
  console.log(`   ${NAME_ID}: name=${JSON.stringify(nm)}  length=${nm?.length ?? 0}   (typed 16; spec says max 15)`)

  console.log('\n#8  snapshot slot placement  (key order inside the snp entry)')
  const snp = p?.map?.snp?.[SNP_ID]
  if (!snp) console.log(`   ${SNP_ID}: (not found)`)
  else {
    const keys = Object.keys(snp)
    const slotKeys = keys.filter((k) => /^\d+$/.test(k))
    const dataIdx = keys.indexOf('data')
    const firstSlotIdx = keys.indexOf(slotKeys[0])
    console.log(`   ${SNP_ID} keys: [${keys.join(', ')}]`)
    if (slotKeys.length && dataIdx >= 0)
      console.log(`   → output slot(s) ${slotKeys.join(',')} come ${firstSlotIdx < dataIdx ? 'BEFORE' : 'AFTER'} "data"  (app currently writes them AFTER; spec example shows BEFORE)`)
  }
  console.log('')
}

const [mode, file] = process.argv.slice(2)
if (mode === 'instructions') instructions()
else if (mode === 'decode' && file) decode(file)
else { console.log('usage: node scripts/capture-open.mjs instructions | decode <file.json>'); process.exit(1) }
