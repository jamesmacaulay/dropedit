import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { App } from '../src/ui/App'
import { Surface } from '../src/ui/Surface'
import { Sidebar, SnapshotEditPanel } from '../src/ui/Sidebar'
import { SnapshotGrid, SnapshotMeta } from '../src/ui/SnapshotGrid'
import { parseJson } from '../src/model/jsonDoc'
import { loadBundled } from '../src/data/devices'

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
    // CC-BY-SA-4.0 attribution for the bundled device DB must be visible in the app
    expect(html).toContain('pencilresearch/midi')
    expect(html).toContain('CC')
    expect(html).toContain('creativecommons.org/licenses/by-sa/4.0')
    // header has the GitHub source link; undo/redo moved out of the header into the ops row
    const header = html.slice(0, html.indexOf('class="workspace"'))
    expect(header).toContain('github.com/jamesmacaulay/dropedit')
    expect(header).not.toContain('Undo')
    expect(html).toContain('Undo') // still rendered (now under the control layout)
    expect(html).toContain('Redo')
    // editable file name input, bound to the current name (drives the download filename)
    expect(header).toContain('class="filename"')
    expect(header).toContain('value="clean-init.json"')
  })

  it('Surface renders controls for a loaded project', () => {
    const doc = parseJson(EXP)
    const html = renderToString(<Surface doc={doc} layer={0} selected={new Set()} onSelect={() => {}} />)
    expect(html).toContain('<svg')
    expect(html).toContain('Col 1')
    expect(html).toContain('AMOUNT') // a control name label
  })

  it('Sidebar single selection: general tab + tab bar', async () => {
    const doc = parseJson(EXP)
    const device = (await loadBundled('synthstrom-deluge'))!
    const html = renderToString(<Sidebar text={EXP} doc={doc} deviceFor={() => device} selection={['rotary:000']} defaultColId={0} onChange={() => {}} onSetActive={() => {}} />)
    expect(html).toContain('AMOUNT') // general tab: control name
    expect(html).toContain('General')
    expect(html).toContain('Output slots')
    expect(html).toContain('Groups')
    // Behavior is now a decoded dropdown (behavId 1 = Dynamic Pot) with a Custom fallback
    expect(html).toContain('Dynamic Pot')
    expect(html).toContain('Custom…')
  })

  it('Sidebar shows [multiple values] across a heterogeneous selection', () => {
    const doc = parseJson(EXP)
    const html = renderToString(<Sidebar text={EXP} doc={doc} deviceFor={() => null} selection={['rotary:000', 'rotary:001']} defaultColId={0} onChange={() => {}} onSetActive={() => {}} />)
    expect(html).toContain('2 controls')
    expect(html).toContain('[multiple values]') // AMOUNT vs RATE differ (general tab Name)
  })

  it('Sidebar ignores inactive controls when deciding shared values', () => {
    const doc = parseJson(EXP)
    // rotary:000 is active (AMOUNT); rotary:150 is unmapped (inactive, layer 1 is empty)
    const html = renderToString(<Sidebar text={EXP} doc={doc} deviceFor={() => null} selection={['rotary:000', 'rotary:150']} defaultColId={0} onChange={() => {}} onSetActive={() => {}} />)
    expect(html).toContain('2 controls')
    expect(html).toContain('AMOUNT')            // shows the single active control's value...
    expect(html).not.toContain('[multiple values]') // ...not "[multiple values]"
  })

  it('SnapshotGrid renders pads; SnapshotMeta shows the selected pad name/colour below the grid', () => {
    const doc = parseJson(OLD)
    const grid = renderToString(<SnapshotGrid doc={doc} bank={0} bankMode={false} selected={new Set()} onSelect={() => {}} onPickBank={() => {}} />)
    expect(grid).toContain('class="pad')
    const banks = renderToString(<SnapshotGrid doc={doc} bank={0} bankMode={true} selected={new Set()} onSelect={() => {}} onPickBank={() => {}} />)
    expect(banks).toContain('class="pad bank') // bank picker mode
    const meta = renderToString(<SnapshotMeta text={OLD} doc={doc} id="0000" onChange={() => {}} />)
    expect(meta).toContain('SNP 01-1-1') // editable name lives below the grid now
  })

  it('Sidebar snapshot view points at the below-grid name/colour and the Edit/Jump-Load modes', () => {
    const doc = parseJson(OLD)
    const side = renderToString(<Sidebar text={OLD} doc={doc} deviceFor={() => null} selection={['snp:0000']} defaultColId={0} onChange={() => {}} onSetActive={() => {}} />)
    expect(side).toContain('Snapshot 0000')
    expect(side).toContain('Jump/Load')
  })

  it('SnapshotEditPanel edits a selected control’s stored value in the chosen snapshot', () => {
    const doc = parseJson(OLD)
    const empty = renderToString(<SnapshotEditPanel text={OLD} doc={doc} editSnap={null} selection={[]} deviceFor={() => null} onChange={() => {}} />)
    expect(empty).toContain('Click a filled snapshot pad') // no pad picked yet
    const editing = renderToString(<SnapshotEditPanel text={OLD} doc={doc} editSnap="0000" selection={['rotary:030']} deviceFor={() => null} onChange={() => {}} />)
    expect(editing).toContain('Stored in this snapshot')
    expect(editing).toContain('Stored value') // rotary 030 is stored, so the value editor shows
  })

  it('SnapshotEditPanel shows the snapshot’s own MIDI output slots when no control is selected', () => {
    const doc = parseJson(OLD)
    const slots = renderToString(<SnapshotEditPanel text={OLD} doc={doc} editSnap="0000" selection={[]} deviceFor={() => null} onChange={() => {}} />)
    expect(slots).toContain('output slots')   // the intro hint
    expect(slots).toContain('Output slot 0')   // SlotList renders the snapshot's slots
  })
})
