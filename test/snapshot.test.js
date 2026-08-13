import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONFIG, mergeConfig } from '../src/config.js'

/**
 * The launch cache. It is only a cache — the sheet is the source of truth — so
 * every doubt resolves to "ignore it and re-read", never to a repair.
 */

const SHEET = 'sheet-a'

function installStorage(seed = {}) {
  const store = new Map(Object.entries(seed))
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  return store
}

async function load(seed) {
  const store = installStorage(seed)
  vi.resetModules()
  // Module state (the last-written payload) has to reset with it.
  return { store, snapshot: await import('../src/lib/snapshot.js') }
}

const entry = (over = {}) => ({
  id: 'e1',
  type: 'expense',
  date: '2026-08-06',
  amountCents: 1250,
  currency: 'JPY',
  category: 'Groceries',
  description: 'shop',
  payer: 'p1',
  payerShare: 0.5,
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
  deletedAt: null,
  ...over,
})

afterEach(() => {
  delete globalThis.localStorage
})

describe('round trip', () => {
  it('preserves the amount and its currency exactly', async () => {
    const { snapshot } = await load()
    // Integer minor units plus the row's own currency, so JSON is lossless and
    // nothing is re-decoded at the wrong scale on the way back in.
    snapshot.writeSnapshot(SHEET, [entry({ amountCents: 1250, currency: 'JPY' })], {})
    const read = snapshot.readSnapshot(SHEET)
    expect(read.entries[0].amountCents).toBe(1250)
    expect(read.entries[0].currency).toBe('JPY')
  })

  it('drops pending, which does not survive a relaunch', async () => {
    const { snapshot } = await load()
    snapshot.writeSnapshot(SHEET, [{ ...entry(), pending: true }], {})
    const [restored] = snapshot.readSnapshot(SHEET).entries
    expect(restored.pending).toBeUndefined()
    expect(restored.id).toBe(entry().id)
  })

  it('stores the partial config, so a changed default still applies', async () => {
    const { snapshot } = await load()
    // Only what the sheet actually said. Storing the merged config would freeze
    // the building build's defaults into every later launch.
    snapshot.writeSnapshot(SHEET, [], { currency: 'USD' })
    const read = snapshot.readSnapshot(SHEET)
    expect(read.config).toEqual({ currency: 'USD' })
    const merged = mergeConfig(read.config)
    expect(merged.currency).toBe('USD')
    expect(merged.categories).toEqual(DEFAULT_CONFIG.categories)
  })

  it('does not write twice for an unchanged ledger', async () => {
    const { store, snapshot } = await load()
    snapshot.writeSnapshot(SHEET, [entry()], {})
    const first = store.get('sf.snapshot')
    snapshot.writeSnapshot(SHEET, [entry()], {})
    expect(store.get('sf.snapshot')).toBe(first)
  })
})

describe('what gets ignored', () => {
  it('ignores a snapshot of a different spreadsheet', async () => {
    const { snapshot } = await load()
    snapshot.writeSnapshot(SHEET, [entry()], {})
    // Somebody else's ledger, or this device pointed at a new sheet.
    expect(snapshot.readSnapshot('sheet-b')).toBe(null)
  })

  it('ignores an unrecognised version rather than trying to repair it', async () => {
    const { snapshot } = await load({
      'sf.snapshot': JSON.stringify({ v: 99, spreadsheetId: SHEET, entries: [], config: {} }),
    })
    expect(snapshot.readSnapshot(SHEET)).toBe(null)
  })

  it('ignores malformed JSON', async () => {
    const { snapshot } = await load({ 'sf.snapshot': '{not json' })
    expect(snapshot.readSnapshot(SHEET)).toBe(null)
  })

  it('ignores a payload missing its entries or config', async () => {
    const { snapshot } = await load({
      'sf.snapshot': JSON.stringify({ v: 1, spreadsheetId: SHEET, entries: 'nope', config: {} }),
    })
    expect(snapshot.readSnapshot(SHEET)).toBe(null)
  })

  it('reads nothing when there is no spreadsheet yet', async () => {
    const { snapshot } = await load()
    expect(snapshot.readSnapshot(null)).toBe(null)
  })

  it('refuses to write a ledger too large for the quota', async () => {
    const { store, snapshot } = await load()
    // writeStored swallows QuotaExceededError, so an oversized payload would
    // silently never persist and launch would stay slow with no signal at all.
    const huge = Array.from({ length: 20_000 }, (_unused, index) => entry({ id: `e${index}` }))
    snapshot.writeSnapshot(SHEET, huge, {})
    expect(store.has('sf.snapshot')).toBe(false)
  })

  it('clears on request, for forgetting the key', async () => {
    const { store, snapshot } = await load()
    snapshot.writeSnapshot(SHEET, [entry()], {})
    snapshot.clearSnapshot()
    expect(store.has('sf.snapshot')).toBe(false)
  })

  it('can be rewritten after clearing, even with identical data', async () => {
    // The skip-unchanged guard is module state, so clearing has to reset it too.
    // Wiping the key without resetting it left the next load convinced it had
    // already saved, and no snapshot was ever written again.
    const { store, snapshot } = await load()
    snapshot.writeSnapshot(SHEET, [entry()], {})
    snapshot.clearSnapshot()
    snapshot.writeSnapshot(SHEET, [entry()], {})
    expect(store.has('sf.snapshot')).toBe(true)
  })
})
