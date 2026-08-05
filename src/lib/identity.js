/**
 * Working out which of the two people is using the app right now.
 *
 * Preference order: match the signed-in Google address against the emails in
 * the sheet's config tab, then fall back to a choice the person made manually.
 * The email match can legitimately fail — the drive.file scope does not
 * guarantee access to the userinfo endpoint — so the manual fallback is a
 * first-class path, not an error case.
 */

import { PERSON } from '../schema.js'
import { STORAGE_KEYS } from '../config.js'

export function readStoredIdentity() {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.identity)
    return value === PERSON.P1 || value === PERSON.P2 ? value : null
  } catch {
    return null
  }
}

export function storeIdentity(person) {
  try {
    if (person) localStorage.setItem(STORAGE_KEYS.identity, person)
    else localStorage.removeItem(STORAGE_KEYS.identity)
  } catch {
    // Private browsing with storage blocked: identity just won't persist.
  }
}

/** @returns {'p1'|'p2'|null} null means "ask them". */
export function resolveIdentity(config, email, stored = readStoredIdentity()) {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (normalized) {
    if (config?.person1Email?.trim().toLowerCase() === normalized) return PERSON.P1
    if (config?.person2Email?.trim().toLowerCase() === normalized) return PERSON.P2
  }
  return stored
}

/**
 * The two people's display names.
 *
 * `fallbacks` and `youLabel` are optional parameters rather than catalog lookups,
 * so this module stays pure and independently testable. Components pass the
 * translated strings in.
 */
export function nameOf(config, person, fallbacks = { p1: 'Person 1', p2: 'Person 2' }) {
  if (person === PERSON.P2) return config?.person2Name || fallbacks.p2
  return config?.person1Name || fallbacks.p1
}

/** Label a person relative to the viewer, so the UI can say "You". */
export function labelFor(config, person, me, youLabel = 'You', fallbacks) {
  return person === me ? youLabel : nameOf(config, person, fallbacks)
}
