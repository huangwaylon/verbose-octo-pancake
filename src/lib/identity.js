/**
 * Which of the two people is using the app right now. There is nothing to detect: the access token
 * belongs to the account that owns the spreadsheet, so this is a per-device choice made once on the
 * identity gate, and it must not follow the data to the other phone.
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
 * The two people's display names. `fallbacks` is a parameter rather than a catalog lookup, so this
 * module stays pure, and it has NO default: two English words defaulted here would be the localized
 * fallback everywhere a caller forgot them.
 */
export function nameOf(config, person, fallbacks) {
  if (person === PERSON.P2) return config?.person2Name || fallbacks.p2
  return config?.person1Name || fallbacks.p1
}
