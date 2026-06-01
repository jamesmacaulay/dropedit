# Neuzeit Drop project (`.json`) format

Reverse-engineered from real Drop projects. This is what `dropedit` reads and writes. Treat it as the
source of truth for the data model; the editor's job is to mutate these structures while preserving
every untouched byte (see the "Formatting" section — it's why we use span-preserving edits, not
`JSON.stringify`).

## Top-level keys (order preserved on disk)

`type, version, versionInstalled, state, device, map, chain, clk, grid, layers, cvOut, cvIn, remote, settings`

`dropedit` only edits `map`, `state`, `device`, and `settings.selGroup`. Everything else round-trips
untouched.

## `map` — control mappings, by control type

Sections: `rotary`, `rotbut` (rotary push), `fader`, `mute`, `snp` (snapshots).

**Control IDs encode physical position. The first digit is the layer (0–7)** for everything except
snapshots:

| Type            | ID format                | Grid                          |
|-----------------|--------------------------|-------------------------------|
| `rotary`        | `<layer><col><row>` (3)  | 8 cols × 4 rows (turn)        |
| `rotbut`        | `<layer><col><row>` (3)  | the rotary's push, same grid  |
| `fader`         | `<layer><col>` (2)       | 8 faders                      |
| `mute`          | `<layer><col>` (2)       | 8 mute buttons                |
| `snp`           | `<bank:2><col><row>` (4) | **global, no layer**; 4 cols × 5 rows per bank, banks 0–99 |

So "copy a layer" = rewrite the first id digit. `controlId.ts` encapsulates all of this.

### A control entry

```jsonc
"100": {
  "name": "Delay Amount",
  "colId": 8,            // colour 0–11 (see palette.ts)
  "dropOrder": 0,
  "behavId": 1,          // physical behavior (see enums below)
  "feedbSlotVis": 1,
  "feedbId": 0,          // LED style (enum unknown)
  "feedbSlot": 1,
  "0": { /* output slot — see below */ }
}
```

**"Active" is not a field — it is presence.** A control element is active iff its entry exists in
`map.<type>`. dropedit's Active toggle creates (chrome-only, no slot) or removes the entry; it keeps a
session stash so re-activating restores prior settings (hardware "remembers" too).

### Output slots

A control can have multiple numbered output slots (`"0"`, `"1"`, … up to 8) — each an independent MIDI
message, so one knob can drive several destinations/messages.

```jsonc
"0": {
  "inUse": 1,        // 1 = enabled
  "target": 0,       // index into the 8 `device` entries
  "msgType": 3,      // 2 = Note, 3 = CC (others exist)
  "ch": 9,           // MIDI channel, 1-based
  "csvRef": 1509949455,
  "msgNr": 52,       // CC number (or note number for msgType 2)
  "maxOut": 16383, "minOut": 0,   // output range (scale/invert)
  "curveId": 0
}
```

### `csvRef`

`csvRef = (checksum16 << 16) | rowIndex16`.
- **Low 16 bits = the 0-based CSV data-row index** (header excluded) — **VERIFIED** (Amount=15, Rate=16,
  Reverb amount=75, HPF Freq=46, Master level=57). `presetDb.makeCsvRef` writes this.
- **High 16 bits = a checksum/flags — NOT reproduced.** A control still functions without it
  (msgNr/ch/name are independent); it's the Drop's re-link / value-feedback metadata.

## `snp` — snapshots

A snapshot is a global "scene" pad. Its entry has the same chrome fields as a control (name, colId,
behavId 4, feedb*) plus a `data` object instead of output slots:

```jsonc
"data": { "rotary": { "100": 0.5, ... }, "rotbut": {...}, "mute": {...}, "fader": {...} }
```

Values are normalized 0..1 (same format as the top-level `state`). On hardware a snapshot stores **only
the controls in the selection group used to save it** — dropedit's `saveSnapshot` currently captures
*all* of `state` (a known simplification; making it selection-group-aware is a TODO).

## `state` — live control values

`state.{rotary,rotbut,mute,fader}` map a control id to its current value (0..1). Editable via
`setStateValue`. Snapshots recall into here (`loadSnapshot`).

## `settings.selGroup` — selection groups

8 groups (`"0".."7"`), each `{ "sgCol": <colour>, "data": [ 80 bytes ] }`.

Each byte is **one row of one layer**. Per-layer layout (10 rows):
`[rot r1, rot r2, rot r3, rot r4, rotbut r1..r4, mute, fader]`.
So `index = layer*10 + rowKind`, where `rowKind` = row (0–3) for rotary, `4+row` for rotbut, `8` for
mute, `9` for fader. **Within a byte, the column is a bit, MSB-first: column 1 = bit 7 … column 8 =
bit 0.** `255` = all 8 columns in the group, `0` = none. See `dropProject.selGroupLocation` /
`edits.setGroupMember`.

## `device` — the 8 target destinations

`device.0..7`, each:
`{ inUse, name, portOut, portIn, cableIdOut, cableIdIn, preDrop, ch, csvInUse, csvPath, csvFile, merge }`.

A slot's `target` indexes this array. `csvPath`+`csvFile` point at a preset CSV in the `midi-main`
database (e.g. `/midi-main/Synthstrom` + `Deluge.csv`) that supplies friendly parameter names for slots
aimed at that device. **Ports appear 1-indexed with 0 = off** — tentative labels
`0 Off, 1 USB1, 2 USB2, 3 TRS1, 4 TRS2, 5 TRS3, 6 TRS4` (Deluge's `portOut 3` = TRS1). Verify on hardware.

## Device preset CSV (`midi-main`)

Columns: `manufacturer, device, section, parameter_name, …, cc_msb, …`. `dropedit` parses
`section`, `parameter_name`, `cc_msb`, and the 0-based row index (= `csvRef` low bits). `Synthstrom/
Deluge.csv` is bundled; others can be uploaded per device.

## Observed enum values (incomplete — names unknown)

- `msgType`: 2 = Note, 3 = CC (others exist: CC14/NRPN/etc.)
- `behavId`: rotary `1`, fader `11`, mute `4`, rotbut(push) `5` — these are the per-type defaults; the
  full id→name map (Precision / Dynamic Pot / Toggle / Temporary / …) is unknown.
- `feedbId`: seen `0`, `2`, `28`. `curveId`: seen `0`, `9`. Maps unknown.

To decode any enum: change one option on the hardware, save, and diff the JSON.

## Formatting (why we splice instead of regenerate)

Tab indentation; one attribute per line for large objects; numbers sometimes carry trailing zeros
(`52.000`, `2.00`, `0.40932`) and sometimes don't, depending on firmware version; key order is
meaningful-ish and inconsistent; empty objects appear as both `{}` and multiline. A regenerating
printer can't reproduce all that, so `jsonDoc.ts` keeps source spans and only rewrites the exact
regions you edit. The round-trip tests (`test/jsonDoc.test.ts`) assert byte-exact identity on no-op.
