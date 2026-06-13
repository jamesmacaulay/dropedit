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

// Which CSV row a CC-type slot maps to, for the Parameter dropdown / auto-naming.
//   1. If csvRef carries a reference (its msgId — the two top bits — is non-zero) and its lineNr
//      points at a row whose CC matches, trust it (this also disambiguates devices that repeat a CC).
//   2. Otherwise csvRef wasn't assigned via CSV (msgId 0 = "none"), so fall back to matching on the
//      CC — but only when exactly one row has that CC, to avoid guessing on a duplicate-CC device.
// Returns the rowIndex, or null if the slot can't be identified.
export function slotParamRow(device: PresetDevice | null, msgType: number, csvRef: number, msgNr: number): number | null {
  if (!device || msgType !== 3) return null
  if ((csvRef >>> 30) !== 0) { // msgId != 0 -> csvRef holds a real reference (per firmware)
    const ri = csvRef & 0xfff   // low 12 bits = CSV line number (bits 12-15 are the device index)
    const byRef = device.byRowIndex.get(ri)
    if (byRef && byRef.cc === msgNr) return ri
  }
  const ccMatches = device.params.filter((p) => p.cc === msgNr)
  return ccMatches.length === 1 ? ccMatches[0].rowIndex : null
}

// Derive a Drop control name (<=15 chars) from a preset param's category + name, fitting as much
// of each as possible. Drop caps any name at 15 chars (16-byte buffer incl. the NUL terminator).
// We progressively condense: truncate each word to 3 chars (`shorten`), then keep only first+last
// word (`extraShorten`), trying the least-aggressive combination that fits. The final fallback
// (both extra-shortened) is at most "xxx xxx xxx xxx" = 15 chars, so the result is always <=15.
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
  for (const c of candidates) if (c.length <= 15) return c
  return joinName(extraShorten(cat), extraShorten(param))
}

// csvRef encoding — authoritative, from Neuzeit's firmware source (Slot::csvStamp_build):
//   csvRef = (msgId << 30) | (msgNr << 23) | (msgNrLsb << 16) | (devId << 12) | lineNr
//     bits 30-31  msgId   : 0 = none/empty, 1 = CC, 2 = CC14, 3 = NRPN
//                           (msgId 0 — the two leftmost bits clear — means Drop ignores the ref)
//     bits 23-29  msgNr   : the (MSB) CC / message number, 0-127
//     bits 16-22  msgNrLsb: the LSB CC number for CC14 / NRPN (0 for plain CC)
//     bits 12-15  devId   : target device index, 0-7
//     bits 0-11   lineNr  : CSV row index (0-based, blank lines counted; 12-bit, max 4095)
//   On load the Drop trusts lineNr only if msgNr (and devId) still match, so a swapped database
//   degrades gracefully. No checksum; renaming a control doesn't change it. Our preset DB is
//   CC-based so assignments use msgId = CC. Verified (device 0, CC), e.g.:
//     Delay/Amount cc52 row15 -> 0x5A00000F   Reverb amount cc91 row75 -> 0x6D80004B
//     HPF Freq     cc81 row46 -> 0x6880002E   Master level  cc7  row57 -> 0x43800039
const CSV_MSG_ID: Record<number, number> = { 3: 1, 7: 2, 8: 3 } // CC -> 1, CC14 -> 2, NRPN -> 3 (per firmware)
export function makeCsvRef(rowIndex: number, cc: number, devId = 0, msgType = 3, ccLsb = 0): number {
  const msgId = CSV_MSG_ID[msgType] ?? 0
  return (((msgId & 0x03) << 30) | ((cc & 0x7f) << 23) | ((ccLsb & 0x7f) << 16) | ((devId & 0x0f) << 12) | (rowIndex & 0xfff)) >>> 0
}
