// Copy/paste payload for the OS clipboard. We serialise the (already JSON-safe) CopiedControl[] with
// a tag so paste can recognise our data and reject anything else on the clipboard. Pure + testable;
// the actual navigator.clipboard read/write lives in the UI.

import type { CopiedControl } from './edits'

export type ClipKind = 'control' | 'snapshot'
export const CLIP_MARKER = 'dropedit/clipboard@1'

export function serializeClip(kind: ClipKind, items: CopiedControl[]): string {
  return JSON.stringify({ _dropedit: CLIP_MARKER, kind, items })
}

/** Parse + validate clipboard text. Returns null for anything that isn't a well-formed dropedit payload. */
export function parseClip(textIn: string | undefined | null): { kind: ClipKind; items: CopiedControl[] } | null {
  if (!textIn) return null
  let j: { _dropedit?: unknown; kind?: unknown; items?: unknown }
  try { j = JSON.parse(textIn) } catch { return null }
  if (!j || j._dropedit !== CLIP_MARKER) return null
  if (j.kind !== 'control' && j.kind !== 'snapshot') return null
  if (!Array.isArray(j.items)) return null
  const ok = j.items.every((it: unknown) => {
    const c = it as Partial<CopiedControl>
    return !!c && typeof c.type === 'string' && typeof c.dCol === 'number' && typeof c.dRow === 'number'
      && (c.valueText === null || typeof c.valueText === 'string')
      // stateValue is optional (older payloads omit it); when present it must be a number or null
      && (c.stateValue === undefined || c.stateValue === null || typeof c.stateValue === 'number')
  })
  return ok ? { kind: j.kind, items: j.items as CopiedControl[] } : null
}
