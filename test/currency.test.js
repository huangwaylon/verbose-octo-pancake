import { describe, expect, it } from 'vitest'

import {
  centsToSheetString,
  formatCents,
  formatCentsParts,
  minorDigits,
  parseAmountToCents,
  splitCents,
} from '../src/lib/money.js'
import { entryToRow, makeEntry, rowToEntry } from '../src/schema.js'

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

  it('answers 2 for unknown, empty and non-string input, which is what keeps legacy rows correct', () => {
    expect(minorDigits('NOTACURRENCY')).toBe(2)
    expect(minorDigits('')).toBe(2)
    expect(minorDigits(null)).toBe(2)
    expect(minorDigits(undefined)).toBe(2)
    expect(minorDigits(42)).toBe(2)
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

  it('keeps two decimals for ordinary currencies', () => {
    expect(centsToSheetString(4210, 'USD')).toBe('42.10')
    expect(centsToSheetString(4210)).toBe('42.10')
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

  it('leaves ordinary currencies exactly as before', () => {
    expect(formatCents(4210, 'USD', { locale: 'en' })).toBe('$42.10')
  })

  it('falls back readably for an unknown code', () => {
    expect(formatCents(4210, 'NOTACURRENCY')).toBe('42.10 NOTACURRENCY')
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

  it('conserves for every share across a sweep of yen amounts', () => {
    for (let amount = 0; amount < 5000; amount += 7) {
      for (const share of [0, 0.25, 1 / 3, 0.5, 0.75, 1]) {
        const { payerCents, otherCents } = splitCents(amount, share)
        expect(payerCents + otherCents).toBe(amount)
      }
    }
  })
})

describe('schema rows carry their own currency', () => {
  const row = (amount, currency) => [
    'id-1',
    'expense',
    '2026-08-05',
    amount,
    currency,
    'Groceries',
    '',
    '0.5',
    '',
    '',
    '',
  ]

  it('reads a JPY row as whole yen', () => {
    const entry = rowToEntry(row('1250', 'JPY'), 0, 'p1')
    expect(entry.amountCents).toBe(1250)
    expect(entry.currency).toBe('JPY')
  })

  it('reads a USD row as cents', () => {
    const entry = rowToEntry(row('42.10', 'USD'), 0, 'p1')
    expect(entry.amountCents).toBe(4210)
  })

  it('treats a blank currency cell as USD, which is what migrates old sheets', () => {
    const entry = rowToEntry(row('42.10', ''), 0, 'p1')
    expect(entry.amountCents).toBe(4210)
    expect(entry.currency).toBe('USD')
  })

  it('writes each row back at its own scale', () => {
    const jpy = makeEntry(
      { id: 'a', date: '2026-08-05', payer: 'p1', amountCents: 1250, currency: 'JPY', category: 'x' },
      '2026-08-05T00:00:00.000Z',
    )
    expect(entryToRow(jpy)[3]).toBe('1250')

    const usd = makeEntry(
      { id: 'b', date: '2026-08-05', payer: 'p1', amountCents: 4210, currency: 'USD', category: 'x' },
      '2026-08-05T00:00:00.000Z',
    )
    expect(entryToRow(usd)[3]).toBe('42.10')
  })

  it('survives a full row round trip in both scales', () => {
    for (const [amount, currency, expected] of [
      ['1250', 'JPY', 1250],
      ['42.10', 'USD', 4210],
      ['1.234', 'KWD', 1234],
    ]) {
      const entry = rowToEntry(row(amount, currency), 0, 'p1')
      expect(entry.amountCents).toBe(expected)
      expect(entryToRow(entry)[3]).toBe(amount)
    }
  })
})
