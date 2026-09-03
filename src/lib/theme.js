/**
 * The accent color, as a per-device preference. The values live in `tokens.css` under
 * `[data-accent]`, where the measured contrast sits next to them; this module only decides which
 * name is on `<html>`.
 */

import { STORAGE_KEYS } from '../config.js'
import { storedPreference } from './preference.js'

/**
 * The presets, in swatch order. `indigo` is the default and is expressed by the ABSENCE of the
 * attribute, so the base tokens stay its single definition.
 */
export const ACCENTS = ['indigo', 'pine', 'teal', 'plum', 'sepia']

export const DEFAULT_ACCENT = ACCENTS[0]

const store = storedPreference({
  key: STORAGE_KEYS.accent,
  values: ACCENTS,
  fallback: DEFAULT_ACCENT,
})

/** Reflect the accent onto the document. No-op outside a browser. */
export function syncDocumentAccent(name = store.get()) {
  if (typeof document === 'undefined') return
  if (name === DEFAULT_ACCENT) delete document.documentElement.dataset.accent
  else document.documentElement.dataset.accent = name
}

export function setAccent(name) {
  store.set(name)
  syncDocumentAccent()
}

export const useAccent = store.use
