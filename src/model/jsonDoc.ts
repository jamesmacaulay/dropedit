// Span-preserving JSON parser + splice-based editing.
//
// Why not JSON.parse/JSON.stringify? A Drop project must round-trip byte-for-byte
// for everything the user didn't touch: it uses tab indentation, trailing-zero floats
// (`52.000`, `2.00`), specific key order, and even inconsistent empty objects
// (`{}` vs `{\n\t\t}`). A regenerating printer can't reproduce all that. Instead we
// parse to a tree that records each node's exact source span, express edits as text
// splices on the original string, and re-parse after applying. Untouched bytes are
// preserved exactly; diffs stay minimal.

export interface Span { start: number; end: number }

export interface ScalarNode { kind: 'scalar'; span: Span; raw: string; value: string | number | boolean | null }
export interface ArrayNode { kind: 'array'; span: Span; items: JsonNode[] }
export interface Member {
  key: string
  keySpan: Span
  value: JsonNode
  /** span covering `"key": value` (not surrounding whitespace or comma) */
  span: Span
  /** source index of the comma following this member, or -1 if none */
  commaAfter: number
}
export interface ObjectNode { kind: 'object'; span: Span; open: number; close: number; members: Member[] }
export type JsonNode = ScalarNode | ArrayNode | ObjectNode

export interface JsonDoc { text: string; root: JsonNode }

export function parseJson(text: string): JsonDoc {
  let i = 0
  const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r'
  function ws() { while (i < text.length && isWs(text[i])) i++ }

  function parseString(): ScalarNode {
    const start = i
    i++ // opening quote
    while (i < text.length) {
      const c = text[i]
      if (c === '\\') { i += 2; continue }
      if (c === '"') { i++; break }
      i++
    }
    const raw = text.slice(start, i)
    return { kind: 'scalar', span: { start, end: i }, raw, value: JSON.parse(raw) as string }
  }

  function parseLiteral(): ScalarNode {
    const start = i
    while (i < text.length && !isWs(text[i]) && text[i] !== ',' && text[i] !== '}' && text[i] !== ']') i++
    const raw = text.slice(start, i)
    let value: number | boolean | null
    if (raw === 'true') value = true
    else if (raw === 'false') value = false
    else if (raw === 'null') value = null
    else value = Number(raw)
    return { kind: 'scalar', span: { start, end: i }, raw, value }
  }

  function parseArray(): ArrayNode {
    const start = i
    i++ // [
    const items: JsonNode[] = []
    ws()
    if (text[i] === ']') { i++; return { kind: 'array', span: { start, end: i }, items } }
    while (i < text.length) {
      items.push(parseValue())
      ws()
      if (text[i] === ',') { i++; ws(); continue }
      if (text[i] === ']') { i++; break }
      break
    }
    return { kind: 'array', span: { start, end: i }, items }
  }

  function parseObject(): ObjectNode {
    const start = i
    const open = i
    i++ // {
    const members: Member[] = []
    ws()
    if (text[i] === '}') { const close = i; i++; return { kind: 'object', span: { start, end: i }, open, close, members } }
    while (i < text.length) {
      ws()
      const keyNode = parseString()
      ws()
      if (text[i] === ':') i++
      const value = parseValue()
      ws()
      let commaAfter = -1
      if (text[i] === ',') { commaAfter = i; i++ }
      members.push({ key: keyNode.value as string, keySpan: keyNode.span, value, span: { start: keyNode.span.start, end: value.span.end }, commaAfter })
      ws()
      if (text[i] === '}') break
      if (commaAfter === -1) break // malformed; stop defensively
    }
    const close = i
    i++ // }
    return { kind: 'object', span: { start, end: i }, open, close, members }
  }

  function parseValue(): JsonNode {
    ws()
    const c = text[i]
    if (c === '{') return parseObject()
    if (c === '[') return parseArray()
    if (c === '"') return parseString()
    return parseLiteral()
  }

  const root = parseValue()
  return { text, root }
}

// ---- navigation ----------------------------------------------------------
export function getMember(obj: ObjectNode, key: string): Member | undefined {
  return obj.members.find((m) => m.key === key)
}

export function getPath(node: JsonNode, path: (string | number)[]): JsonNode | undefined {
  let cur: JsonNode | undefined = node
  for (const seg of path) {
    if (!cur) return undefined
    if (typeof seg === 'number') {
      if (cur.kind !== 'array') return undefined
      cur = cur.items[seg]
    } else {
      if (cur.kind !== 'object') return undefined
      cur = getMember(cur, seg)?.value
    }
  }
  return cur
}

export function getObject(node: JsonNode, path: (string | number)[]): ObjectNode | undefined {
  const n = getPath(node, path)
  return n && n.kind === 'object' ? n : undefined
}

// ---- edits ---------------------------------------------------------------
export interface Edit { start: number; end: number; text: string }

/** Apply non-overlapping edits to text (order-independent input). */
export function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end)
  let out = ''
  let pos = 0
  for (const e of sorted) {
    if (e.start < pos) throw new Error(`overlapping edit at ${e.start} (pos ${pos})`)
    out += text.slice(pos, e.start) + e.text
    pos = e.end
  }
  return out + text.slice(pos)
}

/** Replace a scalar's source with a new raw token (caller formats the value). */
export function editSetScalar(scalar: ScalarNode, rawValue: string): Edit {
  return { start: scalar.span.start, end: scalar.span.end, text: rawValue }
}

function lineIndentBefore(text: string, pos: number): string {
  const nl = text.lastIndexOf('\n', pos - 1)
  return text.slice(nl + 1, pos).replace(/[^\t ].*$/s, '') // leading whitespace run only
}
function newlineLeadBefore(text: string, pos: number): string {
  const nl = text.lastIndexOf('\n', pos - 1)
  return nl < 0 ? '' : text.slice(nl, pos) // newline + indentation
}

/** Insert (or replace) a member `"key": valueText` into an object. */
export function editInsertMember(text: string, obj: ObjectNode, key: string, valueText: string): Edit {
  const keyText = JSON.stringify(key)
  const memberText = `${keyText}: ${valueText}`
  if (obj.members.length === 0) {
    const closeIndent = lineIndentBefore(text, obj.close)
    const memberIndent = closeIndent + '\t'
    return { start: obj.open + 1, end: obj.close, text: `\n${memberIndent}${memberText}\n${closeIndent}` }
  }
  const last = obj.members[obj.members.length - 1]
  const lead = newlineLeadBefore(text, last.span.start) || '\n'
  return { start: last.span.end, end: last.span.end, text: `,${lead}${memberText}` }
}

/** Remove a member by key (handles commas + leading whitespace; empties → `{}`). */
export function editRemoveMember(text: string, obj: ObjectNode, key: string): Edit | null {
  const idx = obj.members.findIndex((m) => m.key === key)
  if (idx < 0) return null
  const members = obj.members
  const m = members[idx]
  if (members.length === 1) {
    return { start: obj.open, end: obj.close + 1, text: '{}' }
  }
  if (idx < members.length - 1) {
    const left = idx === 0 ? obj.open + 1 : members[idx - 1].commaAfter + 1
    const right = m.commaAfter + 1 // include this member's trailing comma
    return { start: left, end: right, text: '' }
  }
  // last member: remove the preceding comma + this member
  const left = members[idx - 1].commaAfter
  return { start: left, end: m.span.end, text: '' }
}
