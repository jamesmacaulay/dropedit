import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { App } from '../src/ui/App'
import { Surface } from '../src/ui/Surface'
import { Sidebar } from '../src/ui/Sidebar'
import { SnapshotGrid } from '../src/ui/SnapshotGrid'
import { parseJson } from '../src/model/jsonDoc'
import { parseBundled } from '../src/data/devices'

const here = dirname(fileURLToPath(import.meta.url))
const EXP = readFileSync(join(here, 'fixtures', 'deluge-exp.json'), 'utf8')
const OLD = readFileSync(join(here, 'fixtures', 'old-daw-init.json'), 'utf8')

describe('UI smoke (renderToString, no DOM)', () => {
  it('App boots into the clean-init blank slate without throwing', () => {
    const html = renderToString(<App />)
    expect(html).toContain('dropedit')
    expect(html).toContain('Clean Init') // init buttons present
    expect(html).toContain('DAW Init')
    expect(html).toContain('Layer 1') // workspace rendered (clean-init loaded), not the empty state
  })

  it('Surface renders controls for a loaded project', () => {
    const doc = parseJson(EXP)
    const html = renderToString(<Surface doc={doc} layer={0} selected={new Set()} onSelect={() => {}} />)
    expect(html).toContain('<svg')
    expect(html).toContain('Col 1')
    expect(html).toContain('AMOUNT') // a control name label
  })

  it('Sidebar single selection: general tab + tab bar', () => {
    const doc = parseJson(EXP)
    const device = parseBundled('synthstrom-deluge')!
    const html = renderToString(<Sidebar text={EXP} doc={doc} deviceFor={() => device} selection={['rotary:000']} defaultColId={0} onChange={() => {}} onSetActive={() => {}} />)
    expect(html).toContain('AMOUNT') // general tab: control name
    expect(html).toContain('General')
    expect(html).toContain('Output slots')
    expect(html).toContain('Groups')
  })

  it('Sidebar shows [multiple values] across a heterogeneous selection', () => {
    const doc = parseJson(EXP)
    const html = renderToString(<Sidebar text={EXP} doc={doc} deviceFor={() => null} selection={['rotary:000', 'rotary:001']} defaultColId={0} onChange={() => {}} onSetActive={() => {}} />)
    expect(html).toContain('2 controls')
    expect(html).toContain('[multiple values]') // AMOUNT vs RATE differ (general tab Name)
  })

  it('SnapshotGrid renders pads and Sidebar shows a snapshot editor', () => {
    const doc = parseJson(OLD)
    const grid = renderToString(<SnapshotGrid doc={doc} bank={0} selected={new Set()} onSelect={() => {}} onPickBank={() => {}} />)
    expect(grid).toContain('Snapshots')
    expect(grid).toContain('class="pad')
    expect(grid).toContain('Bank 1') // bank toggle button
    const side = renderToString(<Sidebar text={OLD} doc={doc} deviceFor={() => null} selection={['snp:0000']} defaultColId={0} onChange={() => {}} onSetActive={() => {}} />)
    expect(side).toContain('Snapshot 0000')
    expect(side).toContain('SNP 01-1-1') // its name
    expect(side).toContain('Save')
    expect(side).toContain('Load')
  })
})
