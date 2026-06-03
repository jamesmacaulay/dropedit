#!/usr/bin/env node
// Refresh the bundled MIDI device-preset database from pencilresearch/midi.
//
// We VENDOR a snapshot (committed to this repo) pinned to a specific commit, rather than
// fetching at build time — builds stay reproducible/offline and a DB refresh is a reviewed
// commit, like bumping a pinned action SHA. To refresh: bump PINNED_COMMIT, run
// `node scripts/sync-midi-db.mjs` (or `bun scripts/sync-midi-db.mjs`), review the diff, commit.
//
// Source: https://github.com/pencilresearch/midi  (license: CC-BY-SA-4.0)
// The CSVs are the exact format the Drop expects (csvPath "/midi-main/<Manufacturer>",
// csvFile "<Device>.csv"); they're copied verbatim into src/data/devices/<Manufacturer>/.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, readdirSync, copyFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const PINNED_COMMIT = '0995e3ae6278f898589cf778b2d5688ca30fc843'
const REPO = 'pencilresearch/midi'
const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/legalcode.txt'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const destDir = join(root, 'src', 'data', 'devices')

function walkCsvs(dir, base = dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue // skip .git, .github, etc.
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkCsvs(p, base))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) out.push(relative(base, p))
  }
  return out
}

const tmp = mkdtempSync(join(tmpdir(), 'midi-db-'))
try {
  const tarUrl = `https://codeload.github.com/${REPO}/tar.gz/${PINNED_COMMIT}`
  const tarball = join(tmp, 'db.tar.gz')
  console.log(`Downloading ${REPO}@${PINNED_COMMIT.slice(0, 12)} …`)
  execFileSync('curl', ['-fsSL', tarUrl, '-o', tarball])
  execFileSync('tar', ['-xzf', tarball, '-C', tmp])

  const extracted = readdirSync(tmp, { withFileTypes: true }).find((e) => e.isDirectory() && e.name.startsWith('midi-'))
  if (!extracted) throw new Error('could not find extracted repo dir')
  const srcRoot = join(tmp, extracted.name)

  const csvs = walkCsvs(srcRoot)
  // clean re-sync: wipe the vendored tree, then copy the snapshot in
  rmSync(destDir, { recursive: true, force: true })
  let bytes = 0
  for (const rel of csvs) {
    const src = join(srcRoot, rel)
    const dst = join(destDir, rel)
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(src, dst)
    bytes += statSync(dst).size
  }

  // bundle the CC-BY-SA-4.0 legal text alongside the data (the dir is wiped above, so write it here)
  execFileSync('curl', ['-fsSL', LICENSE_URL, '-o', join(destDir, 'LICENSE')])

  writeFileSync(join(destDir, 'SOURCE.md'),
    `# Bundled MIDI device-preset database\n\n` +
    `Vendored **verbatim** (unmodified) from [${REPO}](https://github.com/${REPO}), licensed\n` +
    `**Creative Commons Attribution-ShareAlike 4.0 International (CC-BY-SA-4.0)**.\n\n` +
    `- Source: https://github.com/${REPO}\n` +
    `- Pinned commit: \`${PINNED_COMMIT}\`\n` +
    `- Files: ${csvs.length} CSVs\n` +
    `- License text: [./LICENSE](./LICENSE) · deed: https://creativecommons.org/licenses/by-sa/4.0/\n\n` +
    `## Attribution & reuse\n\n` +
    `These CSVs are licensed CC-BY-SA-4.0 (NOT the project's MIT license). If you redistribute them\n` +
    `you must keep this attribution and license, and any *adaptation* you distribute must also be\n` +
    `CC-BY-SA-4.0. Refresh by bumping \`PINNED_COMMIT\` in \`scripts/sync-midi-db.mjs\` and re-running it;\n` +
    `keep edits upstream so the snapshot stays verbatim (if you ever modify a file here, say so).\n`)

  console.log(`Synced ${csvs.length} CSVs (${(bytes / 1024 / 1024).toFixed(2)} MB) + LICENSE -> src/data/devices/`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
