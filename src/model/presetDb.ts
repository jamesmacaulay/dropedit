// Device preset database: parse a midi-main CSV (e.g. Synthstrom/Deluge.csv) into a
// list of parameters with their MIDI CC and CSV row index. The Drop links a control to
// a CSV row via `csvRef`; the parameter's friendly name comes from the CSV too.

export interface PresetParam {
  /** 0-based data-row index (header excluded). This IS the low 16 bits of csvRef. */
  rowIndex: number
  section: string
  /** parameter_name exactly as spelled in the CSV (vendored verbatim, so it may contain typos). */
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

// Derive a Drop control name (<=16 chars) from a preset param's category + name, fitting as much
// of each as possible. Drop caps any name at 16 chars. We progressively condense: truncate each
// word to 3 chars (`shorten`), then keep only first+last word (`extraShorten`), trying the
// least-aggressive combination that fits. The final fallback (both extra-shortened) is at most
// "xxx xxx xxx xxx" = 15 chars, so the result is always <=16.
const shortenedWords = (s: string): string[] => s.split(' ').filter((w) => w !== '').map((w) => w.slice(0, 3))
const shorten = (s: string): string => shortenedWords(s).join(' ')
const extraShorten = (s: string): string => {
  const w = shortenedWords(s)
  return w.length <= 1 ? (w[0] ?? '') : `${w[0]} ${w[w.length - 1]}`
}
// join with a single space, dropping empty parts (e.g. params with no category)
const joinName = (a: string, b: string): string => [a, b].filter((s) => s !== '').join(' ')

export function deriveControlName(category: string, name: string): string {
  let cat = category.trim()
  const param = name.trim()
  // if the category just repeats the start of the param name ("Reverb" + "Reverb amount"), drop it
  // and fit the param name alone — avoids silly doubled results like "Rev Rev amo".
  const lcat = cat.toLowerCase(), lparam = param.toLowerCase()
  if (cat !== '' && (lparam === lcat || lparam.startsWith(lcat + ' '))) cat = ''
  const candidates: string[] = []
  // a long category should never hog the budget at the param name's expense — once it's >=8 chars,
  // always condense it at least with `shorten` (never use the whole thing).
  if (cat.length < 8) candidates.push(joinName(cat, param))
  candidates.push(
    joinName(shorten(cat), param),
    joinName(shorten(cat), shorten(param)),
    joinName(extraShorten(cat), param),
    joinName(extraShorten(cat), shorten(param)),
  )
  for (const c of candidates) if (c.length <= 16) return c
  return joinName(extraShorten(cat), extraShorten(param))
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
