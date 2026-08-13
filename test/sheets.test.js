import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EXPENSE_COLUMNS, PERSON, columnIndex, makeEntry } from '../src/schema.js'
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
      if (call.url.includes('!A2:A')) return values([['e1']])
      if (call.url.includes('values:batchGet')) return { valueRanges: [{}, {}, {}] }
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
  it('writes to the row the id column says, not to any cached position', async () => {
    // The id sits third in the tab, so the write must land on row 4 (header + 2).
    const calls = installSheets((call) => {
      if (call.url.includes('!A2:A')) return values([['other-1'], ['other-2'], ['e1']])
      return {}
    })

    await sheets.updateEntry(SHEET, entry(), PERSON.P1)

    const [read, write] = calls
    expect(read.method).toBe('GET')
    expect(read.url).toContain('expenses_p1!A2:A')
    expect(write.method).toBe('PUT')
    expect(write.url).toContain('expenses_p1!A4:K4')
  })

  it('stamps deleted_at on the resolved row, in the deleted_at column only', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('!A2:A')) return values([['e1']])
      return {}
    })

    await sheets.setDeletedAt(SHEET, PERSON.P2, 'e1', '2026-08-06T00:00:00.000Z')

    const [, write] = calls
    const letter = String.fromCharCode(65 + columnIndex('deleted_at'))
    expect(write.url).toContain(`expenses_p2!${letter}2:${letter}2`)
    expect(write.body.values).toEqual([['2026-08-06T00:00:00.000Z']])
  })

  it('clears the cell with an empty string when restoring', async () => {
    const calls = installSheets((call) => {
      if (call.url.includes('!A2:A')) return values([['e1']])
      return {}
    })

    await sheets.setDeletedAt(SHEET, PERSON.P1, 'e1', null)

    expect(writes(calls)[0].body.values).toEqual([['']])
  })

  it('refuses to write at all when the id is gone from the sheet', async () => {
    const calls = installSheets(() => values([['someone-else']]))

    await expect(sheets.setDeletedAt(SHEET, PERSON.P1, 'e1', null)).rejects.toMatchObject({
      i18nKey: 'error.entryGone',
    })
    expect(writes(calls)).toHaveLength(0)
  })
})

describe('changing who paid moves the row between tabs', () => {
  it('appends to the new tab BEFORE tombstoning the old row', async () => {
    // Ordering is the invariant: a failure between the two must leave the entry
    // visible under its old payer rather than gone from both tabs.
    const calls = installSheets((call) => {
      if (call.url.includes('!A2:A')) return values([['e1']])
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
      if (call.url.includes('!A2:A')) return values([['e1']])
      return {}
    })

    await sheets.updateEntry(SHEET, entry(), PERSON.P1)

    const mutating = writes(calls)
    expect(mutating).toHaveLength(1)
    expect(mutating[0].url).not.toContain(':append')
  })

  it('refuses a previousPayer that is not one of the two people', async () => {
    // `undefined` here used to mean "append a duplicate, then look for the
    // original in whichever tab expensesTab defaulted to".
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
      expect(deleteDimension.dimension ?? deleteDimension.range.dimension).toBe('ROWS')
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
