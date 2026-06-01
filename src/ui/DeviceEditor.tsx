import type { JsonDoc } from '../model/jsonDoc'
import { readDevices } from '../model/dropProject'
import type { PresetDevice } from '../model/presetDb'
import { setDeviceField, setDeviceCsv } from '../model/edits'
import { BUNDLED_DEVICES } from '../data/devices'

// Ports are 1-indexed with 0 = off (Deluge's portOut 3 = TRS1, per hardware).
const PORTS: { v: number; l: string }[] = [
  { v: 0, l: 'Off' }, { v: 1, l: 'USB1' }, { v: 2, l: 'USB2' },
  { v: 3, l: 'TRS1' }, { v: 4, l: 'TRS2' }, { v: 5, l: 'TRS3' }, { v: 6, l: 'TRS4' },
]

export interface DeviceEditorProps {
  text: string
  doc: JsonDoc
  deviceFor: (index: number) => PresetDevice | null
  onChange: (t: string) => void
  onUploadCsv: (index: number, file: File) => void
  onClose: () => void
}

function bundledIdFor(path: string, file: string): string {
  const b = BUNDLED_DEVICES.find((x) => x.file === file && (x.path === path || path === ''))
  return b ? b.id : ''
}

export function DeviceEditor({ text, doc, deviceFor, onChange, onUploadCsv, onClose }: DeviceEditorProps) {
  const devices = readDevices(doc)
  const set = (i: number, f: string, v: string | number) => onChange(setDeviceField(text, i, f, v))
  const portSel = (i: number, f: 'portOut' | 'portIn', v: number) => (
    <select value={v} onChange={(e) => set(i, f, Number(e.target.value))}>
      {PORTS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
      {!PORTS.some((p) => p.v === v) && <option value={v}>{`port ${v}`}</option>}
    </select>
  )
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
                  <label>Name<input type="text" value={d.name} onChange={(e) => set(d.index, 'name', e.target.value)} /></label>
                  <label>Channel<input type="number" min={1} max={16} value={d.ch} onChange={(e) => set(d.index, 'ch', Number(e.target.value))} /></label>
                  <label>Out port{portSel(d.index, 'portOut', d.portOut)}</label>
                  <label>In port{portSel(d.index, 'portIn', d.portIn)}</label>
                  <label>Cable out<input type="number" min={0} value={d.cableIdOut} onChange={(e) => set(d.index, 'cableIdOut', Number(e.target.value))} /></label>
                  <label>Cable in<input type="number" min={0} value={d.cableIdIn} onChange={(e) => set(d.index, 'cableIdIn', Number(e.target.value))} /></label>
                </div>
                <div className="device-csv">
                  <label>Preset CSV
                    <select value={bundledIdFor(d.csvPath, d.csvFile)} onChange={(e) => {
                      if (e.target.value === '') onChange(setDeviceCsv(text, d.index, '', ''))
                      else { const b = BUNDLED_DEVICES.find((x) => x.id === e.target.value); if (b) onChange(setDeviceCsv(text, d.index, b.path, b.file)) }
                    }}>
                      <option value="">— none —</option>
                      {BUNDLED_DEVICES.map((b) => <option key={b.id} value={b.id}>{b.manufacturer} {b.device}</option>)}
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
