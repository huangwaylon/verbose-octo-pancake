import { describe, it, expect } from 'vitest'
import {
  EXPENSE_COLUMNS,
  ENTRY_ERROR,
  ENTRY_TYPE,
  PEOPLE,
  PERSON,
  EVEN_SHARE,
  otherPerson,
  expensesTab,
  expensesDataRange,
  rowRange,
  cellText,
  columnIndex,
  columnLetter,
  cellRange,
  rowToEntry,
  entryToRow,
  makeEntry,
  validateEntryCodes,
  isActive,
} from '../src/schema.js'

const NOW = '2026-03-10T12:00:00.000Z'

/** A full, valid entry with no randomness in it. */
function fullEntry(overrides = {}) {
  return makeEntry(
    {
      id: 'entry-1',
      type: ENTRY_TYPE.EXPENSE,
      date: '2026-03-09',
      payer: PERSON.P1,
      amountCents: 4210,
      currency: 'USD',
      category: 'Groceries',
      description: 'Weekly shop',
      payerShare: EVEN_SHARE,
      createdAt: '2026-03-09T08:30:00.000Z',
      ...overrides,
    },
    NOW,
  )
}

/** Build a raw row from field/value pairs so tests never depend on column order. */
function rawRow(fields) {
  return EXPENSE_COLUMNS.map((column) => fields[column] ?? '')
}

/**
 * The sheet currency argument, which only decides how a row with a blank
 * currency cell is read. Every amount in this file is written in USD cents.
 */
const SHEET = 'USD'

describe('column contract', () => {
  it('is eleven columns, A..K', () => {
    expect(EXPENSE_COLUMNS).toHaveLength(11)
    expect(columnLetter('id')).toBe('A')
    expect(columnLetter('deleted_at')).toBe('K')
    expect(columnIndex('id')).toBe(0)
    expect(columnIndex('deleted_at')).toBe(10)
  })

  it('names one tab per person', () => {
    expect(expensesTab(PERSON.P1)).toBe('expenses_p1')
    expect(expensesTab(PERSON.P2)).toBe('expenses_p2')
  })

  // Literals on the expected side on purpose: interpolating the module's own
  // FIRST_DATA_ROW would move both sides together and pin nothing.
  it('builds ranges that start below the header row', () => {
    expect(expensesDataRange(PERSON.P1)).toBe('expenses_p1!A2:K')
    expect(expensesDataRange(PERSON.P2)).toBe('expenses_p2!A2:K')
    expect(rowRange(PERSON.P1, 7)).toBe('expenses_p1!A7:K7')
    expect(rowRange(PERSON.P2, 7)).toBe('expenses_p2!A7:K7')
    expect(cellRange(PERSON.P1, 7, 'deleted_at')).toBe('expenses_p1!K7:K7')
  })

  it('throws on an unknown column rather than writing to the wrong cell', () => {
    expect(() => columnLetter('nope')).toThrow(/Unknown column/)
    expect(() => columnIndex('nope')).toThrow(/Unknown column/)
  })

  it('lists exactly the two people, each with their own tab', () => {
    expect(PEOPLE).toEqual([PERSON.P1, PERSON.P2])
    expect(new Set(PEOPLE.map(expensesTab)).size).toBe(2)
  })

  it('otherPerson is an involution', () => {
    expect(otherPerson(PERSON.P1)).toBe(PERSON.P2)
    expect(otherPerson(PERSON.P2)).toBe(PERSON.P1)
    for (const person of PEOPLE) expect(otherPerson(otherPerson(person))).toBe(person)
  })
})

describe('rowToEntry', () => {
  it('returns null for blank rows', () => {
    expect(rowToEntry([], PERSON.P1, SHEET)).toBeNull()
    expect(rowToEntry(['', '', '', '', '', '', '', '', '', '', ''], PERSON.P1, SHEET)).toBeNull()
    expect(rowToEntry(['   '], PERSON.P1, SHEET)).toBeNull()
    expect(rowToEntry(null, PERSON.P1, SHEET)).toBeNull()
    expect(rowToEntry(undefined, PERSON.P1, SHEET)).toBeNull()
    expect(rowToEntry('not a row', PERSON.P1, SHEET)).toBeNull()
  })

  it('returns null when the id is missing even if the rest is filled in', () => {
    const row = rawRow({ type: 'expense', date: '2026-03-09', amount: '42.10' })
    expect(rowToEntry(row, PERSON.P1, SHEET)).toBeNull()
  })

  it('returns null for an unparseable amount', () => {
    for (const amount of ['', 'abc', '4-2', '$', 'twelve', '1e3', '-42.10', '12,34.5']) {
      const row = rawRow({ id: 'x', type: 'expense', date: '2026-03-09', amount })
      expect(rowToEntry(row, PERSON.P1, SHEET)).toBeNull()
    }
  })

  it('accepts a zero amount as structurally valid — validation is what rejects it', () => {
    const row = rawRow({ id: 'x', amount: '0.00', date: '2026-03-09' })
    const entry = rowToEntry(row, PERSON.P1, SHEET)
    expect(entry.amountCents).toBe(0)
    expect(validateEntryCodes(entry)).toContain(ENTRY_ERROR.BAD_AMOUNT)
  })

  it('reads a cell Sheets returned as a number, not a string', () => {
    // values.get hands back a bare number for a numeric cell, so every read goes
    // through cellText rather than trusting the type.
    expect(cellText([' 42.10 '], 0)).toBe('42.10')
    expect(cellText([1250], 0)).toBe('1250')
    expect(cellText([], 0)).toBe('')
    expect(cellText([null], 0)).toBe('')
    const row = rawRow({ id: 'x', amount: 42.1, date: '2026-03-09' })
    expect(rowToEntry(row, PERSON.P1, SHEET).amountCents).toBe(4210)
  })

  it('tolerates short rows, because Sheets truncates trailing empty cells', () => {
    const entry = rowToEntry(['id-1', 'expense', '2026-03-09', '42.10'], PERSON.P2, SHEET)
    expect(entry).toMatchObject({
      id: 'id-1',
      type: ENTRY_TYPE.EXPENSE,
      payer: PERSON.P2,
      amountCents: 4210,
      currency: 'USD',
      category: '',
      description: '',
      payerShare: EVEN_SHARE,
      deletedAt: null,
    })
  })

  it('takes the payer from the tab it was read from, not from any cell', () => {
    const row = rawRow({ id: 'x', amount: '1.00' })
    expect(rowToEntry(row, PERSON.P1, SHEET).payer).toBe(PERSON.P1)
    expect(rowToEntry(row, PERSON.P2, SHEET).payer).toBe(PERSON.P2)
    // An unrecognised value normalises to the safe default, same as any other
    // stray input this function might see.
    expect(rowToEntry(row, 'p3', SHEET).payer).toBe(PERSON.P1)
  })

  it('drops a date that is not ISO-shaped instead of passing junk downstream', () => {
    for (const date of ['03/09/2026', '2026-3-9', 'yesterday', '']) {
      const entry = rowToEntry(rawRow({ id: 'x', amount: '1.00', date }), PERSON.P1, SHEET)
      expect(entry.date).toBe('')
    }
    expect(
      rowToEntry(rawRow({ id: 'x', amount: '1.00', date: '2026-03-09' }), PERSON.P1, SHEET).date,
    ).toBe('2026-03-09')
  })

  it('clamps an out-of-range payer_share into [0,1]', () => {
    const high = rowToEntry(
      rawRow({ id: 'x', amount: '1.00', payer_share: '5' }),
      PERSON.P1,
      SHEET,
    )
    const low = rowToEntry(
      rawRow({ id: 'x', amount: '1.00', payer_share: '-3' }),
      PERSON.P1,
      SHEET,
    )
    expect(high.payerShare).toBe(1)
    expect(low.payerShare).toBe(0)
  })

  it('defaults payer_share by type when the cell is blank or junk', () => {
    const expense = rowToEntry(
      rawRow({ id: 'x', amount: '1.00', type: 'expense' }),
      PERSON.P1,
      SHEET,
    )
    const settlement = rowToEntry(
      rawRow({ id: 'y', amount: '1.00', type: 'settlement' }),
      PERSON.P1,
      SHEET,
    )
    expect(expense.payerShare).toBe(EVEN_SHARE)
    expect(settlement.payerShare).toBe(0)
    expect(
      rowToEntry(
        rawRow({ id: 'z', amount: '1.00', type: 'expense', payer_share: 'huh' }),
        PERSON.P1,
        SHEET,
      ).payerShare,
    ).toBe(EVEN_SHARE)
  })

  it('normalises an unknown type to the safe default', () => {
    const row = rawRow({ id: 'x', amount: '1.00', type: 'REFUND' })
    expect(rowToEntry(row, PERSON.P1, SHEET).type).toBe(ENTRY_TYPE.EXPENSE)
  })

  it('normalises an empty deleted_at cell to null so isActive works', () => {
    const live = rowToEntry(rawRow({ id: 'x', amount: '1.00' }), PERSON.P1, SHEET)
    const dead = rowToEntry(
      rawRow({ id: 'y', amount: '1.00', deleted_at: NOW }),
      PERSON.P1,
      SHEET,
    )
    expect(live.deletedAt).toBeNull()
    expect(isActive(live)).toBe(true)
    expect(dead.deletedAt).toBe(NOW)
    expect(isActive(dead)).toBe(false)
    expect(isActive(null)).toBe(false)
  })
})

describe('entryToRow', () => {
  it('always returns exactly EXPENSE_COLUMNS.length cells', () => {
    expect(entryToRow(fullEntry())).toHaveLength(EXPENSE_COLUMNS.length)
    expect(entryToRow(fullEntry({ description: '', category: '' }))).toHaveLength(
      EXPENSE_COLUMNS.length,
    )
    expect(entryToRow(fullEntry({ amountCents: 0 }))).toHaveLength(EXPENSE_COLUMNS.length)
    expect(entryToRow(makeEntry({ id: 'bare', currency: 'USD' }, NOW))).toHaveLength(
      EXPENSE_COLUMNS.length,
    )
  })

  it('returns only strings, never null/undefined, so RAW writes are predictable', () => {
    const row = entryToRow(makeEntry({ id: 'bare', currency: 'USD' }, NOW))
    for (const cell of row) expect(typeof cell).toBe('string')
    expect(row.every((cell) => cell !== 'undefined' && cell !== 'null')).toBe(true)
  })

  it('refuses to encode an amount with no currency, rather than guessing the scale', () => {
    // Encoding ¥1250 at the two-digit default writes "12.50", which reads back
    // as ¥13. validateEntryCodes reports this as MISSING_CURRENCY first.
    expect(() => entryToRow(fullEntry({ currency: '' }))).toThrow(TypeError)
    expect(() => entryToRow(makeEntry({ id: 'bare' }, NOW))).toThrow(TypeError)
  })

  it('refuses to write a non-integer amount instead of putting "NaN" in a cell', () => {
    expect(() => entryToRow({ currency: 'USD' })).toThrow(TypeError)
    expect(() => entryToRow({ currency: 'USD', amountCents: NaN })).toThrow(TypeError)
    expect(() => entryToRow({ currency: 'USD', amountCents: 4.5 })).toThrow(TypeError)
  })

  it('writes an empty payer_share cell rather than the text "undefined" or "NaN"', () => {
    // Pre-stringifying this field once defeated the null guard in the map and
    // permanently polluted the cell, visible to anyone editing in Sheets.
    const share = columnIndex('payer_share')
    for (const payerShare of [undefined, null, NaN, Infinity, 'half']) {
      const row = entryToRow({ ...fullEntry(), payerShare })
      expect(row[share]).toBe('')
    }
    expect(entryToRow(fullEntry({ payerShare: 0.5 }))[share]).toBe('0.5')
    expect(entryToRow(fullEntry({ payerShare: 0 }))[share]).toBe('0')
  })

  it('writes the amount as a plain re-parseable decimal string', () => {
    const row = entryToRow(fullEntry({ amountCents: 123456789 }))
    expect(row[columnIndex('amount')]).toBe('1234567.89')
  })

  it('writes an empty string for a null deletedAt', () => {
    const row = entryToRow(fullEntry({ deletedAt: null }))
    expect(row[columnIndex('deleted_at')]).toBe('')
  })

  it('does not write a payer column at all — the tab it goes into is the payer', () => {
    expect(EXPENSE_COLUMNS).not.toContain('payer')
  })
})

describe('rowToEntry / entryToRow round trip', () => {
  const cases = [
    ['even-split expense', fullEntry()],
    ['payer keeps it all', fullEntry({ payerShare: 1 })],
    ['bought for the other person', fullEntry({ payerShare: 0 })],
    ['awkward share', fullEntry({ payerShare: 0.333 })],
    ['p2 paid', fullEntry({ payer: PERSON.P2 })],
    ['settlement', fullEntry({ type: ENTRY_TYPE.SETTLEMENT, category: '', payerShare: 0 })],
    ['soft deleted', fullEntry({ deletedAt: '2026-03-11T00:00:00.000Z' })],
    ['one cent', fullEntry({ amountCents: 1 })],
    ['large amount', fullEntry({ amountCents: 123456789 })],
    ['zero amount', fullEntry({ amountCents: 0 })],
    ['no category or description', fullEntry({ category: '', description: '' })],
    ['non-USD currency', fullEntry({ currency: 'EUR' })],
  ]

  for (const [name, entry] of cases) {
    it(`is lossless: ${name}`, () => {
      // The payer is supplied from the outside, exactly as loadAll does when
      // it reads each per-person tab.
      const restored = rowToEntry(entryToRow(entry), entry.payer, entry.currency)
      expect(restored).toEqual(entry)
    })
  }

  it('is stable over a second trip through the sheet', () => {
    const once = entryToRow(fullEntry())
    const twice = entryToRow(rowToEntry(once, PERSON.P1, SHEET))
    expect(twice).toEqual(once)
  })

  it('keeps a formula-looking description as literal text', () => {
    const nasty = [
      '=SUM(A:A)',
      "=SUM(A:A)",
      '+1 pizza',
      '-5 refund',
      '@channel',
      "'quoted'",
      '2026-03-09',
      '1,234',
    ]
    for (const description of nasty) {
      const entry = fullEntry({ description })
      const row = entryToRow(entry)
      expect(row[columnIndex('description')]).toBe(description)
      expect(rowToEntry(row, PERSON.P1, SHEET).description).toBe(description)
    }
  })

  it('keeps a description that looks like another column value from bleeding across', () => {
    const entry = fullEntry({ description: 'p2, 99.99, settlement' })
    const restored = rowToEntry(entryToRow(entry), PERSON.P1, SHEET)
    expect(restored.payer).toBe(PERSON.P1)
    expect(restored.amountCents).toBe(4210)
    expect(restored.type).toBe(ENTRY_TYPE.EXPENSE)
    expect(restored.description).toBe('p2, 99.99, settlement')
  })
})

describe('makeEntry', () => {
  it('is deterministic when id and now are supplied', () => {
    const a = makeEntry({ id: 'fixed', amountCents: 100 }, NOW)
    const b = makeEntry({ id: 'fixed', amountCents: 100 }, NOW)
    expect(a).toEqual(b)
    expect(a.createdAt).toBe(NOW)
    expect(a.updatedAt).toBe(NOW)
  })

  it('preserves createdAt and always refreshes updatedAt on an edit', () => {
    const created = makeEntry({ id: 'x', amountCents: 100 }, '2026-01-01T00:00:00.000Z')
    const edited = makeEntry({ ...created, amountCents: 200 }, NOW)
    expect(edited.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(edited.updatedAt).toBe(NOW)
  })

  it('defaults the share by type, but keeps an explicit 0', () => {
    expect(makeEntry({ id: 'a' }, NOW).payerShare).toBe(EVEN_SHARE)
    expect(makeEntry({ id: 'b', type: ENTRY_TYPE.SETTLEMENT }, NOW).payerShare).toBe(0)
    // A falsy-but-meaningful 0 must not be replaced by the 0.5 default.
    expect(makeEntry({ id: 'c', payerShare: 0 }, NOW).payerShare).toBe(0)
  })

  it('defaults type, payer, and deletedAt, and leaves a missing currency blank', () => {
    const entry = makeEntry({ id: 'a', payer: 'nonsense', type: 'nonsense' }, NOW)
    expect(entry.type).toBe(ENTRY_TYPE.EXPENSE)
    expect(entry.payer).toBe(PERSON.P1)
    // Blank rather than a guessed code: a scale invented here would be a silent
    // 100x error, so validation refuses the entry instead.
    expect(entry.currency).toBe('')
    expect(validateEntryCodes(entry)).toContain(ENTRY_ERROR.MISSING_CURRENCY)
    expect(entry.deletedAt).toBeNull()
    expect(entry.amountCents).toBe(0)
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
    for (const amountCents of [0, -1, -4210]) {
      expect(validateEntryCodes(fullEntry({ amountCents }))).toEqual([ENTRY_ERROR.BAD_AMOUNT])
    }
  })

  it('rejects a non-integer or NaN amount', () => {
    for (const amountCents of [4.5, NaN, Infinity, '4210', null, undefined]) {
      expect(validateEntryCodes(fullEntry({ amountCents }))).toEqual([ENTRY_ERROR.BAD_AMOUNT])
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

  it('rejects an entry with no currency, whatever the amount says', () => {
    // The integer is meaningless without the scale it was written at, so this is
    // a refusal rather than an assumption.
    for (const currency of ['', null, undefined]) {
      expect(validateEntryCodes(fullEntry({ currency }))).toEqual([ENTRY_ERROR.MISSING_CURRENCY])
    }
  })

  it('reports every problem at once so the form can show them together', () => {
    const errors = validateEntryCodes({
      id: '',
      type: ENTRY_TYPE.EXPENSE,
      date: 'nope',
      payer: 'p9',
      amountCents: -1,
      payerShare: 3,
      category: '',
      currency: '',
    })
    expect(errors).toEqual([
      ENTRY_ERROR.MISSING_ID,
      ENTRY_ERROR.BAD_DATE,
      ENTRY_ERROR.BAD_AMOUNT,
      ENTRY_ERROR.BAD_PAYER,
      ENTRY_ERROR.BAD_SHARE,
      ENTRY_ERROR.MISSING_CATEGORY,
      ENTRY_ERROR.MISSING_CURRENCY,
    ])
  })

  it('returns codes, never English, because the UI translates them', () => {
    // The codes are the stable contract between the validator and the catalogs.
    const codes = new Set(Object.values(ENTRY_ERROR))
    for (const code of validateEntryCodes({})) expect(codes.has(code)).toBe(true)
  })
})
