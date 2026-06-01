import { useEffect, useMemo, useRef, useState } from 'react'
import { parseJson } from '../model/jsonDoc'
import { readLayers, readDevices } from '../model/dropProject'
import { copyControlText, pasteControl, copyControls, pasteControls, copySnapshots, pasteSnapshots, removeControl, createControl, setDeviceCsv, type CopiedControl } from '../model/edits'
import { parseBundledByPathFile } from '../data/devices'
import { parsePresetCsv, type PresetDevice } from '../model/presetDb'
import { isPositional, withLayer, withBank, type ControlType } from '../model/controlId'
import { Surface, selKey } from './Surface'
import { SnapshotGrid } from './SnapshotGrid'
import { Sidebar } from './Sidebar'
import { DeviceEditor } from './DeviceEditor'
import { CLEAN_INIT, DAW_INIT } from '../data/inits'

const LAYERS = 8
const STORAGE_KEY = 'dropedit:project'
const STORAGE_FILE = 'dropedit:fileName'

// Last project + filename saved to localStorage, or null if none / unavailable.
function readStored(): { text: string; name: string } | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const t = localStorage.getItem(STORAGE_KEY)
    return t != null ? { text: t, name: localStorage.getItem(STORAGE_FILE) || 'project.json' } : null
  } catch { return null }
}
function persistProject(text: string, name?: string) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, text)
    if (name != null) localStorage.setItem(STORAGE_FILE, name)
  } catch { /* quota / disabled storage — keep working in-memory */ }
}

export function App() {
  // First load restores the saved project; with nothing saved, start from the clean-init blank slate.
  const [text, setText] = useState<string | null>(() => readStored()?.text ?? CLEAN_INIT)
  const [fileName, setFileName] = useState(() => readStored()?.name ?? 'clean-init.json')
  const [layer, setLayer] = useState(0)
  const [bank, setBank] = useState(0)
  const [selection, setSelection] = useState<string[]>([])
  const [clipboard, setClipboard] = useState<{ kind: 'control' | 'snapshot'; items: CopiedControl[] } | null>(null)
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

  // every edit returns new project text; persist it so the view, the download, and the
  // restored-on-reload copy are always the same bytes.
  function apply(next: string) { setText(next); persistProject(next) }

  function loadProject(file: File) {
    file.text().then((t) => loadInit(t, file.name))
  }
  function loadInit(t: string, name: string) {
    setText(t); setFileName(name); persistProject(t, name); setSelection([]); setLayer(0)
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
      const mapped = copyControlText(t, tg.type, tg.id) != null
      if (active) {
        if (mapped) continue // already active — don't clobber its settings
        const stashed = inactiveStore.current.get(k)
        t = stashed ? pasteControl(t, tg.type, tg.id, stashed) : createControl(t, tg.type, tg.id, { name: '', colId }, false)
        inactiveStore.current.delete(k)
      } else {
        if (!mapped) continue // already inactive
        const vt = copyControlText(t, tg.type, tg.id)
        if (vt) inactiveStore.current.set(k, vt)
        t = removeControl(t, tg.type, tg.id)
      }
    }
    apply(t)
  }
  // selection is positional (layer-independent): switching layers re-targets it to the new
  // layer so e.g. "fader 1" stays selected across layers. snp & non-positional keys are kept as-is.
  function switchLayer(next: number) {
    setSelection((sel) => sel.map((k) => {
      const [type, id] = splitKey(k)
      return isPositional(type) ? selKey(type, withLayer(id, next)) : k
    }))
    setLayer(next)
  }
  // snapshots are positional within a bank the same way controls are within a layer:
  // switching banks re-targets the snapshot selection to the same slots in the new bank.
  function switchBank(next: number) {
    setSelection((sel) => sel.map((k) => {
      const [type, id] = splitKey(k)
      return type === 'snp' ? selKey('snp', withBank(id, next)) : k
    }))
    setBank(next)
  }
  const selControls = () => selection.map(splitKey).map(([type, id]) => ({ type, id }))
  const hasPositional = selection.some((k) => isPositional(splitKey(k)[0]))
  const hasSnp = selection.some((k) => splitKey(k)[0] === 'snp')
  const canCopy = hasPositional || hasSnp
  const canPaste = !!clipboard && (clipboard.kind === 'snapshot' ? hasSnp : hasPositional)
  function doCopy() {
    if (!text) return
    // snapshots and controls are separate families; copy whichever the selection is.
    if (hasSnp && !hasPositional) {
      const items = copySnapshots(text, selControls())
      if (items.some((c) => c.valueText != null)) setClipboard({ kind: 'snapshot', items })
    } else if (hasPositional) {
      const items = copyControls(text, selControls())
      if (items.some((c) => c.valueText != null)) setClipboard({ kind: 'control', items })
    }
  }
  function doPaste() {
    if (!text || !canPaste) return
    apply(clipboard!.kind === 'snapshot'
      ? pasteSnapshots(text, clipboard!.items, selControls(), bank)
      : pasteControls(text, clipboard!.items, selControls(), layer))
  }
  function doDelete() {
    if (!text || selection.length === 0) return
    let t = text
    for (const k of selection) { const [type, id] = splitKey(k); t = removeControl(t, type, id) }
    apply(t)
  }

  // Keyboard shortcuts for the selection. Skipped while a form field is focused so ordinary
  // text editing (and text copy/paste) is left alone.
  //   Ctrl/Cmd+C / +V — copy / paste the selection (controls or snapshots)
  //   Backspace / Delete — delete the selection (same as the Delete button)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (selection.length) { e.preventDefault(); doDelete() }
        return
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const k = e.key.toLowerCase()
      if (k === 'c' && canCopy) { e.preventDefault(); doCopy() }
      else if (k === 'v' && canPaste) { e.preventDefault(); doPaste() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [text, selection, clipboard, layer, bank])

  return (
    <div className="app">
      <header className="topbar">
        <strong>dropedit</strong>
        <label className="btn">Open project
          <input type="file" accept=".json" hidden onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) loadProject(f)
            e.target.value = '' // allow re-selecting the same file to reload it
          }} />
        </label>
        <button onClick={() => loadInit(CLEAN_INIT, 'clean-init.json')}>Clean Init</button>
        <button onClick={() => loadInit(DAW_INIT, 'daw-init.json')}>DAW Init</button>
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
          {/* clicking empty canvas (the stage/board background itself, not a control) clears the selection */}
          <section className="stage" onClick={(e) => { if (e.target === e.currentTarget) setSelection([]) }}>
            <div className="board" onClick={(e) => { if (e.target === e.currentTarget) setSelection([]) }}>
              <div className="left-col">
                <SnapshotGrid doc={doc} bank={bank} selected={new Set(selection)} onSelect={onSelect} onPickBank={switchBank} />
                <button className="devices-btn" onClick={() => setDeviceEditorOpen(true)}>Devices…</button>
              </div>
              <div className="right-col">
                <div className="layers">
                  {Array.from({ length: LAYERS }, (_, i) => (
                    <button key={i} className={i === layer ? 'active' : ''} onClick={() => switchLayer(i)}>
                      {layers[i]?.name ?? `Layer ${i + 1}`}
                    </button>
                  ))}
                </div>
                <Surface doc={doc} layer={layer} selected={new Set(selection)} onSelect={onSelect} />
                <div className="ops">
                  <button onClick={doCopy} disabled={!canCopy}>Copy</button>
                  <button onClick={doPaste} disabled={!canPaste}>Paste</button>
                  <button onClick={doDelete} disabled={selection.length === 0}>Delete</button>
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
