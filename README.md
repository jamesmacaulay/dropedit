# dropedit

A browser-based editor for **Neuzeit Drop** project files (`.json`). Open a Drop project,
click controls on a stylized hardware surface, and edit their MIDI settings in a sidebar.

Features:
- Click / shift-click / row & column / "All" selection, with multi-select **[multiple values]** editing
- Per-control **General** (active, name, colour, behavior, LED style, value), **Output slots**
  (up to 8, each with target device, type, CC/note, channel, range, curve), and **Selection groups**
- Per-output-slot **parameter assignment** from a device's preset CSV (friendly names)
- **Snapshots**: 4×5 pad grid with banks; save current values into / recall from a snapshot
- Copy/paste a control, **copy a whole layer**, and a **Devices** editor for the 8 MIDI destinations
- Human-readable parameter names from the Drop's device-preset CSV database (the `midi-main`
  collection; `Synthstrom/Deluge.csv` is bundled, and you can upload your own per device)

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
  - `dropProject` — typed read-views (controls, slots, layers, devices).
  - `edits` — `setField`, multi-select bulk set, `assignParam` (create or edit in place),
    create/remove control, `setChannelForLayer`, `copyLayer`, copy/paste control.
- **`src/ui/`** — React: `Surface` (SVG hardware), `Sidebar` (per-selection editing), `App`.

## Known limitations / to revisit

- **`csvRef` high 16 bits** are a checksum/flags that aren't reproduced yet (only the verified
  low-16 row index is written). A control still works fully — its CC, channel, and display
  `name` are independent of `csvRef`; the checksum is the Drop's re-link/feedback metadata.
  Centralized in `presetDb.makeCsvRef` for a one-line upgrade once solved on hardware.
- Friendly-name maps for `behavId` / `feedbId` / `curveId` and the device port enum aren't known,
  so those are edited as raw numbers (the port labels USB1/USB2/TRS1–4 are a tentative guess).
- Only `Synthstrom/Deluge.csv` is bundled so far; other devices need an uploaded CSV.
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
