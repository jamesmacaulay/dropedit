import { describe, it, expect } from 'vitest'
import { serializeClip, parseClip, CLIP_MARKER, type ClipKind } from '../src/model/clipboard'
import type { CopiedControl } from '../src/model/edits'

const items: CopiedControl[] = [
  { type: 'rotary', dCol: 0, dRow: 0, valueText: '{ "name": "Reverb amount" }' },
  { type: 'fader', dCol: 1, dRow: 0, valueText: null },
]

describe('clipboard payload', () => {
  it('round-trips a control payload', () => {
    const s = serializeClip('control', items)
    expect(JSON.parse(s)._dropedit).toBe(CLIP_MARKER)
    expect(parseClip(s)).toEqual({ kind: 'control', items })
  })

  it('round-trips a snapshot payload', () => {
    expect(parseClip(serializeClip('snapshot', items))?.kind).toBe('snapshot')
  })

  it('rejects foreign / malformed clipboard text', () => {
    expect(parseClip(null)).toBeNull()
    expect(parseClip('')).toBeNull()
    expect(parseClip('just some text')).toBeNull()
    expect(parseClip('{"hello":"world"}')).toBeNull() // valid JSON, not ours
    expect(parseClip(JSON.stringify({ _dropedit: 'other-app', kind: 'control', items }))).toBeNull()
    expect(parseClip(JSON.stringify({ _dropedit: CLIP_MARKER, kind: 'bogus' as ClipKind, items }))).toBeNull()
    expect(parseClip(JSON.stringify({ _dropedit: CLIP_MARKER, kind: 'control', items: 'nope' }))).toBeNull()
  })

  it('rejects a payload whose items have the wrong shape', () => {
    const bad = JSON.stringify({ _dropedit: CLIP_MARKER, kind: 'control', items: [{ type: 'rotary', dCol: '0', dRow: 0, valueText: null }] })
    expect(parseClip(bad)).toBeNull()
    const missing = JSON.stringify({ _dropedit: CLIP_MARKER, kind: 'control', items: [{ type: 'rotary' }] })
    expect(parseClip(missing)).toBeNull()
  })
})
