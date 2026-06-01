// Device preset database: parse a midi-main CSV (e.g. Synthstrom/Deluge.csv) into a
// list of parameters with their MIDI CC and CSV row index. The Drop links a control to
// a CSV row via `csvRef`; the parameter's friendly name comes from the CSV too.

export interface PresetParam {
  /** 0-based data-row index (header excluded). This IS the low 16 bits of csvRef. */
  rowIndex: number
  section: string
  /** parameter_name as spelled in the CSV (may contain typos, e.g. "Amonut"). */
  name: string
  /** cc_msb as a number, or null for NRPN-only rows. Becomes a control slot's msgNr. */
  cc: number | null
}

export interface PresetDevice {
  manufacturer: string
  device: string
  params: PresetParam[]
  byRowIndex: Map<number, PresetParam>
}

/** Split one CSV line into fields, honoring "quoted, fields" with "" escapes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = false
      } else cur += c
    } else if (c === '"') inQ = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

export function parsePresetCsv(text: string): PresetDevice {
  const lines = text.split(/\r?\n/)
  const header = splitCsvLine(lines[0]).map((h) => h.trim())
  const col = (name: string) => header.indexOf(name)
  const ci = {
    manufacturer: col('manufacturer'),
    device: col('device'),
    section: col('section'),
    name: col('parameter_name'),
    cc: col('cc_msb'),
  }
  const params: PresetParam[] = []
  const byRowIndex = new Map<number, PresetParam>()
  let manufacturer = ''
  let device = ''
  // rowIndex = (array index) - 1, i.e. position after the header, blanks included,
  // so it stays aligned with how the Drop counts CSV rows (verified against real csvRefs).
  for (let k = 1; k < lines.length; k++) {
    const raw = lines[k]
    if (raw.trim() === '') continue
    const f = splitCsvLine(raw)
    const rowIndex = k - 1
    const section = (f[ci.section] ?? '').trim()
    const name = (f[ci.name] ?? '').trim()
    if (!section && !name) continue
    if (!manufacturer) manufacturer = (f[ci.manufacturer] ?? '').trim()
    if (!device) device = (f[ci.device] ?? '').trim()
    const ccRaw = (f[ci.cc] ?? '').trim()
    const cc = ccRaw === '' ? null : Number(ccRaw)
    const p: PresetParam = { rowIndex, section, name, cc: Number.isNaN(cc as number) ? null : cc }
    params.push(p)
    byRowIndex.set(rowIndex, p)
  }
  return { manufacturer, device, params, byRowIndex }
}

export function paramLabel(p: PresetParam): string {
  return p.section ? `${p.section} / ${p.name}` : p.name
}

// csvRef encoding.
//   VERIFIED: low 16 bits = rowIndex (Amount=15, Rate=16, Reverb amount=75,
//   HPF Freq=46, Master level=57 — exact against the real project).
//   SPIKE: high 16 bits are a checksum/flags (byte[1]=0x80 except on a renamed
//   control where it was 0x00; byte[0] varies per param, not a simple section hash).
//   Not yet reproduced. We write the verified low word only (high word 0). This still
//   produces a fully functional layout — the control's CC (msgNr), channel, and display
//   `name` are independent of csvRef; csvRef is the Drop's re-link/feedback metadata.
//   Centralized here so it's a one-line upgrade once the checksum is solved on hardware.
// Observed samples for the future fix (rowIndex -> full csvRef):
//   15 -> 0x5A00000F (renamed), 16 -> 0x5A800010, 75 -> 0x6D80004B,
//   46 -> 0x6880002E, 57 -> 0x43800039
export function makeCsvRef(rowIndex: number): number {
  return rowIndex >>> 0
}
