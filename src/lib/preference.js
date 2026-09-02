/**
 * A per-device preference: one of a fixed set of values, kept in `localStorage`,
 * read through `useSyncExternalStore`.
 *
 * Both callers — the locale and the accent — are per-device rather than per-sheet,
 * because two people share one spreadsheet and neither gets to restyle or relabel
 * the other's phone. Nothing here ever reaches the sheet.
 *
 * `reflect` writes the value onto `<html>`, and is called on every change but never
 * at module load: these modules also load under vitest's `node` environment, so the
 * DOM touch is an explicit step the app takes before its first render.
 */

import { useSyncExternalStore } from 'react'
import { readStored, writeStored } from '../config.js'

/**
 * @param {object} spec
 * @param {string} spec.key a `STORAGE_KEYS` entry
 * @param {string[]} spec.values every acceptable value
 * @param {string} spec.fallback used when storage holds nothing acceptable
 * @param {() => string|null} [spec.detect] consulted before `fallback`, for a
 *   preference with something better to guess from than a default
 * @returns {{get: () => string, set: (value: string) => void, use: () => string,
 *   subscribe: (listener: () => void) => () => void}}
 */
export function storedPreference({ key, values, fallback, detect }) {
  const stored = readStored(key)
  let current = values.includes(stored) ? stored : (detect?.() ?? fallback)

  const listeners = new Set()
  const subscribe = (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const get = () => current

  return {
    get,
    subscribe,
    /**
     * An unrecognised value coerces to the fallback rather than being stored, so
     * nothing can persist a name the CSS or the catalogs have no entry for.
     */
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
