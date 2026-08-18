import { describe, expect, it } from 'vitest'

import {
  centsToSheetString,
  formatCents,
  formatCentsParts,
  minorDigits,
  normalizeCurrency,
  parseAmountToCents,
  splitCents,
} from '../src/lib/money.js'
import { entryToRow, columnIndex, rowToEntry } from '../src/schema.js'
import { expense, row as rawRow } from './support/entries.js'

/**
 * Zero- and three-decimal currency support.
 *
 * The interesting property is that the arithmetic helpers need no special case:
 * once the internal integer is "whole yen" rather than "hundredths of a yen",
 * `splitCents` conserves units for free. Everything here guards the *boundary* —
 * the three functions that convert between a string and that integer.
 */

describe('minorDigits', () => {
  it('reports 0 for zero-decimal currencies', () => {
    for (const code of ['JPY', 'KRW', 'VND', 'ISK', 'CLP', 'XOF']) {
      expect(minorDigits(code)).toBe(0)
    }
  })

  it('reports 3 for the three-decimal currencies', () => {
    for (const code of ['KWD', 'BHD', 'JOD', 'OMR', 'TND']) {
      expect(minorDigits(code)).toBe(3)
    }
  })

  it('reports 2 for ordinary currencies', () => {
    for (const code of ['USD', 'EUR', 'GBP', 'CAD']) {
      expect(minorDigits(code)).toBe(2)
    }
  })

  it('is case- and whitespace-insensitive', () => {
    expect(minorDigits('jpy')).toBe(0)
    expect(minorDigits(' JPY ')).toBe(0)
  })

  it('answers 2 for unknown, empty and non-string input rather than throwing', () => {
    // The code comes from a hand-edited config cell, so it can be anything at
    // all; the ISO 4217 default keeps the boundary usable.
    expect(minorDigits('NOTACURRENCY')).toBe(2)
    expect(minorDigits('')).toBe(2)
    expect(minorDigits(null)).toBe(2)
    expect(minorDigits(undefined)).toBe(2)
    expect(minorDigits(42)).toBe(2)
  })
})

describe('normalizeCurrency', () => {
  it('folds case and padding to one spelling', () => {
    expect(normalizeCurrency(' jpy ')).toBe('JPY')
    expect(normalizeCurrency('Usd')).toBe('USD')
    expect(normalizeCurrency('KWD')).toBe('KWD')
  })

  it('rejects anything that is not a three-letter code', () => {
    // Because two codes are compared with `!==` downstream. An unnormalised code
    // is not a rendering problem, it is a mixed-currency warning that never clears
    // over totals that are homogeneous.
    for (const value of ['JP', 'YENS', '¥', '1PY', 'JP¥', '', ' ', null, undefined, 42, {}]) {
      expect(normalizeCurrency(value)).toBe('')
    }
  })
})

describe('parsing a zero-decimal currency', () => {
  it('treats the whole number as minor units', () => {
    expect(parseAmountToCents('1250', 'JPY')).toBe(1250)
  })

  it('rounds half-up at the first decimal, since there is no sub-yen', () => {
    expect(parseAmountToCents('1250.5', 'JPY')).toBe(1251)
    expect(parseAmountToCents('1250.4', 'JPY')).toBe(1250)
    expect(parseAmountToCents('0.5', 'JPY')).toBe(1)
    expect(parseAmountToCents('0.4', 'JPY')).toBe(0)
  })

  it('strips grouping and either yen sign', () => {
    expect(parseAmountToCents('1,250', 'JPY')).toBe(1250)
    expect(parseAmountToCents('¥1,250', 'JPY')).toBe(1250)
    expect(parseAmountToCents('￥1,250', 'JPY')).toBe(1250)
    expect(parseAmountToCents(' 1 250 ', 'JPY')).toBe(1250)
  })

  it('still rejects what it rejects for USD', () => {
    expect(parseAmountToCents('-1250', 'JPY')).toBeNull()
    expect(parseAmountToCents('abc', 'JPY')).toBeNull()
    expect(parseAmountToCents('', 'JPY')).toBeNull()
  })
})

describe('parsing a three-decimal currency', () => {
  it('scales by 1000 and rounds at the fourth decimal', () => {
    expect(parseAmountToCents('1.234', 'KWD')).toBe(1234)
    expect(parseAmountToCents('1.2345', 'KWD')).toBe(1235)
    expect(parseAmountToCents('1', 'KWD')).toBe(1000)
  })

  it('returns null rather than an unsafe integer for an absurd amount', () => {
    expect(parseAmountToCents('99999999999999.999', 'KWD')).toBeNull()
  })
})

describe('writing to the sheet', () => {
  it('writes a zero-decimal amount with no decimal point at all', () => {
    expect(centsToSheetString(1250, 'JPY')).toBe('1250')
    expect(centsToSheetString(0, 'JPY')).toBe('0')
    expect(centsToSheetString(-1250, 'JPY')).toBe('-1250')
  })

  it('writes three decimals for a three-decimal currency', () => {
    expect(centsToSheetString(1234, 'KWD')).toBe('1.234')
    expect(centsToSheetString(4, 'KWD')).toBe('0.004')
  })

  it('round-trips losslessly through parse for every supported scale', () => {
    for (const code of ['USD', 'JPY', 'KWD', 'EUR']) {
      for (let minor = 0; minor <= 20000; minor += 37) {
        expect(parseAmountToCents(centsToSheetString(minor, code), code)).toBe(minor)
      }
    }
  })

  it('decodes to the WRONG number when given the wrong currency', () => {
    // Executable documentation of the schema hazard: a stored "1250" is ¥1250 or
    // $12.50 depending entirely on the row's currency cell, so rowToEntry must
    // read that cell before the amount.
    expect(parseAmountToCents(centsToSheetString(1250, 'JPY'), 'USD')).toBe(125000)
  })
})

describe('formatting', () => {
  it('renders yen with no fractional part', () => {
    const en = formatCents(1250, 'JPY', { locale: 'en' })
    expect(en).toContain('1,250')
    // Assert the ABSENCE of a fraction rather than the symbol: en uses ¥ and ja
    // uses fullwidth ￥, and that varies by ICU version.
    expect(en).not.toMatch(/[.,]\d{2}$/)

    const ja = formatCents(1250, 'JPY', { locale: 'ja' })
    expect(ja).toContain('1,250')
    expect(ja).not.toMatch(/[.,]\d{2}$/)
  })

  it('exposes parts with no fraction for a zero-decimal currency', () => {
    const parts = formatCentsParts(1250, 'JPY', { locale: 'en' })
    const types = parts.map((part) => part.type)
    expect(types).toContain('currency')
    expect(types).toContain('integer')
    expect(types).not.toContain('decimal')
    expect(types).not.toContain('fraction')
  })

  it('exposes a fraction for a two-decimal currency', () => {
    const types = formatCentsParts(4210, 'USD', { locale: 'en' }).map((part) => part.type)
    expect(types).toContain('fraction')
  })

  it('returns null for an unknown code so the caller can fall back', () => {
    expect(formatCentsParts(4210, 'NOTACURRENCY')).toBeNull()
  })
})

describe('splitting whole yen', () => {
  it('conserves every yen on an odd amount', () => {
    expect(splitCents(1251, 0.5)).toEqual({ payerCents: 626, otherCents: 625 })
  })
})

describe('schema rows carry their own currency', () => {
  // The amount and the currency are the two cells every case here is about, so they
  // are the two the fixture takes. Built by field NAME through the shared helper: as
  // eleven positional cells, which is what this was, a twelfth column would leave
  // every value one field to the left with every assertion below still passing.
  const row = (amount, currency) =>
    rawRow({
      id: 'id-1',
      type: 'expense',
      date: '2026-08-05',
      amount,
      currency,
      category: 'Groceries',
      payer_share: '0.5',
    })

  it('reads a JPY row as whole yen', () => {
    const entry = rowToEntry(row('1250', 'JPY'), 'p1', 'JPY')
    expect(entry.amountCents).toBe(1250)
    expect(entry.currency).toBe('JPY')
  })

  it('reads a USD row as cents', () => {
    const entry = rowToEntry(row('42.10', 'USD'), 'p1', 'USD')
    expect(entry.amountCents).toBe(4210)
  })

  it('decodes a blank currency cell at the sheet currency it was passed', () => {
    // A row somebody typed straight into Sheets has no currency cell, and the
    // same text is a hundred times apart on the two sheets: ¥1250 or $1250.00.
    const jpy = rowToEntry(row('1250', ''), 'p1', 'JPY')
    expect(jpy.amountCents).toBe(1250)
    expect(jpy.currency).toBe('JPY')

    const usd = rowToEntry(row('1250', ''), 'p1', 'USD')
    expect(usd.amountCents).toBe(125000)
    expect(usd.currency).toBe('USD')
  })

  it('normalises a row’s currency cell, so one lowercase cell is not a second currency', () => {
    const entry = rowToEntry(row('1250', ' jpy '), 'p1', 'JPY')
    expect(entry.currency).toBe('JPY')
    expect(entry.amountCents).toBe(1250)
  })

  it('falls back to the sheet currency for a cell that is not a code at all', () => {
    // 'JP' would otherwise be carried onto the entry, read as 2 minor digits, and
    // then flagged as a different currency from the sheet's forever.
    const entry = rowToEntry(row('1250', 'JP'), 'p1', 'JPY')
    expect(entry.currency).toBe('JPY')
    expect(entry.amountCents).toBe(1250)
  })

  it("lets a row's own currency beat the sheet's, so a mixed sheet stays correct", () => {
    const entry = rowToEntry(row('42.10', 'USD'), 'p1', 'JPY')
    expect(entry.amountCents).toBe(4210)
    expect(entry.currency).toBe('USD')
  })

  it('writes each row back at its own scale', () => {
    // The same 1250 at two scales is the whole case, so both amounts and both codes
    // stay here; everything else about the entry is the shared fixture's.
    const jpy = expense({ id: 'a', amountCents: 1250, currency: 'JPY' })
    // `columnIndex('amount')`, not a literal 3: this is an INPUT to the assertion
    // rather than the thing under test, so a column added before `amount` must move it.
    expect(entryToRow(jpy)[columnIndex('amount')]).toBe('1250')

    const usd = expense({ id: 'b', amountCents: 4210, currency: 'USD' })
    expect(entryToRow(usd)[columnIndex('amount')]).toBe('42.10')
  })

  it('survives a full row round trip in both scales', () => {
    for (const [amount, currency, expected] of [
      ['1250', 'JPY', 1250],
      ['42.10', 'USD', 4210],
      ['1.234', 'KWD', 1234],
    ]) {
      const entry = rowToEntry(row(amount, currency), 'p1', currency)
      expect(entry.amountCents).toBe(expected)
      expect(entryToRow(entry)[columnIndex('amount')]).toBe(amount)
    }
  })
})
