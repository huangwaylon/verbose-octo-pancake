import { describe, it, expect } from 'vitest'
import {
  EXPENSE_COLUMNS,
  FIRST_DATA_ROW,
  EXPENSES_DATA_RANGE,
  ENTRY_TYPE,
  PERSON,
  EVEN_SHARE,
  otherPerson,
  rowRange,
  columnLetter,
  cellRange,
  rowToEntry,
  entryToRow,
  makeEntry,
  validateEntry,
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
      rowNumber: FIRST_DATA_ROW,
      ...overrides,
    },
    NOW,
  )
}

/** Build a raw row from field/value pairs so tests never depend on column order. */
function rawRow(fields) {
  return EXPENSE_COLUMNS.map((column) => fields[column] ?? '')
}

describe('column contract', () => {
  it('has exactly 12 columns, A..L, matching the declared data range', () => {
    expect(EXPENSE_COLUMNS).toHaveLength(12)
    expect(columnLetter('id')).toBe('A')
    expect(columnLetter('deleted_at')).toBe('L')
    expect(EXPENSES_DATA_RANGE).toBe(`expenses!A${FIRST_DATA_ROW}:L`)
    expect(rowRange(7)).toBe('expenses!A7:L7')
    expect(cellRange(7, 'deleted_at')).toBe('expenses!L7:L7')
  })

  it('throws on an unknown column rather than writing to the wrong cell', () => {
    expect(() => columnLetter('nope')).toThrow(/Unknown column/)
  })

  it('otherPerson is an involution', () => {
    expect(otherPerson(PERSON.P1)).toBe(PERSON.P2)
    expect(otherPerson(PERSON.P2)).toBe(PERSON.P1)
    expect(otherPerson(otherPerson(PERSON.P1))).toBe(PERSON.P1)
  })
})

describe('rowToEntry', () => {
  it('returns null for blank rows', () => {
    expect(rowToEntry([], 0)).toBeNull()
    expect(rowToEntry(['', '', '', '', '', '', '', '', '', '', '', ''], 0)).toBeNull()
    expect(rowToEntry(['   '], 0)).toBeNull()
    expect(rowToEntry(null, 0)).toBeNull()
    expect(rowToEntry(undefined, 0)).toBeNull()
    expect(rowToEntry('not a row', 0)).toBeNull()
  })

  it('returns null when the id is missing even if the rest is filled in', () => {
    const row = rawRow({ type: 'expense', date: '2026-03-09', payer: 'p1', amount: '42.10' })
    expect(rowToEntry(row, 0)).toBeNull()
  })

  it('returns null for an unparseable amount', () => {
    for (const amount of ['', 'abc', '4-2', '$', 'twelve', '1e3', '-42.10', '12,34.5']) {
      const row = rawRow({ id: 'x', type: 'expense', date: '2026-03-09', payer: 'p1', amount })
      expect(rowToEntry(row, 0)).toBeNull()
    }
  })

  it('accepts a zero amount as structurally valid (validateEntry is what rejects it)', () => {
    const row = rawRow({ id: 'x', amount: '0.00', date: '2026-03-09', payer: 'p1' })
    const entry = rowToEntry(row, 0)
    expect(entry.amountCents).toBe(0)
    expect(validateEntry(entry)).toContain('Amount must be greater than zero.')
  })

  it('sets rowNumber to FIRST_DATA_ROW + index', () => {
    for (const index of [0, 1, 5, 41, 999]) {
      const row = rawRow({ id: `id-${index}`, amount: '1.00' })
      expect(rowToEntry(row, index).rowNumber).toBe(FIRST_DATA_ROW + index)
    }
    expect(rowToEntry(rawRow({ id: 'a', amount: '1.00' }), 0).rowNumber).toBe(2)
  })

  it('tolerates short rows, because Sheets truncates trailing empty cells', () => {
    const entry = rowToEntry(['id-1', 'expense', '2026-03-09', 'p2', '42.10'], 0)
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

  it('drops a date that is not ISO-shaped instead of passing junk downstream', () => {
    for (const date of ['03/09/2026', '2026-3-9', 'yesterday', '']) {
      const entry = rowToEntry(rawRow({ id: 'x', amount: '1.00', date }), 0)
      expect(entry.date).toBe('')
    }
    expect(rowToEntry(rawRow({ id: 'x', amount: '1.00', date: '2026-03-09' }), 0).date).toBe(
      '2026-03-09',
    )
  })

  it('clamps an out-of-range payer_share into [0,1]', () => {
    const high = rowToEntry(rawRow({ id: 'x', amount: '1.00', payer_share: '5' }), 0)
    const low = rowToEntry(rawRow({ id: 'x', amount: '1.00', payer_share: '-3' }), 0)
    expect(high.payerShare).toBe(1)
    expect(low.payerShare).toBe(0)
  })

  it('defaults payer_share by type when the cell is blank or junk', () => {
    const expense = rowToEntry(rawRow({ id: 'x', amount: '1.00', type: 'expense' }), 0)
    const settlement = rowToEntry(rawRow({ id: 'y', amount: '1.00', type: 'settlement' }), 0)
    expect(expense.payerShare).toBe(EVEN_SHARE)
    expect(settlement.payerShare).toBe(0)
    expect(
      rowToEntry(rawRow({ id: 'z', amount: '1.00', type: 'expense', payer_share: 'huh' }), 0)
        .payerShare,
    ).toBe(EVEN_SHARE)
  })

  it('normalises unknown type and payer values to the safe defaults', () => {
    const entry = rowToEntry(rawRow({ id: 'x', amount: '1.00', type: 'REFUND', payer: 'p3' }), 0)
    expect(entry.type).toBe(ENTRY_TYPE.EXPENSE)
    expect(entry.payer).toBe(PERSON.P1)
  })

  it('normalises an empty deleted_at cell to null so isActive works', () => {
    const live = rowToEntry(rawRow({ id: 'x', amount: '1.00' }), 0)
    const dead = rowToEntry(rawRow({ id: 'y', amount: '1.00', deleted_at: NOW }), 0)
    expect(live.deletedAt).toBeNull()
    expect(isActive(live)).toBe(true)
    expect(dead.deletedAt).toBe(NOW)
    expect(isActive(dead)).toBe(false)
    expect(isActive(null)).toBe(false)
  })
})

describe('entryToRow', () => {
  it('always returns exactly 12 cells', () => {
    expect(entryToRow(fullEntry())).toHaveLength(12)
    expect(entryToRow(fullEntry({ description: '', category: '' }))).toHaveLength(12)
    expect(entryToRow(fullEntry({ amountCents: 0 }))).toHaveLength(12)
    expect(entryToRow(makeEntry({ id: 'bare' }, NOW))).toHaveLength(12)
    expect(entryToRow(fullEntry())).toHaveLength(EXPENSE_COLUMNS.length)
  })

  it('returns only strings, never null/undefined, so RAW writes are predictable', () => {
    const row = entryToRow(makeEntry({ id: 'bare' }, NOW))
    for (const cell of row) expect(typeof cell).toBe('string')
    expect(row.every((cell) => cell !== 'undefined' && cell !== 'null')).toBe(true)
  })

  it('refuses to write a non-integer amount instead of putting "NaN" in a cell', () => {
    expect(() => entryToRow({})).toThrow(TypeError)
    expect(() => entryToRow({ amountCents: NaN })).toThrow(TypeError)
    expect(() => entryToRow({ amountCents: 4.5 })).toThrow(TypeError)
  })

  it('writes an empty payer_share cell rather than the text "undefined" or "NaN"', () => {
    // Pre-stringifying this field once defeated the null guard in the map and
    // permanently polluted the cell, visible to anyone editing in Sheets.
    const share = EXPENSE_COLUMNS.indexOf('payer_share')
    for (const payerShare of [undefined, null, NaN, Infinity, 'half']) {
      const row = entryToRow({ ...fullEntry(), payerShare })
      expect(row[share]).toBe('')
    }
    expect(entryToRow(fullEntry({ payerShare: 0.5 }))[share]).toBe('0.5')
    expect(entryToRow(fullEntry({ payerShare: 0 }))[share]).toBe('0')
  })

  it('writes the amount as a plain re-parseable decimal string', () => {
    const row = entryToRow(fullEntry({ amountCents: 123456789 }))
    expect(row[EXPENSE_COLUMNS.indexOf('amount')]).toBe('1234567.89')
  })

  it('writes an empty string for a null deletedAt', () => {
    const row = entryToRow(fullEntry({ deletedAt: null }))
    expect(row[EXPENSE_COLUMNS.indexOf('deleted_at')]).toBe('')
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
      const restored = rowToEntry(entryToRow(entry), 0)
      expect(restored).toEqual(entry)
    })
  }

  it('is stable over a second trip through the sheet', () => {
    const once = entryToRow(fullEntry())
    const twice = entryToRow(rowToEntry(once, 0))
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
      expect(row[EXPENSE_COLUMNS.indexOf('description')]).toBe(description)
      expect(rowToEntry(row, 0).description).toBe(description)
    }
  })

  it('keeps a description that looks like another column value from bleeding across', () => {
    const entry = fullEntry({ description: 'p2, 99.99, settlement' })
    const restored = rowToEntry(entryToRow(entry), 0)
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

  it('defaults type, payer, currency, and deletedAt', () => {
    const entry = makeEntry({ id: 'a', payer: 'nonsense', type: 'nonsense' }, NOW)
    expect(entry.type).toBe(ENTRY_TYPE.EXPENSE)
    expect(entry.payer).toBe(PERSON.P1)
    expect(entry.currency).toBe('USD')
    expect(entry.deletedAt).toBeNull()
    expect(entry.amountCents).toBe(0)
  })
})

describe('validateEntry', () => {
  it('accepts a well-formed expense and settlement', () => {
    expect(validateEntry(fullEntry())).toEqual([])
    expect(
      validateEntry(fullEntry({ type: ENTRY_TYPE.SETTLEMENT, category: '', payerShare: 0 })),
    ).toEqual([])
  })

  it('rejects zero and negative amounts', () => {
    for (const amountCents of [0, -1, -4210]) {
      expect(validateEntry(fullEntry({ amountCents }))).toContain(
        'Amount must be greater than zero.',
      )
    }
  })

  it('rejects a non-integer or NaN amount', () => {
    for (const amountCents of [4.5, NaN, Infinity, '4210', null, undefined]) {
      expect(validateEntry(fullEntry({ amountCents }))).toContain(
        'Amount must be greater than zero.',
      )
    }
  })

  it('rejects a badly shaped date', () => {
    for (const date of ['', '2026-3-9', '03/09/2026', '9 March 2026', '2026-03-09T00:00:00Z']) {
      expect(validateEntry(fullEntry({ date }))).toContain('Date must be a real day, as YYYY-MM-DD.')
    }
  })

  it('rejects an ISO-shaped date that is not a real calendar day', () => {
    // These pass a shape-only regex but would produce a nonsense month key.
    for (const date of ['2026-02-31', '2026-13-45', '0000-00-00', '2026-04-31', '2025-02-29']) {
      expect(validateEntry(fullEntry({ date }))).toContain('Date must be a real day, as YYYY-MM-DD.')
    }
    expect(validateEntry(fullEntry({ date: '2024-02-29' }))).toEqual([]) // real leap day
  })

  it('rejects a payerShare that is a numeric string rather than a number', () => {
    // makeEntry coerces, so reaching validateEntry with a string means someone
    // bypassed it — and a string share must not slip through into the balance.
    expect(validateEntry({ ...fullEntry(), payerShare: '0.5' })).toContain(
      'Split must be between 0 and 100%.',
    )
  })

  it('rejects an out-of-range or non-numeric share', () => {
    for (const payerShare of [-0.01, 1.01, 2, -1, NaN]) {
      expect(validateEntry(fullEntry({ payerShare }))).toContain(
        'Split must be between 0 and 100%.',
      )
    }
    for (const payerShare of [0, 0.5, 1, 0.333]) {
      expect(validateEntry(fullEntry({ payerShare }))).not.toContain(
        'Split must be between 0 and 100%.',
      )
    }
  })

  it('sees the default share, not the omission, when payerShare is left out', () => {
    // makeEntry fills in the type-appropriate default, so an omitted share is
    // never itself a validation error.
    for (const payerShare of [undefined, null]) {
      expect(validateEntry(fullEntry({ payerShare }))).toEqual([])
    }
  })

  it('rejects an expense with no category, but not a settlement', () => {
    expect(validateEntry(fullEntry({ category: '' }))).toContain('Pick a category.')
    expect(
      validateEntry(fullEntry({ type: ENTRY_TYPE.SETTLEMENT, category: '', payerShare: 0 })),
    ).not.toContain('Pick a category.')
  })

  it('rejects a missing id and an unknown payer', () => {
    expect(validateEntry({ ...fullEntry(), id: '' })).toContain('Missing id.')
    expect(validateEntry({ ...fullEntry(), payer: 'p3' })).toContain(
      'Payer must be one of the two people.',
    )
  })

  it('reports every problem at once so the form can show them together', () => {
    const errors = validateEntry({
      id: '',
      type: ENTRY_TYPE.EXPENSE,
      date: 'nope',
      payer: 'p9',
      amountCents: -1,
      payerShare: 3,
      category: '',
    })
    expect(errors).toHaveLength(6)
  })
})
