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
  "behavId": 1,          // physical behavior — global enum 0–12 (see Enums below)
  "feedbSlotVis": 1,
  "feedbId": 0,          // LED ring style (see Enums below)
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
  "msgType": 3,      // message type (see Enums)
  "ch": 9,           // MIDI channel, 1-based
  "csvRef": 1509949455,
  "msgNr": 52,       // CC / note number (see "Value encoding" for Program+Bank's float quirk)
  "maxOut": 16383, "minOut": 0,   // output range, stored as a 14-bit value (see "Value encoding")
  "curveId": 0       // output curve (see Enums)
}
```

#### Value encoding (Min/Max, Flex, Program+Bank)

`minOut`/`maxOut` are **not** the displayed values — they're stored as a 14-bit number (0–16383)
spanning the message type's display range, so the editor scales them:
`displayed = min + round(stored / 16383 × (max − min))`. Per type: CC / Note / Aftertouch use 0–127
(so `16383` shows as `127`, `8256` as `64`); CC14 / NRPN are 0–16383 (1:1); Pitch bend is ±8192
(`stored = displayed + 8192`). Helpers: `enums.storedToDisplay` / `displayToStored`.

Two special cases reuse these fields:
- **`Flex` curve** (`curveId 33`) packs its two XY points into `maxOut` (XY1) and `minOut` (XY2),
  each as `(x << 7) | y` with `x,y` 0–127. (`enums.packXY`/`unpackXY`.)
- **`Program Change` / `Program+Bank`** carry the program number as the slot **value** (`maxOut`,
  0–127); `Program+Bank` additionally packs its two bank-select bytes into **`msgNr` as a float**
  `MSB.LSB` (e.g. `5.009` = MSB 5, LSB 9). (`enums.packBank`/`unpackBank`.)

### `csvRef`

`csvRef = (checksum16 << 16) | rowIndex16`.
- **Low 16 bits = the 0-based CSV data-row index** (header excluded) — **VERIFIED** (Amount=15, Rate=16,
  Reverb amount=75, HPF Freq=46, Master level=57). `presetDb.makeCsvRef` writes this.
- **High 16 bits = a checksum/flags — NOT reproduced.** A control still functions without it
  (msgNr/ch/name are independent); it's the Drop's re-link / value-feedback metadata.

## `snp` — snapshots

A snapshot is a global "scene" pad (banks of 4 cols × 5 rows; the device exposes 20 banks). Its entry
has the same chrome fields as a control (name, colId, behavId 4, feedb*), a `data` object holding the
stored scene, **and** up to 8 output slots (`"0".."7"`, same shape as a control slot) that fire one-shot
MIDI when the snapshot executes — this is where snapshot-only **Program Change / Program+Bank** messages
live:

```jsonc
"data": { "rotary": { "100": 0, ... }, "rotbut": {...}, "mute": {...}, "fader": {...} }
```

`data` holds only the controls the snapshot stores — it's the controls in the **selection group** used
to save it, not necessarily all of them (values use the same format as the top-level `state`).
`saveSnapshot` is selection-group-aware (stores just the group's controls); `loadSnapshot` **merges**
(writes only the stored controls into `state`, leaving the rest — the device's "Jump" behaviour).

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

A slot's `target` indexes this array. `portOut`/`portIn` are the MIDI port (enum below); `cableIdOut`/
`cableIdIn` are the USB **virtual cable**, stored **0-indexed** (the device shows it 1-based, so the
editor displays `stored + 1`). `csvPath`+`csvFile` point at a preset CSV in the `midi-main` database
(e.g. `/midi-main/Synthstrom` + `Deluge.csv`) that supplies friendly parameter names for slots aimed at
that device.

## Device preset CSV (`midi-main`)

Columns: `manufacturer, device, section, parameter_name, …, cc_msb, …`. `dropedit` parses
`section`, `parameter_name`, `cc_msb`, and the 0-based row index (= `csvRef` low bits). The **full
[pencilresearch/midi](https://github.com/pencilresearch/midi) collection (~393 devices) is bundled**
(`src/data/devices/`, lazy-loaded per device; refresh via `scripts/sync-midi-db.mjs`); users can also
upload their own CSV per device.

## Enums (decoded from hardware captures — `enums.ts`)

Codes are firmware-assigned and **not** in menu order; the UI shows a `code · name` dropdown with a
`Custom…` raw-value fallback for anything unmapped. Decoded via `scripts/decode-enums.mjs`.

- **`msgType`**: `2` Note On · `3` CC · `5` Pitch bend · `6` Aftertouch · `7` CC14 · `8` NRPN ·
  `9` Program Change · `10` Program+Bank · `12` CC14 LSB first.
- **`behavId`** (one global enum across control types): `0` Precision · `1` Dynamic Pot · `2` Dynamic
  Fast · `3` Toggle · `4` Temporary · `5` Quick Turn · `6` Reset Left · `7` Reset Mid · `8` Reset Right ·
  `9` Reset L/R · `10` Reset R/L · `11` One per Layer · `12` Layer A only.
- **`feedbId`** (LED ring style, rotary turn): `0` Line from left · `1` Line from center · `2` Dot ·
  `3..26` = "2 Steps".."25 Steps" · `27` Blank · `29` Line from right · `30` Hue Color · `31` MIDI Level ·
  `32` MIDI Clip LED · `33..36` MIDI Col Dot / Line from left / center / right. (`28` is an unused hole —
  it's the feedback id non-rotary elements carry.)
- **`curveId`**: `0` Linear · `1/2` Exp-/Exp+ · `3..8` half curves · `9..13` On/Off (50/25/75/1/99) ·
  `14..28` step curves (3..16, then 25 Steps) · `29..32` Relative 1–4 · `33` Flex · `34` Feedback Only.
- **`portOut`/`portIn`**: `0` Off · `1` USB1 · `2` USB2 · `3` TRS1 · `4` TRS2 · `5` TRS3 · `6` TRS4
  (verified — `portIn` shares the same enum).

To decode/refresh an enum: build a capture project per `node scripts/decode-enums.mjs instructions`,
then `decode <file.json>`. The one thing still unmapped is `csvRef`'s high 16 bits (a checksum/flags).

## Formatting (why we splice instead of regenerate)

Tab indentation; one attribute per line for large objects; numbers sometimes carry trailing zeros
(`52.000`, `2.00`, `0.40932`) and sometimes don't, depending on firmware version; key order is
meaningful-ish and inconsistent; empty objects appear as both `{}` and multiline. A regenerating
printer can't reproduce all that, so `jsonDoc.ts` keeps source spans and only rewrites the exact
regions you edit. The round-trip tests (`test/jsonDoc.test.ts`) assert byte-exact identity on no-op.
