import { useMemo, useRef, useState } from 'react'
import { parseJson } from '../model/jsonDoc'
import { readLayers, readDevices } from '../model/dropProject'
import { copyLayer, copyControlText, pasteControl, removeControl, createControl, setDeviceCsv } from '../model/edits'
import { parseBundledByPathFile } from '../data/devices'
import { parsePresetCsv, type PresetDevice } from '../model/presetDb'
import type { ControlType } from '../model/controlId'
import { Surface, selKey } from './Surface'
import { SnapshotGrid } from './SnapshotGrid'
import { Sidebar } from './Sidebar'
import { DeviceEditor } from './DeviceEditor'

const LAYERS = 8

export function App() {
  const [text, setText] = useState<string | null>(null)
  const [fileName, setFileName] = useState('project.json')
  const [layer, setLayer] = useState(0)
  const [bank, setBank] = useState(0)
  const [selection, setSelection] = useState<string[]>([])
  const [clipboard, setClipboard] = useState<{ type: ControlType; valueText: string } | null>(null)
  const [deviceEditorOpen, setDeviceEditorOpen] = useState(false)
  const [uploads, setUploads] = useState<Map<number, PresetDevice>>(new Map()) // per-device uploaded CSVs
  // remembers settings of deactivated controls within the session (the file can't store inactive ones)
  const inactiveStore = useRef<Map<string, string>>(new Map())

  const doc = useMemo(() => (text != null ? parseJson(text) : null), [text])
  const layers = doc ? readLayers(doc) : []
  // resolve each target device's preset CSV (per-device upload wins, else bundled by csvPath/csvFile)
  const devicePresets = useMemo(() => {
    const m = new Map<number, PresetDevice>()
    if (!doc) return m
    for (const d of readDevices(doc)) {
      const up = uploads.get(d.index)
      if (up) { m.set(d.index, up); continue }
      if (d.csvInUse && d.csvFile) { const pd = parseBundledByPathFile(d.csvPath, d.csvFile); if (pd) m.set(d.index, pd) }
    }
    return m
  }, [doc, uploads])
  const deviceFor = (t: number) => devicePresets.get(t) ?? null

  function apply(next: string) { setText(next) }

  function loadProject(file: File) {
    file.text().then((t) => { setText(t); setFileName(file.name); setSelection([]); setLayer(0) })
  }
  function onUploadCsv(index: number, file: File) {
    file.text().then((t) => {
      const pd = parsePresetCsv(t)
      setUploads((m) => new Map(m).set(index, pd))
      if (text) apply(setDeviceCsv(text, index, '', file.name))
    })
  }
  function save() {
    if (text == null) return
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName.replace(/\.json$/i, '') + '.json'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function onSelect(keys: string[], additive: boolean) {
    setSelection((sel) => {
      if (!additive) return keys
      const set = new Set(sel)
      const allIn = keys.every((k) => set.has(k))
      if (allIn) keys.forEach((k) => set.delete(k))
      else keys.forEach((k) => set.add(k))
      return Array.from(set)
    })
  }
  function setActive(tgts: { type: ControlType; id: string }[], active: boolean) {
    if (!text) return
    let t = text
    const colId = layers[layer]?.colId ?? 0
    for (const tg of tgts) {
      const k = tg.type + ':' + tg.id
      if (active) {
        const stashed = inactiveStore.current.get(k)
        t = stashed ? pasteControl(t, tg.type, tg.id, stashed) : createControl(t, tg.type, tg.id, { name: '', colId }, false)
        inactiveStore.current.delete(k)
      } else {
        const vt = copyControlText(t, tg.type, tg.id)
        if (vt) inactiveStore.current.set(k, vt)
        t = removeControl(t, tg.type, tg.id)
      }
    }
    apply(t)
  }
  function doCopy() {
    if (!text || selection.length !== 1) return
    const [type, id] = splitKey(selection[0])
    const vt = copyControlText(text, type, id)
    if (vt) setClipboard({ type, valueText: vt })
  }
  function doPaste() {
    if (!text || !clipboard || selection.length !== 1) return
    const [type, id] = splitKey(selection[0])
    if (type !== clipboard.type) return // cross-type paste not supported in v1
    apply(pasteControl(text, type, id, clipboard.valueText))
  }
  function doDelete() {
    if (!text || selection.length === 0) return
    let t = text
    for (const k of selection) { const [type, id] = splitKey(k); t = removeControl(t, type, id) }
    apply(t)
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong>dropedit</strong>
        <label className="btn">Open project
          <input type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && loadProject(e.target.files[0])} />
        </label>
        <button onClick={save} disabled={!text}>Download</button>
        <span className="grow" />
        <span className="muted">{text ? fileName : 'no project loaded'}</span>
      </header>

      {!doc ? (
        <main className="empty">
          <p>Open a Drop <code>.json</code> project to begin. Everything stays in your browser.</p>
        </main>
      ) : (
        <div className="workspace">
          <section className="stage">
            <div className="board">
              <div className="left-col">
                <SnapshotGrid doc={doc} bank={bank} selected={new Set(selection)} onSelect={onSelect} onPickBank={setBank} />
                <button className="devices-btn" onClick={() => setDeviceEditorOpen(true)}>Devices…</button>
              </div>
              <div className="right-col">
                <Surface doc={doc} layer={layer} selected={new Set(selection)} onSelect={onSelect} />
                <div className="layers">
                  {Array.from({ length: LAYERS }, (_, i) => (
                    <button key={i} className={i === layer ? 'active' : ''} onClick={() => { setLayer(i); setSelection([]) }}>
                      {layers[i]?.name ?? `Layer ${i + 1}`}
                    </button>
                  ))}
                </div>
                <div className="ops">
                  <button onClick={doCopy} disabled={selection.length !== 1}>Copy control</button>
                  <button onClick={doPaste} disabled={!clipboard || selection.length !== 1}>Paste here</button>
                  <button onClick={doDelete} disabled={selection.length === 0}>Delete</button>
                  <span className="sep" />
                  <label>Copy layer {layer + 1} →
                    <select value="" onChange={(e) => e.target.value !== '' && apply(copyLayer(text!, layer, Number(e.target.value)))}>
                      <option value="">dest…</option>
                      {Array.from({ length: LAYERS }, (_, i) => i).filter((i) => i !== layer).map((i) => (
                        <option key={i} value={i}>Layer {i + 1}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>
          </section>
          <Sidebar text={text!} doc={doc} deviceFor={deviceFor} selection={selection} defaultColId={layers[layer]?.colId ?? 0} onChange={apply} onSetActive={setActive} />
        </div>
      )}

      {doc && deviceEditorOpen && (
        <DeviceEditor text={text!} doc={doc} deviceFor={deviceFor} onChange={apply} onUploadCsv={onUploadCsv} onClose={() => setDeviceEditorOpen(false)} />
      )}
    </div>
  )
}

function splitKey(k: string): [ControlType, string] {
  const i = k.indexOf(':')
  return [k.slice(0, i) as ControlType, k.slice(i + 1)]
}
