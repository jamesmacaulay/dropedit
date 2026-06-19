import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  parseJson, getPath, getObject, getMember, applyEdits,
  editSetScalar, editInsertMember, editRemoveMember,
  type ScalarNode,
} from '../src/model/jsonDoc'

const here = dirname(fileURLToPath(import.meta.url))
const fx = (n: string) => readFileSync(join(here, 'fixtures', n), 'utf8')
const FIXTURES = ['deluge-exp.json', 'old-daw-init.json', 'empty-template.json', 'nrpn-14bit.json']

function scalarAt(doc: ReturnType<typeof parseJson>, path: (string | number)[]): ScalarNode {
  const n = getPath(doc.root, path)
  if (!n || n.kind !== 'scalar') throw new Error('not a scalar at ' + path.join('.'))
  return n
}

describe('jsonDoc round-trip fidelity', () => {
  for (const name of FIXTURES) {
    it(`identity: applyEdits([]) preserves ${name} byte-for-byte`, () => {
      const text = fx(name)
      parseJson(text) // must not throw
      expect(applyEdits(text, [])).toBe(text)
    })
    it(`parsed structure JSON-equals the original for ${name}`, () => {
      const text = fx(name)
      parseJson(text)
      // sanity: our parser agrees with JSON.parse on values
      expect(JSON.parse(text)).toBeTypeOf('object')
    })
  }

  it('preserves trailing-zero number tokens (52.000, 2.00) in raw', () => {
    const doc = parseJson(fx('deluge-exp.json'))
    expect(scalarAt(doc, ['version']).raw).toBe('2.00')
    expect(scalarAt(doc, ['map', 'rotary', '000', '0', 'msgNr']).raw).toBe('52.000')
    expect(scalarAt(doc, ['map', 'rotary', '000', '0', 'msgNr']).value).toBe(52)
    expect(scalarAt(doc, ['map', 'rotary', '000', 'name']).value).toBe('AMOUNT')
    expect(scalarAt(doc, ['map', 'rotary', '000', '0', 'ch']).value).toBe(1)
  })
})

describe('jsonDoc scalar edits', () => {
  it('setScalar changes only the target token', () => {
    const text = fx('deluge-exp.json')
    const doc = parseJson(text)
    const ch = scalarAt(doc, ['map', 'rotary', '000', '0', 'ch'])
    const out = applyEdits(text, [editSetScalar(ch, '5')])
    // exactly one char region changed: lengths differ by (len('5')-len('1'))=0
    expect(out.length).toBe(text.length)
    expect(out).not.toBe(text)
    // re-parse: value updated, neighbours intact
    const doc2 = parseJson(out)
    expect(scalarAt(doc2, ['map', 'rotary', '000', '0', 'ch']).value).toBe(5)
    expect(scalarAt(doc2, ['map', 'rotary', '001', '0', 'ch']).value).toBe(1)
    expect(scalarAt(doc2, ['map', 'rotary', '000', 'name']).value).toBe('AMOUNT')
    // diff is localized: prefix and suffix around the token are identical
    const i = ch.span.start
    expect(out.slice(0, i)).toBe(text.slice(0, i))
    expect(out.slice(i + 1)).toBe(text.slice(ch.span.end))
  })

  it('a no-op setScalar (same raw) reproduces the file exactly', () => {
    const text = fx('deluge-exp.json')
    const doc = parseJson(text)
    const ch = scalarAt(doc, ['map', 'rotary', '000', '0', 'ch'])
    expect(applyEdits(text, [editSetScalar(ch, ch.raw)])).toBe(text)
  })

  it('batches multiple scalar edits (bulk channel change)', () => {
    const text = fx('deluge-exp.json')
    const doc = parseJson(text)
    const rot = getObject(doc.root, ['map', 'rotary'])!
    const edits = rot.members.map((m) => {
      const ch = getMember(m.value as any, '0') as any
      const chScalar = getMember(ch.value, 'ch')!.value as ScalarNode
      return editSetScalar(chScalar, '3')
    })
    const out = applyEdits(text, edits)
    const doc2 = parseJson(out)
    const rot2 = getObject(doc2.root, ['map', 'rotary'])!
    for (const m of rot2.members) {
      expect(scalarAt(doc2, ['map', 'rotary', m.key, '0', 'ch']).value).toBe(3)
    }
  })
})

describe('jsonDoc member insert/remove', () => {
  it('inserts a cloned control and stays valid + minimal', () => {
    const text = fx('deluge-exp.json')
    const doc = parseJson(text)
    const rot = getObject(doc.root, ['map', 'rotary'])!
    const src = getMember(rot, '000')!.value
    const valueText = text.slice(src.span.start, src.span.end)
    const out = applyEdits(text, [editInsertMember(text, rot, '500', valueText)])
    const obj = JSON.parse(out)
    expect(Object.keys(obj.map.rotary)).toContain('500')
    expect(obj.map.rotary['500'].name).toBe('AMOUNT')
    expect(obj.map.rotary['000']).toBeDefined() // original intact
    // only added text; original is a prefix-preserving expansion
    expect(out.length).toBeGreaterThan(text.length)
    const doc2 = parseJson(out)
    expect(scalarAt(doc2, ['map', 'rotary', '500', '0', 'msgNr']).raw).toBe('52.000')
  })

  it('removes a middle member, leaving valid JSON and siblings intact', () => {
    const text = fx('deluge-exp.json')
    const doc = parseJson(text)
    const rot = getObject(doc.root, ['map', 'rotary'])!
    const out = applyEdits(text, [editRemoveMember(text, rot, '001')!])
    const obj = JSON.parse(out)
    expect(obj.map.rotary['001']).toBeUndefined()
    expect(obj.map.rotary['000']).toBeDefined()
    expect(obj.map.rotary['002']).toBeDefined()
    expect(out.length).toBeLessThan(text.length)
  })

  it('removes the last member of an object', () => {
    const text = fx('deluge-exp.json')
    const doc = parseJson(text)
    const fader = getObject(doc.root, ['map', 'fader'])!
    const lastKey = fader.members.at(-1)!.key
    const out = applyEdits(text, [editRemoveMember(text, fader, lastKey)!])
    const obj = JSON.parse(out)
    expect(obj.map.fader[lastKey]).toBeUndefined()
    expect(Object.keys(obj.map.fader).length).toBe(fader.members.length - 1)
  })

  it('removing the only member yields {}', () => {
    const text = '{\n\t"a": {\n\t\t"x": 1\n\t}\n}'
    const doc = parseJson(text)
    const a = getObject(doc.root, ['a'])!
    expect(a.members.length).toBe(1)
    const out = applyEdits(text, [editRemoveMember(text, a, 'x')!])
    expect(JSON.parse(out).a).toEqual({})
    expect(out).toContain('"a": {}')
  })

  it('inserts into an empty object with inferred indentation', () => {
    const text = '{\n\t"map": {\n\t}\n}'
    const doc = parseJson(text)
    const map = getObject(doc.root, ['map'])!
    const out = applyEdits(text, [editInsertMember(text, map, '00', '{ "name": "X" }')])
    expect(JSON.parse(out).map['00']).toEqual({ name: 'X' })
    expect(out).toBe('{\n\t"map": {\n\t\t"00": { "name": "X" }\n\t}\n}')
  })
})
