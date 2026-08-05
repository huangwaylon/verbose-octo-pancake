/**
 * Working out which of the two people is using the app right now.
 *
 * Preference order: match the signed-in Google address against the emails in
 * the sheet's config tab, then fall back to a choice the person made manually.
 * The email match can legitimately fail — the drive.file scope does not
 * guarantee access to the userinfo endpoint — so the manual fallback is a
 * first-class path, not an error case.
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

/** @returns {'p1'|'p2'|null} null means "ask them". */
export function resolveIdentity(config, email, stored) {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (normalized) {
    if (config?.person1Email?.trim().toLowerCase() === normalized) return PERSON.P1
    if (config?.person2Email?.trim().toLowerCase() === normalized) return PERSON.P2
  }
  return stored
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
