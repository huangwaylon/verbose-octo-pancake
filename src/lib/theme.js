/**
 * The accent color, as a per-device preference.
 *
 * Same shape and same reasoning as the locale in `i18n/index.js`: a module
 * singleton over localStorage, read with `useSyncExternalStore`. Per-device
 * rather than per-sheet because two people share one spreadsheet and neither
 * should be able to restyle the other's phone — and because nothing written to
 * the sheet may depend on whose device wrote it.
 *
 * The values themselves live in `tokens.css` under `[data-accent]`, where the
 * measured contrast sits next to them; this module only decides which name is
 * on <html>.
 */

import { useSyncExternalStore } from 'react'
import { STORAGE_KEYS, readStored, writeStored } from '../config.js'

/**
 * The presets, in swatch order. `indigo` is the default and is expressed by the
 * absence of the attribute, so the base tokens stay the single definition of it.
 */
export const ACCENTS = ['indigo', 'pine', 'teal', 'plum', 'sepia']

export const DEFAULT_ACCENT = ACCENTS[0]

function detect() {
  const stored = readStored(STORAGE_KEYS.accent)
  return ACCENTS.includes(stored) ? stored : DEFAULT_ACCENT
}

let current = detect()
const listeners = new Set()

export function getAccent() {
  return current
}

/** Reflect the accent onto the document. No-op outside a browser. */
export function syncDocumentAccent(name = current) {
  if (typeof document === 'undefined') return
  if (name === DEFAULT_ACCENT) delete document.documentElement.dataset.accent
  else document.documentElement.dataset.accent = name
}

export function setAccent(name) {
  const next = ACCENTS.includes(name) ? name : DEFAULT_ACCENT
  if (next === current) return
  current = next
  writeStored(STORAGE_KEYS.accent, next)
  syncDocumentAccent(next)
  for (const listener of listeners) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The third argument is required: the render tests have no client snapshot. */
export function useAccent() {
  return useSyncExternalStore(subscribe, getAccent, getAccent)
}
