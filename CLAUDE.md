# dropedit — guide for AI agents

A browser-based editor for **Neuzeit Drop** MIDI-controller project files (`.json`). Load a Drop
project, edit its controls / snapshots / target devices on a visual hardware surface, and download
the modified `.json`. **Vite + React + TypeScript, 100% client-side** (no backend), deployed to
GitHub Pages. Repo: `github.com/jamesmacaulay/dropedit` · live: https://jamesmacaulay.github.io/dropedit/

The Drop `.json` schema is reverse-engineered; the authoritative reference is
[`docs/drop-format.md`](docs/drop-format.md). **Read it before touching the model.**

## Golden rules (don't break these)

1. **Never serialize the project with `JSON.stringify`.** All edits go through
   `src/model/jsonDoc.ts` — a span-preserving parser + **text splices**. Bytes you don't touch MUST
   round-trip *exactly*: the Drop file uses tab indentation, trailing-zero floats (`52.000`), a
   specific key order, and inconsistent empty-object styles (`{}` vs multiline). The round-trip tests
   enforce this; if you regenerate JSON you will corrupt users' projects.
2. **`src/model/` is pure TypeScript, no DOM** — keep it node-testable. React/DOM lives only in `src/ui/`.
3. **Keep it green:** `bun run test` (vitest) passes and `bunx tsc --noEmit` is clean after every change.
   Add or adjust tests for any new model behavior.
4. **Use bun with scripts disabled** (supply-chain hygiene): `bun install --ignore-scripts`.

## Commands

```bash
bun install --ignore-scripts
bun run dev       # Vite dev server (localhost:5173)
bun run test      # vitest (model + UI smoke); expect all green
bun run build     # tsc --noEmit && vite build -> dist/
bun run preview   # serve the production build
```
(Plain npm also works: `npm install && npm run dev`.)

## Architecture

```
src/model/   pure TS, fully unit-tested — the brains
  jsonDoc.ts      span-preserving JSON parse + splice edits. THE foundation.
                  parseJson, getPath/getObject/getMember, editSetScalar/editInsertMember/
                  editRemoveMember, applyEdits. Every edit is expressed as splices on the original text.
  controlId.ts    control id <-> {type,layer,col,row}; layer ops (first id digit = layer).
  selection.ts    rangeSelect: pure shift-click range selection (union-of-boxes over the visual grid).
  clipboard.ts    serializeClip/parseClip: tagged JSON copy/paste payload (validates untrusted text).
  presetDb.ts     parse a device preset CSV -> params; makeCsvRef (low16 = CSV row index, verified).
                  deriveControlName (auto-name a control from a param, <=16 chars, category-aware).
  dropProject.ts  typed READ-views: readControl, readLayers, readDevices, readStateValue,
                  readGroupMember, selGroupLocation, readSnapshotValue/readSnapshotMember.
  edits.ts        ALL mutations -> return new project text:
                  setControlField, bulkSetControlField/SlotField, assignParam, createControl
                  (withSlot flag), removeControl, addSlot/removeSlot, setSlotField/setSlotParam,
                  setStateValue, setGroupMember, saveSnapshot/loadSnapshot, copyLayer,
                  setSnapshotValue/setSnapshotMembers/toggleSnapshotMembers (edit a stored scene),
                  copyControlText/pasteControl, setDeviceField/setDeviceCsv.
  enums.ts        MSG_TYPE / BEHAV labels + CONTROL_DEFAULTS per control type.
src/ui/      React (prop-driven; easy to render-test)
  App.tsx         owns `text` (project JSON string = source of truth) + selection/clipboard/etc.
                  doc = useMemo(parseJson(text)); every edit calls a model fn and setText(newText),
                  so the view always equals what will be saved. Selection = string keys "type:id".
                  onSelect(keys, mode): replace / toggle (⌘·Ctrl-click) / range (shift-click, via
                  model selection.rangeSelect + rangeSelectSnapshots for the pad grid). A selection
                  holds ONE family (controls XOR snapshots) — a modifier-click across families is a
                  no-op (footer note); a plain click switches. Copy/paste writes a tagged JSON payload to the OS
                  clipboard (clipboard.ts) so it works across tabs; falls back to an in-memory copy
                  when the clipboard can't be read (permissions / Safari).
  Surface.tsx     the Drop as inline SVG: rotaries(+push), faders, mutes; clickable row/col/All labels.
                  Click modifiers -> SelectMode (replace / toggle / range).
  Sidebar.tsx     per-selection editor, tabs: Config (general + output slots) / Groups.
                  Inputs go through ValidatedInput (draft/validate/commit; errors in the footer bar).
                  Multi-select uses a [multiple values] pattern (shared value or placeholder).
                  Also exports SnapshotEditPanel: the snapshot Edit-mode sidebar (auto-adapts —
                  the snapshot's own output slots when no control is selected, stored-value editor when one is).
  SnapshotGrid.tsx  4x5 pads (bankMode -> bank picker) + SnapshotMeta (selected pad's name/colour).
  DeviceEditor.tsx  modal to edit the 8 target devices + their preset CSVs.
  palette.ts      the Drop's 12 colour names/hexes (colId order).
src/data/    devices.ts + devices/<Manufacturer>/<Device>.csv  — bundled preset DB.
                  ~393 CSVs vendored from pencilresearch/midi (CC-BY-SA-4.0), loaded LAZILY via
                  import.meta.glob (one chunk per CSV — main bundle stays small). BUNDLED_DEVICES is
                  the synchronous manifest; loadBundled / loadBundledByPathFile are async. Refresh
                  with `node scripts/sync-midi-db.mjs` (vendored at a pinned commit; see SOURCE.md).
                  inits.ts + clean-init/daw-init.json — starter projects (imported ?raw).
test/        vitest specs; fixtures/ are REAL Drop projects (deluge-exp, old-daw-init, empty-template).
```

The model has no app-global state; `App` threads `text` + small UI state. To support per-device
preset names, `App` builds `devicePresets` (device index -> parsed CSV) and passes `deviceFor(target)`
to the sidebar so each output slot's Parameter dropdown uses *its target device's* CSV.

## Verifying UI changes in a real browser

The `file_upload` MCP tool rejects host paths, so to load a project into the running app:
1. Stage the file where Vite serves it: `mkdir -p public && cp <some>.json public/sample-project.json`
2. Inject it via the file input with `javascript_tool`:
   ```js
   (async () => {
     const r = await fetch('/sample-project.json?' + Math.random());
     const input = document.querySelector('input[type=file]');
     const dt = new DataTransfer();
     dt.items.add(new File([await r.text()], 'project.json', { type: 'application/json' }));
     Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
     input.dispatchEvent(new Event('change', { bubbles: true }));
   })();
   ```
3. **Delete the staged file afterward** (`rm -f public/sample-project.json`) — don't commit it.
A sample project usually lives at `/Users/james/Downloads/Deluge.json`.

## Hosting / CI

`.github/workflows/deploy.yml` builds with bun and deploys to GitHub Pages on push to `main` (and runs
the tests first). **Actions are pinned to full commit SHAs** (tag in a comment) for supply-chain safety
— bump them deliberately (re-resolve via `gh api repos/<a>/commits/<tag> --jq .sha`). `vite.config.ts`
uses `base: './'` so assets resolve under the `/dropedit/` Pages subpath.

## Known unknowns & TODOs

- **Enum name maps — decoded** (`enums.ts`: `BEHAV`/`FEEDB`/`CURVE`/`PORT`). `behavId` is one global
  0-12 enum; `feedbId`/`curveId` codes are firmware-assigned, NOT menu order (`Line from right`=29,
  `Flex`=33; feedbId 28 is an unused hole used by non-rotary elements). Ports verified `0=Off…6=TRS4`;
  Virt. Cable is 0-indexed (shown +1). The UI renders these as `EnumField` dropdowns with a "Custom…"
  entry + raw-value fallback, so unknown/future codes still work. To refresh for a new firmware:
  build a capture project per `node scripts/decode-enums.mjs instructions`, then
  `decode <file.json>` and update the maps. Still raw numbers: `msgType` is partially mapped
  (`MSG_TYPE`); the Flex curve's XY-point storage is unknown (its slot keeps default min/max until
  the points are edited — capture a non-default Flex to locate it).
- **`csvRef` — fully solved** (hardware capture, `scripts/decode-csvref.mjs`):
  `csvRef = 0x40000000 | (cc << 23) | rowIndex` (bit 30 = valid-reference flag, bits 23-29 = CC,
  low 16 = CSV row index). No checksum; renaming doesn't change it. `presetDb.makeCsvRef(row, cc)`
  writes it; a manual edit of a slot's identity clears it to 0 (per the firmware docs).
- **Snapshot editing** is complete: Save (selection-group-aware), Edit (membership + per-control
  stored values + the snapshot's own **one-shot MIDI output slots**, reusing SlotList /
  `setSlotField` / `addSlot` on type `'snp'`), and Jump/Load. A snapshot's output slots get inserted
  after its `data` scene in the entry and that layout isn't hardware-verified — confirm on a real Drop.
- The full pencilresearch/midi DB (~393 devices) is bundled and lazy-loaded; refresh by bumping the
  pinned commit in `scripts/sync-midi-db.mjs` and re-running it. CSVs are verbatim, so any upstream
  typos ship as-is — fix them upstream, not locally, to keep the sync clean. (Note: a CSV fix upstream
  can break the presetDb tests, which assert on specific param names/rows — update those alongside.)
- **Hardware status:** projects exported by the app are used on real Drop hardware (control
  mappings, output slots, values, snapshots save/jump/load, decoded enums all confirmed in practice).
  One narrow bit remains unconfirmed on hardware: the placement of a snapshot's own output slots (added in the snapshot
  Edit work, inserted after `data`; not yet hardware-tested). Still: encourage keeping backups.

## Conventions

- Match the surrounding code style; prefer reusing existing model fns over new code paths.
- New model behavior → a vitest test (often asserting both the parsed result *and* that unrelated
  bytes are unchanged). UI gets a light `renderToString` smoke test (no jsdom; tabs hide content from
  SSR, so assert tab-visible bits).
- Commit messages: imperative subject + short why. Keep `dist/`, `node_modules/`, `public/*.json`
  scratch files out of git.
