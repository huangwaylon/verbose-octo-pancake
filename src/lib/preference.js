/**
 * A per-device preference: one of a fixed set of values, kept in `localStorage`, read through
 * `useSyncExternalStore`. The locale and the accent are per-device rather than per-sheet, because
 * two people share one spreadsheet and neither gets to restyle or relabel the other's phone;
 * nothing here ever reaches the sheet.
 *
 * Reflecting the value onto `<html>` happens on change but never at module load: these modules also
 * load under vitest's `node` environment, so the DOM touch is an explicit step the app takes.
 */

import { useSyncExternalStore } from 'react'
import { readStored, writeStored } from '../config.js'

/**
 * @param {string} spec.key a `STORAGE_KEYS` entry
 * @param {string[]} spec.values every acceptable value
 * @param {string} spec.fallback used when storage holds nothing acceptable
 * @param {() => string|null} [spec.detect] consulted before `fallback`
 */
export function storedPreference({ key, values, fallback, detect }) {
  const stored = readStored(key)
  // The detected value is checked against `values` exactly as a stored one is: an unrecognised
  // guess persists nothing yet still paints an attribute CSS has no rule for.
  const guessed = stored ?? detect?.()
  let current = values.includes(guessed) ? guessed : fallback

  const listeners = new Set()
  const subscribe = (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const get = () => current

  return {
    get,
    subscribe,
    /** An unrecognised value coerces to the fallback rather than being stored. */
    set(value) {
      const next = values.includes(value) ? value : fallback
      if (next === current) return
      current = next
      writeStored(key, next)
      for (const listener of listeners) listener()
    },
    /** The third argument is required: the render tests have no client snapshot. */
    use: () => useSyncExternalStore(subscribe, get, get),
  }
}
