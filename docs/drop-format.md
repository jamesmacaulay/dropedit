# Neuzeit Drop project (`.json`) format

The Neuzeit Drop saves each project as a single JSON file. This document describes that file's
structure — the control mappings, snapshots, device list, and the value encodings used inside them.

> This is a hardware-verified write-up, against **firmware 2.01**. The authoritative spec,
> [`jsonDocu_FW_2_01.txt`](jsonDocu_FW_2_01.txt), was contributed by Thomas Hutmann (Neuzeit
> Instruments) and is labelled for firmware 2.05; this document follows it, with a few corrections
> where the 2.01 hardware disagreed (colour, behaviour, LED-style and curve enums) and the `csvRef`
> encoding filled in. Later firmware may add or change fields.

## Top-level keys

A project is one JSON object. Its keys, in the order they appear on disk:

| key | holds |
|-----|-------|
| `type` | file-type tag — always `"PROJ"` |
| `version` | format version (the oldest firmware that can read the file) |
| `versionInstalled` | firmware version that wrote the file |
| `state` | each control's current value, restored on load |
| `device` | the 8 MIDI destinations |
| `map` | control → MIDI mappings, and snapshots |
| `chain` | snapshot chains |
| `clk` | clock / tempo |
| `grid` | snapshot-grid note / DAW mode |
| `layers` | per-layer names and the A/B button modes |
| `cvOut` / `cvIn` | CV jack configuration |
| `remote` | remote-control modes |
| `settings` | project settings (including selection groups) |

The sections below detail `map`, `state`, `device`, and `settings.selGroup`, plus the preset-CSV format
and the enum codes used throughout.

## `map` — control mappings

`map` has one object per control type: `rotary`, `rotbut` (the rotary's push switch), `fader`, `mute`,
and `snp` (snapshots). Each maps a control **id** to its configuration.

### Control ids encode physical position

The first digit is the layer (0–7) for everything except snapshots. Columns and rows are 0-based.

| type | id | grid |
|------|----|------|
| `rotary` | `<layer><col><row>` (3 digits) | 8 cols × 4 rows |
| `rotbut` | `<layer><col><row>` (3 digits) | the rotary's push, same grid |
| `fader` | `<layer><col>` (2 digits) | 8 faders |
| `mute` | `<layer><col>` (2 digits) | 8 mute buttons |
| `snp` | `<bank><col><row>` (bank is 2 digits, 00–19) | global, no layer; 4 cols × 5 rows per bank |

Because the layer is the leading digit, the same physical control on a different layer differs only in
that digit.

### A control entry

```jsonc
"100": {
  "name": "Delay Amount",   // display name (max 15 chars; the buffer is 16 bytes incl. a NUL)
  "colId": 8,               // colour index (0–11)
  "dropOrder": 0,           // position in the DROP output order
  "behavId": 1,             // physical behaviour (see Enums)
  "feedbId": 0,             // LED ring style (see Enums)
  "feedbSlotVis": 1,        // which output slot the LED feedback follows
  "feedbSlot": 1,           // slot whose value drives the LED
  "0": { /* output slot — see below */ }
}
```

A control is **active simply by being present** in its `map.<type>` object — there is no "active"
field. An entry can exist with only the chrome fields (name/colour/…) and no output slot.

### Output slots

A control can carry several numbered output slots (`"0"`, `"1"`, … up to 8), each an independent MIDI
message, so one control can drive multiple destinations or message types at once.

```jsonc
"0": {
  "inUse": 1,            // 1 = enabled, 0 = present but off
  "target": 0,           // index (0–7) into the `device` list
  "msgType": 3,          // message type (see Enums)
  "ch": 9,               // MIDI channel, 1-based
  "msgNr": 52,           // CC / note number
  "csvRef": 1509949455,  // preset reference (see csvRef)
  "maxOut": 16383,       // output range, max ...
  "minOut": 0,           //   ... and min — both 14-bit (see Value encoding)
  "curveId": 0           // response curve (see Enums)
}
```

#### Value encoding (Min/Max, Flex, Program+Bank)

`minOut` and `maxOut` are **not** the displayed numbers. They're stored as a 14-bit value (0–16383)
spanning the message type's display range:

```
displayed = min + round(stored / 16383 × (max − min))
```

- **CC / Note / Aftertouch** — display range 0–127 (so `16383` → `127`, `8256` → `64`).
- **CC14 / NRPN** — 0–16383 (stored equals displayed).
- **Pitch bend** — ±8192 (`stored = displayed + 8192`).

Two cases reuse these fields:

- The **Flex curve** stores two XY points instead of a min/max: `maxOut` is XY1, `minOut` is XY2, each
  packed as `(x << 7) | y` with `x` and `y` in 0–127.
- **Program Change / Program+Bank** put the program number in the slot value (`maxOut`, 0–127).
  **Program+Bank** also packs its two bank-select bytes into `msgNr` as a float `MSB.LSB` — e.g.
  `5.009` means MSB 5, LSB 9.

#### `csvRef`

When a slot is mapped by choosing a parameter from a device's preset CSV, `csvRef` records which CSV
row it came from. It is **`0` when the slot wasn't assigned from a CSV** (and stays `0` if the CC is set
by hand).

When set, it packs the row index and the CC into a 32-bit integer:

```
csvRef = 0x40000000 | (cc << 23) | rowIndex
```

| bits | meaning |
|------|---------|
| 0–15 | the **CSV row index** — 0-based, header excluded, blank lines counted |
| 23–29 | the **CC number** (0–127) — the same value as `msgNr` |
| 30 | a flag bit, set whenever a CSV reference is present |

`csvRef` therefore depends only on the CC and the row; renaming or otherwise editing the control
doesn't change it. Examples: Delay/Amount (CC 52, row 15) → `0x5A00000F`; Reverb amount (CC 91,
row 75) → `0x6D80004B`; Master level (CC 7, row 57) → `0x43800039`.

### Snapshots (`map.snp`)

A snapshot is a global pad that stores a "scene". Pads are arranged in banks of 4 columns × 5 rows.
A snapshot entry has the same chrome fields as a control (`name`, `colId`, `behavId`, `feedb…`), up to
8 output slots (`"0"`…`"7"`, identical in shape to a control slot — this is where snapshot-only
**Program Change / Program+Bank** messages live), and a `data` object holding the stored scene. The
output slots come **before** `data` in the entry:

```jsonc
"data": { "rotary": { "100": 0.5, ... }, "rotbut": {...}, "mute": {...}, "fader": {...} }
```

`data` maps control ids to stored values (same 0–1 format as `state`) and contains **only the controls
the snapshot captured** — not necessarily every control. Recalling a snapshot writes those stored
values into `state` and leaves the rest untouched (a merge, not a full reset).

## `state` — live control values

`state.rotary`, `state.rotbut`, `state.mute`, `state.fader` each map a control id to its current value
in `0`–`1`. This is the position a control is restored to when the project loads; recalling a snapshot
updates the ids it stores.

## `settings.selGroup` — selection groups

There are 8 selection groups (`"0"`…`"7"`), each `{ "sgCol": <colour>, "data": [ … ] }`. A selection
group marks which controls it contains (used to choose which controls a snapshot captures).

`data` is an **80-byte bitmask**. Each byte is one row of one layer; a layer occupies 10 consecutive
bytes in this order:

```
rotary row1, rotary row2, rotary row3, rotary row4,
rotbut row1, rotbut row2, rotbut row3, rotbut row4,
mute, fader
```

So for layer `L`: `byteIndex = L*10 + rowKind`, where `rowKind` is the row (0–3) for a rotary, `4+row`
for a rotbut, `8` for the mute row, and `9` for the fader row. **Within a byte each column is one bit,
LSB first**: column 1 (leftmost) = bit 0 (value `1`), … column 8 = bit 7 (value `128`). `255` means all
8 columns, `0` means none. (8 layers × 10 bytes = 80.)

## `device` — the 8 MIDI destinations

`device.0` … `device.7`, each:

```jsonc
{ "inUse", "name", "portOut", "portIn", "cableIdOut", "cableIdIn",
  "preDrop", "ch", "csvInUse", "csvPath", "csvFile", "merge" }
```

A slot's `target` is an index into this list. `portOut`/`portIn` are the MIDI port (see Enums).
`cableIdOut`/`cableIdIn` are the USB **virtual cable**, stored **0-based** (the device's own UI shows
it 1-based). `csvPath` + `csvFile` point at a preset CSV in the Drop's `midi-main` folder — e.g.
`"csvPath": "/midi-main/Synthstrom"`, `"csvFile": "Deluge.csv"` — which supplies friendly parameter
names for slots aimed at that device.

## Device preset CSV (`midi-main`)

A device's preset CSV lives at `/midi-main/<Manufacturer>/<Device>.csv` on the Drop. Its columns
include `manufacturer, device, section, parameter_name, …, cc_msb, …`. A parameter's **row index**
(0-based, header excluded, blank lines counted) is what a slot's `csvRef` points at, and `cc_msb` is
the CC that parameter maps to.

## Enums

These numeric codes are firmware-assigned and are **not** in menu order.

- **`msgType`** — `2` Note On · `3` CC · `5` Pitch bend · `6` Aftertouch · `7` CC14 · `8` NRPN ·
  `9` Program Change · `10` Program+Bank · `12` CC14 LSB first.
- **`behavId`** (one enum shared across control types) — `0` Precision · `1` Dynamic Pot ·
  `2` Dynamic Fast · `3` Toggle · `4` Temporary · `5` Quick Turn · `6` Reset Left · `7` Reset Mid ·
  `8` Reset Right · `9` Reset L/R · `10` Reset R/L · `11` One per Layer · `12` Layer A only.
- **`feedbId`** (LED ring style on rotary turn) — `0` Line from left · `1` Line from center · `2` Dot ·
  `3`–`26` "2 Steps".."25 Steps" · `27` Blank · `29` Line from right · `30` Hue Color · `31` MIDI Level ·
  `32` MIDI Clip LED · `33`–`36` MIDI Col Dot / Line from left / center / right. (`28` is the id
  non-rotary elements carry.)
- **`curveId`** — `0` Linear · `1`/`2` Exp-/Exp+ · `3`–`8` half curves · `9`–`13` On/Off
  (50/25/75/1/99) · `14`–`28` step curves (3..16, then 25 Steps) · `29`–`32` Relative 1–4 · `33` Flex ·
  `34` Feedback Only.
- **`portOut` / `portIn`** — `0` Off · `1` USB1 · `2` USB2 · `3` TRS1 · `4` TRS2 · `5` TRS3 · `6` TRS4.

## Formatting notes

The Drop's writer formats the file in a specific way. If you edit the file in place, these quirks are
worth preserving, because re-serializing from scratch generally won't reproduce them:

- **Tab** indentation; large objects use one field per line.
- Numbers sometimes carry trailing zeros (`52.000`, `2.00`, `0.40932`) and sometimes don't — it varies
  by field and firmware version.
- Key order is significant in places and inconsistent in others.
- Empty objects appear as both `{}` and a multi-line block.

The safest approach is to change only the bytes you intend to and leave everything else exactly as it
was.
