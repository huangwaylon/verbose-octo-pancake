import { describe, expect, it } from 'vitest'

import { ENTRY_ERROR, PERSON, expensesTab, makeEntry } from '../src/schema.js'
import {
  acknowledge,
  entryById,
  entryFromInput,
  looksUninitialized,
  mergeLoaded,
  missingExpenseGid,
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

const entry = (id, over = {}) =>
  makeEntry(
    {
      id,
      date: '2026-08-05',
      payer: PERSON.P1,
      amountCents: 1000,
      currency: 'JPY',
      category: 'Groceries',
      ...over,
    },
    '2026-08-05T10:00:00.000Z',
  )

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

  it('is what compact asks before doing any work', () => {
    // A separate `hasTombstones` predicate would be this same expression.
    expect(tombstoneCount([entry('a')])).toBe(0)
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
  const dead = (id, over) => entry(id, { deletedAt: '2026-08-06T00:00:00.000Z', ...over })

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
    expect(entryFromInput(input, '2026-08-05T10:00:00.000Z')).toMatchObject({
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
