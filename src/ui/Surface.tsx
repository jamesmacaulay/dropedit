import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { ReactNode } from 'react'
import type { JsonDoc } from '../model/jsonDoc'
import { readControl, readGroupMember, readSnapshotMember, readStateValue } from '../model/dropProject'
import { COLS, ROWS, type ControlType } from '../model/controlId'
import { ledLevels, FEEDB_HUE, HEAD, OFF, LED_COUNT } from '../model/leds'
import { colorFor, hueCycleColor } from './palette'

export const selKey = (type: string, id: string) => `${type}:${id}`

// how a click changes the selection: replace it, toggle the clicked items, or range-extend (shift).
export type SelectMode = 'replace' | 'toggle' | 'range'
// cmd (mac) / ctrl (win-linux) = toggle; shift = range. On mac a ctrl-click is a context-menu, so
// mac users use cmd — metaKey covers that; we never need to special-case it here.
export const modeOf = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): SelectMode =>
  e.shiftKey ? 'range' : (e.metaKey || e.ctrlKey) ? 'toggle' : 'replace'

// snapshot save / edit modes: controls tint green (included) / red (not)
const SAVE_GREEN = '#22c55e', SAVE_RED = '#ef4444'

export interface SurfaceProps {
  doc: JsonDoc
  layer: number
  selected: Set<string>
  onSelect: (keys: string[], mode: SelectMode) => void
  /** save mode: tint each control green (in this selection group) / red (not) */
  saveGroup?: number | null
  /** snapshot edit mode: tint each control green (stored in this snapshot) / red (not) */
  editSnap?: string | null
  /** keyboard hint (e.g. "⌘A") shown on the "All" label button */
  selectAllHint?: string
  /** set a control's live value (drag on a rotary/fader, double-click toggle on a rotbut/mute).
   *  `coalesce=true` collapses a drag into one undo step; `false` is a discrete edit (a toggle). */
  onSetValue?: (type: ControlType, id: string, value: number, coalesce: boolean) => void
}

const PAD = 16, LEFT = 46, COLW = 104, ROT_R = 32, ROT_GAP = 80, TOP = 48, MUTE_H = 34, FADER_H = 120
const LBL_H = 22
// fader: a vertical slot with a cap at the value position, a colour LED line across the cap and a
// small circular LED at the upper right (both lit only when the fader is mapped).
const FADER_W = 26, TRACK_W = 8, CAP_H = 12, FADER_CIRC_R = 3.5
// mute: a top arc LED (lit when on), a shorter bottom arc LED (lit whenever mapped) and a centre LED.
const MUTE_R = 14, MUTE_LED_W = 4, MUTE_TOP_DEG = 60, MUTE_BOT_DEG = 42, MUTE_CEN_R = 3.5

// vertical-drag value editing: pixels of vertical travel for a full 0→1 sweep, and the slop (in px)
// a press may move before it counts as a drag instead of a click. Round drag values to 5 decimals so
// a continuous drag writes clean tokens (e.g. 0.43192) instead of float-precision noise. The sweep
// distance equals a fader cap's travel, so dragging a fader tracks the cursor 1:1 and rotaries use the
// same scale.
const DRAG_SENSITIVITY = FADER_H - CAP_H, DRAG_THRESHOLD = 4
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const round5 = (v: number) => Math.round(v * 1e5) / 1e5

// Rotary LED ring around a dark knob body, like the hardware. Laid out as if 16 segments evenly
// circled the knob (SEG_DEG apart), then the bottom one and its two neighbours were removed: the
// bottom slot becomes the rotbut indicator LED and the two flanking slots are the gaps either side of
// it. That leaves 13 ring segments, centred at a = 180 + (i+2)·SEG_DEG (a: 0=top, 180=bottom, +cw).
// Geometry is the same for every rotary, so we precompute each segment's radial unit vector + tangent.
const LED_R = 25, KNOB_R = 17, LED_LEN = 2.2, LED_W = 4, CENTER_R = 5
const SEG_DEG = 360 / 16
const LED_GEO = (() => {
  return Array.from({ length: LED_COUNT }, (_, i) => {
    const th = ((180 + (i + 2) * SEG_DEG) * Math.PI) / 180
    const s = Math.sin(th), c = Math.cos(th)
    return { rx: s, ry: -c, tx: c, ty: s } // radial position (×LED_R) + tangent (×LED_LEN)
  })
})()

// The rotbut indicator LED is the removed bottom segment: same radius/size/shape as a ring segment,
// at the very bottom (a = 180), tangent horizontal.
const butLedPos = (cx: number, cy: number): [number, number] => [cx, cy + LED_R]

// Selection / hover outlines, built from two concentric circles — inner around the knob, outer around
// the LEDs — split by two vertical lines through the gaps either side of the bottom rotbut LED. The
// walls sit where an LED segment's centre would be in each gap (x = cx ± LED_R·sin(SEG_DEG)), so they
// line up with the missing LEDs. The rotary's outline is the horseshoe over the LED ring (outer +
// inner arcs, open at the bottom between the walls); the rotbut's is a keyhole: the knob arc with a
// tab reaching down to the bottom LED. Both share the same outer circle and the same vertical walls,
// so the keyhole's tab continues the horseshoe's outer arc into one circle and the walls coincide; the
// keyhole's knob arc nests just inside the horseshoe's inner arc so they don't double up.
const HS_OUT = LED_R + 7, HS_IN = KNOB_R + 1           // outer (LEDs) / inner (knob) circle radii
const KH_OUT = HS_OUT, KH_IN = KNOB_R                  // keyhole: tab on the outer circle, knob arc hugging the knob
const WALL_X = LED_R * Math.sin((SEG_DEG * Math.PI) / 180) // gap walls at the missing LEDs' centre x
const wallY = (cy: number, R: number) => cy + Math.sqrt(R * R - WALL_X * WALL_X) // where a wall meets circle R

// horseshoe over the LED ring: outer arc over the top, a vertical wall down the left gap, inner arc
// back over the top, then the closing vertical wall up the right gap (open at the bottom).
function horseshoePath(cx: number, cy: number): string {
  const yOut = wallY(cy, HS_OUT), yIn = wallY(cy, HS_IN)
  return `M${cx - WALL_X} ${yOut} A${HS_OUT} ${HS_OUT} 0 1 1 ${cx + WALL_X} ${yOut}` + // outer arc over the top
    ` L${cx + WALL_X} ${yIn}` +                                                        // vertical wall down (right gap)
    ` A${HS_IN} ${HS_IN} 0 1 0 ${cx - WALL_X} ${yIn}` +                                // inner arc back over the top
    ` Z`                                                                               // vertical wall up (left gap)
}

// keyhole around the knob + bottom rotbut LED: the knob arc (top of the inner circle), then two
// vertical slot walls dropping straight down to the outer circle (rather than radiating from the
// centre), joined by a short tab arc across the bottom around the rotbut LED.
function keyholePath(cx: number, cy: number): string {
  const yIn = wallY(cy, KH_IN), yOut = wallY(cy, KH_OUT)
  return `M${cx - WALL_X} ${yIn} A${KH_IN} ${KH_IN} 0 1 1 ${cx + WALL_X} ${yIn}` + // knob arc, clockwise over the top
    ` L${cx + WALL_X} ${yOut}` +                                                    // vertical wall down (right gap)
    ` A${KH_OUT} ${KH_OUT} 0 0 1 ${cx - WALL_X} ${yOut}` +                          // tab arc across the bottom
    ` L${cx - WALL_X} ${yIn} Z`                                                     // vertical wall up (left gap)
}

// an arc along radius R from angle a0→a1 (degrees; 0 = top, clockwise), as an SVG path to stroke.
function arcPath(cx: number, cy: number, R: number, a0: number, a1: number): string {
  const pt = (a: number): [number, number] => { const r = (a * Math.PI) / 180; return [cx + R * Math.sin(r), cy - R * Math.cos(r)] }
  const [x0, y0] = pt(a0), [x1, y1] = pt(a1)
  return `M${x0} ${y0} A${R} ${R} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1} ${y1}`
}
// an LED drawn as a stroked path: bright = a wide soft glow + a solid core; dim = a faint stroke.
function ledStroke(d: string, color: string, bright: boolean, w: number, key?: string): ReactNode {
  return bright ? (
    <g key={key}>
      <path d={d} fill="none" stroke={color} strokeWidth={w + 4} strokeLinecap="round" opacity={0.4} />
      <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" />
    </g>
  ) : <path key={key} d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" opacity={0.3} />
}
// a round LED: bright = glow + colour + white-hot core; dim = a faint colour dot.
function ledDot(cx: number, cy: number, r: number, color: string, bright: boolean, key?: string): ReactNode {
  return bright ? (
    <g key={key}>
      <circle cx={cx} cy={cy} r={r + 2.5} fill={color} opacity={0.4} />
      <circle cx={cx} cy={cy} r={r} fill={color} />
      <circle cx={cx} cy={cy} r={r - 1.4} fill="#fff" opacity={0.6} />
    </g>
  ) : <circle key={key} cx={cx} cy={cy} r={r} fill={color} opacity={0.32} />
}

// Draw the LED ring for a rotary at (cx,cy): lit segments glow in `color`, the rest sit at `dim`
// opacity, and the HEAD segment(s) (the value position) burn brightest with a white-hot core — like
// the hardware. `dim` defaults to a faint unlit look; Hue Color raises it so no segment reads as off.
function ledRing(cx: number, cy: number, color: string, levels: number[], dim = 0.32): ReactNode[] {
  const out: ReactNode[] = []
  for (let i = 0; i < LED_GEO.length; i++) {
    const g = LED_GEO[i]
    const px = cx + g.rx * LED_R, py = cy + g.ry * LED_R
    const x1 = px - g.tx * LED_LEN, y1 = py - g.ty * LED_LEN
    const x2 = px + g.tx * LED_LEN, y2 = py + g.ty * LED_LEN
    const on = levels[i] > OFF
    const isHead = levels[i] === HEAD
    if (on) {
      out.push(<line key={`g${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={LED_W + (isHead ? 5 : 3)}
        strokeLinecap="round" opacity={isHead ? 0.5 : 0.3} />)
    }
    out.push(<line key={`s${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={LED_W}
      strokeLinecap="round" opacity={on ? 1 : dim} />)
    if (isHead) {
      out.push(<line key={`h${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeWidth={LED_W - 1.4}
        strokeLinecap="round" opacity={0.7} />)
    }
  }
  return out
}

function trunc(s: string): string {
  return s.length > 12 ? s.slice(0, 11) + '…' : s
}

export function Surface({ doc, layer, selected, onSelect, saveGroup, editSnap, selectAllHint, onSetValue }: SurfaceProps) {
  // membership tint: in save mode by selection group, in snapshot edit mode by stored scene; null = off
  const memberOf = (type: ControlType, id: string): boolean | null => {
    if (saveGroup != null) return readGroupMember(doc, saveGroup, type, id)
    if (editSnap != null) return readSnapshotMember(doc, editSnap, type, id)
    return null
  }
  // when tinting, a control's fill shows membership (green/red); else its colour or empty grey
  const fillFor = (type: ControlType, id: string, view: { colId: number } | undefined, empty: string) => {
    const m = memberOf(type, id)
    if (m != null) return m ? SAVE_GREEN : SAVE_RED
    return view ? colorFor(view.colId) : empty
  }
  const tinting = saveGroup != null || editSnap != null

  // Vertical-drag value editing on mapped rotaries/faders. We track the drag in a ref and listen on
  // window (so the pointer can leave the element); onSetValue is kept in a ref so the window handlers
  // always call the latest closure. suppressClick doubles as the "drag started" flag: once the press
  // moves past DRAG_THRESHOLD we both edit the value and swallow the click that follows pointerup, so
  // a drag doesn't also re-select. Disabled while tinting (save/edit modes show membership, not values)
  // and on unmapped controls (an inactive control has no value to edit — `active` gates it, matching
  // the rotbut/mute double-click guards), so a press there only selects.
  // `scale` = on-screen pixels per viewBox unit (the SVG is rendered to fit its container), captured at
  // press time so the drag tracks the cursor against the control's actual rendered size, not the viewBox.
  const drag = useRef<{ type: ControlType; id: string; startY: number; startVal: number; scale: number } | null>(null)
  const suppressClick = useRef(false)
  const onSetValueRef = useRef(onSetValue)
  onSetValueRef.current = onSetValue
  const startValueDrag = (type: ControlType, id: string, startVal: number, active: boolean) => (e: ReactPointerEvent) => {
    if (!onSetValue || tinting || !active) return
    suppressClick.current = false
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement
    const vbH = svg?.viewBox.baseVal.height
    const scale = svg && vbH ? svg.getBoundingClientRect().height / vbH : 1
    drag.current = { type, id, startY: e.clientY, startVal, scale }
    const move = (ev: PointerEvent) => {
      const d = drag.current; if (!d) return
      const dy = (ev.clientY - d.startY) / d.scale   // screen px → viewBox units
      if (!suppressClick.current) {
        if (Math.abs(dy * d.scale) < DRAG_THRESHOLD) return // still within click slop (screen px) — not a drag yet
        suppressClick.current = true                         // crossed the threshold → it's a drag
      }
      onSetValueRef.current?.(d.type, d.id, round5(clamp01(d.startVal - dy / DRAG_SENSITIVITY)), true)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      drag.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const colX = (col: number) => PAD + LEFT + col * COLW + COLW / 2
  const rotCY = (row: number) => TOP + row * ROT_GAP + ROT_R
  const muteY = TOP + ROWS * ROT_GAP + 12
  const faderY = muteY + MUTE_H + 22
  const width = PAD * 2 + LEFT + COLS * COLW
  const height = faderY + FADER_H + 24 + PAD

  const colKeys = (col: number) => [
    ...Array.from({ length: ROWS }, (_, r) => selKey('rotary', `${layer}${col}${r}`)),
    ...Array.from({ length: ROWS }, (_, r) => selKey('rotbut', `${layer}${col}${r}`)),
    selKey('fader', `${layer}${col}`), selKey('mute', `${layer}${col}`),
  ]
  const rotRowKeys = (row: number) => [
    ...Array.from({ length: COLS }, (_, c) => selKey('rotary', `${layer}${c}${row}`)),
    ...Array.from({ length: COLS }, (_, c) => selKey('rotbut', `${layer}${c}${row}`)),
  ]
  const faderRowKeys = () => Array.from({ length: COLS }, (_, c) => selKey('fader', `${layer}${c}`))
  const muteRowKeys = () => Array.from({ length: COLS }, (_, c) => selKey('mute', `${layer}${c}`))
  const allKeys = () => Array.from({ length: COLS }, (_, c) => colKeys(c)).flat()
  const full = (keys: string[]) => keys.length > 0 && keys.every((k) => selected.has(k))

  const cells: ReactNode[] = []

  // a rounded-rect label "button" that selects a group of controls (with an optional shortcut hint)
  const labelBtn = (key: string, x: number, y: number, w: number, text: string, keys: () => string[], hint?: string) => {
    const on = full(keys())
    return (
      <g key={key} style={{ cursor: 'pointer' }} onClick={(e) => onSelect(keys(), modeOf(e))}>
        <rect x={x} y={y} width={w} height={LBL_H} rx={6} fill={on ? '#2f3340' : '#23232a'} stroke={on ? '#fff' : '#454552'} strokeWidth={on ? 2 : 1} />
        <text x={x + w / 2} y={y + LBL_H / 2 + 3.5} textAnchor="middle" fontSize={10} fill={on ? '#fff' : '#9aa0ad'}>
          {text}{hint && <tspan dx={3} fontSize={8} fillOpacity={0.55}>{hint}</tspan>}
        </text>
      </g>
    )
  }

  // top-left corner: "All" selects every control on this layer (also Cmd/Ctrl+A)
  const headerY = 8
  cells.push(labelBtn('all', PAD, headerY, LEFT - 8, 'All', allKeys, selectAllHint))

  // column header buttons
  for (let col = 0; col < COLS; col++) {
    const cx = colX(col)
    cells.push(labelBtn(`h${col}`, cx - 34, headerY, 68, `Col ${col + 1}`, () => colKeys(col)))
  }
  // row label buttons (left gutter)
  for (let r = 0; r < ROWS; r++) cells.push(labelBtn(`lr${r}`, PAD, rotCY(r) - LBL_H / 2, LEFT - 8, `R${r + 1}`, () => rotRowKeys(r)))
  cells.push(labelBtn('lmute', PAD, muteY + MUTE_H / 2 - LBL_H / 2, LEFT - 8, 'Mut', muteRowKeys))
  cells.push(labelBtn('lfader', PAD, faderY + FADER_H / 2 - LBL_H / 2, LEFT - 8, 'Fdr', faderRowKeys))

  // controls
  for (let col = 0; col < COLS; col++) {
    const cx = colX(col)
    for (let row = 0; row < ROWS; row++) {
      const id = `${layer}${col}${row}`
      const cy = rotCY(row)
      const rot = readControl(doc, 'rotary', id)
      const rb = readControl(doc, 'rotbut', id)
      const rsel = selected.has(selKey('rotary', id))
      const bsel = selected.has(selKey('rotbut', id))
      // LED ring reflects the live value through the control's LED style; absent value reads as 0.
      // Unmapped rotaries still show their ring — dim grey, all-off — so the LEDs read as present.
      const rotVal = readStateValue(doc, 'rotary', id) ?? 0
      const levels = rot ? ledLevels(rot.feedbId, rotVal) : new Array(LED_COUNT).fill(OFF)
      // Hue Color style: the ring colour cycles with the value; every other style uses the fixed colId
      const isHue = rot?.feedbId === FEEDB_HUE
      const ringColor = rot ? (isHue ? hueCycleColor(rotVal) : colorFor(rot.colId)) : '#8e94a0'
      // knob body is dark (the colour lives in the ring); membership tint overrides it when shown
      const knobFill = tinting ? fillFor('rotary', id, rot, '#26262c') : (rot ? '#16161a' : '#26262c')
      // rotbut LED lives in the bottom gap: its colour, dim when off / bright when on (live state),
      // grey when unmapped. The live value reflects whatever the button's behaviour produces. It's
      // drawn as a single ring segment (same size/shape as the rotary LEDs) with a horizontal tangent.
      const butOn = (readStateValue(doc, 'rotbut', id) ?? 0) >= 0.5
      const butColor = tinting ? (rb ? fillFor('rotbut', id, rb, '#8e94a0') : '#8e94a0') : (rb ? colorFor(rb.colId) : '#8e94a0')
      // like a ring segment: dim (0.32) when off/unmapped; when on it matches the brightest HEAD
      // segments (the value extremes) — wider glow + white-hot core — not a regular lit segment.
      const butOpacity = tinting ? 1 : butOn ? 1 : 0.32
      const [bx, by] = butLedPos(cx, cy)
      const blx1 = bx - LED_LEN, blx2 = bx + LED_LEN
      cells.push(
        // Visuals (pointer-events off) sit under the hit targets: a horseshoe over the ring selects
        // the rotary; a single contour around the knob + bottom-gap LED selects the push button (rotbut).
        <g key={`r${id}`} pointerEvents="none">
          {/* Hue Color keeps every segment at least medium-bright (no dim segments), unlike line-from-left */}
          {ledRing(cx, cy, ringColor, levels, isHue ? 0.6 : 0.32)}
          <circle cx={cx} cy={cy} r={KNOB_R} fill={knobFill} stroke="#3c3c46" strokeWidth={1} />
          {/* centre dot: same thin outline as the knob; fills with the rotbut's dim colour whenever it's mapped */}
          <circle cx={cx} cy={cy} r={CENTER_R} fill={rb && !tinting ? butColor : 'none'} fillOpacity={0.32} stroke="#3c3c46" strokeWidth={1} />
          {butOn && !tinting && <line x1={blx1} y1={by} x2={blx2} y2={by} stroke={butColor} strokeWidth={LED_W + 5} strokeLinecap="round" opacity={0.5} />}
          <line x1={blx1} y1={by} x2={blx2} y2={by} stroke={butColor} strokeWidth={LED_W} strokeLinecap="round" opacity={butOpacity} />
          {butOn && !tinting && <line x1={blx1} y1={by} x2={blx2} y2={by} stroke="#fff" strokeWidth={LED_W - 1.4} strokeLinecap="round" opacity={0.7} />}
          <text x={cx} y={cy + ROT_R + 11} textAnchor="middle" fontSize={8} fill="#c4c8d0">{rot ? trunc(rot.name) : ''}</text>
          <path className={rsel ? 'hit sel' : 'hit'} d={horseshoePath(cx, cy)} pointerEvents="all"
            style={{ touchAction: 'none' }}
            onPointerDown={startValueDrag('rotary', id, rotVal, !!rot)}
            onClick={(e) => { if (suppressClick.current) { suppressClick.current = false; return } onSelect([selKey('rotary', id)], modeOf(e)) }} />
          <path className={bsel ? 'hit sel' : 'hit'} d={keyholePath(cx, cy)} pointerEvents="all"
            onClick={(e) => { e.stopPropagation(); onSelect([selKey('rotbut', id)], modeOf(e)) }}
            onDoubleClick={(e) => {
              if (!onSetValue || tinting || !rb) return
              e.stopPropagation()
              onSetValue('rotbut', id, (readStateValue(doc, 'rotbut', id) ?? 0) >= 0.5 ? 0 : 1, false)
            }} />
        </g>,
      )
    }
    const lc = `${layer}${col}`
    const mv = readControl(doc, 'mute', lc)
    const msel = selected.has(selKey('mute', lc))
    // top arc lights (bright) only when on; the shorter bottom arc + centre track presence: the bottom
    // arc is lit whenever mapped, the centre is bright when on / dim when off. All unlit when unmapped.
    const muteOn = (readStateValue(doc, 'mute', lc) ?? 0) >= 0.5
    const mCenY = muteY + MUTE_H / 2
    const mColor = mv ? colorFor(mv.colId) : '#8e94a0'
    cells.push(
      <g key={`m${lc}`}>
        {tinting ? (
          <circle cx={cx} cy={mCenY} r={MUTE_R} fill={fillFor('mute', lc, mv, '#26262c')} stroke="#54545e" strokeWidth={1} pointerEvents="none" />
        ) : (
          <g pointerEvents="none">
            {/* top arc: bright when on; otherwise fully off (grey), identical to a deactivated mute */}
            {ledStroke(arcPath(cx, mCenY, MUTE_R, -MUTE_TOP_DEG, MUTE_TOP_DEG), mv && muteOn ? mColor : '#8e94a0', !!mv && muteOn, MUTE_LED_W)}
            {ledStroke(arcPath(cx, mCenY, MUTE_R, 180 - MUTE_BOT_DEG, 180 + MUTE_BOT_DEG), mColor, !!mv, MUTE_LED_W)}
            {ledDot(cx, mCenY, MUTE_CEN_R, mColor, !!mv && muteOn)}
          </g>
        )}
        <circle className={msel ? 'ctlbox sel' : 'ctlbox'} cx={cx} cy={mCenY} r={MUTE_R + 4}
          fill="transparent" stroke="transparent" strokeWidth={1}
          onClick={(e) => onSelect([selKey('mute', lc)], modeOf(e))}
          onDoubleClick={(e) => {
            if (!onSetValue || tinting || !mv) return
            e.stopPropagation()
            onSetValue('mute', lc, muteOn ? 0 : 1, false)
          }} />
        <text x={cx} y={muteY + MUTE_H + 11} textAnchor="middle" fontSize={8} fill="#c4c8d0">{mv ? trunc(mv.name) : ''}</text>
      </g>,
    )
    const fv = readControl(doc, 'fader', lc)
    const fsel = selected.has(selKey('fader', lc))
    const fColor = fv ? colorFor(fv.colId) : '#8e94a0'
    // value positions the cap (1 = top, 0 = bottom); unmapped reads as 0 so the cap rests at the bottom.
    const fVal = Math.max(0, Math.min(1, readStateValue(doc, 'fader', lc) ?? 0))
    const capCY = faderY + CAP_H / 2 + (1 - fVal) * (FADER_H - CAP_H)
    const capLX0 = cx - (FADER_W / 2 - 7), capLX1 = cx + (FADER_W / 2 - 7)
    const ledCX = cx + FADER_W / 2 + 6, ledCY = faderY + 6
    cells.push(
      <g key={`f${lc}`}>
        {tinting ? (
          <rect x={cx - FADER_W / 2} y={faderY} width={FADER_W} height={FADER_H} rx={5} fill={fillFor('fader', lc, fv, '#26262c')} pointerEvents="none" />
        ) : (
          <g pointerEvents="none">
            {/* slot + side tick marks: long at top/middle/bottom, shorter triples at 20/40/60% of the
                way from top→middle and from bottom→middle (like the Drop's fader scale) */}
            <rect x={cx - TRACK_W / 2} y={faderY} width={TRACK_W} height={FADER_H} rx={4} fill="#121216" stroke="#3c3c46" strokeWidth={1} />
            {[
              { f: 0, long: true }, { f: 0.1 }, { f: 0.2 }, { f: 0.3 },
              { f: 0.5, long: true }, { f: 0.7 }, { f: 0.8 }, { f: 0.9 }, { f: 1, long: true },
            ].map(({ f, long }, i) => {
              const ty = faderY + 6 + f * (FADER_H - 12)
              const len = long ? 8 : 5
              return (
                <g key={i}>
                  <line x1={cx - TRACK_W / 2 - 3} y1={ty} x2={cx - TRACK_W / 2 - 3 - len} y2={ty} stroke="#3c3c46" strokeWidth={1} opacity={0.7} />
                  <line x1={cx + TRACK_W / 2 + 3} y1={ty} x2={cx + TRACK_W / 2 + 3 + len} y2={ty} stroke="#3c3c46" strokeWidth={1} opacity={0.7} />
                </g>
              )
            })}
            {/* cap + its colour LED line (bright when mapped, faint when not) */}
            <rect x={cx - FADER_W / 2} y={capCY - CAP_H / 2} width={FADER_W} height={CAP_H} rx={3} fill="#16161a" stroke="#3c3c46" strokeWidth={1} />
            {fv ? (
              <>
                <line x1={capLX0} y1={capCY} x2={capLX1} y2={capCY} stroke={fColor} strokeWidth={7} strokeLinecap="round" opacity={0.4} />
                <line x1={capLX0} y1={capCY} x2={capLX1} y2={capCY} stroke={fColor} strokeWidth={3.5} strokeLinecap="round" />
                <line x1={capLX0} y1={capCY} x2={capLX1} y2={capCY} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" opacity={0.55} />
              </>
            ) : (
              <line x1={capLX0} y1={capCY} x2={capLX1} y2={capCY} stroke={fColor} strokeWidth={3.5} strokeLinecap="round" opacity={0.3} />
            )}
            {/* upper-right circle LED (replaces the Drop's up/circle/down LEDs) */}
            {ledDot(ledCX, ledCY, FADER_CIRC_R, fColor, !!fv)}
          </g>
        )}
        {/* faders are the one control whose value can be dragged even while deactivated (active flag = true) */}
        <rect className={fsel ? 'ctlbox sel' : 'ctlbox'} x={cx - FADER_W / 2} y={faderY} width={FADER_W} height={FADER_H} rx={5}
          fill="transparent" stroke="transparent" strokeWidth={1} style={{ touchAction: 'none' }}
          onPointerDown={startValueDrag('fader', lc, fVal, true)}
          onClick={(e) => { if (suppressClick.current) { suppressClick.current = false; return } onSelect([selKey('fader', lc)], modeOf(e)) }} />
        <text x={cx} y={faderY + FADER_H + 12} textAnchor="middle" fontSize={8} fill="#c4c8d0">{fv ? trunc(fv.name) : ''}</text>
      </g>,
    )
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Drop layer ${layer + 1}`} className="surface"
      style={{ background: '#1b1b1f', borderRadius: 10, maxWidth: '100%' }}
      onClick={(e) => { if (e.target === e.currentTarget) onSelect([], 'replace') }}>
      {cells}
    </svg>
  )
}
