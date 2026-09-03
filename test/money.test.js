import { describe, it, expect } from 'vitest'
import {
  parseAmountToYen,
  yenToSheetString,
  formatYen,
  formatYenParts,
  isShare,
  isYenAmount,
  parseShare,
  splitYen,
  sumYen,
} from '../src/lib/money.js'

describe('parseAmountToYen — formats a human actually types', () => {
  it('parses plain integers', () => {
    expect(parseAmountToYen('1250')).toBe(1250)
    expect(parseAmountToYen('0')).toBe(0)
    expect(parseAmountToYen('1')).toBe(1)
  })

  it('rounds a typed decimal half-up to the yen', () => {
    expect(parseAmountToYen('1250.4')).toBe(1250)
    expect(parseAmountToYen('1250.5')).toBe(1251)
    expect(parseAmountToYen('1250.49')).toBe(1250)
    // Only the FIRST decimal digit decides: 0.49 must not carry into 0.5.
    expect(parseAmountToYen('0.49')).toBe(0)
    expect(parseAmountToYen('0.5')).toBe(1)
  })

  it('reads the bank export’s six-decimal amounts as whole yen', () => {
    // Every amount in the statement CSV is written this way.
    expect(parseAmountToYen('1400.000000')).toBe(1400)
    expect(parseAmountToYen('100000.000000')).toBe(100000)
    expect(parseAmountToYen('311.000000')).toBe(311)
  })

  it('parses the sloppy shapes a phone keyboard produces', () => {
    expect(parseAmountToYen('.5')).toBe(1)
    expect(parseAmountToYen('.4')).toBe(0)
    expect(parseAmountToYen('1250.')).toBe(1250)
  })

  it('strips surrounding whitespace and currency symbols', () => {
    expect(parseAmountToYen(' ¥1250 ')).toBe(1250)
    // Fullwidth yen sign, which is what a Japanese keyboard produces.
    expect(parseAmountToYen('￥1250')).toBe(1250)
    expect(parseAmountToYen('$1250')).toBe(1250)
    expect(parseAmountToYen('1250 ¥')).toBe(1250)
  })

  /**
   * The comma rule has one definition for the whole app, at
   * `decimalSeparatorIndex`, and both readings of it decide what lands in the sheet
   * — so both are pinned here rather than left to the caller.
   */
  it('treats a comma before one or two digits as a decimal separator', () => {
    expect(parseAmountToYen('42,10')).toBe(42)
    expect(parseAmountToYen('42,50')).toBe(43)
    expect(parseAmountToYen('0,99')).toBe(1)
    expect(parseAmountToYen(',5')).toBe(1)
  })

  it('treats a comma before exactly three digits as a thousands separator', () => {
    expect(parseAmountToYen('1,234')).toBe(1234)
    expect(parseAmountToYen('1,234,567')).toBe(1234567)
  })

  it('takes the last separator as the decimal one when both kinds appear', () => {
    expect(parseAmountToYen('1,234.56')).toBe(1235)
    expect(parseAmountToYen('1.234,56')).toBe(1235)
    expect(parseAmountToYen('1.234,49')).toBe(1234)
  })

  it('returns null for malformed grouping rather than a plausible wrong number', () => {
    expect(parseAmountToYen('12,34,567')).toBeNull()
    expect(parseAmountToYen('1,2345,678')).toBeNull()
    expect(parseAmountToYen(',,5')).toBeNull()
  })

  it('returns null for junk and for anything that is not a string or number', () => {
    expect(parseAmountToYen('')).toBeNull()
    expect(parseAmountToYen('   ')).toBeNull()
    expect(parseAmountToYen('abc')).toBeNull()
    expect(parseAmountToYen('12a5')).toBeNull()
    expect(parseAmountToYen('.')).toBeNull()
    expect(parseAmountToYen(null)).toBeNull()
    expect(parseAmountToYen(undefined)).toBeNull()
    expect(parseAmountToYen({})).toBeNull()
    expect(parseAmountToYen([])).toBeNull()
  })

  it('refuses negatives — direction is the payer’s job, not the amount’s', () => {
    expect(parseAmountToYen('-1250')).toBeNull()
    // U+2212 MINUS SIGN, which an iOS keyboard can produce.
    expect(parseAmountToYen('−1250')).toBeNull()
    expect(parseAmountToYen(-1250)).toBeNull()
  })

  it('accepts a finite number but refuses exponential notation and non-finites', () => {
    expect(parseAmountToYen(1250)).toBe(1250)
    expect(parseAmountToYen(1250.5)).toBe(1251)
    expect(parseAmountToYen(1e21)).toBeNull()
    expect(parseAmountToYen(1e-7)).toBeNull()
    expect(parseAmountToYen(NaN)).toBeNull()
    expect(parseAmountToYen(Infinity)).toBeNull()
  })

  it('refuses magnitudes that would leave the safe integer range', () => {
    expect(parseAmountToYen('9999999999999')).toBe(9999999999999) // 13 digits, fine
    expect(parseAmountToYen('99999999999999')).toBeNull() // 14, refused
    // Leading zeros do not count towards the limit.
    expect(parseAmountToYen('0000000000000001')).toBe(1)
  })
})

describe('yenToSheetString', () => {
  it('writes digits alone — no separator, no grouping, no symbol', () => {
    expect(yenToSheetString(1250)).toBe('1250')
    expect(yenToSheetString(0)).toBe('0')
    expect(yenToSheetString(1234567)).toBe('1234567')
    expect(yenToSheetString(-1250)).toBe('-1250')
  })

  it('never emits a decimal point, a comma or a symbol', () => {
    for (const yen of [0, 1, 99, 1250, 1234567]) {
      expect(yenToSheetString(yen)).toMatch(/^-?\d+$/)
    }
  })

  it('throws rather than writing "NaN" into somebody’s ledger', () => {
    expect(() => yenToSheetString(12.5)).toThrow(TypeError)
    expect(() => yenToSheetString(NaN)).toThrow(TypeError)
    expect(() => yenToSheetString('1250')).toThrow(TypeError)
    expect(() => yenToSheetString(undefined)).toThrow(TypeError)
    expect(() => yenToSheetString(null)).toThrow(TypeError)
  })
})

describe('the sheet round trip is lossless', () => {
  it('recovers every amount written', () => {
    for (let yen = 0; yen <= 20000; yen += 37) {
      expect(parseAmountToYen(yenToSheetString(yen))).toBe(yen)
    }
  })
})

describe('splitYen — never loses or invents a yen', () => {
  const shares = [0, 0.5, 1, 0.333, 0.6667]
  const amounts = [0, 1, 3, 7, 99, 101, 4210, 123456789]

  /**
   * Conservation on its own cannot fail against the current implementation —
   * `otherYen` IS `yen - payerYen`, so the sum is an algebraic identity and a
   * `payerYen + 1` mutation passes. It is still worth asserting, because the
   * plausible rewrite is computing each side from its own share
   * (`Math.round(yen * (1 - share))`), which loses a yen on every odd amount.
   *
   * So the bound below is the half that can fail: the payer's own side, stated as a
   * property rather than restated as the formula. Anything further than half a yen
   * from the exact share is money moved by rounding.
   */
  it('sums back to the original amount, and lands within half a yen of the exact share', () => {
    for (const yen of amounts) {
      for (const share of shares) {
        const { payerYen, otherYen } = splitYen(yen, share)
        expect(payerYen + otherYen).toBe(yen)
        expect(Math.abs(payerYen - yen * share)).toBeLessThanOrEqual(0.5 + 1e-9)
      }
    }
  })

  it('holds both properties across an exhaustive small sweep', () => {
    for (let yen = 0; yen <= 200; yen += 1) {
      for (let share = 0; share <= 1.0001; share += 0.05) {
        const { payerYen, otherYen } = splitYen(yen, share)
        expect(payerYen + otherYen).toBe(yen)
        expect(Math.abs(payerYen - yen * Math.min(share, 1))).toBeLessThanOrEqual(0.5 + 1e-9)
      }
    }
  })

  it('gives everything to the payer at share 1 and nothing at share 0', () => {
    expect(splitYen(101, 1)).toEqual({ payerYen: 101, otherYen: 0 })
    expect(splitYen(101, 0)).toEqual({ payerYen: 0, otherYen: 101 })
  })

  it('rounds the payer up on an odd even split and hands the rest to the other', () => {
    // 3 yen, even split: payer 2, other 1 — documented remainder-to-other rule.
    expect(splitYen(3, 0.5)).toEqual({ payerYen: 2, otherYen: 1 })
    expect(splitYen(1, 0.5)).toEqual({ payerYen: 1, otherYen: 0 })
    expect(splitYen(7, 0.5)).toEqual({ payerYen: 4, otherYen: 3 })
    expect(splitYen(99, 0.5)).toEqual({ payerYen: 50, otherYen: 49 })
    expect(splitYen(1251, 0.5)).toEqual({ payerYen: 626, otherYen: 625 })
  })

  it('clamps out-of-range shares instead of producing nonsense', () => {
    expect(splitYen(100, 1.5)).toEqual({ payerYen: 100, otherYen: 0 })
    expect(splitYen(100, -2)).toEqual({ payerYen: 0, otherYen: 100 })
  })

  it('throws on non-integer yen or a non-finite share', () => {
    expect(() => splitYen(10.5, 0.5)).toThrow(TypeError)
    expect(() => splitYen(NaN, 0.5)).toThrow(TypeError)
    expect(() => splitYen(100, NaN)).toThrow(TypeError)
    expect(() => splitYen(100, Infinity)).toThrow(TypeError)
    expect(() => splitYen(100, '0.5')).toThrow(TypeError)
    expect(() => splitYen(100, null)).toThrow(TypeError)
  })

  it('handles negative amounts without breaking the invariant', () => {
    // The literals, not the `payerYen + otherYen === yen` identity: that one is algebra on
    // `otherYen: yen - payerYen` and a `payerYen + 1` mutation passes it. JS rounds -1.5
    // towards +Infinity, so the payer's half of -3 is -1 and the other person absorbs -2.
    expect(splitYen(-3, 0.5)).toEqual({ payerYen: -1, otherYen: -2 })
    expect(splitYen(-101, 0.8)).toEqual({ payerYen: -81, otherYen: -20 })
    expect(splitYen(-1, 1)).toEqual({ payerYen: -1, otherYen: 0 })
  })
})

/**
 * The one reading of a share a human typed, and the last thing between an unparseable
 * config cell and `splitYen`. Every case here is money: a share read wrong moves a real
 * figure on a real screen, and `null` is the only answer that lets the caller's own default
 * win instead.
 */
describe('parseShare', () => {
  it('reads a fraction as a fraction and anything above 1 as a percentage', () => {
    expect(parseShare('0.5')).toBe(0.5)
    expect(parseShare(0.8)).toBe(0.8)
    expect(parseShare('80')).toBe(0.8)
    expect(parseShare('1')).toBe(1)
    expect(parseShare('0')).toBe(0)
    // A spreadsheet is where people write the symbol too.
    expect(parseShare('80%')).toBe(0.8)
  })

  it('clamps a percentage that overshoots rather than refusing it', () => {
    // 150% is the payer covering all of it, not a refusal — and `2` is 2%, because the
    // above-1-is-a-percentage rule reads the NUMBER, not how it was typed.
    expect(parseShare('150')).toBe(1)
    expect(parseShare(2)).toBe(0.02)
    expect(parseShare('101')).toBe(1)
  })

  /**
   * REFUSED rather than truncated, which is what `parseFloat` would do: it reads '0,5' as
   * 0 — the payer covering nothing, so the other person owes all of every expense they pay
   * for — and '0.5x' as 0.5. A comma is read in exactly one place in this app, and it is
   * not here. Refusing hands the caller its own documented default instead.
   */
  it('refuses a value it cannot read whole, rather than reading part of one', () => {
    for (const bad of ['0,5', '0.5x', '0b1', '1e3', 'half', '', ' ', '-0.5', null, undefined, {}]) {
      expect(parseShare(bad), JSON.stringify(bad)).toBeNull()
    }
    expect(parseShare(NaN)).toBeNull()
    expect(parseShare(-1)).toBeNull()
  })

  it('tolerates the whitespace a cell carries', () => {
    expect(parseShare(' 0.5 ')).toBe(0.5)
    expect(parseShare(' 80 ')).toBe(0.8)
  })
})

describe('isYenAmount and isShare', () => {
  it('accept only a positive whole yen, and only a fraction in [0,1]', () => {
    expect(isYenAmount(1)).toBe(true)
    expect(isYenAmount(220000)).toBe(true)
    for (const bad of [0, -1, 1.5, NaN, Infinity, '100', null, undefined]) {
      expect(isYenAmount(bad), String(bad)).toBe(false)
    }

    for (const good of [0, 0.5, 1]) expect(isShare(good), String(good)).toBe(true)
    for (const bad of [-0.1, 1.1, NaN, Infinity, '0.5', null, undefined]) {
      expect(isShare(bad), String(bad)).toBe(false)
    }
  })
})

describe('sumYen', () => {
  it('sums integers and returns 0 for an empty list', () => {
    expect(sumYen([])).toBe(0)
    expect(sumYen([1, 2, 3])).toBe(6)
    expect(sumYen([4210, -4210])).toBe(0)
    expect(sumYen([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toBe(10)
  })

  it('throws on a non-array or a non-integer member instead of returning NaN', () => {
    expect(() => sumYen(null)).toThrow(TypeError)
    expect(() => sumYen(undefined)).toThrow(TypeError)
    expect(() => sumYen('123')).toThrow(TypeError)
    expect(() => sumYen([1, '2'])).toThrow(TypeError)
    expect(() => sumYen([1, NaN])).toThrow(TypeError)
    expect(() => sumYen([1, undefined])).toThrow(TypeError)
    expect(() => sumYen([1, 2.5])).toThrow(TypeError)
  })
})

describe('formatYen', () => {
  it('renders yen with grouping and no fractional part', () => {
    const en = formatYen(1250, { locale: 'en' })
    expect(en).toContain('1,250')
    // Assert the ABSENCE of a fraction rather than the symbol: `en` uses ¥ and `ja`
    // fullwidth ￥, and which one varies by ICU version.
    expect(en).not.toMatch(/[.,]\d{2}$/)

    const ja = formatYen(1250, { locale: 'ja' })
    expect(ja).toContain('1,250')
    expect(ja).not.toMatch(/[.,]\d{2}$/)
  })

  it('renders zero and large amounts', () => {
    expect(formatYen(0, { locale: 'en' })).toContain('0')
    expect(formatYen(1234567, { locale: 'en' })).toContain('1,234,567')
  })

  it('marks negatives', () => {
    const formatted = formatYen(-1250, { locale: 'en' })
    expect(formatted).toContain('1,250')
    expect(formatted).toMatch(/-|\(/)
  })

  it('respects the requested locale', () => {
    // de-DE groups with dots, so this fails if the locale is being ignored.
    expect(formatYen(1234567, { locale: 'de-DE' })).toContain('1.234.567')
  })

  it('throws on non-integer yen', () => {
    expect(() => formatYen(NaN)).toThrow(TypeError)
    expect(() => formatYen(1.5)).toThrow(TypeError)
    expect(() => formatYen('1250')).toThrow(TypeError)
    expect(() => formatYen(undefined)).toThrow(TypeError)
  })
})

describe('formatYenParts', () => {
  /**
   * `Header` styles the symbol apart from the digits and handles no other recessive
   * part, so "there is a currency part, an integer part, and nothing fractional" is
   * exactly the contract it depends on.
   */
  it('exposes a symbol and an integer, and never a fraction', () => {
    const types = formatYenParts(1250, { locale: 'en' }).map((part) => part.type)
    expect(types).toContain('currency')
    expect(types).toContain('integer')
    expect(types).not.toContain('decimal')
    expect(types).not.toContain('fraction')
  })

  it('composes back to the same string formatYen produces', () => {
    const parts = formatYenParts(1250, { locale: 'ja' })
    expect(parts.map((part) => part.value).join('')).toBe(formatYen(1250, { locale: 'ja' }))
  })

  it('throws on non-integer yen', () => {
    expect(() => formatYenParts(1.5)).toThrow(TypeError)
  })
})
