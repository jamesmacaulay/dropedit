# dropedit

A browser-based editor for **Neuzeit Drop** project files, hosted at https://jamesmacaulay.github.io/dropedit/.

## Features

- Import a Drop project `.json` file from your computer or start from a Clean Init or DAW Init template, download after editing
- Click / shift-click / row & column / "All" selection, with multi-select batch editing of any or all controls in a layer at once
- Copy & paste multiple selected controls within or between layers
- Undo / redo with autosave to localStorage
- MIDI Output Device management with included preset CSVs from [pencilresearch/midi](https://github.com/pencilresearch/midi) for human-readable parameter names
- Per-control editing of name, value, color, behavior, LED style, MIDI output slots, and selection groups
- Per-output-slot editing of device, MIDI channel, message type, message value (assignable with friendly param names from device preset), curve config, etc.
- Snapshot management mirroring the Drop UI: **Save** (selection-group-aware) and **Jump/Load** (merge-recall), plus an **Edit** mode to change which controls a snapshot stores (green/red on the surface), the value it stores for each, and the snapshot's own one-shot MIDI output slots
- 100% client-side: your project never leaves the browser.

## Known limitations / to revisit

- **`csvRef` high 16 bits** are a checksum/flags that aren't reproduced yet (only the verified
  low-16 row index is written). A control still works fully — its CC, channel, and display
  `name` are independent of `csvRef`; the checksum is the Drop's re-link/feedback metadata.
  Centralized in `presetDb.makeCsvRef` for a one-line upgrade once solved on hardware.
- The enum/value encodings (behavior, LED style, curve, port, message type, Min/Max scaling, Flex XY,
  Program+Bank packing) are **decoded from hardware captures** — see [`docs/drop-format.md`](docs/drop-format.md).
  Unknown/future codes degrade gracefully to a "Custom" raw-value field.
- **You can save invalid data.** Some fields constrain the valid values of others. The Drop's own UI
  enforces those invariants; dropedit doesn't enforce all of them, so you can export a project with
  combinations the hardware wouldn't let you create. The Drop likely tolerates most gracefully, but
  unusual values may give unusual results.

## Develop

Uses [Bun](https://bun.sh). Dependencies install with lifecycle scripts disabled.

```bash
bun install --ignore-scripts
bun run dev      # Vite dev server
bun run test     # Vitest (model + UI smoke)
bun run build    # tsc --noEmit && vite build  → dist/
```

(Plain npm works too: `npm install && npm run dev`.)

For contributors/agents: [`CLAUDE.md`](CLAUDE.md) is the architecture + working guide, and
[`docs/drop-format.md`](docs/drop-format.md) documents the reverse-engineered Drop `.json` format.

## How it works

- **`src/model/`** — pure TypeScript, no DOM, fully unit-tested:
  - `jsonDoc` — span-preserving JSON parser + splice-based edits. Untouched bytes round-trip
    **exactly** (preserves tab indent, trailing-zero floats like `52.000`, key order, and the
    file's empty-object quirks). This is why we don't use `JSON.stringify`.
  - `controlId` — control IDs encode physical position: rotary/rotbut `<layer><col><row>`,
    fader/mute `<layer><col>`. The first digit is the layer (so "copy layer" is a digit rewrite).
  - `presetDb` — parses a midi-main device CSV into parameters; `csvRef` low 16 bits = CSV row
    index (verified). See the `csvRef` note below.
  - `dropProject` — typed read-views (controls, slots, layers, devices, selection groups).
  - `enums` — decoded id→name maps (behavior, LED style, curve, message type, port) plus the
    value-encoding helpers (Min/Max ↔ 14-bit scaling, Flex XY packing, Program+Bank float).
  - `edits` — all mutations return new text: bulk field set, `assignParam`, create/remove control,
    `copyLayer`, positional multi copy/paste (`copyControls`/`pasteControls`, and the snapshot
    variants), `saveSnapshot` (selection-group-aware) / `loadSnapshot` (merge),
    `setSnapshotValue` / `setSnapshotMembers` (edit an existing snapshot's stored scene), `setGroupMember`.
- **`src/ui/`** — React: `Surface` (SVG hardware), `Sidebar` (per-selection editing), `EnumField`
  (dropdown + Custom fallback), `SnapshotGrid` + `SnapshotMeta`, `DeviceEditor`, and `App` (owns the
  project text; threads undo/redo history, localStorage autosave, and the snapshot Save/Edit/Jump-Load modes).
- **`scripts/`** — `sync-midi-db.mjs` (refresh the bundled preset DB from a pinned commit) and
  `decode-enums.mjs` (decode the Drop's enum/value encodings from a hardware capture).

## Hosting

Built as a static site and deployed to GitHub Pages from `.github/workflows/deploy.yml`
(builds with Bun, deploys on push to `main`): **https://jamesmacaulay.github.io/dropedit/**.

## License

The **software** is MIT — see [LICENSE](LICENSE).

The bundled **MIDI device-preset database** in [`src/data/devices/`](src/data/devices/) is **not** MIT.
It is vendored verbatim from [pencilresearch/midi](https://github.com/pencilresearch/midi) and licensed
**[CC-BY-SA-4.0](https://creativecommons.org/licenses/by-sa/4.0/)** — see
[`src/data/devices/LICENSE`](src/data/devices/LICENSE) and [`SOURCE.md`](src/data/devices/SOURCE.md).
If you redistribute that data you must preserve its attribution and license, and any adaptation of it
must also be CC-BY-SA-4.0.
