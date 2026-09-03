import { afterEach, describe, expect, it, vi } from 'vitest'

import { installStorage, removeStorage } from './support/storage.js'

/**
 * The two per-device preferences: which person this phone belongs to, and the accent. Neither
 * may ever reach the sheet — two people share one spreadsheet. Both modules read storage at
 * import time, so each case loads them fresh against a seeded store, and the accent's current
 * value is observed through an argument-less `syncDocumentAccent()`.
 */

afterEach(() => {
  removeStorage()
  vi.unstubAllGlobals()
  vi.resetModules()
})

/** A fresh theme module over a seeded store, plus the element it writes to. */
async function loadTheme(seed = {}) {
  const store = installStorage(seed)
  const element = { dataset: {} }
  vi.stubGlobal('document', { documentElement: element })
  vi.resetModules()
  const theme = await import('../src/lib/theme.js')
  /** Whatever the module currently holds, as the attribute value or undefined. */
  const currentAccent = () => {
    theme.syncDocumentAccent()
    return element.dataset.accent
  }
  return { ...theme, store, element, currentAccent }
}

async function loadIdentity(seed = {}) {
  const store = installStorage(seed)
  vi.resetModules()
  return { ...(await import('../src/lib/identity.js')), store }
}

describe('the stored identity', () => {
  it('accepts only the two people', async () => {
    for (const value of ['p1', 'p2']) {
      const { readStoredIdentity } = await loadIdentity({ 'sf.identity': value })
      expect(readStoredIdentity()).toBe(value)
    }
  })

  it('answers null for anything else, so the gate asks instead of guessing', async () => {
    // Nothing can detect which person this is, so a junk value must send someone back to
    // the gate rather than pick p1.
    for (const value of ['p3', 'P1', '', 'true', '{}']) {
      const { readStoredIdentity } = await loadIdentity({ 'sf.identity': value })
      expect(readStoredIdentity()).toBeNull()
    }
    expect((await loadIdentity({})).readStoredIdentity()).toBeNull()
  })

  it('round-trips through storage under the documented key', async () => {
    const { readStoredIdentity, storeIdentity, store } = await loadIdentity({})
    storeIdentity('p2')
    expect(store.get('sf.identity')).toBe('p2')
    expect(readStoredIdentity()).toBe('p2')
  })
})

describe('the accent preference', () => {
  it('starts from a stored preset', async () => {
    const { currentAccent } = await loadTheme({ 'sf.accent': 'plum' })
    expect(currentAccent()).toBe('plum')
  })

  it('ignores a stored name that is not a preset', async () => {
    // A hand-edited value must not reach `[data-accent]`, where it matches no rule and
    // leaves the app with no accent colour at all.
    const { currentAccent } = await loadTheme({ 'sf.accent': 'chartreuse' })
    expect(currentAccent()).toBeUndefined()
  })

  it('coerces an unrecognised name to the default rather than storing it', async () => {
    const { setAccent, currentAccent, store } = await loadTheme({ 'sf.accent': 'teal' })
    setAccent('nonsense')
    expect(currentAccent()).toBeUndefined()
    expect(store.get('sf.accent')).toBe('indigo')
  })

  it('stores and reflects a real preset', async () => {
    const { setAccent, currentAccent, store } = await loadTheme({})
    setAccent('pine')
    expect(store.get('sf.accent')).toBe('pine')
    expect(currentAccent()).toBe('pine')
  })

  it('expresses the default by REMOVING the attribute, not by setting it', async () => {
    // `:root` in tokens.css is the single definition of indigo; an attribute for it would
    // be a second one to keep in sync.
    const { syncDocumentAccent, DEFAULT_ACCENT, element } = await loadTheme({})
    syncDocumentAccent('plum')
    expect(element.dataset.accent).toBe('plum')
    syncDocumentAccent(DEFAULT_ACCENT)
    expect('accent' in element.dataset).toBe(false)
  })

  it('names every preset in swatch order, with the default first', async () => {
    // The order is the swatch row, and the first is the one `:root` already defines.
    const { ACCENTS, DEFAULT_ACCENT } = await loadTheme({})
    expect(ACCENTS).toEqual(['indigo', 'pine', 'teal', 'plum', 'sepia'])
    expect(DEFAULT_ACCENT).toBe(ACCENTS[0])
  })
})
