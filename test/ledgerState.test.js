import { afterEach, describe, expect, it, vi } from 'vitest'

import { DATA_TABS, ENTRY_ERROR, ENTRY_TYPE, PERSON, RECURRING, isPerson } from '../src/schema.js'
import { expense, row as rawRow, tombstone } from './support/entries.js'
import { SHEET, installSheets, removeSheets, values } from './support/sheets-api.js'
import {
  gateFor,
  acknowledge,
  blocksReload,
  compactRefusal,
  entryById,
  entryFromInput,
  hasPendingWrite,
  looksUninitialized,
  mergeLoaded,
  missingGid,
  newDraftEntry,
  NO_SHEET_EXTRAS,
  noticeKeys,
  reconcileById,
  reverted,
  settled,
  sheetExtrasFrom,
  shouldRefresh,
  statusOnLoadFailure,
  statusOnLoadStart,
  templateFromInput,
  tombstoneCount,
  withPending,
  withPendingDeletedAt,
  withPendingEdit,
  without,
} from '../src/lib/ledgerState.js'

/**
 * The optimistic bookkeeping `useLedger` delegates to: a row left looking saved that never
 * reached the sheet, or one that vanishes because the read that started first finished last.
 */

/** Stubbed for the one case here that reads a sheet; `connection.test.js` owns the mint. */
vi.mock('../src/lib/connection.js', () => ({
  getAccessToken: vi.fn(async () => 'ya29.stub-token'),
  refreshToken: vi.fn(async () => {}),
}))

afterEach(() => {
  removeSheets()
})

const entry = (id, over = {}) => expense({ id, ...over })

describe('mergeLoaded', () => {
  it('hands back the server list itself when nothing is in flight', () => {
    // Identity, not equality: `applyLoad` passes it to `setEntries` and `writeSnapshot` both.
    const loaded = [entry('a'), entry('b')]
    expect(mergeLoaded([entry('a')], loaded)).toBe(loaded)
  })

  it('hands back the list already on screen when the read changed nothing', () => {
    // Most reads change nothing; a fresh array of equal rows re-runs every memo and the snapshot.
    const current = [entry('a'), entry('b')]
    const loaded = [entry('a'), entry('b')]
    expect(mergeLoaded(current, loaded)).toBe(current)
  })

  it('takes the server list when any single field differs', () => {
    // Returning `current` above is only safe if this is exact: a field the comparison misses
    // is the other person's edit frozen off the screen, with nothing to report it.
    const differences = {
      type: 'settlement',
      date: '2026-08-04',
      payer: 'p2',
      amountYen: 1251,
      category: 'Dining',
      description: 'theirs',
      payerShare: 1,
      deletedAt: '2026-08-07T00:00:00.000Z',
    }
    // Every field but the id, which is what the two rows are matched BY.
    expect(Object.keys(differences).length).toBe(Object.keys(entry('a')).length - 1)

    for (const [field, value] of Object.entries(differences)) {
      const loaded = [{ ...entry('a'), [field]: value }]
      expect(mergeLoaded([entry('a')], loaded), field).toBe(loaded)
    }
  })

  it('takes the server list when a row moved, gained one or lost one', () => {
    const reordered = [entry('b'), entry('a')]
    expect(mergeLoaded([entry('a'), entry('b')], reordered)).toBe(reordered)

    const gained = [entry('a'), entry('b')]
    expect(mergeLoaded([entry('a')], gained)).toBe(gained)

    const lost = [entry('a')]
    expect(mergeLoaded([entry('a'), entry('b')], lost)).toBe(lost)
  })

  it('keeps a pending row the read has not caught up with yet', () => {
    // Dropping it would also persist the truncated list, losing the row across a relaunch.
    const current = [entry('a'), { ...entry('new'), pending: true }]
    const merged = mergeLoaded(current, [entry('a')])
    expect(merged.map((item) => item.id)).toEqual(['a', 'new'])
    expect(merged[1].pending).toBe(true)
  })

  it('keeps the local copy while a write is in flight, even once the sheet lists it', () => {
    // The copies agree here, so this buys nothing alone — the edit and delete cases below do.
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
    // A focus refresh returning the row still live: the server copy revives it into the balance,
    // persists it, then `settled` clears `pending` so it reads as saved under a "Deleted" toast.
    const deleting = withPendingDeletedAt([entry('a')], 'a', '2026-08-06T00:00:00.000Z')
    const merged = mergeLoaded(deleting, [entry('a')])
    expect(merged).toHaveLength(1)
    expect(merged[0].deletedAt).toBe('2026-08-06T00:00:00.000Z')
    expect(settled(merged, 'a')[0].deletedAt).toBe('2026-08-06T00:00:00.000Z')
  })

  it('does not roll back an edit that is still in flight', () => {
    const editing = withPendingEdit(
      [entry('a', { amountYen: 1000 })],
      entry('a', { amountYen: 9000 }),
    )
    const merged = mergeLoaded(editing, [entry('a', { amountYen: 1000 })])
    expect(merged[0].amountYen).toBe(9000)
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
  const original = entry('a', { description: 'shop', amountYen: 1000 })
  const edited = entry('a', { description: 'Ozeki', amountYen: 2000 })

  it('replaces the whole entry, not a patch of it', () => {
    const [next] = withPendingEdit([original], edited)
    expect(next.description).toBe('Ozeki')
    expect(next.amountYen).toBe(2000)
    expect(next.pending).toBe(true)
  })

  it('clears only the flag on success, leaving fields the edit did not touch', () => {
    const pendingRow = withPendingEdit([original], edited)
    const [next] = settled(pendingRow, 'a')
    expect(next.pending).toBe(false)
    expect(next.description).toBe('Ozeki')
  })

  it('puts the previous entry back on failure, not the optimistic values', () => {
    // Clearing `pending` instead leaves an unsaved edit looking exactly like a saved one.
    const pendingRow = withPendingEdit([original], edited)
    const [next] = reverted(pendingRow, 'a', original)
    expect(next.description).toBe('shop')
    expect(next.amountYen).toBe(1000)
    expect(next.pending).toBeUndefined()
  })

  it('clears pending on the row it puts back, whatever it was handed', () => {
    // `previous` can itself be pending: Restore tapped while the delete is still in flight.
    const stillGoing = { ...original, pending: true }
    const [next] = reverted(withPendingEdit([original], edited), 'a', stillGoing)
    expect(next.pending).toBe(false)
    expect(next.description).toBe('shop')
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
    // `loading` shows a gate; every later read, a cached launch (`stale`) included, has content.
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
    // 0 is the "never refreshed" sentinel, and must not depend on `now` being a real epoch ms.
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
 * Changing who paid appends the new row before tombstoning the old, so the sheet holds two rows
 * with one id until `compact` runs. Each case below is what a lookup finding the dead copy costs.
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
    // `useLedger` hands `previous.payer` to `updateEntry` as the tab the row is in NOW. The
    // tombstone names the wrong tab, so the write moves the row again — appending a duplicate.
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
    // Both map by id, so an unreconciled list shows the expense twice and counts it twice.
    expect(withPendingEdit(entries, entry('moved', { amountYen: 500 }))).toHaveLength(1)
    expect(withPendingDeletedAt(entries, 'moved', 'now')).toHaveLength(1)
  })

  /**
   * The tie-break is `deletedAt`, NOT array order — and array order is tab order (p1 decodes
   * first), so "last seen" keeps p1's copy however late p2's was retired. Both ways round pins it.
   */
  it('breaks a tie between two tombstones on the later deletion', () => {
    const older = dead('moved', { payer: PERSON.P1, deletedAt: '2026-08-06T00:00:00.000Z' })
    const newer = dead('moved', { payer: PERSON.P2, deletedAt: '2026-09-01T00:00:00.000Z' })
    expect(reconcileById([older, newer])[0].payer).toBe(PERSON.P2)
    expect(reconcileById([newer, older])[0].payer).toBe(PERSON.P2)
  })

  /**
   * The case an array-order tie-break gets backwards: created under p2, moved to p1, then deleted,
   * so p1's stamp is later even though p1's decodes first. Wrong, it moves money silently —
   * `deletedEntries` offers the pre-move copy, and restoring it revives the entry under the wrong
   * payer, flipping the sign of its contribution.
   */
  it('keeps the copy retired last after a payer move and then a delete', () => {
    const movedAway = dead('moved', { payer: PERSON.P2, deletedAt: '2026-08-06T00:00:00.000Z' })
    const thenDeleted = dead('moved', { payer: PERSON.P1, deletedAt: '2026-08-09T00:00:00.000Z' })
    // Decoded order: p1's tab first, exactly as `loadAll` reads them.
    expect(reconcileById([thenDeleted, movedAway])[0].payer).toBe(PERSON.P1)
  })

  it('keeps the FIRST of two tombstones stamped at the same moment', () => {
    /**
     * `supersedes` uses `>`, so a tie leaves the incumbent — p1's row, since p1's tab is read
     * first. That names the tab `useLedger` hands `updateEntry`, so `>=` sends the next edit to p2.
     */
    const first = dead('moved', { payer: PERSON.P1 })
    const second = dead('moved', { payer: PERSON.P2 })
    expect(first.deletedAt).toBe(second.deletedAt) // the tie itself, not an accident
    expect(reconcileById([first, second])[0].payer).toBe(PERSON.P1)
    // Reversed, the answer reverses: that pins the comparison rather than the fixture.
    expect(reconcileById([second, first])[0].payer).toBe(PERSON.P2)
  })

  it('returns the same array when there is nothing to reconcile', () => {
    const entries = [entry('a'), entry('b'), dead('c')]
    expect(reconcileById(entries)).toBe(entries)
    expect(reconcileById([])).toEqual([])
  })
})

describe('looksUninitialized', () => {
  it('is true only for the statuses a sheet with no tabs answers with', () => {
    // Gates the ONLY path that writes tabs into somebody's spreadsheet.
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
    amountYen: 1000,
    category: 'Groceries',
  }

  it('returns a complete entry for valid input', () => {
    expect(entryFromInput(input)).toMatchObject({
      id: 'a',
      payer: PERSON.P1,
      amountYen: 1000,
      category: 'Groceries',
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
    expect(thrown({ amountYen: 0 })).toBe(`error.${ENTRY_ERROR.BAD_AMOUNT}`)
    expect(thrown({ payer: 'nobody' })).toBe(`error.${ENTRY_ERROR.BAD_PAYER}`)
    expect(thrown({ category: '' })).toBe(`error.${ENTRY_ERROR.MISSING_CATEGORY}`)
    expect(thrown({ date: '2026-02-31' })).toBe(`error.${ENTRY_ERROR.BAD_DATE}`)
  })

  it('reports the problem nearest the top of the form when there are several', () => {
    // One message slot; MISSING_ID cannot be first because `makeEntry` mints an id.
    try {
      entryFromInput({ ...input, date: 'nope', amountYen: 0, payer: 'x' })
      throw new Error('should have thrown')
    } catch (cause) {
      expect(cause.i18nKey).toBe(`error.${ENTRY_ERROR.BAD_DATE}`)
    }
  })
})

describe('the gids a hard delete needs', () => {
  const allGids = (over = {}) => ({
    ...Object.fromEntries(DATA_TABS.map((tab, index) => [tab.title, index + 1])),
    ...over,
  })

  it('is satisfied only when EVERY data tab has one', () => {
    expect(missingGid(allGids(), DATA_TABS)).toBe(false)
    expect(missingGid({}, DATA_TABS)).toBe(true)
    expect(missingGid(undefined, DATA_TABS)).toBe(true)
    // Dropped in turn: the settlements tab counts as much as the two expenses ones, or
    // `compact` leaves every tombstoned settlement in place while settings offers to remove it.
    for (const tab of DATA_TABS) {
      expect(missingGid(allGids({ [tab.title]: undefined }), DATA_TABS), tab.title).toBe(true)
    }
  })

  it('covers whichever tabs it is given, which is how the recurring delete reuses it', () => {
    // `compact` passes DATA_TABS, `deleteTemplate` [RECURRING]: two inline checks would drift.
    expect(missingGid({ recurring: 5 }, [RECURRING])).toBe(false)
    expect(missingGid(allGids(), [RECURRING])).toBe(true)
  })

  it('accepts gid 0, which is what the first tab of a new spreadsheet gets', () => {
    // A truthiness check here would ask for the gids on every compact, forever.
    expect(missingGid(allGids({ [DATA_TABS[0].title]: 0 }), DATA_TABS)).toBe(false)
  })
})

/**
 * The template half of `entryFromInput`. The blank cases are what matter: a blank amount and a
 * blank share are both real answers, and refusing either makes a variable bill unsavable.
 */
describe('templateFromInput', () => {
  const input = { description: 'Rent', payer: PERSON.P1, dayOfMonth: 27, amountYen: 220000 }

  it('mints an id and returns a complete template', () => {
    const template = templateFromInput(input)
    expect(template.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(template).toMatchObject({ description: 'Rent', amountYen: 220000, dayOfMonth: 27 })
  })

  it('keeps an id it was given, because changing one re-posts every month', () => {
    expect(templateFromInput({ ...input, id: 'rent' }).id).toBe('rent')
  })

  it('accepts a blank amount and a blank share, which both mean something', () => {
    const template = templateFromInput({ ...input, amountYen: null, payerShare: null })
    expect(template.amountYen).toBeNull()
    expect(template.payerShare).toBeNull()
  })

  it('throws a translated key rather than an English sentence', () => {
    expect(() => templateFromInput({ ...input, description: '  ' })).toThrow()
    expect(() => templateFromInput({ ...input, description: '  ' })).toThrowError(
      expect.objectContaining({ i18nKey: 'error.missingDescription' }),
    )
    expect(() => templateFromInput({ ...input, payer: 'p3' })).toThrowError(
      expect.objectContaining({ i18nKey: 'error.badPayer' }),
    )
    expect(() => templateFromInput({ ...input, dayOfMonth: 99 })).toThrowError(
      expect.objectContaining({ i18nKey: 'error.badDay' }),
    )
  })

  it('reports the problem the FORM shows first, which is the name', () => {
    // WHICH key is the only assertable thing: `validateTemplateCodes`' order is the form's.
    expect(() => templateFromInput({ description: '', payer: 'p3', dayOfMonth: 0 })).toThrowError(
      expect.objectContaining({ i18nKey: 'error.missingDescription' }),
    )
    expect(() =>
      templateFromInput({ description: 'Rent', payer: 'p3', dayOfMonth: 0 }),
    ).toThrowError(expect.objectContaining({ i18nKey: 'error.badPayer' }))
  })
})

describe('what a read carries beside the entries', () => {
  /**
   * Compared against a REAL read rather than a literal: a count added to `loadAll` and
   * forgotten here reports its starting value all session, with nothing on screen looking wrong.
   */
  it('names every count loadAll returns, and nothing else it returns', async () => {
    const { loadAll } = await import('../src/lib/sheets.js')
    // One unreadable amount, so the reply carries a non-zero count and not just six defaults.
    installSheets((call) =>
      call.url.includes('values:batchGet')
        ? { valueRanges: [values([rawRow({ id: 'a', amount: 'lots' })]), {}, {}, {}, {}] }
        : {},
    )

    const data = await loadAll(SHEET)
    const counted = Object.keys(data).filter(
      (key) => !['entries', 'templates', 'config', 'sheetConfig'].includes(key),
    )

    expect([...counted].sort()).toEqual(Object.keys(NO_SHEET_EXTRAS).sort())
    // And the picker takes exactly those, so entries and config cannot ride into notice state.
    expect(sheetExtrasFrom(data)).toEqual({ ...NO_SHEET_EXTRAS, undecodedRows: 1 })
  })
})

describe('noticeKeys', () => {
  const keysFor = (state) => noticeKeys(state).map((notice) => notice.key)

  it('says nothing about a healthy sheet', () => {
    expect(noticeKeys({ status: 'ready', error: null })).toEqual([])
    expect(noticeKeys()).toEqual([])
  })

  it('reports cached data only once a read has actually failed', () => {
    // `stale` alone is where a cached launch starts: a warning there sits over a good screen.
    expect(keysFor({ status: 'stale', error: null })).toEqual([])
    expect(keysFor({ status: 'stale', error: 'boom' })).toEqual(['warning.staleData'])
    expect(keysFor({ status: 'ready', error: 'boom' })).toEqual([])
  })

  it('reports a missing config tab, which silently changes the default split', () => {
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

  it('reports settlements whose payer cell names nobody', () => {
    expect(noticeKeys({ unattributedRows: 2 })).toEqual([
      { key: 'warning.unattributedRows', vars: { count: 2 } },
    ])
    expect(keysFor({ unattributedRows: 0 })).toEqual([])
  })

  it('reports recurring rows it cannot read, so one never stops being offered silently', () => {
    expect(noticeKeys({ undecodedTemplates: 2 })).toEqual([
      { key: 'warning.undecodedTemplates', vars: { count: 2 } },
    ])
    expect(keysFor({ undecodedTemplates: 0 })).toEqual([])
  })

  it('stacks worst first, because the top one is the one that gets read', () => {
    expect(
      keysFor({
        status: 'stale',
        error: 'boom',
        configMissing: true,
        undecodedRows: 1,
        undatedRows: 1,
        unattributedRows: 1,
        undecodedTemplates: 1,
      }),
    ).toEqual([
      'warning.staleData',
      'warning.configMissing',
      'warning.undecodedRows',
      'warning.undatedRows',
      'warning.unattributedRows',
      // Last: it is the only one where no figure on screen is wrong.
      'warning.undecodedTemplates',
    ])
  })
})

describe('hasPendingWrite', () => {
  it('is true while any row has not reached the sheet', () => {
    expect(hasPendingWrite([{ id: 'a' }, { id: 'b', pending: true }])).toBe(true)
  })

  it('is false for a settled list and for an empty one', () => {
    expect(hasPendingWrite([{ id: 'a' }, { id: 'b', pending: false }])).toBe(false)
    expect(hasPendingWrite([])).toBe(false)
  })
})

/** An update activates by RELOADING, and each case is something a reload destroys silently. */
describe('blocksReload', () => {
  const settledList = [{ id: 'a' }]

  it('blocks while a form is open, because a reload throws away what is half-typed', () => {
    for (const kind of ['entry', 'template']) {
      expect(blocksReload({ overlay: { kind }, entries: settledList, writing: false }), kind).toBe(
        true,
      )
    }
  })

  it('blocks while an optimistic entry write is unacknowledged', () => {
    const pending = [{ id: 'a' }, { id: 'b', pending: true }]
    expect(blocksReload({ overlay: null, entries: pending, writing: false })).toBe(true)
  })

  /**
   * The case neither of the two above can see, and the costliest: a template write and a compact
   * carry no `pending` flag, and the overlay cannot stand in — `deleteTemplate` switches it to the
   * recurring page and `compact` runs from settings, both before awaiting. The only two
   * irreversible writes there are.
   */
  it('blocks a write no optimistic flag can see, whichever sheet is open', () => {
    for (const kind of ['recurring', 'settings', 'confirmEntry']) {
      expect(blocksReload({ overlay: { kind }, entries: settledList, writing: true }), kind).toBe(
        true,
      )
    }
    expect(blocksReload({ overlay: null, entries: settledList, writing: true })).toBe(true)
  })

  it('allows a reload with nothing open and nothing in flight', () => {
    expect(blocksReload({ overlay: null, entries: settledList, writing: false })).toBe(false)
    expect(blocksReload({ overlay: { kind: 'settings' }, entries: [], writing: false })).toBe(false)
    // A sheet that cannot hold a half-typed anything is not a form.
    expect(
      blocksReload({ overlay: { kind: 'recurring' }, entries: settledList, writing: false }),
    ).toBe(false)
  })
})

describe('compactRefusal', () => {
  const gone = tombstone({ id: 'gone' })

  it('refuses as BUSY while a write is in flight, even with rows to remove', () => {
    // Compact shifts every row below a deletion, and a pending write already resolved its target
    // row number. `busy`, never `{removed: 0}`, which over removable rows reads as nothing to do.
    expect(compactRefusal([gone, { id: 'a', pending: true }], 0)).toEqual({
      removed: 0,
      busy: true,
    })
  })

  it('refuses quietly when there is genuinely nothing to remove', () => {
    expect(compactRefusal([{ id: 'a' }], 0)).toEqual({ removed: 0 })
    expect(compactRefusal([], 0)).toEqual({ removed: 0 })
  })

  it('allows a run for a tombstone the sheet holds but the list cannot show', () => {
    // `reconcileById` hides a superseded tombstone behind its live row, so `entries` can look
    // clean while the sheet holds removable rows. Refusing here strands them for the install.
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
    // The id belongs to the draft, not the submit: a `fetch` that rejects after Google committed
    // the append must re-submit the SAME id. A draft with no id has `makeEntry` mint one per pass.
    const draft = newDraftEntry(PERSON.P1)
    const submit = () => entryFromInput({ ...draft, amountYen: 1000, category: 'Groceries' })

    expect(submit().id).toBe(draft.id)
    expect(submit().id).toBe(draft.id)

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

  it('is an expense, and is not tombstoned', () => {
    const draft = newDraftEntry(PERSON.P1)
    expect(draft.type).toBe(ENTRY_TYPE.EXPENSE)
    // A truthy `deletedAt` here would hide the entry the moment it was saved.
    expect(draft.deletedAt).toBeUndefined()
  })

  it('opens on a date that is a real ISO day', () => {
    expect(newDraftEntry(PERSON.P1).date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

/** The gate ladder. The ORDER can be wrong while every screen it chooses between looks right. */
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
    // No key screen: with no endpoint to present a key to, asking for 64 uncheckable characters.
    expect(gateFor({ ...ready, connectionStatus: 'unconfigured' })).toBe('unconfigured')
  })

  it('sends a REJECTED key back to the key screen, cached sheet id and all', () => {
    // A suspect key outranks the cached id, which is worthless without a token; backwards, this
    // shows a ledger that can never load.
    expect(gateFor({ ...ready, connectionStatus: 'no-key' })).toBe('key')
  })

  it('tells a first mint in flight apart from one that failed', () => {
    expect(gateFor({ ...ready, spreadsheetId: null })).toBe('loading')
    expect(gateFor({ ...ready, spreadsheetId: null, connectionFailed: true })).toBe(
      'connectionError',
    )
  })

  it('shows a failed read instead of asking who you are', () => {
    // Two screens for one problem, and the identity question comes back after the retry anyway.
    expect(gateFor({ ...ready, ledgerStatus: 'error', me: null })).toBe('readError')
  })

  it('gates the ledger on the FIRST read only', () => {
    expect(gateFor({ ...ready, ledgerStatus: 'idle' })).toBe('loading')
    expect(gateFor({ ...ready, ledgerStatus: 'loading' })).toBe('loading')
    // Both have something real on screen already, so neither may be replaced by a spinner.
    expect(gateFor({ ...ready, ledgerStatus: 'stale' })).toBe(null)
    expect(gateFor({ ...ready, ledgerStatus: 'refreshing' })).toBe(null)
  })

  it('asks who this device is last, and only when nothing else is wrong', () => {
    // Nothing detects it; this gate and the localStorage choice behind it are the only path.
    // Last, because the answer is worth keeping only if the ledger behind it loaded.
    expect(gateFor({ ...ready, me: null })).toBe('identity')
    expect(gateFor({ ...ready, me: null, ledgerStatus: 'stale' })).toBe('identity')
  })
})
