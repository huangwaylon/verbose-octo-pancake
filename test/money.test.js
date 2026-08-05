import { describe, it, expect } from 'vitest'
import {
  parseAmountToCents,
  centsToSheetString,
  formatCents,
  splitCents,
  sumCents,
} from '../src/lib/money.js'

describe('parseAmountToCents — formats a human actually types', () => {
  it('parses plain integers and decimals', () => {
    expect(parseAmountToCents('42', 'USD')).toBe(4200)
    expect(parseAmountToCents('42.10', 'USD')).toBe(4210)
    expect(parseAmountToCents('0', 'USD')).toBe(0)
    expect(parseAmountToCents('0.00', 'USD')).toBe(0)
    expect(parseAmountToCents('0.01', 'USD')).toBe(1)
  })

  it('parses the sloppy shapes a phone keyboard produces', () => {
    expect(parseAmountToCents('.5', 'USD')).toBe(50)
    expect(parseAmountToCents('42.', 'USD')).toBe(4200)
    expect(parseAmountToCents('.05', 'USD')).toBe(5)
    expect(parseAmountToCents('.5', 'USD')).toBe(parseAmountToCents('0.50', 'USD'))
  })

  it('strips surrounding whitespace and currency symbols', () => {
    expect(parseAmountToCents(' $42.10 ', 'USD')).toBe(4210)
    expect(parseAmountToCents('€42,10', 'USD')).toBe(4210)
    expect(parseAmountToCents('£1,234.56', 'USD')).toBe(123456)
    expect(parseAmountToCents(' 42.10 ', 'USD')).toBe(4210)
    expect(parseAmountToCents('42.10 $', 'USD')).toBe(4210)
  })

  it('treats a comma before one or two digits as a decimal separator', () => {
    expect(parseAmountToCents('42,10', 'USD')).toBe(4210)
    expect(parseAmountToCents('42,1', 'USD')).toBe(4210)
    expect(parseAmountToCents('0,99', 'USD')).toBe(99)
    expect(parseAmountToCents(',5', 'USD')).toBe(50)
  })

  it('treats a comma before exactly three digits as a thousands separator', () => {
    expect(parseAmountToCents('1,234', 'USD')).toBe(123400)
    expect(parseAmountToCents('1,234,567', 'USD')).toBe(123456700)
    expect(parseAmountToCents('12,345', 'USD')).toBe(1234500)
  })

  it('lets the last separator win when both . and , appear', () => {
    // US style
    expect(parseAmountToCents('1,234.56', 'USD')).toBe(123456)
    // European style — same amount
    expect(parseAmountToCents('1.234,56', 'USD')).toBe(123456)
    expect(parseAmountToCents('1,234.56', 'USD')).toBe(parseAmountToCents('1.234,56', 'USD'))
    // French style, space grouping
    expect(parseAmountToCents('1 234,56', 'USD')).toBe(123456)
    expect(parseAmountToCents('1.234.567,89', 'USD')).toBe(123456789)
    expect(parseAmountToCents('1,234,567.89', 'USD')).toBe(123456789)
  })

  it('reads a lone dot as a decimal point even before three digits', () => {
    // "1.234" is a US decimal, so it must round to 1.23 and NOT become 1234.
    expect(parseAmountToCents('1.234', 'USD')).toBe(123)
    // Repeated dots can only be grouping.
    expect(parseAmountToCents('1.234.567', 'USD')).toBe(123456700)
  })

  it('rounds half-up at the third decimal without float error', () => {
    expect(parseAmountToCents('1.005', 'USD')).toBe(101)
    expect(parseAmountToCents('1.004', 'USD')).toBe(100)
    expect(parseAmountToCents('1.0049', 'USD')).toBe(100)
    expect(parseAmountToCents('1.0051', 'USD')).toBe(101)
    expect(parseAmountToCents('0.005', 'USD')).toBe(1)
    expect(parseAmountToCents('0.004', 'USD')).toBe(0)
    expect(parseAmountToCents('1.995', 'USD')).toBe(200)
    expect(parseAmountToCents('0.999', 'USD')).toBe(100)
    expect(parseAmountToCents('9.999', 'USD')).toBe(1000)
  })

  it('beats naive float rounding, which loses a cent on these', () => {
    // Math.round(x * 100) rounds DOWN here because the double nearest to the
    // decimal is just below the .xx5 midpoint. Half-up must round up.
    for (const [text, cents] of [
      ['1.005', 101],
      ['0.145', 15],
      ['0.285', 29],
      ['0.575', 58],
      ['1.255', 126],
    ]) {
      expect(Math.round(Number(text) * 100)).toBe(cents - 1)
      expect(parseAmountToCents(text, 'USD')).toBe(cents)
    }
  })

  it('returns null for empty and non-string input', () => {
    for (const bad of ['', '   ', null, undefined, {}, [], true, false, NaN, Infinity, -Infinity]) {
      expect(parseAmountToCents(bad, 'USD')).toBeNull()
    }
  })

  it('returns null for junk that merely contains digits', () => {
    for (const bad of [
      'abc',
      '42abc',
      'abc42',
      '4-2',
      '1e3',
      '1E3',
      '$',
      '.',
      ',',
      '..',
      '--5',
      'NaN',
      'Infinity',
      '4/2',
      '1_000',
      '=42',
      '42%',
    ]) {
      expect(parseAmountToCents(bad, 'USD')).toBeNull()
    }
  })

  it('returns null for malformed grouping instead of guessing', () => {
    for (const bad of ['12,34.5', '1,2,3', '1,,234', ',234', '1,23,456', '12.34.5']) {
      expect(parseAmountToCents(bad, 'USD')).toBeNull()
    }
  })

  it('returns null for negatives — direction lives on the payer, not the amount', () => {
    for (const bad of ['-1', '-0.01', '-42.10', ' -$42.10 ', '−42.10', '(42.10)', -5, -0.5]) {
      expect(parseAmountToCents(bad, 'USD')).toBeNull()
    }
  })

  it('accepts finite numbers as well as strings', () => {
    expect(parseAmountToCents(42, 'USD')).toBe(4200)
    expect(parseAmountToCents(42.1, 'USD')).toBe(4210)
    expect(parseAmountToCents(0, 'USD')).toBe(0)
    expect(parseAmountToCents(0.1 + 0.2, 'USD')).toBe(30)
  })

  it('refuses absurd magnitudes rather than returning an unsafe integer', () => {
    expect(parseAmountToCents('99999999999999999999', 'USD')).toBeNull()
    expect(parseAmountToCents('1e21', 'USD')).toBeNull()
    // ...but a realistically large amount still parses exactly.
    expect(parseAmountToCents('9999999999.99', 'USD')).toBe(999999999999)
    expect(Number.isSafeInteger(parseAmountToCents('9999999999.99', 'USD'))).toBe(true)
  })

  it('never returns NaN', () => {
    for (const input of ['abc', '', '.', ',', '1,2,3', null, {}]) {
      const result = parseAmountToCents(input, 'USD')
      expect(Number.isNaN(result)).toBe(false)
      expect(result).toBeNull()
    }
  })
})

describe('centsToSheetString', () => {
  it('writes a locale-independent fixed-2-decimal string', () => {
    expect(centsToSheetString(4210, 'USD')).toBe('42.10')
    expect(centsToSheetString(0, 'USD')).toBe('0.00')
    expect(centsToSheetString(1, 'USD')).toBe('0.01')
    expect(centsToSheetString(99, 'USD')).toBe('0.99')
    expect(centsToSheetString(100, 'USD')).toBe('1.00')
    expect(centsToSheetString(123456789, 'USD')).toBe('1234567.89')
  })

  it('handles negatives', () => {
    expect(centsToSheetString(-1, 'USD')).toBe('-0.01')
    expect(centsToSheetString(-4210, 'USD')).toBe('-42.10')
    expect(centsToSheetString(-100, 'USD')).toBe('-1.00')
  })

  it('never emits a currency symbol, grouping, or a comma', () => {
    for (const cents of [0, 1, 999, 100000, 123456789]) {
      const s = centsToSheetString(cents, 'USD')
      expect(s).not.toMatch(/[,$€£\s]/)
      expect(s).toMatch(/^-?\d+\.\d{2}$/)
    }
  })

  it('throws rather than emitting "NaN" into a sheet cell', () => {
    for (const bad of [NaN, Infinity, -Infinity, 4.5, '4210', null, undefined]) {
      expect(() => centsToSheetString(bad, 'USD')).toThrow(TypeError)
    }
  })
})

describe('centsToSheetString <-> parseAmountToCents round trip', () => {
  it('round-trips every representative value', () => {
    for (const cents of [0, 1, 5, 99, 100, 101, 999, 1000, 4210, 100000, 123456789]) {
      expect(parseAmountToCents(centsToSheetString(cents, 'USD'), 'USD')).toBe(cents)
    }
  })

  it('round-trips a wide sweep of values', () => {
    for (let cents = 0; cents < 2000; cents += 7) {
      expect(parseAmountToCents(centsToSheetString(cents, 'USD'), 'USD')).toBe(cents)
    }
    for (let cents = 999900; cents < 1000100; cents += 13) {
      expect(parseAmountToCents(centsToSheetString(cents, 'USD'), 'USD')).toBe(cents)
    }
  })

  it('is idempotent under a second write, as a sheet read-modify-write would be', () => {
    for (const cents of [1, 99, 4210, 123456789]) {
      const once = centsToSheetString(cents, 'USD')
      const twice = centsToSheetString(parseAmountToCents(once, 'USD'), 'USD')
      expect(twice).toBe(once)
    }
  })
})

describe('splitCents — never loses or invents a penny', () => {
  const shares = [0, 0.5, 1, 0.333, 0.6667]
  const amounts = [0, 1, 3, 7, 99, 101, 4210, 123456789]

  it('always sums back to the original amount', () => {
    for (const cents of amounts) {
      for (const share of shares) {
        const { payerCents, otherCents } = splitCents(cents, share)
        expect(payerCents + otherCents).toBe(cents)
        expect(Number.isInteger(payerCents)).toBe(true)
        expect(Number.isInteger(otherCents)).toBe(true)
      }
    }
  })

  it('sums back to the original amount across an exhaustive small sweep', () => {
    for (let cents = 0; cents <= 200; cents += 1) {
      for (let share = 0; share <= 1.0001; share += 0.05) {
        const { payerCents, otherCents } = splitCents(cents, share)
        expect(payerCents + otherCents).toBe(cents)
      }
    }
  })

  it('gives everything to the payer at share 1 and nothing at share 0', () => {
    expect(splitCents(101, 1)).toEqual({ payerCents: 101, otherCents: 0 })
    expect(splitCents(101, 0)).toEqual({ payerCents: 0, otherCents: 101 })
  })

  it('rounds the payer up on an odd even split and hands the rest to the other', () => {
    // 3 cents, even split: payer 2, other 1 — documented remainder-to-other rule.
    expect(splitCents(3, 0.5)).toEqual({ payerCents: 2, otherCents: 1 })
    expect(splitCents(1, 0.5)).toEqual({ payerCents: 1, otherCents: 0 })
    expect(splitCents(7, 0.5)).toEqual({ payerCents: 4, otherCents: 3 })
    expect(splitCents(99, 0.5)).toEqual({ payerCents: 50, otherCents: 49 })
  })

  it('clamps out-of-range shares instead of producing nonsense', () => {
    expect(splitCents(100, 1.5)).toEqual({ payerCents: 100, otherCents: 0 })
    expect(splitCents(100, -2)).toEqual({ payerCents: 0, otherCents: 100 })
  })

  it('throws on non-integer cents or a non-finite share', () => {
    expect(() => splitCents(10.5, 0.5)).toThrow(TypeError)
    expect(() => splitCents(NaN, 0.5)).toThrow(TypeError)
    expect(() => splitCents(100, NaN)).toThrow(TypeError)
    expect(() => splitCents(100, Infinity)).toThrow(TypeError)
    expect(() => splitCents(100, '0.5')).toThrow(TypeError)
    expect(() => splitCents(100, null)).toThrow(TypeError)
  })

  it('handles negative amounts without breaking the invariant', () => {
    for (const cents of [-1, -3, -101]) {
      for (const share of shares) {
        const { payerCents, otherCents } = splitCents(cents, share)
        expect(payerCents + otherCents).toBe(cents)
      }
    }
  })
})

describe('sumCents', () => {
  it('sums integers and returns 0 for an empty list', () => {
    expect(sumCents([])).toBe(0)
    expect(sumCents([1, 2, 3])).toBe(6)
    expect(sumCents([4210, -4210])).toBe(0)
    expect(sumCents([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toBe(10)
  })

  it('does not accumulate float error the way summing dollars would', () => {
    const tenCents = new Array(10).fill(10)
    expect(sumCents(tenCents)).toBe(100)
    // The float equivalent does not even equal itself exactly.
    expect(new Array(10).fill(0.1).reduce((a, b) => a + b, 0)).not.toBe(1)
  })

  it('throws on a non-array or a non-integer member instead of returning NaN', () => {
    expect(() => sumCents(null)).toThrow(TypeError)
    expect(() => sumCents(undefined)).toThrow(TypeError)
    expect(() => sumCents('123')).toThrow(TypeError)
    expect(() => sumCents([1, '2'])).toThrow(TypeError)
    expect(() => sumCents([1, NaN])).toThrow(TypeError)
    expect(() => sumCents([1, undefined])).toThrow(TypeError)
    expect(() => sumCents([1, 2.5])).toThrow(TypeError)
  })
})

describe('formatCents', () => {
  it('formats with a currency symbol and cents by default', () => {
    expect(formatCents(4210, 'USD', { locale: 'en-US' })).toBe('$42.10')
    expect(formatCents(0, 'USD', { locale: 'en-US' })).toBe('$0.00')
    expect(formatCents(4200, 'USD', { locale: 'en-US' })).toBe('$42.00')
    expect(formatCents(123456789, 'USD', { locale: 'en-US' })).toBe('$1,234,567.89')
  })

  it('can trim the ".00" tail on whole amounts for narrow screens', () => {
    expect(formatCents(4200, 'USD', { locale: 'en-US', trimZeroCents: true })).toBe('$42')
    // A non-whole amount keeps its cents even with the option on.
    expect(formatCents(4210, 'USD', { locale: 'en-US', trimZeroCents: true })).toBe('$42.10')
  })

  it('marks negatives', () => {
    const formatted = formatCents(-4210, 'USD', { locale: 'en-US' })
    expect(formatted).toContain('42.10')
    expect(formatted).toMatch(/-|\(/)
  })

  it('respects the requested locale and currency', () => {
    const eur = formatCents(123456, 'EUR', { locale: 'de-DE' })
    expect(eur).toContain('€')
    expect(eur).toContain('1.234,56')
  })

  it('falls back to a plain string rather than throwing on a bad currency code', () => {
    expect(formatCents(4210, 'NOTACURRENCY')).toBe('42.10 NOTACURRENCY')
    expect(formatCents(4210, '')).toContain('42.10')
    expect(formatCents(4210, null)).toContain('42.10')
  })

  it('throws on non-integer cents', () => {
    expect(() => formatCents(NaN, 'USD')).toThrow(TypeError)
    expect(() => formatCents(1.5, 'USD')).toThrow(TypeError)
    expect(() => formatCents('4210', 'USD')).toThrow(TypeError)
    expect(() => formatCents(undefined, 'USD')).toThrow(TypeError)
  })

  it('is never used for sheet values — its output is not re-parseable as a bare amount', () => {
    // Guards against someone swapping formatCents in for centsToSheetString.
    expect(formatCents(123456789, 'USD', { locale: 'en-US' })).not.toBe(
      centsToSheetString(123456789, 'USD'),
    )
  })
})

describe('a caller that forgets the currency', () => {
  // Passing the currency is the contract, but a display path that misses it must
  // degrade to the two-decimal default rather than take the render down with it.
  it('still writes and formats an amount instead of throwing', () => {
    expect(centsToSheetString(4210)).toBe('42.10')
    expect(() => formatCents(4210)).not.toThrow()
    expect(formatCents(4210)).toContain('42.10')
  })
})
