import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONFIG, mergeConfig } from '../src/config.js'
import { installStorage, removeStorage } from './support/storage.js'

/**
 * The launch cache. It is only a cache — the sheet is the source of truth — so
 * every doubt resolves to "ignore it and re-read", never to a repair.
 */

const SHEET = 'sheet-a'

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
  amountYen: 1250,
  category: 'Groceries',
  description: 'shop',
  payer: 'p1',
  payerShare: 0.5,
  deletedAt: null,
  ...over,
})

afterEach(removeStorage)

describe('round trip', () => {
  it('preserves the amount exactly', async () => {
    const { snapshot } = await load()
    // Whole yen as an integer, so JSON is lossless and nothing is re-decoded on the
    // way back in — this is the one input never read through `rowToEntry`.
    snapshot.writeSnapshot(SHEET, [entry({ amountYen: 1250 })], {})
    const read = snapshot.readSnapshot(SHEET)
    expect(read.entries[0].amountYen).toBe(1250)
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
    snapshot.writeSnapshot(SHEET, [], { defaultSplitP1: 0.8 })
    const read = snapshot.readSnapshot(SHEET)
    expect(read.config).toEqual({ defaultSplitP1: 0.8 })
    const merged = mergeConfig(read.config)
    expect(merged.defaultSplitP1).toBe(0.8)
    expect(merged.categories).toEqual(DEFAULT_CONFIG.categories)
  })

  it('does not write twice for an unchanged ledger', async () => {
    const { store, snapshot } = await load()
    snapshot.writeSnapshot(SHEET, [entry()], {})
    const first = store.get('sf.snapshot')
    snapshot.writeSnapshot(SHEET, [entry()], {})
    expect(store.get('sf.snapshot')).toBe(first)
  })

  it('does not rewrite what it just restored, which is every cached launch', async () => {
    // `useLedger` persists whatever is on screen once nothing is pending, and on a
    // cached launch that is the list this read just returned — so a read that does
    // not remember what storage holds makes every launch pay a full serialize and a
    // synchronous setItem of bytes already there, on the frame someone is waiting on.
    // The payload is produced by `writeSnapshot` rather than hand-authored, so this
    // asserts byte-identity through the real encoder.
    const seeded = await load()
    seeded.snapshot.writeSnapshot(SHEET, [entry()], { person1Name: 'Waylon' })
    const payload = seeded.store.get('sf.snapshot')

    // A fresh module, as a relaunch is: the remembered payload resets with it.
    const { snapshot } = await load({ 'sf.snapshot': payload })
    const restored = snapshot.readSnapshot(SHEET)
    const writes = vi.spyOn(globalThis.localStorage, 'setItem')
    // The serialize is the expensive half — a long ledger is a quarter of a megabyte
    // of JSON built to be thrown away — so it has to be skipped, not just its write.
    const serialize = vi.spyOn(JSON, 'stringify')

    snapshot.writeSnapshot(SHEET, restored.entries, restored.config)
    expect(writes).not.toHaveBeenCalled()
    expect(serialize).not.toHaveBeenCalled()

    // And not by going deaf: a changed ledger still reaches storage.
    snapshot.writeSnapshot(SHEET, [entry({ amountYen: 99 })], restored.config)
    expect(writes).toHaveBeenCalledTimes(1)
    serialize.mockRestore()
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
      'sf.snapshot': JSON.stringify({ v: 2, spreadsheetId: SHEET, entries: 'nope', config: {} }),
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
    //
    // The 800,000-character cap is the whole subject, and rows of this shape cross it
    // at about 5,130 — so this is just past it rather than the 20,000 it used to be,
    // which spent four times the work proving the same crossing. A fixture that fell
    // back UNDER the cap fails this test rather than passing it vacuously, which is
    // what happens every time the row shape loses a field: re-measure, do not pad.
    const overCap = Array.from({ length: 5_400 }, (_unused, index) => entry({ id: `e${index}` }))
    snapshot.writeSnapshot(SHEET, overCap, {})
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

/**
 * The cache is the one input never decoded through `rowToEntry`, and it is restored
 * during the FIRST render — so a row the aggregates cannot take is not a bad number,
 * it is an app that will not launch, with no way in to clear the cache. `splitYen`
 * throws on a non-numeric share and `sumYen` on a non-integer amount.
 *
 * Whole-list rejection is the point: a partially dropped ledger is a wrong balance on
 * screen, which is worse than the empty frame a re-read costs.
 */
describe('a row the balance could not survive', () => {
  const stored = (entries) => ({
    'sf.snapshot': JSON.stringify({ v: 2, spreadsheetId: SHEET, entries, config: {} }),
  })

  const unusable = {
    'a non-integer amount': { amountYen: 12.5 },
    'a missing amount': { amountYen: undefined },
    // Not `Number(...)`: null, '' and false all coerce to 0 and then throw.
    'a null share': { payerShare: null },
    'an empty-string share': { payerShare: '' },
    'a non-numeric share': { payerShare: 'half' },
    // A junk payer decides the SIGN of the balance, so it is a wrong number rather
    // than a crash — which is worse.
    'a payer who is neither person': { payer: 'p3' },
    'a missing payer': { payer: undefined },
    'a missing id': { id: undefined },
    'an empty id': { id: '' },
  }

  for (const [what, over] of Object.entries(unusable)) {
    it(`drops the whole snapshot for ${what}`, async () => {
      const { snapshot } = await load(stored([entry(over)]))
      expect(snapshot.readSnapshot(SHEET)).toBe(null)
    })
  }

  it('drops the whole list, not just the bad row', async () => {
    const { snapshot } = await load(
      stored([entry({ id: 'good' }), entry({ id: 'bad', amountYen: 12.5 })]),
    )
    expect(snapshot.readSnapshot(SHEET)).toBe(null)
  })

  it('still restores a list where every row is usable', async () => {
    const { snapshot } = await load(stored([entry({ id: 'a' }), entry({ id: 'b' })]))
    expect(snapshot.readSnapshot(SHEET).entries).toHaveLength(2)
  })

  it('accepts a share of exactly 0 and exactly 1, which are real splits', async () => {
    // A settlement is `payerShare: 0`, and "the payer covered all of it" is 1. A
    // falsy-check guard instead of `Number.isFinite` would reject the settlement.
    const { snapshot } = await load(stored([entry({ payerShare: 0 }), entry({ payerShare: 1 })]))
    expect(snapshot.readSnapshot(SHEET).entries).toHaveLength(2)
  })

  it('accepts a zero amount, which is not the same as a missing one', async () => {
    const { snapshot } = await load(stored([entry({ amountYen: 0 })]))
    expect(snapshot.readSnapshot(SHEET).entries).toHaveLength(1)
  })
})
