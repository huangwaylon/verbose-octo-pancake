import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EXPENSE_COLUMNS, PERSON, columnIndex, makeEntry } from '../src/schema.js'
import { DEFAULT_CONFIG } from '../src/config.js'
import {
  installSheets,
  removeSheets,
  rangesOf,
  values,
  writes,
  SHEET,
} from './support/sheets-api.js'

/**
 * The Sheets layer. Four invariants live here and every one of them fails
 * silently: `compact` must delete bottom-up or it removes live expenses,
 * every write must be RAW or a note becomes a formula, ids must be re-resolved to
 * rows immediately before writing or a write lands on somebody else's expense, and
 * `loadAll` must resolve the config before mapping rows or a blank-currency row is
 * decoded at the wrong scale.
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

/** A raw sheet row, built by field name so tests never depend on column order. */
const row = (fields) => EXPENSE_COLUMNS.map((column) => fields[column] ?? '')

const entry = (over = {}) =>
  makeEntry(
    {
      id: 'e1',
      date: '2026-08-05',
      payer: PERSON.P1,
      amountCents: 1250,
      currency: 'JPY',
      category: 'Groceries',
      description: 'shop',
      payerShare: 0.5,
      ...over,
    },
    '2026-08-05T10:00:00.000Z',
  )

const GIDS = { expenses_p1: 111, expenses_p2: 222, config: 333 }

describe('every write is RAW', () => {
  it('never sends USER_ENTERED, on any path', async () => {
    const calls = installSheets((call) => {
      // Checked before the row range: a batchGet's `ranges` never carry `!A2:K`
      // (`ensureStructure` asks for header rows), but matching it first cannot go
      // wrong either way.
      if (call.url.includes('values:batchGet')) return { valueRanges: [{}, {}, {}] }
      if (call.url.includes('!A2:K')) return values([row({ id: 'e1' })])
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
    await sheets.setDeletedAt(SHEET, PERSON.P1, 'e1', '2026-08-06T00:00:00.000Z')
    await sheets.ensureStructure(SHEET)

    const mutating = writes(calls)
    expect(mutating.length).toBeGreaterThan(3)
    for (const call of mutating) {
      expect(call.url).not.toContain('USER_ENTERED')
      // A batchUpdate carries the option in its body instead of the query.
      const raw = call.url.includes('valueInputOption=RAW') || call.body?.valueInputOption === 'RAW'
      // `:batchUpdate` on the spreadsheet itself writes structure, not values.
      if (!call.url.includes(`/${SHEET}:batchUpdate`)) expect(raw).toBe(true)
    }
  })
})

describe('resolving a row before writing to it', () => {
  it('writes to the row the sheet says, not to any cached position', async () => {
    // The id sits third in the tab, so the write must land on row 4 (header + 2).
    const calls = installSheets((call) => {
      if (call.url.includes('!A2:K')) {
        return values([row({ id: 'other-1' }), row({ id: 'other-2' }), row({ id: 'e1' })])
      }
      return {}
    })

    await sheets.updateEntry(SHEET, entry(), PERSON.P1)

    const [read, write] = calls
    expect(read.method).toBe('GET')
    // The full row range, not the id column alone: an id is not unique within a tab,
    // so telling a live row from a tombstone needs `deleted_at` as well.
    expect(read.url).toContain('expenses_p1!A2:K')
    expect(write.method).toBe('PUT')
    expect(write.url).toContain('expenses_p1!A4:K4')
  })

  it('stamps deleted_at on the resolved row, in the deleted_at column only', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('!A2:K')) return values([row({ id: 'e1' })])
      return {}
    })

    await sheets.setDeletedAt(SHEET, PERSON.P2, 'e1', '2026-08-06T00:00:00.000Z')

    const [, write] = calls
    // The literal, not `columnLetter('deleted_at')` — deriving it from the module
    // under test would only assert the module against a copy of its own arithmetic.
    expect(write.url).toContain('expenses_p2!K2:K2')
    expect(write.body.values).toEqual([['2026-08-06T00:00:00.000Z']])
  })

  it('clears the cell with an empty string when restoring', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('!A2:K')) return values([row({ id: 'e1' })])
      return {}
    })

    await sheets.setDeletedAt(SHEET, PERSON.P1, 'e1', null)

    expect(writes(calls)[0].body.values).toEqual([['']])
  })

  it('refuses to write at all when the id is gone from the sheet', async () => {
    const calls = installSheets(() => values([row({ id: 'someone-else' })]))

    await expect(sheets.setDeletedAt(SHEET, PERSON.P1, 'e1', null)).rejects.toMatchObject({
      i18nKey: 'error.entryGone',
    })
    expect(writes(calls)).toHaveLength(0)
  })

  /**
   * An id is NOT unique within a tab: `updateEntry` tombstones the old row whenever the
   * payer moves, so a payer that has gone p1 -> p2 -> p1 leaves the id in p1 twice.
   * Resolving to the first match writes to the dead row, and every consequence is
   * silent — `reconcileById` collapses the duplicate on screen and `supersededRows`
   * counts tombstones only, so a hidden live copy is never reported.
   */
  describe('when the same id appears twice in one tab', () => {
    const duplicated = (call) =>
      call.url.includes('!A2:K')
        ? values([
            row({ id: 'e1', deleted_at: '2026-08-05T10:00:00.000Z' }),
            row({ id: 'other' }),
            row({ id: 'e1' }),
          ])
        : {}

    it('stamps the LIVE row, so a delete is not silently a no-op', async () => {
      const calls = installSheets(duplicated)

      await sheets.setDeletedAt(SHEET, PERSON.P1, 'e1', '2026-08-06T00:00:00.000Z')

      // Row 4, the live copy — not row 2, which is already tombstoned.
      expect(writes(calls)[0].url).toContain('expenses_p1!K4:K4')
    })

    it('overwrites the LIVE row, so an edit does not resurrect the tombstone', async () => {
      const calls = installSheets(duplicated)

      await sheets.updateEntry(SHEET, entry(), PERSON.P1)

      // Writing row 2 would clear its `deleted_at` and leave TWO live rows for one id.
      expect(writes(calls)[0].url).toContain('expenses_p1!A4:K4')
    })

    it('falls back to a tombstone when no copy in the tab is live', async () => {
      const calls = installSheets((call) =>
        call.url.includes('!A2:K')
          ? values([row({ id: 'e1', deleted_at: '2026-08-05T10:00:00.000Z' })])
          : {},
      )

      // The payer-move branch has to be able to stamp a row that is already dead.
      await sheets.setDeletedAt(SHEET, PERSON.P1, 'e1', '2026-08-06T00:00:00.000Z')

      expect(writes(calls)[0].url).toContain('expenses_p1!K2:K2')
    })
  })
})

describe('changing who paid moves the row between tabs', () => {
  it('appends to the new tab BEFORE tombstoning the old row', async () => {
    // Ordering is the invariant: a failure between the two must leave the entry
    // visible under its old payer rather than gone from both tabs.
    const calls = installSheets((call) => {
      if (call.url.includes('!A2:K')) return values([row({ id: 'e1' })])
      return {}
    })

    await sheets.updateEntry(SHEET, entry({ payer: PERSON.P2 }), PERSON.P1)

    const mutating = writes(calls)
    expect(mutating[0].url).toContain('expenses_p2:append')
    expect(mutating[1].method).toBe('PUT')
    expect(mutating[1].url).toContain('expenses_p1!K')
    expect(mutating[1].body.values).toEqual([[entry().updatedAt]])
  })

  it('overwrites in place when the payer is unchanged', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('!A2:K')) return values([row({ id: 'e1' })])
      return {}
    })

    await sheets.updateEntry(SHEET, entry(), PERSON.P1)

    const mutating = writes(calls)
    expect(mutating).toHaveLength(1)
    expect(mutating[0].url).not.toContain(':append')
  })

  it('refuses a previousPayer that is not one of the two people', async () => {
    // Without the guard, `undefined` means "append a duplicate, then look for the
    // original in whichever tab expensesTab guessed".
    const calls = installSheets(() => ({}))
    await expect(sheets.updateEntry(SHEET, entry(), undefined)).rejects.toThrow(TypeError)
    expect(writes(calls)).toHaveLength(0)
  })
})

describe('appendEntry', () => {
  it('appends to the payer’s own tab, since the tab IS the payer', async () => {
    const calls = installSheets(() => ({}))

    await sheets.appendEntry(SHEET, entry({ payer: PERSON.P2 }))

    expect(calls[0].url).toContain('expenses_p2:append')
    expect(calls[0].body.values[0][columnIndex('id')]).toBe('e1')
    // No payer column exists to disagree with the tab.
    expect(EXPENSE_COLUMNS).not.toContain('payer')
  })
})

describe('loadAll', () => {
  it('asks for both tabs and the config, in the order it maps them back', async () => {
    const calls = installSheets(() => ({ valueRanges: [{}, {}, {}] }))

    await sheets.loadAll(SHEET)

    expect(rangesOf(calls[0])).toEqual(['expenses_p1!A2:K', 'expenses_p2!A2:K', 'config!A:B'])
  })

  it('decodes a blank-currency row at the sheet’s currency, which it reads first', async () => {
    // The silent 100x: "1250" is ¥1250 at JPY and $12.50 at USD. If the rows were
    // mapped before the config range was parsed, this would come back as 125000.
    installSheets(() => ({
      valueRanges: [
        values([row({ id: 'a', type: 'expense', date: '2026-08-05', amount: '1250' })]),
        {},
        values([['currency', 'JPY']]),
      ],
    }))

    const { entries, config } = await sheets.loadAll(SHEET)

    expect(config.currency).toBe('JPY')
    expect(entries[0].amountCents).toBe(1250)
    expect(entries[0].currency).toBe('JPY')
  })

  it('attributes each tab’s rows to that tab’s person', async () => {
    installSheets(() => ({
      valueRanges: [
        values([row({ id: 'a', date: '2026-08-05', amount: '100' })]),
        values([row({ id: 'b', date: '2026-08-05', amount: '200' })]),
        values([['currency', 'JPY']]),
      ],
    }))

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
      return { valueRanges: [values([row({ id: 'a', date: '2026-08-05', amount: '4210' })]), {}] }
    })

    const { entries, config } = await sheets.loadAll(SHEET)

    expect(rangesOf(calls[1])).toEqual(['expenses_p1!A2:K', 'expenses_p2!A2:K'])
    // Defaults win, and the amount is decoded at the default currency's scale.
    expect(config.currency).toBe('JPY')
    expect(entries[0].amountCents).toBe(4210)
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
    installSheets(() => ({
      valueRanges: [
        values([
          row({ id: 'moved', date: '2026-08-05', amount: '1000', deleted_at: '2026-08-06T00:00Z' }),
        ]),
        values([row({ id: 'moved', date: '2026-08-05', amount: '1000' })]),
        values([['currency', 'JPY']]),
      ],
    }))

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
    installSheets(() => ({
      valueRanges: [
        values([
          row({ id: 'ok', date: '2026-08-05', amount: '1000' }),
          row({ id: 'bad', date: '2026-08-05', amount: '12,34.5' }),
          row({ id: 'also-bad', date: '2026-08-05', amount: 'about ten' }),
          // A row with no id is a blank one. Expected, and says nothing.
          row({ amount: '999' }),
        ]),
        {},
        values([['currency', 'JPY']]),
      ],
    }))

    const { entries, undecodedRows } = await sheets.loadAll(SHEET)

    expect(entries.map((item) => item.id)).toEqual(['ok'])
    expect(undecodedRows).toBe(2)
  })

  it('counts only tombstones as superseded, never a hidden live duplicate', async () => {
    // Two LIVE rows with one id is what an interrupted payer move leaves behind:
    // `updateEntry` appends before it tombstones, on purpose. `reconcileById` hides
    // one, but `compact` removes tombstones only — so counting it would offer a
    // removal that can never happen and a count that never clears.
    installSheets(() => ({
      valueRanges: [
        values([row({ id: 'dup', date: '2026-08-05', amount: '1000' })]),
        values([row({ id: 'dup', date: '2026-08-05', amount: '1000' })]),
        values([['currency', 'JPY']]),
      ],
    }))

    const { entries, supersededRows } = await sheets.loadAll(SHEET)

    expect(entries).toHaveLength(1)
    expect(supersededRows).toBe(0)
  })

  it('does not report a tombstoned row as missing from the totals', async () => {
    // It is correctly out of them already, so the notice would say the balance is
    // short when it is not — and the row is not in `entries` to be cleared either.
    installSheets(() => ({
      valueRanges: [
        values([
          row({ id: 'bad', date: '2026-08-05', amount: 'nonsense', deleted_at: '2026-08-06' }),
        ]),
        {},
        values([['currency', 'JPY']]),
      ],
    }))

    expect(await sheets.loadAll(SHEET)).toMatchObject({ undecodedRows: 0 })
  })

  it('reports no counts for an ordinary sheet', async () => {
    installSheets(() => ({
      valueRanges: [
        values([row({ id: 'a', date: '2026-08-05', amount: '100' })]),
        values([row({ id: 'b', date: '2026-08-05', amount: '200' })]),
        values([['currency', 'JPY']]),
      ],
    }))

    expect(await sheets.loadAll(SHEET)).toMatchObject({
      supersededRows: 0,
      undecodedRows: 0,
      undatedRows: 0,
      configMissing: false,
    })
  })

  /**
   * The four things `loadAll` reports about what the sheet holds and the app cannot
   * show. `ledgerState.test.js` covers how `noticeKeys` turns each into a sentence;
   * these cover that `loadAll` ever produces one, which nothing else did — every
   * flag below could be deleted from `sheets.js` with a green suite.
   */
  describe('what it reports about the sheet', () => {
    it('flags a missing config tab, so the default currency is never silent', async () => {
      let attempt = 0
      installSheets(() => {
        attempt += 1
        if (attempt === 1) return { __status: 400 }
        return { valueRanges: [{}, {}] }
      })

      // Without this the app runs the whole sheet on JPY with nothing said, which on a
      // USD sheet reads every blank-currency row 100x wrong.
      expect(await sheets.loadAll(SHEET)).toMatchObject({ configMissing: true })
    })

    it('counts live rows whose date is not a real day', async () => {
      installSheets(() => ({
        valueRanges: [
          values([
            // What Sheets hands back for a hand-typed date it stored AS a date: reads
            // are FORMATTED_VALUE, so it arrives in the spreadsheet's own locale.
            row({ id: 'a', date: '8/5/2026', amount: '100' }),
            row({ id: 'b', date: '2026-02-31', amount: '100' }),
            row({ id: 'ok', date: '2026-08-05', amount: '100' }),
          ]),
          {},
          values([['currency', 'JPY']]),
        ],
      }))

      // They reach the balance but belong to no month, so they appear in no month's
      // list and cannot be found and fixed from the app.
      expect(await sheets.loadAll(SHEET)).toMatchObject({ undatedRows: 2 })
    })

    it('does not count a blank date as an unreadable one', async () => {
      installSheets(() => ({
        valueRanges: [values([row({ id: 'a', amount: '100' })]), {}, values([['currency', 'JPY']])],
      }))

      // The cell has to have held SOMETHING for the notice to be true.
      expect(await sheets.loadAll(SHEET)).toMatchObject({ undatedRows: 0 })
    })

    it('flags a config tab that is readable but names no currency', async () => {
      installSheets(() => ({
        // The tab is there and parses; it just has no `currency` row any more.
        valueRanges: [{}, {}, values([['categories', 'Groceries, Dining']])],
      }))

      // `configMissing` cannot catch this — it is only set when the READ fails — so
      // without its own flag the whole sheet runs on the default scale in silence.
      expect(await sheets.loadAll(SHEET)).toMatchObject({
        configMissing: false,
        currencyDefaulted: true,
      })
    })

    it('does not flag a sheet whose config names a currency', async () => {
      installSheets(() => ({ valueRanges: [{}, {}, values([['currency', 'USD']])] }))

      expect(await sheets.loadAll(SHEET)).toMatchObject({ currencyDefaulted: false })
    })

    it('returns the sheet’s own partial config, not the merged one', async () => {
      installSheets(() => ({
        valueRanges: [{}, {}, values([['currency', 'USD']])],
      }))

      const { sheetConfig, config } = await sheets.loadAll(SHEET)
      // The snapshot stores this, and it must be the pre-merge copy: a merged one
      // freezes the building build's defaults into every future cold launch, so the
      // balance can come back at the wrong scale.
      expect(sheetConfig).toEqual({ currency: 'USD' })
      expect(config.currency).toBe('USD')
      expect(config.categories).toEqual(DEFAULT_CONFIG.categories)
    })

    it('takes the FIRST usable value for a config key', async () => {
      installSheets(() => ({
        valueRanges: [
          values([row({ id: 'a', date: '2026-08-05', amount: '1250' })]),
          {},
          // Somebody added a row at the top and forgot the old one lower down.
          values([
            ['currency', 'USD'],
            ['currency', 'JPY'],
          ]),
        ],
      }))

      const { config, entries } = await sheets.loadAll(SHEET)
      // Last-wins would run the sheet at JPY, where this blank-currency row decodes
      // as ¥1250 instead of $1250.00 — a 100x error on every row like it.
      expect(config.currency).toBe('USD')
      expect(entries[0].currency).toBe('USD')
      expect(entries[0].amountCents).toBe(125000)
    })
  })
})

describe('compact', () => {
  it('deletes bottom-up within each tab', async () => {
    // CRITICAL: deleteDimension shifts every row below it, so ascending order
    // would make each request after the first target the wrong row — and the rows
    // it would then delete are live expenses.
    installSheets((call) => {
      if (call.url.includes('expenses_p1!A2:K')) {
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
      if (call.url.includes('expenses_p2!A2:K')) {
        return values([row({ id: 'h', deleted_at: 'x' }), row({ id: 'i' })])
      }
      return {}
    })

    const { removed } = await sheets.compact(SHEET, GIDS)

    const batch = globalThis.fetch.mock.calls.find(([url]) => String(url).includes(':batchUpdate'))
    const requests = JSON.parse(batch[1].body).requests
    const perTab = new Map()
    for (const { deleteDimension } of requests) {
      const list = perTab.get(deleteDimension.range.sheetId) ?? []
      list.push(deleteDimension.range.startIndex)
      perTab.set(deleteDimension.range.sheetId, list)
    }

    expect(removed).toBe(4)
    // Rows 3, 5 and 8 in p1 (0-based 2, 4, 7), newest first.
    expect(perTab.get(GIDS.expenses_p1)).toEqual([7, 4, 2])
    expect(perTab.get(GIDS.expenses_p2)).toEqual([1])
    for (const starts of perTab.values()) {
      expect([...starts].sort((a, b) => b - a)).toEqual(starts)
    }
  })

  it('deletes exactly one row per request', async () => {
    installSheets((call) =>
      call.url.includes('expenses_p1!A2:K') ? values([row({ id: 'a', deleted_at: 'x' })]) : {},
    )

    await sheets.compact(SHEET, GIDS)

    const batch = globalThis.fetch.mock.calls.find(([url]) => String(url).includes(':batchUpdate'))
    for (const { deleteDimension } of JSON.parse(batch[1].body).requests) {
      expect(deleteDimension.range.endIndex - deleteDimension.range.startIndex).toBe(1)
      // The nested shape specifically. `dimension` at the top level is not what
      // the API reads, so accepting either would pass on a request it rejects.
      expect(deleteDimension.range.dimension).toBe('ROWS')
    }
  })

  it('writes nothing when there is nothing tombstoned', async () => {
    const calls = installSheets((call) =>
      call.url.includes('!A2:K') ? values([row({ id: 'a' })]) : {},
    )

    expect(await sheets.compact(SHEET, GIDS)).toEqual({ removed: 0 })
    expect(writes(calls)).toHaveLength(0)
  })

  it('skips a tab whose gid it was not given, rather than guessing one', async () => {
    // `useLedger` throws before it gets here; this is the second line of defence,
    // and the reason that throw must not be removed as redundant.
    installSheets((call) =>
      call.url.includes('!A2:K') ? values([row({ id: 'a', deleted_at: 'x' })]) : {},
    )

    const { removed } = await sheets.compact(SHEET, { expenses_p1: 111 })

    expect(removed).toBe(1)
    const batch = globalThis.fetch.mock.calls.find(([url]) => String(url).includes(':batchUpdate'))
    for (const { deleteDimension } of JSON.parse(batch[1].body).requests) {
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
      if (call.url.includes('values:batchGet')) return { valueRanges: [{}, {}, {}] }
      return {}
    })

    await sheets.ensureStructure(SHEET)

    const added = writes(calls).find((call) => call.body?.requests)
    expect(added.body.requests.map((request) => request.addSheet.properties.title)).toEqual([
      'expenses_p1',
      'expenses_p2',
      'config',
    ])
  })

  it('writes a header row only when it does not already match', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('fields=sheets'))
        return sheetList(['expenses_p1', 'expenses_p2', 'config'])
      if (call.url.includes('values:batchGet')) {
        return {
          valueRanges: [
            values([EXPENSE_COLUMNS]), // p1 already correct
            values([['id', 'type']]), // p2 truncated
            values([
              ['key', 'value'],
              ['currency', 'JPY'],
            ]),
          ],
        }
      }
      return {}
    })

    await sheets.ensureStructure(SHEET)

    const write = writes(calls).find((call) => call.body?.data)
    expect(write.body.data.map((item) => item.range)).toEqual(['expenses_p2!A1:K1'])
    expect(write.body.valueInputOption).toBe('RAW')
  })

  it('never reseeds a config tab that already has values', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('fields=sheets'))
        return sheetList(['expenses_p1', 'expenses_p2', 'config'])
      if (call.url.includes('values:batchGet')) {
        return {
          valueRanges: [
            values([EXPENSE_COLUMNS]),
            values([EXPENSE_COLUMNS]),
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
      if (call.url.includes('fields=sheets'))
        return sheetList(['expenses_p1', 'expenses_p2', 'config'])
      if (call.url.includes('values:batchGet')) {
        return { valueRanges: [values([EXPENSE_COLUMNS]), values([EXPENSE_COLUMNS]), {}] }
      }
      return {}
    })

    await sheets.ensureStructure(SHEET)

    const data = writes(calls).find((call) => call.body?.data).body.data[0]
    expect(data.range).toBe('config!A1')
    expect(data.values[0]).toEqual(['key', 'value'])
    const asObject = Object.fromEntries(data.values.slice(1))
    expect(asObject.person1_name).toBe('Person 1')
    expect(asObject.currency).toBe('JPY')
  })

  it('returns the gids compact needs', async () => {
    installSheets((call) => {
      if (call.url.includes('fields=sheets'))
        return sheetList(['expenses_p1', 'expenses_p2', 'config'])
      if (call.url.includes('values:batchGet')) {
        return {
          valueRanges: [
            values([EXPENSE_COLUMNS]),
            values([EXPENSE_COLUMNS]),
            values([
              ['key', 'value'],
              ['currency', 'JPY'],
            ]),
          ],
        }
      }
      return {}
    })

    const { sheetIds } = await sheets.ensureStructure(SHEET)

    expect(sheetIds).toMatchObject({ expenses_p1: 100, expenses_p2: 101, config: 102 })
  })
})

describe('a rejected token', () => {
  it('re-mints once and retries the request once', async () => {
    let attempt = 0
    installSheets(() => {
      attempt += 1
      return attempt === 1 ? { __status: 401 } : { valueRanges: [{}, {}, {}] }
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
    const calls = installSheets(() => ({ valueRanges: [{}, {}, {}] }))
    await sheets.loadAll(SHEET)
    expect(calls[0].headers.Authorization).toBe('Bearer ya29.stub-token')
  })
})
