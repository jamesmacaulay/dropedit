// Platform-aware modifier-key labels. The Drop editor shows ⌘ on mac and a Ctrl/^ form elsewhere.
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '')

// Prose form used in help text: the full word "Ctrl" reads better than "^" in a sentence.
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl'
