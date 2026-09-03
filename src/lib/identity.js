/**
 * Which of the two people is using the app right now.
 *
 * There is nothing to detect: the access token belongs to the account that owns the
 * spreadsheet, not to either person, so this is a per-device choice made once on the
 * identity gate. That is why it lives in `localStorage` next to the locale and the accent —
 * it changes how this phone labels things and must not follow the data to the other phone.
 */

import { PERSON, isPerson } from '../schema.js'
import { STORAGE_KEYS, readStored, writeStored } from '../config.js'

export function readStoredIdentity() {
  const value = readStored(STORAGE_KEYS.identity)
  return isPerson(value) ? value : null
}

export function storeIdentity(person) {
  writeStored(STORAGE_KEYS.identity, person)
}

/**
 * The two people's display names. `fallbacks` arrives as a parameter rather than a catalog
 * lookup, so this module stays pure and independently testable — and it has NO default: two
 * English words defaulted here would be the localized fallback everywhere a caller forgot
 * them, which is the one thing a sheet with no names must not say.
 */
export function nameOf(config, person, fallbacks) {
  if (person === PERSON.P2) return config?.person2Name || fallbacks.p2
  return config?.person1Name || fallbacks.p1
}
