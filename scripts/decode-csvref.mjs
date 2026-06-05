#!/usr/bin/env node
// Reverse-engineer the Drop's csvRef encoding from a HARDWARE capture.
//
// csvRef (per the firmware docs) is a CSV-lookup cache. We've verified the LOW 16 bits = the CSV row
// index. The HIGH 16 bits are an unknown checksum/flags we don't yet reproduce. To crack them we need
// GROUND TRUTH: a project where YOU mapped knobs to CSV presets ON THE DROP and exported it — AND
// where the Drop assigned them from the SAME preset CSV this repo bundles. If the Drop's CSV differs
// by even one byte/row, the row indices won't line up and the analysis is meaningless.
//
//   node scripts/decode-csvref.mjs instructions [Manufacturer/Device]   # checklist (+ DB-match step)
//   node scripts/decode-csvref.mjs decode <file.json> [Manufacturer/Device]   # analyse a hardware export
//
// Default device: Synthstrom/Deluge.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const DEVDIR = join(here, '..', 'src', 'data', 'devices')
const DEFAULT_DEVICE = 'Synthstrom/Deluge'

// CSV line split honoring "quoted, fields" with "" escapes (same as src/model/presetDb.ts).
function splitCsvLine(line) {
  const out = []; let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false } else cur += c }
    else if (c === '"') inQ = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur); return out
}

// rowIndex = (array index after header, blanks included) - matches how the Drop counts CSV rows
// and how presetDb assigns rowIndex, so it equals the low 16 bits of csvRef.
function loadCsv(devPath) {
  const [manuf, device] = devPath.split('/')
  const text = readFileSync(join(DEVDIR, manuf, `${device}.csv`), 'utf8')
  const lines = text.split(/\r?\n/)
  const hdr = splitCsvLine(lines[0]).map((h) => h.trim())
  const ci = { sec: hdr.indexOf('section'), nm: hdr.indexOf('parameter_name'), cc: hdr.indexOf('cc_msb') }
  const rows = new Map() // rowIndex -> {section,name,cc,line}
  const params = []      // CC-bearing params only, for the suggested capture list
  for (let k = 1; k < lines.length; k++) {
    const raw = lines[k]; if (raw.trim() === '') continue
    const f = splitCsvLine(raw)
    const rowIndex = k - 1
    const section = (f[ci.sec] ?? '').trim(), name = (f[ci.nm] ?? '').trim()
    const ccRaw = (f[ci.cc] ?? '').trim()
    rows.set(rowIndex, { section, name, cc: ccRaw, line: raw })
    if (/^\d+$/.test(ccRaw)) params.push({ rowIndex, section, name, cc: Number(ccRaw) })
  }
  return { manuf, device, devPath, rows, params }
}

// A diverse spread to map by hand: a cluster from one section (does the high word vary within a
// section?), then one from each of many other sections (does it depend on section?), spanning CCs.
function suggestedParams(csv) {
  const bySection = new Map()
  for (const p of csv.params) { if (!bySection.has(p.section)) bySection.set(p.section, []); bySection.get(p.section).push(p) }
  const sections = [...bySection.keys()]
  const pick = []
  const cluster = bySection.get(sections[0]) ?? []
  pick.push(...cluster.slice(0, 6)) // intra-section cluster
  for (const s of sections.slice(1)) { const g = bySection.get(s); if (g?.length) pick.push(g[0]) } // 1 per other section
  // de-dup + cap to fit comfortably on a layer or two
  const seen = new Set(), out = []
  for (const p of pick) { const k = p.rowIndex; if (!seen.has(k)) { seen.add(k); out.push(p) } if (out.length >= 28) break }
  return out
}

function printInstructions(devPath) {
  const csv = loadCsv(devPath)
  const picks = suggestedParams(csv)
  console.log(`\nDrop csvRef capture — ${csv.devPath}\n`)
  console.log('STEP 0 — MATCH THE PRESET DB (critical):')
  console.log(`  Copy THIS repo's exact CSV onto the Drop's SD card so the Drop assigns from identical bytes:`)
  console.log(`    src/data/devices/${csv.devPath}.csv   ->   <SD>/midi-main/${csv.manuf}/${csv.device}.csv`)
  console.log(`  (This repo is pinned to pencilresearch/midi commit 0995e3ae… — see src/data/devices/SOURCE.md.)\n`)
  console.log('STEP 1 — set up a device:')
  console.log(`  MENU > Devices > Device 1: enable it and load the CSV preset (${csv.manuf} / ${csv.device}).\n`)
  console.log('STEP 2 — map knobs to presets (Layer 1, output slot 1, via the CSV preset lookup).')
  console.log('  Leave each knob at its DEFAULT name (do NOT rename) — except the last two, which you SHOULD rename.')
  console.log('  Map as many as you like; more samples = better. Suggested diverse set:\n')
  picks.forEach((p, i) => {
    const col = i % 8, row = Math.floor(i / 8)
    const rename = i >= picks.length - 2 ? '   <-- after mapping, RENAME this knob to anything' : ''
    console.log(`    ROT col ${col + 1} row ${row + 1}:  ${p.section} / ${p.name}  (CC ${p.cc})${rename}`)
  })
  console.log('\nSTEP 3 — download the project, then run:')
  console.log(`  node scripts/decode-csvref.mjs decode <file.json> ${csv.devPath}\n`)
}

// ---- analysis: collect every CC slot with a non-zero csvRef, cross-ref the CSV, verify the encoding --

function decode(file, devPath) {
  const csv = loadCsv(devPath)
  const proj = JSON.parse(readFileSync(file, 'utf8'))
  const samples = []
  for (const type of ['rotary', 'rotbut', 'fader', 'mute']) {
    const m = proj.map?.[type] ?? {}
    for (const id of Object.keys(m)) {
      const c = m[id]
      for (const sk of Object.keys(c)) {
        if (!/^[0-7]$/.test(sk)) continue
        const s = c[sk]; const ref = (s.csvRef ?? 0) >>> 0
        if (!ref) continue
        const row = ref & 0xffff, b1 = (ref >>> 16) & 0xff, b0 = (ref >>> 24) & 0xff
        const r = csv.rows.get(row)
        samples.push({ type, id, slot: sk, ref, b0, b1, row, ctlName: c.name ?? '', msgType: s.msgType, msgNr: s.msgNr, r })
      }
    }
  }
  if (!samples.length) { console.log('No non-zero csvRefs found in', file); return }

  console.log(`\n${samples.length} csvRef sample(s) from ${file}  (device ${csv.devPath})\n`)
  console.log('b0 b1 |  row | cc(slot) | section / param (from CSV)          | renamed? | ctl name')
  let mismatches = 0
  for (const s of samples.sort((a, b) => a.row - b.row)) {
    const csvCc = s.r ? s.r.cc : '?'
    const ccOk = s.r && String(s.msgNr) === String(csvCc)
    if (!ccOk) mismatches++
    const renamed = s.r ? (s.ctlName !== s.r.name ? 'yes' : 'no') : '?'
    console.log(
      `${hex(s.b0)} ${hex(s.b1)} | ${String(s.row).padStart(4)} | ${String(s.msgNr).padStart(3)}${ccOk ? ' ' : '≠'}${String(csvCc).padStart(3)} | ${((s.r ? `${s.r.section} / ${s.r.name}` : '(row not in CSV!)')).padEnd(34)} | ${renamed.padEnd(8)} | ${s.ctlName}`,
    )
  }
  if (mismatches) {
    console.log(`\n⚠ ${mismatches} slot(s): the slot's CC doesn't match the CSV row's CC. The Drop's CSV`)
    console.log(`  probably differs from this repo's — re-do STEP 0 (match the preset DB) before trusting this.\n`)
  }

  // Verify the SOLVED encoding holds for every sample: csvRef = 0x40000000 | (cc<<23) | rowIndex.
  // (Re-run on a new device/firmware to catch any deviation.)
  const expect = (cc, row) => (0x40000000 | ((cc & 0xff) << 23) | (row & 0xffff)) >>> 0
  console.log('\n--- verify  csvRef == 0x40000000 | (cc<<23) | rowIndex ---')
  let bad = 0
  for (const s of samples) {
    const want = expect(Number(s.msgNr), s.row)
    if (want !== s.ref) { bad++; console.log(`  ✗ row ${s.row} cc ${s.msgNr}: got ${hexw(s.ref)} expected ${hexw(want)}`) }
  }
  console.log(bad ? `  ⚠ ${bad}/${samples.length} did NOT match the formula — encoding differs here, investigate.`
    : `  ✅ all ${samples.length} samples match the formula.`)
  console.log('')
}

const hex = (n) => n.toString(16).padStart(2, '0')
const hexw = (n) => '0x' + (n >>> 0).toString(16).padStart(8, '0')

const [mode, ...rest] = process.argv.slice(2)
if (mode === 'instructions') printInstructions(rest[0] || DEFAULT_DEVICE)
else if (mode === 'decode' && rest[0]) decode(rest[0], rest[1] || DEFAULT_DEVICE)
else { console.log('usage: node scripts/decode-csvref.mjs instructions [Manuf/Device] | decode <file.json> [Manuf/Device]'); process.exit(1) }
