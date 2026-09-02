import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DATA_TABS,
  EXPENSE_COLUMNS,
  SETTLEMENT_COLUMNS,
  SETTLEMENTS,
  ENTRY_ERROR,
  ENTRY_TYPE,
  PEOPLE,
  PERSON,
  EVEN_SHARE,
  otherPerson,
  isPerson,
  expenseTab,
  tabOf,
  cellText,
  rowToEntry,
  entryToRow,
  makeEntry,
  validateEntryCodes,
  isActive,
} from '../src/schema.js'
import { expense, settlement, row as rawRow, settlementRow } from './support/entries.js'
import { DEFAULT_CONFIG } from '../src/config.js'

const P1 = expenseTab(PERSON.P1)
const P2 = expenseTab(PERSON.P2)

/** A stamp for the one timestamp a row still carries. */
const NOW = '2026-03-10T12:00:00.000Z'

/** The shared expense at this file's own values. */
const fullEntry = (overrides = {}) =>
  expense({
    id: 'entry-1',
    date: '2026-03-09',
    amountYen: 4210,
    description: 'Weekly shop',
    ...overrides,
  })

describe('column contract', () => {
  /**
   * Both lists as literals, because nothing else in the suite can see a reorder: the
   * shared `row` fixture BUILDS rows from a tab's own list, so it moves with the list
   * and every assertion still passes.
   *
   * A reorder is silent and destructive in a live sheet. Every range and letter is
   * derived from array position, and `ensureStructure` rewrites a header row that no
   * longer matches while never touching data rows — so swapping two columns relabels
   * every existing row under the wrong field, and `category`/`description` would read
   * as plausible either way.
   */
  // Ordered to match the bank's CSV export — 取引日, 摘要, 引出額 — with `id` last.
  it('is exactly these expense columns, in this order', () => {
    expect(EXPENSE_COLUMNS).toEqual([
      'date',
      'description',
      'amount',
      'category',
      'payer_share',
      'deleted_at',
      'id',
    ])
  })

  it('is exactly these settlement columns, in this order', () => {
    expect(SETTLEMENT_COLUMNS).toEqual([
      'date',
      'description',
      'amount',
      'payer',
      'deleted_at',
      'id',
    ])
  })

  /**
   * The two layouts put `deleted_at` at DIFFERENT indexes, which is the whole reason
   * every positional lookup hangs off a tab rather than the module. Stated as literals
   * on both sides: one shared index would have `compact` reading the settlements tab's
   * `id` column — non-empty on every row — and hard-deleting every live settlement.
   */
  it('indexes deleted_at differently in the two layouts', () => {
    expect(P1.index('deleted_at')).toBe(5)
    expect(P1.letter('deleted_at')).toBe('F')
    expect(SETTLEMENTS.index('deleted_at')).toBe(4)
    expect(SETTLEMENTS.letter('deleted_at')).toBe('E')
  })

  it('names one tab per person, plus one for settlements', () => {
    expect(P1.title).toBe('expenses_p1')
    expect(P2.title).toBe('expenses_p2')
    expect(SETTLEMENTS.title).toBe('settlements')
    expect(DATA_TABS.map((tab) => tab.title)).toEqual(['expenses_p1', 'expenses_p2', 'settlements'])
  })

  /**
   * The tab asserts what a row cannot. An expenses tab names its payer, so no cell can
   * contradict it; the settlements tab answers null, meaning "read the cell".
   */
  it('says what each tab knows about its own rows', () => {
    expect([P1.type, P1.payer]).toEqual([ENTRY_TYPE.EXPENSE, PERSON.P1])
    expect([P2.type, P2.payer]).toEqual([ENTRY_TYPE.EXPENSE, PERSON.P2])
    expect([SETTLEMENTS.type, SETTLEMENTS.payer]).toEqual([ENTRY_TYPE.SETTLEMENT, null])
  })

  // Literals on the expected side on purpose: interpolating the module's own
  // FIRST_DATA_ROW would move both sides together and pin nothing.
  it('builds ranges that start below the header row', () => {
    expect(P1.dataRange).toBe('expenses_p1!A2:G')
    expect(P2.dataRange).toBe('expenses_p2!A2:G')
    expect(SETTLEMENTS.dataRange).toBe('settlements!A2:F')
    expect(P1.headerRange).toBe('expenses_p1!A1:G1')
    expect(P1.rowRange(7)).toBe('expenses_p1!A7:G7')
    expect(SETTLEMENTS.rowRange(7)).toBe('settlements!A7:F7')
    expect(P1.cellRange(7, 'deleted_at')).toBe('expenses_p1!F7:F7')
    expect(SETTLEMENTS.cellRange(7, 'deleted_at')).toBe('settlements!E7:E7')
  })

  it('throws on an unknown column rather than writing to the wrong cell', () => {
    expect(() => P1.index('nope')).toThrow(/Unknown column/)
    expect(() => P1.letter('nope')).toThrow(/Unknown column/)
    // A column the OTHER layout has is still unknown here, and must not silently
    // resolve to whatever sits at that position.
    expect(() => P1.index('payer')).toThrow(/Unknown column/)
    expect(() => SETTLEMENTS.index('category')).toThrow(/Unknown column/)
    expect(P1.has('payer')).toBe(false)
    expect(SETTLEMENTS.has('payer_share')).toBe(false)
  })

  it('stays within the 26 columns single-letter arithmetic can name', () => {
    // Letters come from `String.fromCharCode(65 + index)`, so a 27th column would
    // answer '[' and the API would reject every range built from it. This assertion is
    // the whole guard: every caller passes a name from a list, so a list growing is the
    // only way the limit can be crossed.
    for (const tab of DATA_TABS) expect(tab.columns.length).toBeLessThanOrEqual(26)
  })

  it('lists exactly the two people, each with their own tab', () => {
    expect(PEOPLE).toEqual([PERSON.P1, PERSON.P2])
    expect(new Set(PEOPLE.map((person) => expenseTab(person).title)).size).toBe(2)
  })

  it('otherPerson is an involution', () => {
    expect(otherPerson(PERSON.P1)).toBe(PERSON.P2)
    expect(otherPerson(PERSON.P2)).toBe(PERSON.P1)
  })
})

describe('rowToEntry', () => {
  it('returns null for blank rows', () => {
    expect(rowToEntry([], P1)).toBeNull()
    expect(rowToEntry(['', '', '', '', '', '', '', '', '', '', ''], P1)).toBeNull()
    expect(rowToEntry(['   '], P1)).toBeNull()
    expect(rowToEntry(null, P1)).toBeNull()
    expect(rowToEntry(undefined, P1)).toBeNull()
    expect(rowToEntry('not a row', P1)).toBeNull()
  })

  it('returns null when the id is missing even if the rest is filled in', () => {
    const row = rawRow({ date: '2026-03-09', amount: '42.10' })
    expect(rowToEntry(row, P1)).toBeNull()
  })

  it('returns null for an unparseable amount', () => {
    for (const amount of ['', 'abc', '4-2', '$', 'twelve', '1e3', '-42.10', '12,34.5']) {
      const row = rawRow({ id: 'x', date: '2026-03-09', amount })
      expect(rowToEntry(row, P1)).toBeNull()
    }
  })

  it('accepts a zero amount as structurally valid — validation is what rejects it', () => {
    const row = rawRow({ id: 'x', amount: '0', date: '2026-03-09' })
    const entry = rowToEntry(row, P1)
    expect(entry.amountYen).toBe(0)
    expect(validateEntryCodes(entry)).toContain(ENTRY_ERROR.BAD_AMOUNT)
  })

  it('reads a cell Sheets returned as a number, not a string', () => {
    // values.get hands back a bare number for a numeric cell, so every read goes
    // through cellText rather than trusting the type.
    expect(cellText([' 42.10 '], 0)).toBe('42.10')
    expect(cellText([1250], 0)).toBe('1250')
    expect(cellText([], 0)).toBe('')
    expect(cellText([null], 0)).toBe('')
    const row = rawRow({ id: 'x', amount: 4210, date: '2026-03-09' })
    expect(rowToEntry(row, P1).amountYen).toBe(4210)
  })

  it('tolerates short rows, because Sheets truncates trailing empty cells', () => {
    const entry = rowToEntry(['2026-03-09', '', '4210', '', '', '', 'id-1'], P2)
    expect(entry).toMatchObject({
      id: 'id-1',
      type: ENTRY_TYPE.EXPENSE,
      payer: PERSON.P2,
      amountYen: 4210,
      category: '',
      description: '',
      payerShare: EVEN_SHARE,
      deletedAt: null,
    })
  })

  it('takes the payer from the tab it was read from, not from any cell', () => {
    const row = rawRow({ id: 'x', amount: '100' })
    expect(rowToEntry(row, P1).payer).toBe(PERSON.P1)
    expect(rowToEntry(row, P2).payer).toBe(PERSON.P2)
    // An expenses tab has no payer column at all, so there is nothing to disagree with.
    expect(P1.has('payer')).toBe(false)
    // Refuses rather than picking one. The tab a row came from IS its type and, here,
    // its payer — so a caller that cannot name the tab has lost track of what it is
    // reading, and every entry it decodes would be attributed wrongly.
    expect(() => rowToEntry(row, PERSON.P1)).toThrow(TypeError)
    expect(() => rowToEntry(row, undefined)).toThrow(TypeError)
  })

  describe('the settlements tab, where the payer IS a cell', () => {
    it('reads the payer from the column, whatever its case', () => {
      for (const spelling of ['p2', 'P2', ' p2 ']) {
        const row = settlementRow({ id: 's1', amount: '100', payer: spelling })
        expect(rowToEntry(row, SETTLEMENTS).payer).toBe(PERSON.P2)
      }
    })

    it('takes its type from the tab, with no cell to get wrong', () => {
      const entry = rowToEntry(settlementRow({ id: 's1', amount: '100', payer: 'p1' }), SETTLEMENTS)
      expect(entry.type).toBe(ENTRY_TYPE.SETTLEMENT)
      expect(SETTLEMENTS.has('type')).toBe(false)
    })

    /**
     * A share of 0 is the whole definition of a settlement — the payer handed money
     * over and the other person is responsible for all of it — so the column does not
     * exist rather than holding a cell with one correct value.
     */
    it('has no share of its own, and reads as 0', () => {
      const entry = rowToEntry(settlementRow({ id: 's1', amount: '100', payer: 'p1' }), SETTLEMENTS)
      expect(entry.payerShare).toBe(0)
      expect(entry.category).toBe('')
    })

    /**
     * The payer decides the SIGN of this row's contribution, so a junk cell is a wrong
     * balance rather than a missing row — which is why the row is dropped and counted
     * instead of being attributed to a default.
     */
    it('refuses a row whose payer names neither person', () => {
      for (const payer of ['', 'p3', 'Waylon', 'both']) {
        const row = settlementRow({ id: 's1', amount: '100', payer })
        expect(rowToEntry(row, SETTLEMENTS)).toBeNull()
      }
    })
  })

  it('drops a date that is not ISO-shaped instead of passing junk downstream', () => {
    for (const date of ['03/09/2026', '2026-3-9', 'yesterday', '']) {
      const entry = rowToEntry(rawRow({ id: 'x', amount: '100', date }), P1)
      expect(entry.date).toBe('')
    }
    expect(rowToEntry(rawRow({ id: 'x', amount: '100', date: '2026-03-09' }), P1).date).toBe(
      '2026-03-09',
    )
  })

  it('reads payer_share as a percentage above 1, exactly like the config tab', () => {
    const share = (payer_share) =>
      rowToEntry(rawRow({ id: 'x', amount: '100', payer_share }), P1).payerShare
    // The rule that matters: somebody typing 80 into the column means 80%, not
    // "the payer covers all of it" — the same reading the config tab gives it.
    expect(share('80')).toBe(0.8)
    expect(share('0.8')).toBe(0.8)
    expect(share('100')).toBe(1)
    expect(share('0')).toBe(0)
    // Junk falls through to the type's default rather than reaching splitYen.
    expect(share('-3')).toBe(EVEN_SHARE)
  })

  it('falls back to an even split when the share cell is blank or junk', () => {
    expect(rowToEntry(rawRow({ id: 'x', amount: '100' }), P1).payerShare).toBe(EVEN_SHARE)
    expect(rowToEntry(rawRow({ id: 'z', amount: '100', payer_share: 'huh' }), P1).payerShare).toBe(
      EVEN_SHARE,
    )
  })

  /**
   * There is no `type` cell to mistype: the tab decides, so an expenses tab cannot
   * produce a settlement at all. A hand-typed "Settlement" read as an expense would
   * inflate the month's spend and the category donut by the whole transfer.
   */
  it('takes the type from the tab, so no cell can make an expense a settlement', () => {
    expect(P1.has('type')).toBe(false)
    expect(rowToEntry(rawRow({ id: 'x', amount: '100' }), P1).type).toBe(ENTRY_TYPE.EXPENSE)
    expect(
      rowToEntry(settlementRow({ id: 'x', amount: '100', payer: 'p1' }), SETTLEMENTS).type,
    ).toBe(ENTRY_TYPE.SETTLEMENT)
  })

  it('normalises an empty deleted_at cell to null so isActive works', () => {
    const live = rowToEntry(rawRow({ id: 'x', amount: '100' }), P1)
    const dead = rowToEntry(rawRow({ id: 'y', amount: '100', deleted_at: NOW }), P1)
    expect(live.deletedAt).toBeNull()
    expect(isActive(live)).toBe(true)
    expect(dead.deletedAt).toBe(NOW)
    expect(isActive(dead)).toBe(false)
    expect(isActive(null)).toBe(false)
  })
})

describe('entryToRow', () => {
  it('returns one cell per column of the tab being written to', () => {
    // Literals, not `tab.columns.length`: `entryToRow` IS a map over that list, so
    // deriving the expectation from it compares the module against itself and passes
    // for any width. Seven and six are what the two `A:G` / `A:F` ranges spell.
    expect(entryToRow(fullEntry(), P1)).toHaveLength(7)
    expect(entryToRow(fullEntry({ description: '', category: '' }), P1)).toHaveLength(7)
    expect(entryToRow(fullEntry({ amountYen: 0 }), P1)).toHaveLength(7)
    expect(entryToRow(makeEntry({ id: 'bare' }), P1)).toHaveLength(7)
    expect(entryToRow(settlement(), SETTLEMENTS)).toHaveLength(6)
  })

  /**
   * A field the tab does not carry is simply not written, and — the half that matters —
   * one it DOES carry is filled from the entry. `payer` is the case: absent from an
   * expenses row, present in a settlement one, and blank in neither.
   */
  it('writes each tab only the columns it has', () => {
    const expenseCells = entryToRow(fullEntry(), P1)
    expect(expenseCells).toHaveLength(P1.columns.length)

    const paid = settlement({ id: 's1', payer: PERSON.P2, amountYen: 500 })
    const settlementCells = entryToRow(paid, SETTLEMENTS)
    expect(settlementCells[SETTLEMENTS.index('payer')]).toBe(PERSON.P2)
    expect(settlementCells[SETTLEMENTS.index('amount')]).toBe('500')
    // The two columns a settlement has no use for are absent, not blank.
    expect(SETTLEMENTS.has('category')).toBe(false)
    expect(SETTLEMENTS.has('payer_share')).toBe(false)
  })

  it('returns only strings, never null/undefined, so RAW writes are predictable', () => {
    const row = entryToRow(makeEntry({ id: 'bare' }), P1)
    for (const cell of row) expect(typeof cell).toBe('string')
    expect(row.every((cell) => cell !== 'undefined' && cell !== 'null')).toBe(true)
  })

  it('refuses to write a non-integer amount instead of putting "NaN" in a cell', () => {
    expect(() => entryToRow({}, P1)).toThrow(TypeError)
    expect(() => entryToRow({ amountYen: NaN }, P1)).toThrow(TypeError)
    expect(() => entryToRow({ amountYen: 4.5 }, P1)).toThrow(TypeError)
  })

  it('refuses a caller that cannot name the tab, rather than picking a layout', () => {
    expect(() => entryToRow(fullEntry())).toThrow(TypeError)
    expect(() => entryToRow(fullEntry(), PERSON.P1)).toThrow(TypeError)
  })

  it('writes an empty payer_share cell rather than the text "undefined" or "NaN"', () => {
    // Pre-stringifying this field would defeat the null guard in the map and
    // permanently pollute the cell, visible to anyone editing in Sheets.
    const share = P1.index('payer_share')
    for (const payerShare of [undefined, null, NaN, Infinity, 'half']) {
      const row = entryToRow({ ...fullEntry(), payerShare }, P1)
      expect(row[share]).toBe('')
    }
    expect(entryToRow(fullEntry({ payerShare: 0.5 }), P1)[share]).toBe('0.5')
    expect(entryToRow(fullEntry({ payerShare: 0 }), P1)[share]).toBe('0')
  })

  it('writes the amount as plain re-parseable digits, with no separator', () => {
    const row = entryToRow(fullEntry({ amountYen: 123456789 }), P1)
    expect(row[P1.index('amount')]).toBe('123456789')
  })

  it('writes an empty string for a null deletedAt', () => {
    const row = entryToRow(fullEntry({ deletedAt: null }), P1)
    expect(row[P1.index('deleted_at')]).toBe('')
  })
})

describe('rowToEntry / entryToRow round trip', () => {
  const cases = [
    ['even-split expense', fullEntry()],
    ['payer keeps it all', fullEntry({ payerShare: 1 })],
    ['bought for the other person', fullEntry({ payerShare: 0 })],
    ['awkward share', fullEntry({ payerShare: 0.333 })],
    ['p2 paid', fullEntry({ payer: PERSON.P2 })],
    ['settlement', settlement({ id: 's1', date: '2026-03-09', amountYen: 4210 })],
    ['settlement p2 paid', settlement({ id: 's2', date: '2026-03-09', payer: PERSON.P2 })],
    ['soft deleted', fullEntry({ deletedAt: '2026-03-11T00:00:00.000Z' })],
    ['one cent', fullEntry({ amountYen: 1 })],
    ['large amount', fullEntry({ amountYen: 123456789 })],
    ['zero amount', fullEntry({ amountYen: 0 })],
    ['no category or description', fullEntry({ category: '', description: '' })],
  ]

  for (const [name, entry] of cases) {
    it(`is lossless: ${name}`, () => {
      // Through the tab the entry belongs in, which is exactly how `loadAll` reads it
      // back and what `appendEntry` used to write it.
      const tab = tabOf(entry)
      expect(rowToEntry(entryToRow(entry, tab), tab)).toEqual(entry)
    })
  }

  it('is stable over a second trip through the sheet', () => {
    const once = entryToRow(fullEntry(), P1)
    const twice = entryToRow(rowToEntry(once, P1), P1)
    expect(twice).toEqual(once)
  })

  it('keeps a formula-looking description as literal text', () => {
    const nasty = [
      '=SUM(A:A)',
      "'=SUM(A:A)",
      '+1 pizza',
      '-5 refund',
      '@channel',
      "'quoted'",
      '2026-03-09',
      '1,234',
    ]
    for (const description of nasty) {
      const entry = fullEntry({ description })
      const row = entryToRow(entry, P1)
      expect(row[P1.index('description')]).toBe(description)
      expect(rowToEntry(row, P1).description).toBe(description)
    }
  })

  it('keeps a description that looks like another column value from bleeding across', () => {
    const entry = fullEntry({ description: 'p2, 99.99, settlement' })
    const restored = rowToEntry(entryToRow(entry, P1), P1)
    expect(restored.payer).toBe(PERSON.P1)
    expect(restored.amountYen).toBe(4210)
    expect(restored.type).toBe(ENTRY_TYPE.EXPENSE)
    expect(restored.description).toBe('p2, 99.99, settlement')
  })
})

describe('makeEntry', () => {
  it('is deterministic for the same input', () => {
    const a = makeEntry({ id: 'fixed', amountYen: 100 })
    const b = makeEntry({ id: 'fixed', amountYen: 100 })
    expect(a).toEqual(b)
  })

  /**
   * An entry reads no clock at all, so a fixture needs nothing injected to be
   * reproducible. `deletedAt` is the one timestamp left and it is stamped by whoever
   * performs the delete, not here — so a fresh entry carries none.
   */
  it('reads no clock, and claims no timestamps', () => {
    const entry = makeEntry({ id: 'x', amountYen: 100 })
    expect(entry.deletedAt).toBeNull()
    expect('createdAt' in entry).toBe(false)
    expect('updatedAt' in entry).toBe(false)
    // Round-tripping an entry through the builder must not invent one either.
    expect(makeEntry({ ...entry, amountYen: 200 })).toEqual({ ...entry, amountYen: 200 })
  })

  it('defaults the share by type, but keeps an explicit 0', () => {
    expect(makeEntry({ id: 'a' }).payerShare).toBe(EVEN_SHARE)
    expect(makeEntry({ id: 'b', type: ENTRY_TYPE.SETTLEMENT }).payerShare).toBe(0)
    // A falsy-but-meaningful 0 must not be replaced by the 0.5 default.
    expect(makeEntry({ id: 'c', payerShare: 0 }).payerShare).toBe(0)
  })

  it('passes an unrecognised payer through so validation can refuse it', () => {
    const entry = makeEntry({ id: 'a', payer: 'nonsense', type: 'nonsense' })
    expect(entry.type).toBe(ENTRY_TYPE.EXPENSE)
    // Not rewritten to p1: guessing makes BAD_PAYER unreachable from every write
    // path and files the expense under the wrong person's tab.
    expect(entry.payer).toBe('nonsense')
    expect(validateEntryCodes(entry)).toContain(ENTRY_ERROR.BAD_PAYER)
    expect(entry.deletedAt).toBeNull()
    expect(entry.amountYen).toBe(0)
  })
})

describe('validateEntryCodes', () => {
  it('accepts a well-formed expense and settlement', () => {
    expect(validateEntryCodes(fullEntry())).toEqual([])
    expect(
      validateEntryCodes(fullEntry({ type: ENTRY_TYPE.SETTLEMENT, category: '', payerShare: 0 })),
    ).toEqual([])
  })

  it('rejects zero and negative amounts', () => {
    for (const amountYen of [0, -1, -4210]) {
      expect(validateEntryCodes(fullEntry({ amountYen }))).toEqual([ENTRY_ERROR.BAD_AMOUNT])
    }
  })

  it('rejects a non-integer or NaN amount', () => {
    for (const amountYen of [4.5, NaN, Infinity, '4210', null, undefined]) {
      expect(validateEntryCodes(fullEntry({ amountYen }))).toEqual([ENTRY_ERROR.BAD_AMOUNT])
    }
  })

  it('rejects a badly shaped date', () => {
    for (const date of ['', '2026-3-9', '03/09/2026', '9 March 2026', '2026-03-09T00:00:00Z']) {
      expect(validateEntryCodes(fullEntry({ date }))).toEqual([ENTRY_ERROR.BAD_DATE])
    }
  })

  it('rejects an ISO-shaped date that is not a real calendar day', () => {
    // These pass a shape-only regex but would produce a nonsense month key.
    for (const date of ['2026-02-31', '2026-13-45', '0000-00-00', '2026-04-31', '2025-02-29']) {
      expect(validateEntryCodes(fullEntry({ date }))).toEqual([ENTRY_ERROR.BAD_DATE])
    }
    expect(validateEntryCodes(fullEntry({ date: '2024-02-29' }))).toEqual([]) // real leap day
  })

  it('rejects a payerShare that is a numeric string rather than a number', () => {
    // makeEntry coerces, so reaching validation with a string means someone
    // bypassed it — and a string share must not slip through into the balance.
    expect(validateEntryCodes({ ...fullEntry(), payerShare: '0.5' })).toEqual([
      ENTRY_ERROR.BAD_SHARE,
    ])
  })

  it('rejects an out-of-range or non-numeric share', () => {
    for (const payerShare of [-0.01, 1.01, 2, -1, NaN]) {
      expect(validateEntryCodes(fullEntry({ payerShare }))).toEqual([ENTRY_ERROR.BAD_SHARE])
    }
    for (const payerShare of [0, 0.5, 1, 0.333]) {
      expect(validateEntryCodes(fullEntry({ payerShare }))).not.toContain(ENTRY_ERROR.BAD_SHARE)
    }
  })

  it('sees the default share, not the omission, when payerShare is left out', () => {
    // makeEntry fills in the type-appropriate default, so an omitted share is
    // never itself a validation error.
    for (const payerShare of [undefined, null]) {
      expect(validateEntryCodes(fullEntry({ payerShare }))).toEqual([])
    }
  })

  it('rejects an expense with no category, but not a settlement', () => {
    expect(validateEntryCodes(fullEntry({ category: '' }))).toEqual([ENTRY_ERROR.MISSING_CATEGORY])
    expect(
      validateEntryCodes(fullEntry({ type: ENTRY_TYPE.SETTLEMENT, category: '', payerShare: 0 })),
    ).not.toContain(ENTRY_ERROR.MISSING_CATEGORY)
  })

  it('rejects a missing id and an unknown payer', () => {
    expect(validateEntryCodes({ ...fullEntry(), id: '' })).toEqual([ENTRY_ERROR.MISSING_ID])
    expect(validateEntryCodes({ ...fullEntry(), payer: 'p3' })).toEqual([ENTRY_ERROR.BAD_PAYER])
  })

  it('reports every problem at once so the form can show them together', () => {
    const errors = validateEntryCodes({
      id: '',
      type: ENTRY_TYPE.EXPENSE,
      date: 'nope',
      payer: 'p9',
      amountYen: -1,
      payerShare: 3,
      category: '',
    })
    expect(errors).toEqual([
      ENTRY_ERROR.MISSING_ID,
      ENTRY_ERROR.BAD_DATE,
      ENTRY_ERROR.BAD_AMOUNT,
      ENTRY_ERROR.BAD_PAYER,
      ENTRY_ERROR.BAD_SHARE,
      ENTRY_ERROR.MISSING_CATEGORY,
    ])
  })

  it('reports a code per problem, so nothing has to parse a sentence', () => {
    // The codes are the stable contract between the validator and the catalogs;
    // i18n.test.js is what proves each one has a translation.
    expect(validateEntryCodes({}).length).toBeGreaterThan(1)
    expect(validateEntryCodes({})).toContain(ENTRY_ERROR.MISSING_ID)
    expect(validateEntryCodes({})).toContain(ENTRY_ERROR.BAD_AMOUNT)
  })
})

/**
 * `scripts/bank_to_ledger.py` writes rows for these same tabs and carries its own copy
 * of the column list, because it is Python and cannot import this module. Nothing else
 * can catch the two disagreeing: the script keeps emitting its old order and width, the
 * rows paste in looking plausible, and every value lands under the neighbouring field.
 *
 * It carries its own copy of the CATEGORY list for the same reason, and a disagreement
 * there is quieter still: a category the config tab does not offer renders the picker
 * blank on every imported row someone opens.
 *
 * Parsed out of the source rather than executed, so this needs no Python on the machine.
 */
describe('the importer script agrees about the column list', () => {
  const pythonList = (name, [open, close] = '[]') => {
    const source = readFileSync(new URL('../scripts/bank_to_ledger.py', import.meta.url), 'utf8')
    const match = source.match(new RegExp(`^${name} = \\${open}$([\\s\\S]*?)^\\${close}$`, 'm'))
    expect(match, `${name} not found in bank_to_ledger.py`).toBeTruthy()
    return [...match[1].matchAll(/"([^"]+)"/g)].map((found) => found[1])
  }

  it('carries the same expense columns in the same order', () => {
    expect(pythonList('EXPENSE_COLUMNS')).toEqual(EXPENSE_COLUMNS)
  })

  // The script emits settlement rows into their own file, at their own layout, so this
  // list can drift independently of the one above.
  it('carries the same settlement columns in the same order', () => {
    expect(pythonList('SETTLEMENT_COLUMNS')).toEqual(SETTLEMENT_COLUMNS)
  })

  // Order included: the app pre-selects `categories[0]` on a new entry, so the two
  // lists reading the same names in a different order is still a disagreement worth
  // seeing. The script's own assert is what pins each RULE to this vocabulary.
  it('classifies into the categories a fresh config offers', () => {
    expect(pythonList('CATEGORIES', '()')).toEqual(DEFAULT_CONFIG.categories)
  })
})

describe('a tab is never guessed', () => {
  // Answering `expenses_p1` for anything unrecognised would turn "we do not know
  // which tab this row is in" into a write against the wrong person's ledger.
  // Every caller either iterates DATA_TABS or holds a row's real payer.
  it('throws for anything that is not one of the two people', () => {
    expect(expenseTab(PERSON.P1).title).toBe('expenses_p1')
    expect(expenseTab(PERSON.P2).title).toBe('expenses_p2')
    for (const bad of [undefined, null, '', 'p3', 'P1', 0, {}]) {
      expect(() => expenseTab(bad)).toThrow(TypeError)
    }
  })

  /**
   * `tabOf` is the one home of "where does this entry live", used by the append and by
   * the lookup that finds the row again — so the two cannot disagree about it.
   *
   * The settlement half is what makes an edit safe: `tabOf` answers the same tab
   * whichever payer a settlement names, so changing that payer overwrites a cell rather
   * than moving the row and leaving a tombstone behind.
   */
  it('sends an entry to the tab its type and payer name', () => {
    expect(tabOf(expense({ payer: PERSON.P1 }))).toBe(expenseTab(PERSON.P1))
    expect(tabOf(expense({ payer: PERSON.P2 }))).toBe(expenseTab(PERSON.P2))
    expect(tabOf(settlement({ payer: PERSON.P1 }))).toBe(SETTLEMENTS)
    expect(tabOf(settlement({ payer: PERSON.P2 }))).toBe(SETTLEMENTS)
  })

  it('refuses an expense whose payer it cannot name', () => {
    expect(() => tabOf({ type: ENTRY_TYPE.EXPENSE, payer: 'p3' })).toThrow(TypeError)
    expect(() => tabOf(undefined)).toThrow(TypeError)
  })

  it('isPerson is what callers check before they get that far', () => {
    expect(isPerson(PERSON.P1)).toBe(true)
    expect(isPerson(PERSON.P2)).toBe(true)
    for (const bad of [undefined, null, '', 'p3', 0]) expect(isPerson(bad)).toBe(false)
  })
})
