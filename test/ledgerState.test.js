import { describe, expect, it } from 'vitest'

import { PERSON, expensesTab, makeEntry } from '../src/schema.js'
import {
  acknowledge,
  entryById,
  hasTombstones,
  mergeLoaded,
  missingExpenseGid,
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
  it('takes the server list when nothing is in flight', () => {
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

  it('drops the local copy once the sheet reports it, taking the server version', () => {
    const current = [{ ...entry('new', { description: 'typed' }), pending: true }]
    const merged = mergeLoaded(current, [entry('new', { description: 'saved' })])
    expect(merged).toHaveLength(1)
    expect(merged[0].description).toBe('saved')
    expect(merged[0].pending).toBeUndefined()
  })

  it('does not keep a non-pending row the sheet no longer has', () => {
    // The other person deleted it and compacted. It is gone, not in flight.
    expect(mergeLoaded([entry('gone')], [])).toEqual([])
  })

  it('puts pending rows last, as the newest thing this person did', () => {
    const current = [{ ...entry('mine'), pending: true }]
    expect(mergeLoaded(current, [entry('theirs')]).map((item) => item.id)).toEqual([
      'theirs',
      'mine',
    ])
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

  it('answers the question compact asks before doing any work', () => {
    expect(hasTombstones(entries)).toBe(true)
    expect(hasTombstones([entry('a')])).toBe(false)
    expect(hasTombstones([])).toBe(false)
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
