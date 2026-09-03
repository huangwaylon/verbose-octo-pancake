import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DATA_TABS, PERSON, RECURRING, SETTLEMENTS, SHEET_TABS, expenseTab } from '../src/schema.js'
import { DEFAULT_CONFIG } from '../src/config.js'
import {
  asFields,
  expense as entry,
  row,
  settlement,
  settlementRow,
  templateRow as recurringRow,
} from './support/entries.js'
import {
  installSheets,
  removeSheets,
  rangesOf,
  values,
  writes,
  SHEET,
} from './support/sheets-api.js'

/**
 * The Sheets layer. Three invariants live here and every one of them fails
 * silently: `compact` must delete bottom-up or it removes live expenses,
 * every write must be RAW or a note becomes a formula, and ids must be re-resolved to
 * rows immediately before writing or a write lands on somebody else's expense.
 *
 * The token is stubbed out: this file is about what gets sent to Google, not about
 * how the credential is obtained (`connection.test.js` owns that).
 */

vi.mock('../src/lib/connection.js', () => ({
  getAccessToken: vi.fn(async () => 'ya29.stub-token'),
  refreshToken: vi.fn(async () => {}),
}))

let sheets
let connection

beforeEach(async () => {
  vi.resetModules()
  sheets = await import('../src/lib/sheets.js')
  connection = await import('../src/lib/connection.js')
})

afterEach(() => {
  removeSheets()
  vi.clearAllMocks()
})

const P1 = expenseTab(PERSON.P1)
const P2 = expenseTab(PERSON.P2)

const GIDS = { expenses_p1: 111, expenses_p2: 222, settlements: 444, recurring: 555, config: 333 }

/** Every tab a fully built ledger has, for the gid listing fixtures. */
const ALL_TABS = [...SHEET_TABS.map((tab) => tab.title), 'config']

/** The five value ranges a read asks for, in `loadAll`'s own order. */
const FIVE_RANGES = [
  P1.dataRange,
  P2.dataRange,
  SETTLEMENTS.dataRange,
  RECURRING.dataRange,
  'config!A:B',
]

/**
 * A reply shaped for those five ranges: the three data tabs, recurring, then config.
 * Named per range rather than positional, because a positional literal goes on passing
 * while every range it holds lands one slot out.
 */
const ranges5 = ({ p1 = {}, p2 = {}, settlements = {}, recurring = {}, config = {} } = {}) => ({
  valueRanges: [p1, p2, settlements, recurring, config],
})

/** Five empty ranges — what most of these cases want from a batchGet. */
const EMPTY_RANGES = { valueRanges: [{}, {}, {}, {}, {}] }

describe('every write is RAW', () => {
  it('never sends USER_ENTERED, on any path', async () => {
    const calls = installSheets((call) => {
      // Checked before the row range: a batchGet's `ranges` never carry `!A2:G`
      // (`ensureStructure` asks for header rows), but matching it first cannot go
      // wrong either way.
      if (call.url.includes('values:batchGet')) return EMPTY_RANGES
      if (call.url.includes('!A2:G')) return values([row({ id: 'e1' })])
      if (call.url.includes('fields=sheets')) {
        return {
          sheets: Object.entries(GIDS).map(([title, sheetId]) => ({
            properties: { title, sheetId },
          })),
        }
      }
      return {}
    })

    await sheets.appendEntry(SHEET, entry())
    await sheets.updateEntry(SHEET, entry(), PERSON.P1)
    await sheets.setDeletedAt(SHEET, P1, 'e1', '2026-08-06T00:00:00.000Z')
    await sheets.ensureStructure(SHEET)

    const mutating = writes(calls)
    expect(mutating.length).toBeGreaterThan(3)
    for (const call of mutating) {
      expect(call.url).not.toContain('USER_ENTERED')
      // Per endpoint, not "either shape": `values.update` and `:append` read the
      // option from the QUERY and ignore a body copy entirely, while
      // `values:batchUpdate` reads it from the BODY and ignores a query copy. An
      // assertion that accepts both passes while the option is being dropped on
      // the floor — and a dropped option defaults to USER_ENTERED.
      if (call.url.includes('/values:batchUpdate')) {
        expect(call.body.valueInputOption).toBe('RAW')
      } else if (call.url.includes('/values/')) {
        expect(call.url).toContain('valueInputOption=RAW')
      } else {
        // `:batchUpdate` on the spreadsheet itself writes structure, not values.
        expect(call.url).toContain(`/${SHEET}:batchUpdate`)
      }
    }
  })
})

describe('resolving a row before writing to it', () => {
  it('writes to the row the sheet says, not to any cached position', async () => {
    // The id sits third in the tab, so the write must land on row 4 (header + 2).
    const calls = installSheets((call) => {
      if (call.url.includes('!A2:G')) {
        return values([row({ id: 'other-1' }), row({ id: 'other-2' }), row({ id: 'e1' })])
      }
      return {}
    })

    await sheets.updateEntry(SHEET, entry(), PERSON.P1)

    const [read, write] = calls
    expect(read.method).toBe('GET')
    // The full row range, not the id column alone: an id is not unique within a tab,
    // so telling a live row from a tombstone needs `deleted_at` as well.
    expect(read.url).toContain('expenses_p1!A2:G')
    expect(write.method).toBe('PUT')
    expect(write.url).toContain('expenses_p1!A4:G4')
  })

  it('stamps deleted_at on the resolved row, in the deleted_at column only', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('!A2:G')) return values([row({ id: 'e1' })])
      return {}
    })

    await sheets.setDeletedAt(SHEET, P2, 'e1', '2026-08-06T00:00:00.000Z')

    const [, write] = calls
    // The literal, not `P2.letter('deleted_at')` — deriving it from the module under
    // test would only assert the module against a copy of its own arithmetic.
    expect(write.url).toContain('expenses_p2!F2:F2')
    expect(write.body.values).toEqual([['2026-08-06T00:00:00.000Z']])
  })

  it('clears the cell with an empty string when restoring', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('!A2:G')) return values([row({ id: 'e1' })])
      return {}
    })

    await sheets.setDeletedAt(SHEET, P1, 'e1', null)

    expect(writes(calls)[0].body.values).toEqual([['']])
  })

  it('refuses to write at all when the id is gone from the sheet', async () => {
    const calls = installSheets(() => values([row({ id: 'someone-else' })]))

    await expect(sheets.setDeletedAt(SHEET, P1, 'e1', null)).rejects.toMatchObject({
      i18nKey: 'error.entryGone',
    })
    expect(writes(calls)).toHaveLength(0)
  })

  /**
   * An id is NOT unique within a tab: `updateEntry` tombstones the old row whenever the
   * payer moves, so a payer that has gone p1 -> p2 -> p1 leaves the id in p1 twice.
   * `resolveRow` says what resolving to the first match costs, and why every
   * consequence of it is silent.
   */
  describe('when the same id appears twice in one tab', () => {
    const duplicated = (call) =>
      call.url.includes('!A2:G')
        ? values([
            row({ id: 'e1', deleted_at: '2026-08-05T10:00:00.000Z' }),
            row({ id: 'other' }),
            row({ id: 'e1' }),
          ])
        : {}

    it('stamps the LIVE row, so a delete is not silently a no-op', async () => {
      const calls = installSheets(duplicated)

      await sheets.setDeletedAt(SHEET, P1, 'e1', '2026-08-06T00:00:00.000Z')

      // Row 4, the live copy — not row 2, which is already tombstoned.
      expect(writes(calls)[0].url).toContain('expenses_p1!F4:F4')
    })

    it('overwrites the LIVE row, so an edit does not resurrect the tombstone', async () => {
      const calls = installSheets(duplicated)

      await sheets.updateEntry(SHEET, entry(), PERSON.P1)

      // Writing row 2 would clear its `deleted_at` and leave TWO live rows for one id.
      expect(writes(calls)[0].url).toContain('expenses_p1!A4:G4')
    })

    it('falls back to a tombstone when no copy in the tab is live', async () => {
      const calls = installSheets((call) =>
        call.url.includes('!A2:G')
          ? values([row({ id: 'e1', deleted_at: '2026-08-05T10:00:00.000Z' })])
          : {},
      )

      // The payer-move branch has to be able to stamp a row that is already dead.
      await sheets.setDeletedAt(SHEET, P1, 'e1', '2026-08-06T00:00:00.000Z')

      expect(writes(calls)[0].url).toContain('expenses_p1!F2:F2')
    })

    /**
     * The fallback takes the LAST tombstone, not the first, and a restore is what
     * makes the difference visible: `setDeletedAt` CLEARS the cell as well as
     * stamping it, so clearing the oldest copy revives the values from before a
     * payer ever moved while the newest row stays dead. `reconcileById` prefers
     * the live row, so the stale one is what everybody then sees, and nothing
     * counts it — `supersededRows` sees a tombstone either way.
     */
    it('restores the LAST tombstone, not the first, when every copy is dead', async () => {
      const calls = installSheets((call) =>
        call.url.includes('!A2:G')
          ? values([
              // The copy from before the payer moved away, carrying stale values.
              row({ id: 'e1', deleted_at: '2026-08-05T10:00:00.000Z' }),
              row({ id: 'other' }),
              // The copy the payer moved back to, tombstoned by the delete being undone.
              row({ id: 'e1', deleted_at: '2026-08-07T10:00:00.000Z' }),
            ])
          : {},
      )

      await sheets.setDeletedAt(SHEET, P1, 'e1', null)

      expect(writes(calls)[0].url).toContain('expenses_p1!F4:F4')
    })
  })
})

describe('changing who paid moves the row between tabs', () => {
  it('appends to the new tab BEFORE tombstoning the old row', async () => {
    // Ordering is the invariant: a failure between the two must leave the entry
    // visible under its old payer rather than gone from both tabs.
    const calls = installSheets((call) => {
      if (call.url.includes('!A2:G')) return values([row({ id: 'e1' })])
      return {}
    })

    await sheets.updateEntry(SHEET, entry({ payer: PERSON.P2 }), PERSON.P1)

    const mutating = writes(calls)
    expect(mutating[0].url).toContain('expenses_p2!A2:G:append')
    expect(mutating[1].method).toBe('PUT')
    expect(mutating[1].url).toContain('expenses_p1!F')
    // A real ISO stamp, not merely something non-empty: `reconcileById` breaks a
    // tombstone-vs-tombstone tie by comparing exactly this cell, so a marker like 'x'
    // would silently make that comparison meaningless. Asserted as a shape because the
    // value comes from the clock — an entry carries no timestamp to copy it from.
    const [[stamp]] = mutating[1].body.values
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  /**
   * A settlement's payer is a CELL in the one settlements tab, so changing it must NOT
   * move the row. Both tabs come from `tabOf`, which answers the same tab either way —
   * so this is one PUT, with no append and no tombstone.
   *
   * The move branch here would append a duplicate settlement and tombstone the original,
   * double-counting the transfer in the balance until a compact ran.
   */
  it('overwrites a settlement in place when its payer changes, without moving it', async () => {
    const calls = installSheets((call) =>
      call.url.includes(SETTLEMENTS.dataRange)
        ? values([settlementRow({ id: 's1', amount: '400', payer: 'p1' })])
        : {},
    )

    const paid = settlement({ id: 's1', amountYen: 400, payer: PERSON.P2 })
    await sheets.updateEntry(SHEET, paid, PERSON.P1)

    const mutating = writes(calls)
    expect(mutating).toHaveLength(1)
    expect(mutating[0].method).toBe('PUT')
    expect(mutating[0].url).toContain('settlements!A2:F2')
    expect(mutating[0].url).not.toContain(':append')
    // And the payer landed in its cell, which is the whole point of the column.
    expect(mutating[0].body.values[0][SETTLEMENTS.index('payer')]).toBe(PERSON.P2)
  })

  it('overwrites in place when the payer is unchanged', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('!A2:G')) return values([row({ id: 'e1' })])
      return {}
    })

    await sheets.updateEntry(SHEET, entry(), PERSON.P1)

    const mutating = writes(calls)
    expect(mutating).toHaveLength(1)
    expect(mutating[0].url).not.toContain(':append')
  })

  it('refuses a previousPayer that is not one of the two people', async () => {
    // Without the guard, `undefined` means "append a duplicate, then look for the
    // original in whichever tab `tabOf` guessed".
    const calls = installSheets(() => ({}))
    await expect(sheets.updateEntry(SHEET, entry(), undefined)).rejects.toThrow(TypeError)
    expect(writes(calls)).toHaveLength(0)
  })
})

describe('appendEntry', () => {
  it('appends to the payer’s own tab, since the tab IS the payer', async () => {
    const calls = installSheets(() => ({}))

    await sheets.appendEntry(SHEET, entry({ payer: PERSON.P2 }))

    expect(calls[0].url).toContain('expenses_p2!A2:G:append')
    expect(calls[0].body.values[0][P2.index('id')]).toBe('e1')
  })

  /**
   * The append range is A-ANCHORED, never the bare tab title. `values.append` treats its range
   * as a range to SEARCH for a logical table, so a bare sheet name lets Google pick where that
   * table starts — and a row written from column G puts every value six fields to the right,
   * which `rowToEntry` then reports as an unreadable amount rather than as a misplaced row.
   *
   * Asserted per tab and against the literal ranges, because the two layouts are seven and six
   * and ten columns wide: deriving them from `tab.dataRange` would only compare the module with
   * a copy of its own arithmetic.
   */
  it.each([
    ['expenses_p1', 'expenses_p1!A2:G:append'],
    ['expenses_p2', 'expenses_p2!A2:G:append'],
    ['settlements', 'settlements!A2:F:append'],
  ])('anchors the %s append to column A', async (_title, range) => {
    const calls = installSheets(() => ({}))
    const rows = [
      entry({ payer: PERSON.P1 }),
      entry({ payer: PERSON.P2 }),
      settlement({ id: 's1', payer: PERSON.P1 }),
    ]

    for (const row of rows) await sheets.appendEntry(SHEET, row)

    expect(calls.map((call) => call.url).join('\n')).toContain(range)
    // And never the bare title, which is the shape that let a row start at column G.
    for (const call of calls) expect(call.url).not.toMatch(/values\/[^!]+:append/)
  })
})

describe('loadAll', () => {
  it('asks for every tab and the config, in the order it maps them back', async () => {
    const calls = installSheets(() => EMPTY_RANGES)

    await sheets.loadAll(SHEET)

    expect(rangesOf(calls[0])).toEqual(FIVE_RANGES)
  })

  it('parses the config from the LAST range, not a hardcoded index', async () => {
    // The index is derived from `ranges.length`, so adding a data range cannot start
    // feeding ledger rows to the config parser — where no key matches, every value
    // silently falls back to a default, and `configMissing` stays false because the
    // read succeeded.
    installSheets(() =>
      ranges5({
        p1: values([row({ id: 'a', date: '2026-08-05', amount: '1250' })]),
        config: values([['categories', 'Groceries, Dining']]),
      }),
    )

    const { entries, config, configMissing } = await sheets.loadAll(SHEET)

    expect(config.categories).toEqual(['Groceries', 'Dining'])
    expect(configMissing).toBe(false)
    expect(entries[0].amountYen).toBe(1250)
  })

  /**
   * An existing ledger predates the settlements tab, so its first read under this build
   * asks for a range that does not exist and the whole batch 400s. That has to reach
   * `useLedger`, where `looksUninitialized` turns it into an `ensureStructure` call that
   * BUILDS the tab — so the retry here must not quietly succeed by dropping it.
   *
   * The retry slices from the END, which is why it drops only the config range. Sliced
   * to a literal 2 it would drop the settlements range as well: the read would succeed,
   * `configMissing` would be reported over a config tab that is perfectly fine, and the
   * settlements tab would never be created — leaving every settlement out of the balance
   * permanently, while the screen blamed the wrong thing.
   */
  it('lets a missing DATA range fail, so the tab gets built rather than dropped', async () => {
    // 400 for any batch that asks for the settlements range, and success for one that
    // does not — so a retry which DROPPED that range would succeed here, and this test
    // fails only if it does.
    const calls = installSheets((call) =>
      call.url.includes(SETTLEMENTS.dataRange) ? { __status: 400 } : ranges5(),
    )

    await expect(sheets.loadAll(SHEET)).rejects.toMatchObject({ status: 400 })
    // Both attempts still asked for it: the retry slices the CONFIG range off the end.
    expect(calls).toHaveLength(2)
    for (const call of calls) expect(call.url).toContain(SETTLEMENTS.dataRange)
  })

  /**
   * The same thing for the `recurring` range, which is the one every existing ledger is
   * missing on its first read under this build. It sits BEFORE the config range for
   * exactly this reason: dropped by the retry instead, the read would succeed and report
   * `configMissing` over a config tab that is fine, while the tab nobody can author a
   * template without would never be created.
   */
  it('lets a missing recurring range fail too, rather than reporting a config problem', async () => {
    const calls = installSheets((call) =>
      call.url.includes(RECURRING.dataRange) ? { __status: 400 } : ranges5(),
    )

    await expect(sheets.loadAll(SHEET)).rejects.toMatchObject({ status: 400 })
    expect(calls).toHaveLength(2)
    for (const call of calls) expect(call.url).toContain(RECURRING.dataRange)
  })

  it('reads the settlements tab, at its own layout', async () => {
    installSheets(() =>
      ranges5({
        p1: values([row({ id: 'e1', date: '2026-08-05', amount: '1000' })]),
        settlements: values([
          settlementRow({ id: 's1', date: '2026-08-06', amount: '400', payer: 'p2' }),
        ]),
      }),
    )

    const { entries, unattributedRows } = await sheets.loadAll(SHEET)

    const settlement = entries.find((item) => item.id === 's1')
    // Type from the tab, payer from the cell, share 0 by definition — none of which the
    // row itself spells out beyond the payer.
    expect(settlement).toMatchObject({
      type: 'settlement',
      payer: PERSON.P2,
      amountYen: 400,
      payerShare: 0,
      category: '',
    })
    expect(unattributedRows).toBe(0)
  })

  /**
   * The payer decides the SIGN of a settlement's contribution, so a cell naming nobody
   * is a wrong balance rather than a missing row — and it is the ONE payer cell in the
   * schema, since an expense takes its payer from the tab it sits in.
   *
   * Counted apart from `undecodedRows` because the cell to go and fix is a different
   * one: the amount here reads perfectly well.
   */
  it('counts a settlement whose payer names neither person, rather than guessing', async () => {
    installSheets(() =>
      ranges5({
        settlements: values([
          settlementRow({ id: 'ok', date: '2026-08-06', amount: '400', payer: 'p1' }),
          settlementRow({ id: 'who', date: '2026-08-06', amount: '900', payer: 'Waylon' }),
          settlementRow({ id: 'blank', date: '2026-08-06', amount: '900', payer: '' }),
          // Tombstoned, so it is correctly out of the totals already and says nothing.
          settlementRow({ id: 'dead', amount: '900', payer: 'nope', deleted_at: 'x' }),
        ]),
      }),
    )

    const { entries, unattributedRows, undecodedRows } = await sheets.loadAll(SHEET)

    expect(entries.map((item) => item.id)).toEqual(['ok'])
    expect(unattributedRows).toBe(2)
    // Not folded into the other count: the amount read fine in both cases.
    expect(undecodedRows).toBe(0)
  })

  it('still counts a settlement whose AMOUNT is the unreadable part as undecoded', async () => {
    installSheets(() =>
      ranges5({
        settlements: values([
          settlementRow({ id: 'bad', date: '2026-08-06', amount: 'about ten', payer: 'p1' }),
        ]),
      }),
    )

    expect(await sheets.loadAll(SHEET)).toMatchObject({
      undecodedRows: 1,
      unattributedRows: 0,
    })
  })

  it('attributes each tab’s rows to that tab’s person', async () => {
    installSheets(() =>
      ranges5({
        p1: values([row({ id: 'a', date: '2026-08-05', amount: '100' })]),
        p2: values([row({ id: 'b', date: '2026-08-05', amount: '200' })]),
      }),
    )

    const { entries } = await sheets.loadAll(SHEET)

    expect(entries.map((item) => [item.id, item.payer])).toEqual([
      ['a', PERSON.P1],
      ['b', PERSON.P2],
    ])
  })

  it('retries without the config range when the sheet has no config tab', async () => {
    let attempt = 0
    const calls = installSheets(() => {
      attempt += 1
      if (attempt === 1) return { __status: 400 }
      // Four ranges, because the retry dropped the config one off the END.
      return {
        valueRanges: [values([row({ id: 'a', date: '2026-08-05', amount: '4210' })]), {}, {}, {}],
      }
    })

    const { entries, config } = await sheets.loadAll(SHEET)

    // Sliced from the END of the range list, so a data range added later still gets
    // requested on the retry rather than silently dropping out of it.
    expect(rangesOf(calls[1])).toEqual(FIVE_RANGES.slice(0, -1))
    // Defaults win for every config value.
    expect(config.categories).toEqual(DEFAULT_CONFIG.categories)
    expect(entries[0].amountYen).toBe(4210)
  })

  it('propagates a failure that is not a missing tab', async () => {
    installSheets(() => ({ __status: 500 }))
    await expect(sheets.loadAll(SHEET)).rejects.toThrow(/HTTP 500/)
  })

  it('carries a translation key on a failed request, so no English reaches the screen', async () => {
    installSheets(() => ({ __status: 500 }))

    const cause = await sheets.loadAll(SHEET).catch((error) => error)

    // The API's own text stays on `.message` for the console; the UI shows the key.
    expect(cause.message).toContain('HTTP 500')
    expect(cause.i18nKey).toBe('error.sheetRequest')
    expect(cause.status).toBe(500)
  })

  it('tells "lost access" apart from "try again"', async () => {
    // Losing access is not a blip: calling it transient hides it behind a 30-second
    // retry loop and a "showing saved data" notice, forever.
    for (const status of [403, 404]) {
      installSheets(() => ({ __status: status }))
      const cause = await sheets.loadAll(SHEET).catch((error) => error)
      expect(cause.i18nKey).toBe('error.sheetUnreachable')
    }
    for (const status of [429, 500, 503]) {
      installSheets(() => ({ __status: status }))
      const cause = await sheets.loadAll(SHEET).catch((error) => error)
      expect(cause.i18nKey).toBe('error.sheetRequest')
    }
  })

  it('does not call a rate-limited 403 a lost share', async () => {
    // Google answers 403 for a revoked share AND for a tripped quota. Two people both
    // active is enough to trip one, and telling someone to go re-share a spreadsheet
    // that is fine is the wrong instruction at the worst moment.
    for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']) {
      installSheets(() => ({ __status: 403, __reason: reason }))
      const cause = await sheets.loadAll(SHEET).catch((error) => error)
      expect(cause.i18nKey).toBe('error.sheetRequest')
    }
    installSheets(() => ({ __status: 403, __reason: 'forbidden' }))
    const revoked = await sheets.loadAll(SHEET).catch((error) => error)
    expect(revoked.i18nKey).toBe('error.sheetUnreachable')
  })

  it('keeps the live row when a payer change left a tombstone under the same id', async () => {
    // Exactly what `updateEntry`'s move branch leaves behind: p1's row tombstoned,
    // p2's row live, one id. Unreconciled, the tombstone is the copy every id
    // lookup finds first, because p1's tab is read first.
    installSheets(() =>
      ranges5({
        p1: values([
          row({ id: 'moved', date: '2026-08-05', amount: '1000', deleted_at: '2026-08-06T00:00Z' }),
        ]),
        p2: values([row({ id: 'moved', date: '2026-08-05', amount: '1000' })]),
      }),
    )

    const { entries, supersededRows } = await sheets.loadAll(SHEET)

    expect(entries).toHaveLength(1)
    expect(entries[0].payer).toBe(PERSON.P2)
    expect(entries[0].deletedAt).toBeNull()
    // Still a real row in the sheet, and still something `compact` will remove, so
    // the settings count has to add it back or the button offers nothing to do.
    expect(supersededRows).toBe(1)
  })

  it('reports rows whose amount cannot be read, rather than dropping them silently', async () => {
    // A hand-typed amount that no rule can parse leaves the ledger short by that
    // expense, with nothing on screen saying the balance is incomplete.
    installSheets(() =>
      ranges5({
        p1: values([
          row({ id: 'ok', date: '2026-08-05', amount: '1000' }),
          row({ id: 'bad', date: '2026-08-05', amount: '12,34.5' }),
          row({ id: 'also-bad', date: '2026-08-05', amount: 'about ten' }),
          // A row with no id is a blank one. Expected, and says nothing.
          row({ amount: '999' }),
        ]),
      }),
    )

    const { entries, undecodedRows } = await sheets.loadAll(SHEET)

    expect(entries.map((item) => item.id)).toEqual(['ok'])
    expect(undecodedRows).toBe(2)
  })

  it('counts only tombstones as superseded, never a hidden live duplicate', async () => {
    // Two LIVE rows with one id is what an interrupted payer move leaves behind:
    // `updateEntry` appends before it tombstones, on purpose. `reconcileById` hides
    // one, but `compact` removes tombstones only — so counting it would offer a
    // removal that can never happen and a count that never clears.
    installSheets(() =>
      ranges5({
        p1: values([row({ id: 'dup', date: '2026-08-05', amount: '1000' })]),
        p2: values([row({ id: 'dup', date: '2026-08-05', amount: '1000' })]),
      }),
    )

    const { entries, supersededRows } = await sheets.loadAll(SHEET)

    expect(entries).toHaveLength(1)
    expect(supersededRows).toBe(0)
  })

  it('does not report a tombstoned row as missing from the totals', async () => {
    // It is correctly out of them already, so the notice would say the balance is
    // short when it is not — and the row is not in `entries` to be cleared either.
    installSheets(() =>
      ranges5({
        p1: values([
          row({ id: 'bad', date: '2026-08-05', amount: 'nonsense', deleted_at: '2026-08-06' }),
        ]),
      }),
    )

    expect(await sheets.loadAll(SHEET)).toMatchObject({ undecodedRows: 0 })
  })

  it('reports no counts for an ordinary sheet', async () => {
    installSheets(() =>
      ranges5({
        p1: values([row({ id: 'a', date: '2026-08-05', amount: '100' })]),
        p2: values([row({ id: 'b', date: '2026-08-05', amount: '200' })]),
      }),
    )

    expect(await sheets.loadAll(SHEET)).toMatchObject({
      supersededRows: 0,
      undecodedRows: 0,
      undatedRows: 0,
      configMissing: false,
    })
  })

  /**
   * The five things `loadAll` reports about what the sheet holds and the app cannot
   * show. `ledgerState.test.js` covers how `noticeKeys` turns each into a sentence;
   * these cover that `loadAll` ever produces one, which nothing else did — every
   * flag below could be deleted from `sheets.js` with a green suite.
   */
  describe('what it reports about the sheet', () => {
    it('flags a missing config tab, so its defaults are never silent', async () => {
      let attempt = 0
      installSheets(() => {
        attempt += 1
        if (attempt === 1) return { __status: 400 }
        return { valueRanges: [{}, {}, {}, {}] }
      })

      // Without this, every expense divides at an even split nobody chose, with nothing said.
      expect(await sheets.loadAll(SHEET)).toMatchObject({ configMissing: true })
    })

    it('counts live rows whose date is not a real day', async () => {
      installSheets(() =>
        ranges5({
          p1: values([
            // What Sheets hands back for a hand-typed date it stored AS a date: reads
            // are FORMATTED_VALUE, so it arrives in the spreadsheet's own locale.
            row({ id: 'a', date: '8/5/2026', amount: '100' }),
            row({ id: 'b', date: '2026-02-31', amount: '100' }),
            row({ id: 'ok', date: '2026-08-05', amount: '100' }),
          ]),
        }),
      )

      // They reach the balance but belong to no month, so they appear in no month's
      // list and cannot be found and fixed from the app.
      expect(await sheets.loadAll(SHEET)).toMatchObject({ undatedRows: 2 })
    })

    it('does not count a blank date as an unreadable one', async () => {
      installSheets(() => ranges5({ p1: values([row({ id: 'a', amount: '100' })]) }))

      // The cell has to have held SOMETHING for the notice to be true.
      expect(await sheets.loadAll(SHEET)).toMatchObject({ undatedRows: 0 })
    })

    it('returns the sheet’s own partial config, not the merged one', async () => {
      installSheets(() => ranges5({ config: values([['default_split_p1', '80']]) }))

      const { sheetConfig, config } = await sheets.loadAll(SHEET)
      // The snapshot stores this, and it must be the pre-merge copy: a merged one
      // freezes the building build's defaults into every future cold launch.
      expect(sheetConfig).toEqual({ defaultSplitP1: 0.8 })
      expect(config.defaultSplitP1).toBe(0.8)
      expect(config.categories).toEqual(DEFAULT_CONFIG.categories)
    })

    it('takes the FIRST usable value for a config key', async () => {
      installSheets(() =>
        ranges5({
          // Somebody added a row at the top and forgot the old one lower down.
          config: values([
            ['default_split_p1', '80'],
            ['default_split_p1', '50'],
          ]),
        }),
      )

      const { config } = await sheets.loadAll(SHEET)
      // Last-wins would run the sheet at an even split, moving money on every expense
      // this person paid for.
      expect(config.defaultSplitP1).toBe(0.8)
    })

    /**
     * The `recurring` tab is read in the same batch and decoded by a different reader,
     * so the two ways this can go wrong are the range landing in the wrong slot — which
     * would silently hand ledger rows to `rowToTemplate` and answer no templates at all
     * — and a refused row going uncounted.
     */
    describe('the recurring tab', () => {
      it('decodes it from its own range, not from a ledger one', async () => {
        installSheets(() =>
          ranges5({
            p1: values([row({ id: 'e1', date: '2026-08-05', amount: '1000' })]),
            recurring: values([
              recurringRow({
                id: 'rent',
                description: 'Rent',
                amount: '220000',
                category: 'Rent',
                payer: 'p1',
                payer_share: '80',
                day_of_month: '27',
              }),
            ]),
          }),
        )

        const { templates, entries, undecodedTemplates } = await sheets.loadAll(SHEET)

        expect(templates).toEqual([
          {
            id: 'rent',
            description: 'Rent',
            amountYen: 220000,
            category: 'Rent',
            payer: PERSON.P1,
            payerShare: 0.8,
            months: null,
            dayOfMonth: 27,
            activeFrom: null,
            activeTo: null,
          },
        ])
        // And the ledger row is still an entry rather than having been read as a template.
        expect(entries.map((item) => item.id)).toEqual(['e1'])
        expect(undecodedTemplates).toBe(0)
      })

      it('counts a row somebody filled in that it cannot use', async () => {
        installSheets(() =>
          ranges5({
            recurring: values([
              recurringRow({ id: 'ok', amount: '8000', payer: 'p2' }),
              // Every one of these is a cell a person typed and this cannot read.
              recurringRow({ id: 'no-payer', amount: '8000' }),
              recurringRow({ description: 'Gym', amount: '8000', payer: 'p1' }),
              recurringRow({ id: 'bad-day', payer: 'p1', day_of_month: 'last' }),
              // Blank rows are what the rest of the tab is. They say nothing.
              recurringRow({}),
              [],
            ]),
          }),
        )

        const { templates, undecodedTemplates } = await sheets.loadAll(SHEET)

        expect(templates.map((template) => template.id)).toEqual(['ok'])
        expect(undecodedTemplates).toBe(3)
      })

      /**
       * Two rows under one id, which a Sheets copy-paste produces. The FIRST wins, exactly as
       * `parseConfigRows` takes the first usable value for a config key — the same
       * hand-authored-tab problem. Unreconciled they would render two identical rows under one
       * React key and `recurringRows` would emit two drafts nothing could tell apart.
       */
      it('keeps the FIRST row per id and counts the rest', async () => {
        installSheets(() =>
          ranges5({
            recurring: values([
              recurringRow({ id: 'rent', description: 'Rent', amount: '220000', payer: 'p1' }),
              recurringRow({ id: 'rent', description: 'Parking', amount: '30000', payer: 'p2' }),
              recurringRow({ id: 'gym', description: 'Gym', amount: '8000', payer: 'p2' }),
            ]),
          }),
        )

        const { templates, undecodedTemplates } = await sheets.loadAll(SHEET)

        expect(templates.map((template) => template.description)).toEqual(['Rent', 'Gym'])
        // Counted, not dropped silently: only the sheet can fix it, and the notice says so.
        expect(undecodedTemplates).toBe(1)
      })

      it('reports no templates for a sheet whose tab is empty', async () => {
        installSheets(() => EMPTY_RANGES)

        expect(await sheets.loadAll(SHEET)).toMatchObject({
          templates: [],
          undecodedTemplates: 0,
        })
      })
    })
  })
})

/**
 * The `recurring` tab's writes. Everything here is a write into a tab a person authored by
 * hand, and the two failures that matter are silent: a blank that should have stayed blank —
 * a variable amount, or a share that means "follow the payer's default" — and a write landing
 * on the wrong row when two rows share an id.
 */
describe('template writes', () => {
  const RENT = {
    id: 'rent',
    description: 'Rent',
    amountYen: 220000,
    category: 'Rent',
    payer: PERSON.P1,
    payerShare: 0.8,
    months: null,
    dayOfMonth: 27,
    activeFrom: null,
    activeTo: null,
  }

  /** The appended or updated row as a field map, so an assertion names its column. */
  const sentRow = (call) => asFields(call.body.values[0], RECURRING.columns)

  it('appends when the tab has no row for that id, RAW, at the schema’s column order', async () => {
    const calls = installSheets(() => ({}))

    await sheets.saveTemplate(SHEET, RENT)

    const write = writes(calls)[0]
    // A-anchored, like every other append: `appendRow` says what a bare tab title costs.
    expect(write.url).toContain('recurring!A2:J:append')
    expect(write.url).toContain('valueInputOption=RAW')
    expect(sentRow(write)).toEqual({
      description: 'Rent',
      amount: '220000',
      category: 'Rent',
      payer: PERSON.P1,
      payer_share: '0.8',
      months: '',
      day_of_month: '27',
      active_from: '',
      active_to: '',
      id: 'rent',
    })
  })

  /**
   * The row a variable cost needs. A blank amount means "the figure changes every month" and
   * a blank share means "follow whoever pays, at their configured default" — the second of
   * which is ALSO what makes `postRecurring` leave the row for a human. Written as '0' both
   * would be lies, and `rowToTemplate` refuses an amount of 0 outright, so the template
   * would vanish from the page the app itself just wrote it to.
   */
  it('writes a blank amount and a blank share, never a zero', async () => {
    const calls = installSheets(() => ({}))

    await sheets.saveTemplate(SHEET, { ...RENT, amountYen: null, payerShare: null })

    const row = sentRow(writes(calls)[0])
    expect(row.amount).toBe('')
    expect(row.payer_share).toBe('')
  })

  it('overwrites the row the sheet says holds that id, not a cached position', async () => {
    // The id sits third, so the write must land on row 4 (header + 2).
    const calls = installSheets((call) =>
      call.url.includes(RECURRING.dataRange)
        ? values([
            recurringRow({ id: 'other', payer: 'p1' }),
            recurringRow({ id: 'another', payer: 'p2' }),
            recurringRow({ id: 'rent', payer: 'p1' }),
          ])
        : {},
    )

    await sheets.saveTemplate(SHEET, RENT)

    const [read, write] = calls
    expect(read.method).toBe('GET')
    expect(read.url).toContain('recurring!A2:J')
    expect(write.method).toBe('PUT')
    // The literal range: ten columns is what `A4:J4` spells, and deriving it from the
    // module under test would assert its arithmetic against a copy of itself.
    expect(write.url).toContain('recurring!A4:J4')
    expect(write.url).toContain('valueInputOption=RAW')
  })

  /**
   * ONE function decides append-versus-overwrite, and that is what makes a retried add
   * idempotent: a template's id is minted when the form opens, so an append whose response was
   * lost gets retried under the SAME id. Two dedicated appends would leave two rows, and from
   * then on every edit to that cost is refused — unmaintainable from the app for good.
   */
  it('overwrites rather than duplicating when the same add is retried', async () => {
    let appended = null
    // `:append` is matched FIRST: the append range now CONTAINS the data range — that is the
    // whole point of anchoring it — so a router that tested the read first would answer the
    // append as though it were one.
    const calls = installSheets((call) => {
      if (call.url.includes(':append')) {
        appended = call.body.values[0]
        return {}
      }
      if (call.url.includes(RECURRING.dataRange)) return values(appended ? [appended] : [])
      return {}
    })

    await sheets.saveTemplate(SHEET, RENT)
    await sheets.saveTemplate(SHEET, RENT)

    const mutating = writes(calls)
    expect(mutating).toHaveLength(2)
    expect(mutating[0].url).toContain(':append')
    // The second lands on the row the first created, not beside it.
    expect(mutating[1].method).toBe('PUT')
    expect(mutating[1].url).toContain('recurring!A2:J2')
  })

  /**
   * Two rows under one id, which a Sheets-UI copy-paste and a retried append both produce.
   * `loadAll` shows only the first, so writing to a GUESS would put one cost's values over
   * another's — and the row on screen would be the one that did not change. Refused, and the
   * message names the fix, because only the sheet can make it.
   */
  it('refuses a duplicate id rather than writing to one of them', async () => {
    const calls = installSheets((call) =>
      call.url.includes(RECURRING.dataRange)
        ? values([
            recurringRow({ id: 'rent', payer: 'p1' }),
            recurringRow({ id: 'rent', payer: 'p2' }),
          ])
        : {},
    )

    await expect(sheets.saveTemplate(SHEET, RENT)).rejects.toMatchObject({
      i18nKey: 'error.duplicateTemplate',
    })
    expect(writes(calls)).toHaveLength(0)
  })

  /** Retiring is an ordinary update with `active_to` set, and shifts no row. */
  it('retires through active_to, without touching a row position', async () => {
    const calls = installSheets((call) =>
      call.url.includes(RECURRING.dataRange)
        ? values([recurringRow({ id: 'rent', payer: 'p1' })])
        : {},
    )

    await sheets.saveTemplate(SHEET, { ...RENT, activeTo: '2026-08' })

    expect(sentRow(writes(calls)[0]).active_to).toBe('2026-08')
    // No `deleteDimension`: retiring is what keeps the id, and the id is what keeps every
    // month this cost has already posted recorded.
    expect(calls.some((call) => call.body?.requests)).toBe(false)
  })

  /**
   * The one hard delete outside `compact`, and the assertion that matters is the row INDEX:
   * `deleteDimension` shifts every row below it, so being one out removes a different cost.
   */
  it('deletes the row the id sits on, and only that row', async () => {
    const calls = installSheets((call) =>
      call.url.includes(RECURRING.dataRange)
        ? values([
            recurringRow({ id: 'gym', payer: 'p2' }),
            recurringRow({ id: 'rent', payer: 'p1' }),
            recurringRow({ id: 'gas', payer: 'p1' }),
          ])
        : {},
    )

    await sheets.deleteTemplate(SHEET, 555, 'rent')

    const requests = writes(calls)[0].body.requests
    expect(requests).toHaveLength(1)
    // Sheet row 3 — header plus the second data row — which is 0-based index 2.
    expect(requests[0].deleteDimension.range).toEqual({
      sheetId: 555,
      dimension: 'ROWS',
      startIndex: 2,
      endIndex: 3,
    })
  })

  /**
   * A missing gid is the failure that looks like nothing: `JSON.stringify` DROPS an
   * undefined `sheetId`, and a `GridRange` without one reads as gid 0 — the first tab in the
   * spreadsheet. So the request does not fail, it hard-deletes whatever row happens to sit at
   * the recurring row's index in `expenses_p1`. Both hard deletes guard upstream through
   * `missingGid`; this is the guard in the request builder they share.
   */
  it('throws rather than sending a delete with no gid, which would hit the first tab', async () => {
    const calls = installSheets((call) =>
      call.url.includes(RECURRING.dataRange)
        ? values([recurringRow({ id: 'rent', payer: 'p1' })])
        : {},
    )

    for (const gid of [undefined, null, '555']) {
      await expect(sheets.deleteTemplate(SHEET, gid, 'rent')).rejects.toThrow(TypeError)
    }
    expect(writes(calls)).toHaveLength(0)
  })

  it('does nothing when the row is already gone, rather than failing', async () => {
    // Deleted from the other phone, or in the Sheets UI. The outcome asked for is the outcome
    // already in place, so interrupting somebody over it would be noise.
    const calls = installSheets((call) =>
      call.url.includes(RECURRING.dataRange)
        ? values([recurringRow({ id: 'gym', payer: 'p2' })])
        : {},
    )

    await expect(sheets.deleteTemplate(SHEET, 555, 'rent')).resolves.toBeUndefined()
    expect(writes(calls)).toHaveLength(0)
  })

  it('refuses to delete when two rows share the id', async () => {
    // The same reason a write refuses: nothing here can tell which of them was meant, and
    // guessing removes a cost somebody still wanted.
    const calls = installSheets((call) =>
      call.url.includes(RECURRING.dataRange)
        ? values([
            recurringRow({ id: 'rent', payer: 'p1' }),
            recurringRow({ id: 'rent', payer: 'p2' }),
          ])
        : {},
    )

    await expect(sheets.deleteTemplate(SHEET, 555, 'rent')).rejects.toMatchObject({
      i18nKey: 'error.duplicateTemplate',
    })
    expect(writes(calls)).toHaveLength(0)
  })
})

describe('compact', () => {
  it('deletes bottom-up within each tab', async () => {
    // CRITICAL: deleteDimension shifts every row below it, so ascending order
    // would make each request after the first target the wrong row — and the rows
    // it would then delete are live expenses.
    const calls = installSheets((call) => {
      if (call.url.includes('expenses_p1!A2:G')) {
        return values([
          row({ id: 'a' }),
          row({ id: 'b', deleted_at: 'x' }),
          row({ id: 'c' }),
          row({ id: 'd', deleted_at: 'x' }),
          row({ id: 'e' }),
          row({ id: 'f' }),
          row({ id: 'g', deleted_at: 'x' }),
        ])
      }
      if (call.url.includes('expenses_p2!A2:G')) {
        return values([row({ id: 'h', deleted_at: 'x' }), row({ id: 'i' })])
      }
      return {}
    })

    const { removed } = await sheets.compact(SHEET, GIDS)

    const requests = writes(calls)[0].body.requests
    const perTab = new Map()
    for (const { deleteDimension } of requests) {
      const list = perTab.get(deleteDimension.range.sheetId) ?? []
      list.push(deleteDimension.range.startIndex)
      perTab.set(deleteDimension.range.sheetId, list)
    }

    expect(removed).toBe(4)
    // Rows 3, 5 and 8 in p1 (0-based 2, 4, 7), newest first. The literal lists are the
    // whole assertion: a "sorted descending" check over whatever came back passes on a
    // single request, and on the wrong rows in the right order.
    expect(perTab.get(GIDS.expenses_p1)).toEqual([7, 4, 2])
    expect(perTab.get(GIDS.expenses_p2)).toEqual([1])
  })

  /**
   * One read per tab, never a batchGet, and that is not an oversight worth tidying.
   * Row numbers here come from POSITION in the reply (`FIRST_DATA_ROW + index`), so
   * batching would mean re-deriving them from a positional `valueRanges` array — in
   * the app's only hard delete, where being one row out removes somebody else's
   * expense. One extra round trip on a rare manual action is the cheaper mistake.
   */
  it('reads each tab on its own rather than batching them', async () => {
    const calls = installSheets((call) =>
      call.url.includes('!A2:') ? values([row({ id: 'a', deleted_at: 'x' })]) : {},
    )

    await sheets.compact(SHEET, GIDS)

    expect(calls.filter((call) => call.url.includes('values:batchGet'))).toHaveLength(0)
    const reads = calls.filter((call) => call.url.includes('!A2:'))
    // One per data tab, in order, each at its own range.
    // The harness records decoded URLs, so the range reads back as written — minus the
    // query string, which is not part of what is being asserted.
    expect(reads.map((call) => call.url.split('/values/')[1].split('?')[0])).toEqual(
      DATA_TABS.map((tab) => tab.dataRange),
    )
  })

  /**
   * The settlements tab is compacted too, and its `deleted_at` is at a DIFFERENT index
   * from the expenses one. This is the test that catches the whole reason the positional
   * lookups hang off a tab: with one module-wide index, `compact` reads the settlements
   * tab's `id` column instead — non-empty on every row — and hard-deletes every live
   * settlement in the sheet.
   *
   * So the fixture gives the settlements tab one LIVE row and one tombstoned one, and
   * asserts exactly one deletion, at the tombstone's position.
   */
  it('removes tombstoned settlements, and only those', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes(SETTLEMENTS.dataRange)) {
        return values([
          settlementRow({ id: 'live', amount: '100', payer: 'p1' }),
          settlementRow({ id: 'dead', amount: '200', payer: 'p2', deleted_at: 'x' }),
          settlementRow({ id: 'live2', amount: '300', payer: 'p1' }),
        ])
      }
      return {}
    })

    const { removed } = await sheets.compact(SHEET, GIDS)

    expect(removed).toBe(1)
    const requests = writes(calls)[0].body.requests
    expect(requests).toHaveLength(1)
    // Sheet row 3, which is 0-based index 2 — the second data row, not the first.
    expect(requests[0].deleteDimension.range).toMatchObject({
      sheetId: GIDS.settlements,
      startIndex: 2,
      endIndex: 3,
    })
  })

  it('deletes exactly one row per request', async () => {
    const calls = installSheets((call) =>
      call.url.includes(P1.dataRange) ? values([row({ id: 'a', deleted_at: 'x' })]) : {},
    )

    await sheets.compact(SHEET, GIDS)

    for (const { deleteDimension } of writes(calls)[0].body.requests) {
      expect(deleteDimension.range.endIndex - deleteDimension.range.startIndex).toBe(1)
      // The nested shape specifically. `dimension` at the top level is not what
      // the API reads, so accepting either would pass on a request it rejects.
      expect(deleteDimension.range.dimension).toBe('ROWS')
    }
  })

  it('writes nothing when there is nothing tombstoned', async () => {
    const calls = installSheets((call) =>
      call.url.includes('!A2:') ? values([row({ id: 'a' })]) : {},
    )

    expect(await sheets.compact(SHEET, GIDS)).toEqual({ removed: 0 })
    expect(writes(calls)).toHaveLength(0)
  })

  it('skips a tab whose gid it was not given, rather than guessing one', async () => {
    // `useLedger` throws before it gets here; this is the second line of defence,
    // and the reason that throw must not be removed as redundant.
    const calls = installSheets((call) =>
      call.url.includes('!A2:') ? values([row({ id: 'a', deleted_at: 'x' })]) : {},
    )

    const { removed } = await sheets.compact(SHEET, { expenses_p1: 111 })

    expect(removed).toBe(1)
    for (const { deleteDimension } of writes(calls)[0].body.requests) {
      expect(deleteDimension.range.sheetId).toBe(111)
    }
  })
})

describe('ensureStructure', () => {
  const sheetList = (titles) => ({
    sheets: titles.map((title, index) => ({ properties: { title, sheetId: 100 + index } })),
  })

  it('refuses a spreadsheet that has other tabs and none of ours', async () => {
    const calls = installSheets((call) =>
      call.url.includes('fields=sheets') ? sheetList(['Budget 2024', 'Notes', 'Pivot']) : {},
    )

    // Translated, and it must stay so: this is the one failure whose message a
    // person has to act on, and the UI shows `i18nKey` rather than `.message`.
    await expect(sheets.ensureStructure(SHEET)).rejects.toMatchObject({
      i18nKey: 'error.notOurSheet',
    })
    await expect(sheets.ensureStructure(SHEET)).rejects.toThrow(/SHEET_ID/)
    expect(writes(calls)).toHaveLength(0)
  })

  it('adopts a freshly created spreadsheet, which has exactly one tab', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('fields=sheets')) return sheetList(['Sheet1'])
      if (call.url.includes('values:batchGet')) return EMPTY_RANGES
      return {}
    })

    await sheets.ensureStructure(SHEET)

    const added = writes(calls).find((call) => call.body?.requests)
    expect(added.body.requests.map((request) => request.addSheet.properties.title)).toEqual([
      'expenses_p1',
      'expenses_p2',
      'settlements',
      'recurring',
      'config',
    ])
  })

  it('writes a header row only when it does not already match', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('fields=sheets')) return sheetList(ALL_TABS)
      if (call.url.includes('values:batchGet')) {
        return {
          valueRanges: [
            values([P1.columns]), // already correct
            values([['id', 'date']]), // truncated
            values([SETTLEMENTS.columns]), // already correct
            values([RECURRING.columns]), // already correct
            values([
              ['key', 'value'],
              ['person1_name', 'Waylon'],
            ]),
          ],
        }
      }
      return {}
    })

    await sheets.ensureStructure(SHEET)

    const write = writes(calls).find((call) => call.body?.data)
    expect(write.body.data.map((item) => item.range)).toEqual(['expenses_p2!A1:G1'])
    expect(write.body.valueInputOption).toBe('RAW')
  })

  /**
   * The `recurring` tab gets a header like every other one, and it is the header that
   * makes the tab usable at all: nothing in the app writes a template, so those ten
   * words are the only thing telling whoever opens the sheet what to type where.
   */
  it('writes the recurring header when the tab has just been created', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('fields=sheets')) return sheetList(ALL_TABS)
      if (call.url.includes('values:batchGet')) {
        return {
          valueRanges: [
            ...DATA_TABS.map((tab) => values([tab.columns])),
            {},
            values([
              ['key', 'value'],
              ['person1_name', 'Waylon'],
            ]),
          ],
        }
      }
      return {}
    })

    await sheets.ensureStructure(SHEET)

    const write = writes(calls).find((call) => call.body?.data)
    expect(write.body.data).toHaveLength(1)
    // The literal range, not `RECURRING.headerRange`: ten columns is what `A1:J1`
    // spells, and deriving it would pin nothing.
    expect(write.body.data[0].range).toBe('recurring!A1:J1')
    expect(write.body.data[0].values[0]).toContain('day_of_month')
  })

  it('never reseeds a config tab that already has values', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('fields=sheets')) return sheetList(ALL_TABS)
      if (call.url.includes('values:batchGet')) {
        return {
          valueRanges: [
            ...SHEET_TABS.map((tab) => values([tab.columns])),
            values([
              ['key', 'value'],
              ['person1_name', 'Waylon'],
            ]),
          ],
        }
      }
      return {}
    })

    await sheets.ensureStructure(SHEET)

    expect(writes(calls)).toHaveLength(0)
  })

  it('seeds the config tab, unlocalized, when it is empty', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('fields=sheets')) return sheetList(ALL_TABS)
      if (call.url.includes('values:batchGet')) {
        return { valueRanges: [...SHEET_TABS.map((tab) => values([tab.columns])), {}] }
      }
      return {}
    })

    await sheets.ensureStructure(SHEET)

    const data = writes(calls).find((call) => call.body?.data).body.data[0]
    expect(data.range).toBe('config!A1')
    expect(data.values[0]).toEqual(['key', 'value'])
    const asObject = Object.fromEntries(data.values.slice(1))
    expect(asObject.person1_name).toBe('Person 1')
    // Unlocalized, and written as a fraction rather than a percentage.
    expect(asObject.default_split_p1).toBe('0.5')
  })

  /**
   * Which keys a fresh sheet gets is a decision, not a consequence: the locale, the
   * accent and which of the two people this device is are per-DEVICE values, and a
   * sheet that named any of them would let one person restyle the other's phone —
   * or tell it who it is. The literal list is the only thing that can catch a new
   * `CONFIG_FIELDS` entry being seeded by accident.
   */
  it('seeds these keys and no others', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('fields=sheets')) return sheetList(ALL_TABS)
      if (call.url.includes('values:batchGet')) {
        return { valueRanges: [...SHEET_TABS.map((tab) => values([tab.columns])), {}] }
      }
      return {}
    })

    await sheets.ensureStructure(SHEET)

    const data = writes(calls).find((call) => call.body?.data).body.data[0]
    expect(data.values.slice(1).map(([key]) => key)).toEqual([
      'person1_name',
      'person2_name',
      'categories',
      'default_split_p1',
      'default_split_p2',
      'note_presets',
    ])
  })

  it('returns the gids compact needs', async () => {
    installSheets((call) => {
      if (call.url.includes('fields=sheets')) return sheetList(ALL_TABS)
      if (call.url.includes('values:batchGet')) {
        return {
          valueRanges: [
            ...SHEET_TABS.map((tab) => values([tab.columns])),
            values([
              ['key', 'value'],
              ['person1_name', 'Waylon'],
            ]),
          ],
        }
      }
      return {}
    })

    const { sheetGids } = await sheets.ensureStructure(SHEET)

    // The settlements tab included: `compact` refuses without a gid for every one.
    expect(sheetGids).toMatchObject({
      expenses_p1: 100,
      expenses_p2: 101,
      settlements: 102,
      recurring: 103,
      config: 104,
    })
  })

  it('takes a created tab’s gid from the reply that created it', async () => {
    // The addSheet reply already names every tab it made, so asking the
    // spreadsheet for the same gids again is a wasted round trip on the one path
    // that runs on a phone with nothing cached.
    const calls = installSheets((call) => {
      if (call.url.includes('fields=sheets')) return sheetList(['Sheet1'])
      if (call.url.includes('values:batchGet')) return EMPTY_RANGES
      if (call.url.includes(`/${SHEET}:batchUpdate`)) {
        return {
          replies: [
            { addSheet: { properties: { title: 'expenses_p1', sheetId: 11 } } },
            { addSheet: { properties: { title: 'expenses_p2', sheetId: 22 } } },
            { addSheet: { properties: { title: 'config', sheetId: 33 } } },
          ],
        }
      }
      return {}
    })

    const { sheetGids } = await sheets.ensureStructure(SHEET)

    expect(sheetGids).toMatchObject({ expenses_p1: 11, expenses_p2: 22, config: 33 })
    expect(calls.filter((call) => call.url.includes('fields=sheets'))).toHaveLength(1)
  })
})

describe('readSheetGids', () => {
  // `compact` needs gids and nothing else, and must never reach them through
  // `ensureStructure`, which WRITES — `readSheetGids` says what that would cost. So the
  // assertion that matters here is the absence of any write.
  it('reads the gids and writes nothing at all', async () => {
    const calls = installSheets((call) =>
      call.url.includes('fields=sheets')
        ? { sheets: [{ properties: { title: 'expenses_p1', sheetId: 7 } }] }
        : {},
    )

    const gids = await sheets.readSheetGids(SHEET)

    expect(gids).toEqual({ expenses_p1: 7 })
    expect(writes(calls)).toHaveLength(0)
    expect(calls).toHaveLength(1)
  })
})

describe('a rejected token', () => {
  it('re-mints once and retries the request once', async () => {
    let attempt = 0
    installSheets(() => {
      attempt += 1
      return attempt === 1 ? { __status: 401 } : EMPTY_RANGES
    })

    await sheets.loadAll(SHEET)

    expect(connection.refreshToken).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('gives up after one retry rather than looping on a revoked grant', async () => {
    installSheets(() => ({ __status: 401 }))

    await expect(sheets.loadAll(SHEET)).rejects.toThrow(/HTTP 401/)
    expect(connection.refreshToken).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('sends the token as a bearer header', async () => {
    const calls = installSheets(() => EMPTY_RANGES)
    await sheets.loadAll(SHEET)
    expect(calls[0].headers.Authorization).toBe('Bearer ya29.stub-token')
  })
})
