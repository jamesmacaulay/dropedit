import type { JsonDoc } from '../model/jsonDoc'
import { readDevices } from '../model/dropProject'
import type { PresetDevice } from '../model/presetDb'
import { setDeviceField, setDeviceCsv } from '../model/edits'
import { PORT } from '../model/enums'
import { BUNDLED_DEVICES, type BundledDevice } from '../data/devices'
import { EnumField } from './EnumField'

// bundled devices grouped by manufacturer for the (now ~400-entry) preset dropdown
const BUNDLED_GROUPS: [string, BundledDevice[]][] = (() => {
  const m = new Map<string, BundledDevice[]>()
  for (const b of BUNDLED_DEVICES) { const g = m.get(b.manufacturer) ?? []; g.push(b); m.set(b.manufacturer, g) }
  return [...m.entries()]
})()

export interface DeviceEditorProps {
  text: string
  doc: JsonDoc
  deviceFor: (index: number) => PresetDevice | null
  onChange: (t: string, coalesce?: boolean) => void // coalesce=true debounces text/number-input edits
  onUploadCsv: (index: number, file: File) => void
  onClose: () => void
}

function bundledIdFor(path: string, file: string): string {
  const b = BUNDLED_DEVICES.find((x) => x.file === file && (x.path === path || path === ''))
  return b ? b.id : ''
}

export function DeviceEditor({ text, doc, deviceFor, onChange, onUploadCsv, onClose }: DeviceEditorProps) {
  const devices = readDevices(doc)
  const set = (i: number, f: string, v: string | number, coalesce = false) => onChange(setDeviceField(text, i, f, v), coalesce)
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Devices</h2>
          <button onClick={onClose}>Close</button>
        </div>
        <p className="meta">The 8 MIDI destinations a control's output slot can target. A device's preset CSV gives friendly parameter names for slots pointing at it. (Port labels are tentative.)</p>
        <div className="device-list">
          {devices.map((d) => {
            const preset = deviceFor(d.index)
            return (
              <fieldset key={d.index} className={'device' + (d.inUse ? '' : ' off')}>
                <legend>
                  <label className="chk"><input type="checkbox" checked={!!d.inUse} onChange={(e) => set(d.index, 'inUse', e.target.checked ? 1 : 0)} /> {`Device ${d.index + 1}`}</label>
                </legend>
                <div className="device-grid">
                  <label>Name<input type="text" value={d.name} onChange={(e) => set(d.index, 'name', e.target.value, true)} /></label>
                  <label>Channel<input type="number" min={1} max={16} value={d.ch} onChange={(e) => set(d.index, 'ch', Number(e.target.value), true)} /></label>
                  <EnumField label="Out port" map={PORT} value={d.portOut} onSet={(v) => set(d.index, 'portOut', v, true)} />
                  <EnumField label="In port" map={PORT} value={d.portIn} onSet={(v) => set(d.index, 'portIn', v, true)} />
                  <label>Virt. cable out<input type="number" min={1} value={d.cableIdOut + 1} onChange={(e) => e.target.value !== '' && set(d.index, 'cableIdOut', Math.max(0, Number(e.target.value) - 1), true)} /></label>
                  <label>Virt. cable in<input type="number" min={1} value={d.cableIdIn + 1} onChange={(e) => e.target.value !== '' && set(d.index, 'cableIdIn', Math.max(0, Number(e.target.value) - 1), true)} /></label>
                </div>
                <div className="device-csv">
                  <label>Preset CSV
                    <select value={bundledIdFor(d.csvPath, d.csvFile)} onChange={(e) => {
                      if (e.target.value === '') onChange(setDeviceCsv(text, d.index, '', ''))
                      else { const b = BUNDLED_DEVICES.find((x) => x.id === e.target.value); if (b) onChange(setDeviceCsv(text, d.index, b.path, b.file)) }
                    }}>
                      <option value="">— none —</option>
                      {BUNDLED_GROUPS.map(([manufacturer, items]) => (
                        <optgroup key={manufacturer} label={manufacturer}>
                          {items.map((b) => <option key={b.id} value={b.id}>{b.device}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <label className="btn">Upload CSV<input type="file" accept=".csv" hidden onChange={(e) => e.target.files?.[0] && onUploadCsv(d.index, e.target.files[0])} /></label>
                  <span className="meta">{preset ? `params: ${preset.manufacturer} ${preset.device} (${preset.params.length})` : d.csvFile ? `${d.csvFile} — not bundled, upload to use` : 'no preset'}</span>
                </div>
              </fieldset>
            )
          })}
        </div>
      </div>
    </div>
  )
}
