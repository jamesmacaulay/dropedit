import { useEffect, useMemo, useRef, useState } from 'react'
import { parseJson } from '../model/jsonDoc'
import { readLayers, readDevices, readControl, NUM_SEL_GROUPS } from '../model/dropProject'
import { copyControlText, pasteControl, copyControls, pasteControls, copySnapshots, pasteSnapshots, removeControl, createControl, setDeviceCsv, saveSnapshot, loadSnapshot, setGroupMember, toggleGroupMember, setSnapshotMembers, toggleSnapshotMembers, type CopiedControl } from '../model/edits'
import { loadBundledByPathFile } from '../data/devices'
import { parsePresetCsv, type PresetDevice } from '../model/presetDb'
import { isPositional, withLayer, withBank, type ControlType } from '../model/controlId'
import { COLOR_NAMES } from './palette'
import { Surface, selKey } from './Surface'
import { SnapshotGrid, SnapshotMeta } from './SnapshotGrid'
import { Sidebar, SnapshotEditPanel } from './Sidebar'
import { DeviceEditor } from './DeviceEditor'
import { CLEAN_INIT, DAW_INIT } from '../data/inits'

const LAYERS = 8
const STORAGE_KEY = 'dropedit:project'
const STORAGE_FILE = 'dropedit:fileName'
const HISTORY_CAP = 100          // max undo depth (each entry is a full project snapshot)
const COALESCE_MS = 450          // typing-burst window: text-input edits within this collapse to one step

// keyboard-shortcut hints shown in button labels (⌘ on mac, ^ elsewhere)
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '')
const MOD = IS_MAC ? '⌘' : '^'
const SHIFT_MOD = IS_MAC ? '⇧⌘' : '^⇧'
const DEL_KEY = IS_MAC ? '⌫' : 'Del'

// Last project + filename saved to localStorage, or null if none / unavailable.
function readStored(): { text: string; name: string } | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const t = localStorage.getItem(STORAGE_KEY)
    return t != null ? { text: t, name: localStorage.getItem(STORAGE_FILE) || 'project.json' } : null
  } catch { return null }
}
// A quick "is this actually a Drop project?" gate. Uses STRICT native JSON.parse (the span-preserving
// parseJson is lenient and won't reject junk) plus a check for the core top-level sections.
function looksLikeDropProject(t: string): boolean {
  try {
    const j = JSON.parse(t)
    return !!j && typeof j === 'object' && (!!j.map || !!j.state || !!j.device)
  } catch { return false }
}
// Restore the saved project only if it still looks like a Drop project (don't boot a broken state).
function readValidStored(): { text: string; name: string } | null {
  const s = readStored()
  return s && looksLikeDropProject(s.text) ? s : null
}
function persistProject(text: string, name?: string) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, text)
    if (name != null) localStorage.setItem(STORAGE_FILE, name)
  } catch { /* quota / disabled storage — keep working in-memory */ }
}
function persistFileName(name: string) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(STORAGE_FILE, name) } catch { /* ignore */ }
}

export function App() {
  // First load restores the saved project (if it still parses); else start from the clean-init slate.
  const [text, setText] = useState<string | null>(() => readValidStored()?.text ?? CLEAN_INIT)
  const [fileName, setFileName] = useState(() => readValidStored()?.name ?? 'clean-init.json')
  const [loadError, setLoadError] = useState<string | null>(null) // shown when an imported file won't parse
  // first-run notice (unofficial tool / keep backups / how to start); dismissed flag persists
  const [welcomed, setWelcomed] = useState(() => { try { return localStorage.getItem('dropedit:welcomed') === '1' } catch { return true } })
  const [layer, setLayer] = useState(0)
  const [bank, setBank] = useState(0)
  const [selection, setSelection] = useState<string[]>([])
  const [clipboard, setClipboard] = useState<{ kind: 'control' | 'snapshot'; items: CopiedControl[] } | null>(null)
  // snapshot flow: 'save' shows the draft settings + group tint; 'load' recalls on pad click;
  // 'edit' picks a pad (editSnap) then edits its stored scene (membership tint + per-control values).
  const [snapMode, setSnapMode] = useState<null | 'save' | 'load' | 'edit'>(null)
  const [editSnap, setEditSnap] = useState<string | null>(null) // the snapshot being edited
  const [snpTab, setSnpTab] = useState<'snapshots' | 'banks'>('snapshots') // grid view: pads vs bank picker
  const [snapDraft, setSnapDraft] = useState<{ name: string; colId: number; group: number }>({ name: '', colId: 4 /* cyan */, group: 0 })
  const [deviceEditorOpen, setDeviceEditorOpen] = useState(false)
  // a pending project load awaiting confirmation (shown only when the project changed since load)
  const [pendingLoad, setPendingLoad] = useState<{ run: () => void; label: string } | null>(null)
  // the project text as of the last load — used to detect whether changes have been made since
  const baselineRef = useRef<string>(text ?? CLEAN_INIT)
  const [uploads, setUploads] = useState<Map<number, PresetDevice>>(new Map()) // per-device uploaded CSVs
  // remembers settings of deactivated controls within the session (the file can't store inactive ones)
  const inactiveStore = useRef<Map<string, string>>(new Map())
  // undo/redo: stack of committed project snapshots (== the sequence of localStorage writes).
  // Text-input edits coalesce into one entry via a debounce; discrete edits commit immediately.
  const history = useRef<{ stack: string[]; index: number }>({ stack: [text ?? CLEAN_INIT], index: 0 })
  const pendingText = useRef<string | null>(null) // latest coalescing (typed) text not yet committed
  const coalesceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [histVer, setHistVer] = useState(0) // bumped on history change so undo/redo buttons re-evaluate
  const bumpHist = () => setHistVer((v) => v + 1)

  const doc = useMemo(() => (text != null ? parseJson(text) : null), [text])
  const layers = doc ? readLayers(doc) : []
  // resolve each target device's preset CSV (per-device upload wins, else bundled by csvPath/csvFile).
  // bundled CSVs load lazily, so this resolves asynchronously into state.
  const [devicePresets, setDevicePresets] = useState<Map<number, PresetDevice>>(new Map())
  useEffect(() => {
    if (!doc) { setDevicePresets(new Map()); return }
    let cancelled = false
      ; (async () => {
        const m = new Map<number, PresetDevice>()
        for (const d of readDevices(doc)) {
          const up = uploads.get(d.index)
          if (up) { m.set(d.index, up); continue }
          if (d.csvInUse && d.csvFile) { const pd = await loadBundledByPathFile(d.csvPath, d.csvFile); if (pd) m.set(d.index, pd) }
        }
        if (!cancelled) setDevicePresets(m)
      })()
    return () => { cancelled = true }
  }, [doc, uploads])
  const deviceFor = (t: number) => devicePresets.get(t) ?? null

  function pushHistory(next: string) {
    const h = history.current
    if (next === h.stack[h.index]) return // no change to record
    h.stack = h.stack.slice(0, h.index + 1) // drop any redo branch
    h.stack.push(next)
    if (h.stack.length > HISTORY_CAP) h.stack.shift()
    h.index = h.stack.length - 1
    bumpHist()
  }
  // commit any in-progress typing burst as its own history entry + localStorage write
  function flushPending() {
    if (coalesceTimer.current != null) { clearTimeout(coalesceTimer.current); coalesceTimer.current = null }
    if (pendingText.current != null) {
      const t = pendingText.current; pendingText.current = null
      pushHistory(t); persistProject(t)
    }
  }
  // discrete edit: commit immediately (its own undo step) and persist.
  function apply(next: string) {
    flushPending()
    setText(next); pushHistory(next); persistProject(next)
  }
  // text-input edit: update the view now, but debounce the history entry + localStorage write so a
  // burst of typing collapses into a single undo step / single persisted update.
  function applyLive(next: string) {
    setText(next)
    pendingText.current = next
    if (coalesceTimer.current != null) clearTimeout(coalesceTimer.current)
    coalesceTimer.current = setTimeout(flushPending, COALESCE_MS)
  }
  function undo() {
    flushPending()
    const h = history.current
    if (h.index <= 0) return
    h.index--; const t = h.stack[h.index]
    setText(t); persistProject(t); bumpHist()
  }
  function redo() {
    flushPending()
    const h = history.current
    if (h.index >= h.stack.length - 1) return
    h.index++; const t = h.stack[h.index]
    setText(t); persistProject(t); bumpHist()
  }

  function loadProject(file: File) {
    file.text().then((t) => {
      if (!looksLikeDropProject(t)) {
        setLoadError(`Couldn’t read “${file.name}” as a Drop project — make sure it’s a valid Drop .json export.`)
        return
      }
      setLoadError(null)
      loadInit(t, file.name)
    }).catch(() => setLoadError(`Couldn’t read “${file.name}”.`))
  }
  function dismissWelcome() {
    setWelcomed(true)
    try { localStorage.setItem('dropedit:welcomed', '1') } catch { /* ignore */ }
  }
  // loading a project is a fresh start: reset the undo history to it.
  function loadInit(t: string, name: string) {
    flushPending()
    setText(t); setFileName(name); persistProject(t, name); setSelection([]); setLayer(0); setSnapMode(null); setEditSnap(null)
    history.current = { stack: [t], index: 0 }; bumpHist()
    baselineRef.current = t // the freshly-loaded project is the new baseline for "has it changed?"
  }
  // loading replaces everything and can't be undone, so guard it whenever the project has been
  // changed since it was loaded. Downloading does NOT clear this — a download isn't a load.
  function guardLoad(run: () => void, label: string) {
    if (text != null && text !== baselineRef.current) setPendingLoad({ run, label })
    else run()
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
    a.download = (fileName.replace(/\.json$/i, '').trim() || 'project') + '.json'
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
  void histVer // re-render trigger: the history stack lives in a ref, so read it after each bump
  const canUndo = history.current.index > 0
  const canRedo = history.current.index < history.current.stack.length - 1
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
  // Cut = copy the selection to the clipboard, then remove the source (one undo step via doDelete).
  function doCut() {
    if (!text || !canCopy) return
    doCopy()
    doDelete()
  }

  // ---- snapshot save / load flow ----
  // In save mode, a snapshot stores the controls in the chosen selection group (green = included).
  // Select/Deselect/Toggle edit that group from the current control selection; clicking a pad saves.
  function doGroup(kind: 'select' | 'deselect' | 'toggle') {
    if (!text || !hasPositional) return
    const tg = selControls()
    apply(kind === 'toggle' ? toggleGroupMember(text, snapDraft.group, tg) : setGroupMember(text, snapDraft.group, tg, kind === 'select'))
  }
  // In edit mode, membership ops add/remove the current control selection to/from editSnap's scene
  // (adding captures each control's current live value), mirroring save mode's group buttons.
  function doSnapMember(kind: 'select' | 'deselect' | 'toggle') {
    if (!text || !editSnap || !hasPositional) return
    const tg = selControls().filter((t) => t.type !== 'snp')
    apply(kind === 'toggle' ? toggleSnapshotMembers(text, editSnap, tg) : setSnapshotMembers(text, editSnap, tg, kind === 'select'))
  }
  function onSnapPad(id: string) {
    if (!text) return
    if (snapMode === 'save') { apply(saveSnapshot(text, id, snapDraft)); setSnapMode(null) }
    else if (snapMode === 'load') { apply(loadSnapshot(text, id)); setSnapMode(null) }
    else if (snapMode === 'edit') {
      // pick this snapshot to edit (only filled pads); clear control selection so the sidebar shows it
      if (doc && readControl(doc, 'snp', id)) { setEditSnap(id); setSelection([]) }
    }
  }
  // toggle a snapshot mode on/off; entering any mode resets the edit pick
  function enterMode(m: 'save' | 'edit' | 'load') {
    setSnapMode((cur) => (cur === m ? null : m))
    setEditSnap(null)
  }
  // the snapshot whose name/colour show below the grid: the one being edited, or a lone selected pad
  const selSnpIds = selection.filter((k) => k.startsWith('snp:')).map((k) => k.slice(4))
  const currentSnp = snapMode === 'edit' ? editSnap : (snapMode == null && selSnpIds.length === 1 ? selSnpIds[0] : null)

  // Keyboard shortcuts for the selection. Skipped while a form field is focused so ordinary
  // text editing (and text copy/paste) is left alone.
  //   Ctrl/Cmd+Z — undo ; Ctrl/Cmd+Shift+Z (or Ctrl+Y) — redo (work anywhere, even in a field)
  //   Ctrl/Cmd+C / +V — copy / paste the selection (controls or snapshots)
  //   Backspace / Delete — delete the selection (same as the Delete button)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const inField = !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
      // undo/redo apply globally (a field's own value is part of the project, so its edit is undoable)
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); if (inField) el!.blur(); return }
        if (k === 'y' && !e.shiftKey) { e.preventDefault(); redo(); if (inField) el!.blur(); return }
      }
      if (inField) return
      // snapshot save mode: t/s/d edit the selection group from the current control selection
      if (snapMode === 'save' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 't') { e.preventDefault(); doGroup('toggle'); return }
        if (k === 's') { e.preventDefault(); doGroup('select'); return }
        if (k === 'd') { e.preventDefault(); doGroup('deselect'); return }
        if (e.key === 'Escape') { e.preventDefault(); setSnapMode(null); return }
      }
      // snapshot edit mode: t/s/d add/remove the control selection to/from the edited snapshot
      if (snapMode === 'edit' && editSnap && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 't') { e.preventDefault(); doSnapMember('toggle'); return }
        if (k === 's') { e.preventDefault(); doSnapMember('select'); return }
        if (k === 'd') { e.preventDefault(); doSnapMember('deselect'); return }
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (selection.length) { e.preventDefault(); doDelete() }
        return
      }
      if (e.key === 'Escape' && snapMode) { setSnapMode(null); setEditSnap(null); return }
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const k = e.key.toLowerCase()
      if (k === 'c' && canCopy) { e.preventDefault(); doCopy() }
      else if (k === 'x' && canCopy) { e.preventDefault(); doCut() }
      else if (k === 'v' && canPaste) { e.preventDefault(); doPaste() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [text, selection, clipboard, layer, bank, snapMode, snapDraft, editSnap])

  // persist any pending typed text if the tab is closed mid-burst
  useEffect(() => {
    const flush = () => flushPending()
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <strong>dropedit</strong>
        <label className="btn">Import project
          <input type="file" accept=".json" hidden onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = '' // allow re-selecting the same file to reload it
            if (f) guardLoad(() => loadProject(f), f.name)
          }} />
        </label>
        <button onClick={() => guardLoad(() => loadInit(CLEAN_INIT, 'clean-init.json'), 'Clean Init')}>Clean Init</button>
        <button onClick={() => guardLoad(() => loadInit(DAW_INIT, 'daw-init.json'), 'DAW Init')}>DAW Init</button>
        <button onClick={save} disabled={!text}>Download</button>
        <input className="filename" value={fileName} aria-label="Project file name (used when downloading)"
          title="File name used when you download the project" spellCheck={false}
          onChange={(e) => { setFileName(e.target.value); persistFileName(e.target.value) }} />
        <span className="grow" />
        <a className="gh-link" href="https://github.com/jamesmacaulay/dropedit" target="_blank" rel="noopener noreferrer" title="View source on GitHub" aria-label="View source on GitHub">
          <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 012-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
          </svg>
        </a>
      </header>

      {!welcomed && (
        <div className="notice welcome">
          <span><strong>dropedit</strong> is an unofficial, community-made editor for Neuzeit Drop projects (not affiliated with Neuzeit). It preserves data it doesn’t touch byte-for-byte, but <strong>please keep a backup of your projects</strong>.</span>
          <button onClick={dismissWelcome}>Got it</button>
        </div>
      )}
      {loadError && (
        <div className="notice error">
          <span>{loadError}</span>
          <button onClick={() => setLoadError(null)}>Dismiss</button>
        </div>
      )}

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
                <button className="devices-btn" onClick={() => setDeviceEditorOpen(true)}>Devices…</button>
                {/* snp-area is a column when wide; below the breakpoint it becomes a row so the
                    tabs/mode buttons sit to the LEFT of the grid instead of stacked above it */}
                <div className="snp-area">
                  <div className="snp-controls">
                    <div className="snp-tabs">
                      <button className={snpTab === 'snapshots' ? 'active' : ''} onClick={() => setSnpTab('snapshots')}>Snapshots</button>
                      <button className={snpTab === 'banks' ? 'active' : ''} onClick={() => setSnpTab('banks')}>Banks</button>
                    </div>
                    {snpTab === 'snapshots' && (
                      <div className="snp-modes">
                        <button className={snapMode === 'save' ? 'active' : ''} onClick={() => enterMode('save')}>Save</button>
                        <button className={snapMode === 'edit' ? 'active' : ''} onClick={() => enterMode('edit')}>Edit</button>
                        <button className={snapMode === 'load' ? 'active' : ''} onClick={() => enterMode('load')}>Jump/Load</button>
                      </div>
                    )}
                  </div>
                  <div className="snp-gridwrap">
                    <SnapshotGrid doc={doc} bank={bank} bankMode={snpTab === 'banks'} selected={new Set(selection)} onSelect={onSelect}
                      onPickBank={(b) => { switchBank(b); setSnpTab('snapshots') }}
                      onPad={snapMode ? onSnapPad : undefined} padHint={snapMode} editing={snapMode === 'edit' ? editSnap : null} />
                    {currentSnp && <SnapshotMeta text={text!} doc={doc} id={currentSnp} onChange={(next, coalesce) => (coalesce ? applyLive : apply)(next)} />}
                  </div>
                </div>
              </div>
              <div className="right-col">
                <div className="layers">
                  {Array.from({ length: LAYERS }, (_, i) => (
                    <button key={i} className={i === layer ? 'active' : ''} onClick={() => switchLayer(i)}>
                      {layers[i]?.name ?? `Layer ${i + 1}`}
                    </button>
                  ))}
                </div>
                <Surface doc={doc} layer={layer} selected={new Set(selection)} onSelect={onSelect}
                  saveGroup={snapMode === 'save' ? snapDraft.group : null} editSnap={snapMode === 'edit' ? editSnap : null} />
                {snapMode === 'save' ? (
                  <div className="ops">
                    <span className="muted">Group {snapDraft.group + 1}: green = saved · red = skipped</span>
                    <span className="grow" />
                    <button onClick={() => doGroup('toggle')} disabled={!hasPositional}>Toggle<span className="sc">T</span></button>
                    <button onClick={() => doGroup('select')} disabled={!hasPositional}>Select<span className="sc">S</span></button>
                    <button onClick={() => doGroup('deselect')} disabled={!hasPositional}>Deselect<span className="sc">D</span></button>
                  </div>
                ) : snapMode === 'edit' ? (
                  editSnap ? (
                    <div className="ops">
                      <span className="muted">Snapshot {editSnap}: green = stored · red = not</span>
                      <span className="grow" />
                      <button onClick={() => doSnapMember('toggle')} disabled={!hasPositional}>Toggle<span className="sc">T</span></button>
                      <button onClick={() => doSnapMember('select')} disabled={!hasPositional}>Select<span className="sc">S</span></button>
                      <button onClick={() => doSnapMember('deselect')} disabled={!hasPositional}>Deselect<span className="sc">D</span></button>
                    </div>
                  ) : (
                    <div className="ops"><span className="muted">Click a snapshot pad to edit the values it stores.</span></div>
                  )
                ) : (
                  <div className="ops">
                    <button onClick={doCopy} disabled={!canCopy}>Copy<span className="sc">{MOD}C</span></button>
                    <button onClick={doCut} disabled={!canCopy}>Cut<span className="sc">{MOD}X</span></button>
                    <button onClick={doPaste} disabled={!canPaste}>Paste<span className="sc">{MOD}V</span></button>
                    <button onClick={doDelete} disabled={selection.length === 0}>Delete<span className="sc">{DEL_KEY}</span></button>
                    <span className="grow" />
                    <button onClick={undo} disabled={!canUndo}>Undo<span className="sc">{MOD}Z</span></button>
                    <button onClick={redo} disabled={!canRedo}>Redo<span className="sc">{SHIFT_MOD}Z</span></button>
                  </div>
                )}
              </div>
            </div>
          </section>
          {snapMode === 'save' ? (
            <aside className="sidebar">
              <h2>Save snapshot</h2>
              <p className="hint">Set the details, choose which controls to include (green), then click a pad to save into it.</p>
              <label>Name<input type="text" value={snapDraft.name} placeholder="(optional)" onChange={(e) => setSnapDraft((d) => ({ ...d, name: e.target.value }))} /></label>
              <label>Pad color
                <select value={String(snapDraft.colId)} onChange={(e) => setSnapDraft((d) => ({ ...d, colId: Number(e.target.value) }))}>
                  {COLOR_NAMES.map((nm, i) => <option key={i} value={i}>{i} · {nm}</option>)}
                </select>
              </label>
              <label>Selection group
                <select value={String(snapDraft.group)} onChange={(e) => setSnapDraft((d) => ({ ...d, group: Number(e.target.value) }))}>
                  {Array.from({ length: NUM_SEL_GROUPS }, (_, g) => <option key={g} value={g}>Group {g + 1}</option>)}
                </select>
              </label>
              <p className="meta">Select controls on the surface, then Toggle/Select/Deselect (T/S/D) to edit group {snapDraft.group + 1}. Esc to cancel.</p>
              <button onClick={() => setSnapMode(null)}>Cancel</button>
            </aside>
          ) : snapMode === 'load' ? (
            <aside className="sidebar">
              <h2>Jump / Load</h2>
              <p className="hint">Click a snapshot pad to recall it — only the controls it stores are written into the live state.</p>
              <button onClick={() => setSnapMode(null)}>Cancel</button>
            </aside>
          ) : snapMode === 'edit' ? (
            <SnapshotEditPanel text={text!} doc={doc} editSnap={editSnap} selection={selection} deviceFor={deviceFor} onChange={(next, coalesce) => (coalesce ? applyLive : apply)(next)} />
          ) : (
            <Sidebar text={text!} doc={doc} deviceFor={deviceFor} selection={selection} defaultColId={layers[layer]?.colId ?? 0} onChange={(next, coalesce) => (coalesce ? applyLive : apply)(next)} onSetActive={setActive} />
          )}
        </div>
      )}

      {doc && deviceEditorOpen && (
        <DeviceEditor text={text!} doc={doc} deviceFor={deviceFor} onChange={(next, coalesce) => (coalesce ? applyLive : apply)(next)} onUploadCsv={onUploadCsv} onClose={() => setDeviceEditorOpen(false)} />
      )}

      {pendingLoad && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setPendingLoad(null) }}>
          <div className="modal confirm">
            <div className="modal-head"><h2>Discard changes?</h2></div>
            <p className="hint">Loading <strong>{pendingLoad.label}</strong> replaces your current project, and this can’t be undone. Download the project to save your work, if you haven’t done so already.</p>
            <div className="confirm-actions">
              <button onClick={() => setPendingLoad(null)}>Cancel</button>
              <button className="danger" onClick={() => { const r = pendingLoad.run; setPendingLoad(null); r() }}>Discard &amp; load</button>
            </div>
          </div>
        </div>
      )}

      <footer className="appfoot">
        Unofficial community tool, not affiliated with Neuzeit. · Device presets from <a href="https://github.com/pencilresearch/midi" target="_blank" rel="noopener noreferrer">pencilresearch/midi</a>,
        licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC&nbsp;BY-SA&nbsp;4.0</a>.
      </footer>
    </div>
  )
}

function splitKey(k: string): [ControlType, string] {
  const i = k.indexOf(':')
  return [k.slice(0, i) as ControlType, k.slice(i + 1)]
}
