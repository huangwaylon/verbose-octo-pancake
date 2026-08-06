/**
 * Working out which of the two people is using the app right now.
 *
 * There is nothing to detect: the access token belongs to the account that owns
 * the spreadsheet, not to either person, so this is purely a per-device choice
 * made once on the identity gate. That is why it lives in `localStorage` next to
 * the locale and the accent rather than in the sheet — it changes how this phone
 * labels things and must not follow the data to the other person's phone.
 */

import { EVEN_SHARE, PERSON } from '../schema.js'
import { STORAGE_KEYS, readStored, writeStored } from '../config.js'

export function readStoredIdentity() {
  const value = readStored(STORAGE_KEYS.identity)
  return value === PERSON.P1 || value === PERSON.P2 ? value : null
}

export function storeIdentity(person) {
  writeStored(STORAGE_KEYS.identity, person)
}

/**
 * The two people's display names. `fallbacks` arrives as a parameter rather than
 * a catalog lookup, so this module stays pure and independently testable.
 */
export function nameOf(config, person, fallbacks = { p1: 'Person 1', p2: 'Person 2' }) {
  if (person === PERSON.P2) return config?.person2Name || fallbacks.p2
  return config?.person1Name || fallbacks.p1
}

/**
 * The share `person` covers by default on an expense they paid for. Keyed on the
 * payer because `payer_share` is the payer's own share: with 0.8 for p1 and 0.2
 * for p2, p1 bears 80% of the cost whichever of them actually paid.
 *
 * Falls back to an even split per person, so a config tab carrying only one of
 * the two keys still behaves sensibly for the other.
 */
export function defaultSplitFor(config, person) {
  const value = person === PERSON.P2 ? config?.defaultSplitP2 : config?.defaultSplitP1
  return Number.isFinite(value) ? value : EVEN_SHARE
}
