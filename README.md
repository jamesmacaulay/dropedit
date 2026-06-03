# dropedit

A browser-based editor for **Neuzeit Drop** project files (`.json`). Open a Drop project,
click controls on a stylized hardware surface, and edit their MIDI settings in a sidebar.

Features:
- Visual hardware **surface** (rotaries + push, faders, mutes) with click / shift-click multi-select,
  row / column / "All" group selection, and **[multiple values]** editing across a mixed selection
- **Positional multi-select copy / paste** (anchor-relative; a single copied control broadcasts to the
  whole selection) and delete — with **⌘/Ctrl+C/V** and Backspace/Delete; switching layers keeps the
  selection in place
- Per-control **General** (active, name, colour, behavior, LED style, value) and **Output slots**
  (up to 8: target device, message type, number, channel, range, curve). Enum fields (behavior, LED
  style, curve, message type, port) are **decoded dropdowns** with a **Custom** fallback for any
  unknown/future-firmware code; Min/Max show in the message type's range, Program Change / Program+Bank
  and the Flex curve get tailored editors
- Per-output-slot **parameter assignment** from a device's preset CSV (friendly names)
- **Snapshots**: 4×5 pad grid with banks; **Save** (selection-group-aware — choose name/colour/group,
  pick which controls to include) and **Jump/Load** (merge-recall) flows
- A **Devices** editor for the 8 MIDI destinations (ports, channel, virtual cable, preset CSV)
- **Undo / redo** (⌘/Ctrl+Z · ⇧⌘Z), **autosave to localStorage** (restored on reload),
  **Clean Init / DAW Init** starters, and **download** with an editable filename
- The full **pencilresearch/midi preset database** (~393 devices) is bundled and lazy-loaded; you can
  also upload your own CSV per device. Responsive layout for narrow/mobile viewports.

100% client-side: your project never leaves the browser.

> One workflow this enables: drive numbered Deluge tracks via the experimental MIDI-follow
> expansion by giving each column a channel and CC parameters from the Deluge preset — no
> per-song MIDI learns. But the editor is device-agnostic.

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
    `copyLayer`, **positional multi copy/paste** (`copyControls`/`pasteControls`, and the snapshot
    variants), `saveSnapshot` (selection-group-aware) / `loadSnapshot` (merge), `setGroupMember`.
- **`src/ui/`** — React: `Surface` (SVG hardware), `Sidebar` (per-selection editing), `EnumField`
  (dropdown + Custom fallback), `SnapshotGrid`, `DeviceEditor`, and `App` (owns the project text;
  threads undo/redo history, localStorage autosave, and the snapshot Save/Jump-Load modes).
- **`scripts/`** — `sync-midi-db.mjs` (refresh the bundled preset DB from a pinned commit) and
  `decode-enums.mjs` (decode the Drop's enum/value encodings from a hardware capture).

## Known limitations / to revisit

- **`csvRef` high 16 bits** are a checksum/flags that aren't reproduced yet (only the verified
  low-16 row index is written). A control still works fully — its CC, channel, and display
  `name` are independent of `csvRef`; the checksum is the Drop's re-link/feedback metadata.
  Centralized in `presetDb.makeCsvRef` for a one-line upgrade once solved on hardware.
- The enum/value encodings (behavior, LED style, curve, port, message type, Min/Max scaling, Flex XY,
  Program+Bank packing) are **decoded from hardware captures** — see [`docs/drop-format.md`](docs/drop-format.md).
  Unknown/future codes degrade gracefully to a "Custom" raw-value field.
- **Snapshot editing** is partial: you can Save (group-aware) and Jump/Load, but editing an existing
  snapshot's stored values / its one-shot MIDI output slots is still on the way.
- **Not yet verified on real hardware** — load a generated project on a Drop before trusting it.

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
