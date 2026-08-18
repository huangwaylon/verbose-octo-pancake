import { describe, expect, it } from 'vitest'

import { ENTRY_ERROR, ENTRY_TYPE, PERSON, expensesTab, isPerson } from '../src/schema.js'
import { expense, tombstone, FIXED_NOW as NOW } from './support/entries.js'
import {
  gateFor,
  acknowledge,
  compactRefusal,
  entryById,
  entryFromInput,
  hasPendingWrite,
  looksUninitialized,
  mergeLoaded,
  missingExpenseGid,
  newDraftEntry,
  noticeKeys,
  reconcileById,
  reverted,
  settled,
  shouldRefresh,
  statusOnLoadFailure,
  statusOnLoadStart,
  tombstoneCount,
  withPending,
  withPendingDeletedAt,
  withPendingEdit,
  without,
} from '../src/lib/ledgerState.js'

/**
 * The optimistic bookkeeping `useLedger` delegates to.
 *
 * Every case here is a write that failed or a refresh that raced one, which is
 * where an optimistic UI goes wrong: a row that stays on screen looking saved when
 * it never reached the sheet, or a row that vanishes because a read that started
 * first finished last.
 */

/** The shared expense, keyed by id: what an id lookup finds is the whole subject here. */
const entry = (id, over = {}) => expense({ id, ...over })

describe('mergeLoaded', () => {
  it('hands back the server list itself when nothing is in flight', () => {
    // Referential identity, not just equality: `applyLoad` passes the same array to
    // `setEntries` and to `writeSnapshot`, so a needless copy here is a needless
    // divergence between what is on screen and what is persisted.
    const loaded = [entry('a'), entry('b')]
    expect(mergeLoaded([entry('a')], loaded)).toBe(loaded)
  })

  it('keeps a pending row the read has not caught up with yet', () => {
    // The append is still in flight, so the sheet does not mention it. Dropping it
    // here would also persist the truncated list, losing the row across a relaunch.
    const current = [entry('a'), { ...entry('new'), pending: true }]
    const merged = mergeLoaded(current, [entry('a')])
    expect(merged.map((item) => item.id)).toEqual(['a', 'new'])
    expect(merged[1].pending).toBe(true)
  })

  it('keeps the local copy while a write is in flight, even once the sheet lists it', () => {
    // The append reached the sheet but `acknowledge` has not run yet, so the two
    // copies hold the same data and keeping the local one changes nothing. What it
    // buys is the edit and delete cases below, where they do NOT agree.
    const current = [{ ...entry('new', { description: 'typed' }), pending: true }]
    const merged = mergeLoaded(current, [entry('new', { description: 'saved' })])
    expect(merged).toHaveLength(1)
    expect(merged[0].description).toBe('typed')
    expect(merged[0].pending).toBe(true)
  })

  it('takes the server version once the write is acknowledged', () => {
    const current = [entry('new', { description: 'typed' })]
    const merged = mergeLoaded(current, [entry('new', { description: 'saved' })])
    expect(merged[0].description).toBe('saved')
    expect(merged[0].pending).toBeUndefined()
  })

  it('does not resurrect a row whose delete is still in flight', () => {
    // A focus refresh fires, the delete is confirmed 100ms later, and the read
    // returns with the row still live. Taking the server copy puts the entry back on
    // screen and back into the balance, persists it that way, and then `settled`
    // clears `pending` so it reads as saved — while the toast says "Deleted".
    const deleting = withPendingDeletedAt([entry('a')], 'a', '2026-08-06T00:00:00.000Z')
    const merged = mergeLoaded(deleting, [entry('a')])
    expect(merged).toHaveLength(1)
    expect(merged[0].deletedAt).toBe('2026-08-06T00:00:00.000Z')
    expect(settled(merged, 'a')[0].deletedAt).toBe('2026-08-06T00:00:00.000Z')
  })

  it('does not roll back an edit that is still in flight', () => {
    const editing = withPendingEdit(
      [entry('a', { amountCents: 1000 })],
      entry('a', { amountCents: 9000 }),
    )
    const merged = mergeLoaded(editing, [entry('a', { amountCents: 1000 })])
    expect(merged[0].amountCents).toBe(9000)
  })

  it('keeps the sheet’s order, with a fresh append last', () => {
    const current = [{ ...entry('mine'), pending: true }]
    expect(mergeLoaded(current, [entry('theirs'), entry('older')]).map((item) => item.id)).toEqual([
      'theirs',
      'older',
      'mine',
    ])
  })

  it('does not keep a non-pending row the sheet no longer has', () => {
    // The other person deleted it and compacted. It is gone, not in flight.
    expect(mergeLoaded([entry('gone')], [])).toEqual([])
  })

  it('mutates neither list', () => {
    const current = [{ ...entry('mine'), pending: true }]
    const loaded = [entry('a')]
    mergeLoaded(current, loaded)
    expect(current).toHaveLength(1)
    expect(loaded).toHaveLength(1)
  })
})

describe('an append', () => {
  const entries = [entry('a')]

  it('shows immediately, marked as not yet in the sheet', () => {
    const next = withPending(entries, entry('b'))
    expect(next.map((item) => item.id)).toEqual(['a', 'b'])
    expect(next[1].pending).toBe(true)
    expect(entries).toHaveLength(1)
  })

  it('loses the flag when the sheet acknowledges it', () => {
    const added = withPending(entries, entry('b'))
    const [, settledRow] = acknowledge(added, entry('b'))
    expect(settledRow.pending).toBeUndefined()
  })

  it('leaves the screen when the write fails, because it was never saved', () => {
    const added = withPending(entries, entry('b'))
    expect(without(added, 'b').map((item) => item.id)).toEqual(['a'])
  })
})

describe('an edit', () => {
  const original = entry('a', { description: 'shop', amountCents: 1000 })
  const edited = entry('a', { description: 'Ozeki', amountCents: 2000 })

  it('replaces the whole entry, not a patch of it', () => {
    const [next] = withPendingEdit([original], edited)
    expect(next.description).toBe('Ozeki')
    expect(next.amountCents).toBe(2000)
    expect(next.pending).toBe(true)
  })

  it('clears only the flag on success, leaving fields the edit did not touch', () => {
    const pendingRow = withPendingEdit([original], edited)
    const [next] = settled(pendingRow, 'a')
    expect(next.pending).toBe(false)
    expect(next.description).toBe('Ozeki')
  })

  it('puts the previous entry back on failure, not the optimistic values', () => {
    // Clearing `pending` instead would leave an unsaved edit on screen looking
    // exactly like a saved one.
    const pendingRow = withPendingEdit([original], edited)
    const [next] = reverted(pendingRow, 'a', original)
    expect(next.description).toBe('shop')
    expect(next.amountCents).toBe(1000)
    expect(next.pending).toBeUndefined()
  })

  it('clears pending on the row it puts back, whatever it was handed', () => {
    /**
     * `previous` can itself be a pending copy: tap Restore while the delete is still
     * in flight, and the delete's `previous` is the row the restore already marked.
     * A `pending` flag left set there is permanent — `mergeLoaded` keeps a pending
     * row over the server's forever, so the row freezes, stops receiving the other
     * person's edits, and blocks `compact` for the life of the install.
     */
    const stillGoing = { ...original, pending: true }
    const [next] = reverted(withPendingEdit([original], edited), 'a', stillGoing)
    expect(next.pending).toBe(false)
    expect(next.description).toBe('shop')
    // And a pending row put back this way is no longer sticky in a merge.
    expect(mergeLoaded([next], [edited])[0].description).toBe('Ozeki')
  })

  it('leaves the list alone when there is nothing to revert to', () => {
    const list = [original]
    expect(reverted(list, 'a', undefined)).toBe(list)
  })

  it('touches no other entry', () => {
    const others = [entry('x'), original, entry('y')]
    const next = withPendingEdit(others, edited)
    expect(next[0]).toBe(others[0])
    expect(next[2]).toBe(others[2])
  })
})

describe('a soft delete', () => {
  const live = entry('a')

  it('stamps the timestamp and the pending flag together', () => {
    const [next] = withPendingDeletedAt([live], 'a', '2026-08-06T00:00:00.000Z')
    expect(next.deletedAt).toBe('2026-08-06T00:00:00.000Z')
    expect(next.pending).toBe(true)
  })

  it('clears the timestamp on a restore', () => {
    const gone = withPendingDeletedAt([live], 'a', '2026-08-06T00:00:00.000Z')
    const [next] = withPendingDeletedAt(gone, 'a', null)
    expect(next.deletedAt).toBe(null)
  })

  it('comes back exactly as it was when the write fails', () => {
    const gone = withPendingDeletedAt([live], 'a', '2026-08-06T00:00:00.000Z')
    expect(reverted(gone, 'a', live)[0]).toBe(live)
  })
})

describe('entryById', () => {
  it('finds the row a failed write will need to revert to', () => {
    const entries = [entry('a'), entry('b')]
    expect(entryById(entries, 'b')).toBe(entries[1])
    expect(entryById(entries, 'nope')).toBeUndefined()
    expect(entryById([], 'a')).toBeUndefined()
  })
})

describe('counting tombstones', () => {
  const entries = [entry('a'), entry('b', { deletedAt: 'x' }), entry('c', { deletedAt: 'y' })]

  it('is sheet-wide, unlike the month-scoped list in the UI', () => {
    expect(tombstoneCount(entries)).toBe(2)
    expect(tombstoneCount([])).toBe(0)
  })
})

describe('status while reading', () => {
  it('gates the UI on the first read of a session only', () => {
    // `loading` is what shows a gate. Every later read has something on screen
    // already, including a cached launch, which starts at `stale`.
    expect(statusOnLoadStart('idle')).toBe('loading')
    expect(statusOnLoadStart('stale')).toBe('refreshing')
    expect(statusOnLoadStart('ready')).toBe('refreshing')
    expect(statusOnLoadStart('error')).toBe('refreshing')
  })

  it('keeps cached data on a failure rather than replacing it with an error', () => {
    expect(statusOnLoadFailure(true)).toBe('stale')
    expect(statusOnLoadFailure(false)).toBe('error')
  })
})

describe('the refresh floor', () => {
  it('allows the first refresh of a session, whatever the clock says', () => {
    // 0 is the "never refreshed" sentinel, and it must not depend on `now` being
    // a real epoch millisecond for the first read of a session to happen.
    expect(shouldRefresh(1000, 0, 30_000)).toBe(true)
    expect(shouldRefresh(1_763_000_000_000, 0, 30_000)).toBe(true)
  })

  it('refuses a second one inside the floor', () => {
    expect(shouldRefresh(40_000, 30_000, 30_000)).toBe(false)
    expect(shouldRefresh(59_999, 30_000, 30_000)).toBe(false)
  })

  it('allows one exactly at the floor', () => {
    expect(shouldRefresh(60_000, 30_000, 30_000)).toBe(true)
  })
})

/**
 * Editing an entry to change who paid moves the row between tabs: the new row is
 * appended before the old one is tombstoned, so the sheet legitimately holds two
 * rows with one id until `compact` runs. Every case below is what goes wrong if the
 * dead copy is the one an id lookup finds.
 */
describe('reconcileById', () => {
  const live = (id, over) => entry(id, over)
  const dead = (id, over) => tombstone({ id, ...over })

  it('keeps the live row when a tombstone shares its id', () => {
    // p1's tab is read first, so the tombstone is the copy `.find` would return.
    const reconciled = reconcileById([
      dead('moved', { payer: PERSON.P1 }),
      live('moved', { payer: PERSON.P2 }),
    ])
    expect(reconciled).toHaveLength(1)
    expect(reconciled[0].payer).toBe(PERSON.P2)
    expect(reconciled[0].deletedAt).toBeNull()
  })

  it('keeps the live row whichever tab it was read from first', () => {
    const reconciled = reconcileById([
      live('moved', { payer: PERSON.P1 }),
      dead('moved', { payer: PERSON.P2 }),
    ])
    expect(reconciled[0].payer).toBe(PERSON.P1)
  })

  it('is what stops the next edit appending a second live row', () => {
    // `useLedger` hands `previous.payer` to `updateEntry` as the tab the row is in
    // NOW. Picking the tombstone names the wrong tab, so the write moves the row
    // again — appending a duplicate and tombstoning an already-dead row.
    const entries = reconcileById([
      dead('moved', { payer: PERSON.P1 }),
      live('moved', { payer: PERSON.P2 }),
    ])
    expect(entryById(entries, 'moved').payer).toBe(PERSON.P2)
  })

  it('never lets an edit or a delete touch two copies of one entry', () => {
    const entries = reconcileById([
      dead('moved', { payer: PERSON.P1 }),
      live('moved', { payer: PERSON.P2 }),
    ])
    // Both map by id, so an unreconciled list would put two of the same expense
    // on screen and count it twice in the balance.
    expect(withPendingEdit(entries, entry('moved', { amountCents: 500 }))).toHaveLength(1)
    expect(withPendingDeletedAt(entries, 'moved', 'now')).toHaveLength(1)
  })

  it('breaks a tie between two tombstones on the later edit', () => {
    const older = dead('moved', { payer: PERSON.P1 })
    const newer = { ...dead('moved', { payer: PERSON.P2 }), updatedAt: '2026-09-01T00:00:00.000Z' }
    expect(reconcileById([older, newer])[0].payer).toBe(PERSON.P2)
    expect(reconcileById([newer, older])[0].payer).toBe(PERSON.P2)
  })

  it('keeps the FIRST of two tombstones stamped at the same moment', () => {
    /**
     * `supersedes` compares timestamps with `>`, so an exact tie leaves the incumbent
     * in place — and the incumbent is p1's row, because `loadAll` reads p1's tab
     * first. That decides which payer `useLedger` then hands `updateEntry` as the
     * tab the row lives in NOW, so it is a real answer rather than a don't-care: a
     * `>=` here would name p2's tab instead, and the next edit would append into it.
     * Two rows one second apart is a payer change and a delete in one sitting, which
     * `updatedAt` records to the second.
     */
    const first = dead('moved', { payer: PERSON.P1 })
    const second = dead('moved', { payer: PERSON.P2 })
    expect(first.updatedAt).toBe(second.updatedAt) // the tie itself, not an accident
    expect(reconcileById([first, second])[0].payer).toBe(PERSON.P1)
    // Stated as "the first one wins" rather than "p1 wins": reversed, the answer
    // reverses with it, which is what pins the comparison rather than the fixture.
    expect(reconcileById([second, first])[0].payer).toBe(PERSON.P2)
  })

  it('returns the same array when there is nothing to reconcile', () => {
    // Which is every load but the ones following a payer change.
    const entries = [entry('a'), entry('b'), dead('c')]
    expect(reconcileById(entries)).toBe(entries)
    expect(reconcileById([])).toEqual([])
  })
})

describe('looksUninitialized', () => {
  it('is true only for the statuses a sheet with no tabs answers with', () => {
    // This gates the ONLY path that writes tabs into somebody's spreadsheet, so a
    // 403 or a 500 must never lead there.
    expect(looksUninitialized({ status: 400 })).toBe(true)
    expect(looksUninitialized({ status: 404 })).toBe(true)
    for (const status of [401, 403, 429, 500, 503]) {
      expect(looksUninitialized({ status })).toBe(false)
    }
    expect(looksUninitialized(undefined)).toBe(false)
    expect(looksUninitialized(new Error('network'))).toBe(false)
  })
})

describe('entryFromInput', () => {
  const input = {
    id: 'a',
    date: '2026-08-05',
    payer: PERSON.P1,
    amountCents: 1000,
    currency: 'JPY',
    category: 'Groceries',
  }

  it('returns a complete entry for valid input', () => {
    expect(entryFromInput(input, NOW)).toMatchObject({
      id: 'a',
      payer: PERSON.P1,
      amountCents: 1000,
      currency: 'JPY',
    })
  })

  it('throws the first problem as a translatable key, never an English sentence', () => {
    const thrown = (over) => {
      try {
        entryFromInput({ ...input, ...over })
        return null
      } catch (cause) {
        return cause.i18nKey
      }
    }
    expect(thrown({ amountCents: 0 })).toBe(`error.${ENTRY_ERROR.BAD_AMOUNT}`)
    expect(thrown({ payer: 'nobody' })).toBe(`error.${ENTRY_ERROR.BAD_PAYER}`)
    expect(thrown({ currency: '' })).toBe(`error.${ENTRY_ERROR.MISSING_CURRENCY}`)
    expect(thrown({ category: '' })).toBe(`error.${ENTRY_ERROR.MISSING_CATEGORY}`)
    expect(thrown({ date: '2026-02-31' })).toBe(`error.${ENTRY_ERROR.BAD_DATE}`)
  })

  it('reports the problem nearest the top of the form when there are several', () => {
    // One message slot, so four at once is a wall; the first is the useful one.
    // Note MISSING_ID is not among them and cannot be: `makeEntry` mints an id for
    // a new entry, so the date is the first thing a person can actually get wrong.
    try {
      entryFromInput({ ...input, date: 'nope', amountCents: 0, payer: 'x', currency: '' })
      throw new Error('should have thrown')
    } catch (cause) {
      expect(cause.i18nKey).toBe(`error.${ENTRY_ERROR.BAD_DATE}`)
    }
  })
})

describe('the gids compact needs', () => {
  it('is satisfied only when both expenses tabs have one', () => {
    const both = { [expensesTab(PERSON.P1)]: 1, [expensesTab(PERSON.P2)]: 2 }
    expect(missingExpenseGid(both)).toBe(false)
    expect(missingExpenseGid({ ...both, [expensesTab(PERSON.P2)]: undefined })).toBe(true)
    expect(missingExpenseGid({})).toBe(true)
    expect(missingExpenseGid(undefined)).toBe(true)
  })

  it('accepts gid 0, which is what the first tab of a new spreadsheet gets', () => {
    // A truthiness check here would ask for the gids on every compact, forever.
    expect(missingExpenseGid({ [expensesTab(PERSON.P1)]: 0, [expensesTab(PERSON.P2)]: 1 })).toBe(
      false,
    )
  })
})

/**
 * What the screen says about itself. Every notice reports a state where the numbers
 * on screen are incomplete or suspect, and every one of them is otherwise silent —
 * which is the whole reason they exist rather than being left to a console.
 */
describe('noticeKeys', () => {
  const keysFor = (state) => noticeKeys(state).map((notice) => notice.key)

  it('says nothing about a healthy sheet', () => {
    expect(noticeKeys({ status: 'ready', error: null })).toEqual([])
    expect(noticeKeys()).toEqual([])
  })

  it('reports cached data only once a read has actually failed', () => {
    // `stale` alone is where a cached launch starts, before any read has failed;
    // announcing it there would put a warning over a perfectly good screen.
    expect(keysFor({ status: 'stale', error: null })).toEqual([])
    expect(keysFor({ status: 'stale', error: 'boom' })).toEqual(['warning.staleData'])
    expect(keysFor({ status: 'ready', error: 'boom' })).toEqual([])
  })

  it('reports a missing config tab, which silently changes the currency', () => {
    expect(keysFor({ configMissing: true })).toEqual(['warning.configMissing'])
  })

  it('reports a config tab that names no currency, and says which one is assumed', () => {
    // The same silent 100x risk as a missing tab, by a different route: `configMissing`
    // can only be set by a FAILED read, so a tab whose `currency` row was deleted reads
    // fine and runs the whole ledger on the default.
    expect(noticeKeys({ currencyDefaulted: true, currency: 'JPY' })).toEqual([
      { key: 'warning.currencyDefaulted', vars: { currency: 'JPY' } },
    ])
  })

  it('says it once when the tab is missing, in the more specific way', () => {
    // A missing tab defaults the currency too, so both flags are true — and two notices
    // about one cause is noise stacked over the balance.
    expect(keysFor({ configMissing: true, currencyDefaulted: true, currency: 'JPY' })).toEqual([
      'warning.configMissing',
    ])
  })

  it('counts the rows it cannot show, and passes the count for pluralisation', () => {
    expect(noticeKeys({ undecodedRows: 2 })).toEqual([
      { key: 'warning.undecodedRows', vars: { count: 2 } },
    ])
    expect(noticeKeys({ undatedRows: 1 })).toEqual([
      { key: 'warning.undatedRows', vars: { count: 1 } },
    ])
    expect(keysFor({ undecodedRows: 0, undatedRows: 0 })).toEqual([])
  })

  it('stacks worst first, because the top one is the one that gets read', () => {
    expect(
      keysFor({
        status: 'stale',
        error: 'boom',
        configMissing: true,
        mixedCurrencies: true,
        undecodedRows: 1,
        undatedRows: 1,
      }),
    ).toEqual([
      'warning.staleData',
      'warning.configMissing',
      'warning.mixedCurrencies',
      'warning.undecodedRows',
      'warning.undatedRows',
    ])
  })
})

/**
 * The three predicates the hook used to spell inline, where nothing could reach them.
 */
describe('hasPendingWrite', () => {
  it('is true while any row has not reached the sheet', () => {
    expect(hasPendingWrite([{ id: 'a' }, { id: 'b', pending: true }])).toBe(true)
  })

  it('is false for a settled list and for an empty one', () => {
    expect(hasPendingWrite([{ id: 'a' }, { id: 'b', pending: false }])).toBe(false)
    expect(hasPendingWrite([])).toBe(false)
  })
})

describe('compactRefusal', () => {
  const gone = tombstone({ id: 'gone' })

  it('refuses as BUSY while a write is in flight, even with rows to remove', () => {
    // Compact shifts every row below each deletion, and a pending write already
    // resolved its target row number — so it would land on whichever row moved into
    // that position, blanking a live expense or un-deleting an unrelated one.
    expect(compactRefusal([gone, { id: 'a', pending: true }], 0)).toEqual({
      removed: 0,
      busy: true,
    })
  })

  it('reports busy rather than "removed 0", which would be a lie', () => {
    // "Removed 0 deleted rows" over a sheet that has rows to remove gives no reason
    // to try again.
    const refusal = compactRefusal([gone, { id: 'a', pending: true }], 0)
    expect(refusal.busy).toBe(true)
  })

  it('refuses quietly when there is genuinely nothing to remove', () => {
    expect(compactRefusal([{ id: 'a' }], 0)).toEqual({ removed: 0 })
    expect(compactRefusal([], 0)).toEqual({ removed: 0 })
  })

  it('allows a run for a tombstone the sheet holds but the list cannot show', () => {
    // `reconcileById` hides a superseded tombstone behind its live row, so `entries`
    // can look clean while the sheet still holds removable rows. Refusing here would
    // leave them unremovable for the life of the install.
    expect(compactRefusal([{ id: 'a' }], 1)).toBe(null)
  })

  it('allows a run when a tombstone is on screen and nothing is in flight', () => {
    expect(compactRefusal([gone], 0)).toBe(null)
  })

  it('puts busy ahead of nothing-to-remove, so a pending write is never ignored', () => {
    expect(compactRefusal([{ id: 'a', pending: true }], 0)).toEqual({ removed: 0, busy: true })
  })
})

describe('newDraftEntry', () => {
  it('mints one id per draft, so a lost response cannot double-count', () => {
    // The id belongs to the draft, not to the submit: a `fetch` that rejects after
    // Google committed the append leaves the row on screen as failed, and re-submitting
    // must write the SAME id — at worst a duplicate row `reconcileById` collapses to
    // one, never a second expense with an id nothing can pair it with.
    //
    // Two submits of one draft is what shows that: `entryFromInput` is what both write
    // paths call, and a draft carrying no id of its own would have `makeEntry` mint a
    // fresh one on each pass through it.
    const draft = newDraftEntry(PERSON.P1)
    const submit = () =>
      entryFromInput({ ...draft, amountCents: 1000, currency: 'JPY', category: 'Groceries' }, NOW)

    expect(submit().id).toBe(draft.id)
    expect(submit().id).toBe(draft.id)

    // And the NEXT draft is a different expense, not a reused row.
    expect(newDraftEntry(PERSON.P1).id).not.toBe(draft.id)
  })

  it('opens on this device’s person, and falls back to a real one', () => {
    expect(newDraftEntry(PERSON.P2).payer).toBe(PERSON.P2)
    // The payer decides the sign of the balance, so it may never be undefined.
    for (const junk of [undefined, null, '', 'p3', 42]) {
      expect(isPerson(newDraftEntry(junk).payer)).toBe(true)
    }
  })

  it('carries no share, meaning "follow the payer’s default"', () => {
    // Seeding one would pin the opening payer's share onto whoever it is switched to.
    expect(newDraftEntry(PERSON.P1).payerShare).toBe(null)
  })

  it('is an expense, and claims no timestamps it has not earned', () => {
    const draft = newDraftEntry(PERSON.P1)
    expect(draft.type).toBe(ENTRY_TYPE.EXPENSE)
    // Not `makeEntry`: a draft has not been saved, so it must not look saved.
    expect(draft.createdAt).toBeUndefined()
    expect(draft.updatedAt).toBeUndefined()
  })

  it('opens on a date that is a real ISO day', () => {
    expect(newDraftEntry(PERSON.P1).date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

/**
 * The gate ladder. Every one of these was an early return in `App`, where nothing
 * could reach it — and the ORDER is the part that can be wrong while every screen it
 * chooses between looks perfectly correct.
 */
describe('gateFor', () => {
  const ready = {
    connectionStatus: 'connected',
    spreadsheetId: 'sheet-1',
    connectionFailed: false,
    ledgerStatus: 'ready',
    me: PERSON.P1,
  }

  it('shows the ledger once everything is in place', () => {
    expect(gateFor(ready)).toBe(null)
  })

  it('reports a missing endpoint before anything else, since nothing can work', () => {
    // No key screen: there is no endpoint for a key to be presented to, so offering to
    // type one would be asking for 64 characters that cannot be checked.
    expect(gateFor({ ...ready, connectionStatus: 'unconfigured' })).toBe('unconfigured')
  })

  it('sends a REJECTED key back to the key screen, cached sheet id and all', () => {
    // The id outlives the key and is worthless without a token, so a suspect key
    // outranks having one. Getting this backwards shows a ledger that can never load.
    expect(gateFor({ ...ready, connectionStatus: 'no-key' })).toBe('key')
  })

  it('tells a first mint in flight apart from one that failed', () => {
    expect(gateFor({ ...ready, spreadsheetId: null })).toBe('loading')
    expect(gateFor({ ...ready, spreadsheetId: null, connectionFailed: true })).toBe(
      'connectionError',
    )
  })

  it('shows a failed read instead of asking who you are', () => {
    // Two screens to answer one problem, and the identity question would come back
    // after the retry anyway.
    expect(gateFor({ ...ready, ledgerStatus: 'error', me: null })).toBe('readError')
  })

  it('gates the ledger on the FIRST read only', () => {
    expect(gateFor({ ...ready, ledgerStatus: 'idle' })).toBe('loading')
    expect(gateFor({ ...ready, ledgerStatus: 'loading' })).toBe('loading')
    // A cached launch starts at `stale` and a later read is `refreshing`: both have
    // something real on screen, so neither may be replaced by a spinner.
    expect(gateFor({ ...ready, ledgerStatus: 'stale' })).toBe(null)
    expect(gateFor({ ...ready, ledgerStatus: 'refreshing' })).toBe(null)
  })

  it('asks who this device is last, and only when nothing else is wrong', () => {
    // Nothing detects it; this gate and the localStorage choice behind it are the
    // only path. It comes last because the answer is worth keeping only if the
    // ledger behind it actually loaded.
    expect(gateFor({ ...ready, me: null })).toBe('identity')
    expect(gateFor({ ...ready, me: null, ledgerStatus: 'stale' })).toBe('identity')
  })
})
