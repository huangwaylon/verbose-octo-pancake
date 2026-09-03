/**
 * Money as whole yen. Nothing here takes a currency: with one currency there is no scale to guess
 * and no 100x error to make. `parseAmountToYen` and `yenToSheetString` are exact inverses, so a
 * sheet round trip is lossless. Functions taking yen throw rather than propagate NaN into a
 * balance or a cell; only `parseAmountToYen`, which reads human input, returns null.
 */

import { cached } from './memo.js'

/** Whitespace (incl. NBSP / thin spaces) and any Unicode currency symbol. */
const NOISE = /[\s\u00a0\u202f\u2009]|\p{Sc}/gu

const NUMERIC_ONLY = /^[0-9.,]+$/
/** Largest integer part we will parse, to stay inside Number.MAX_SAFE_INTEGER. */
const MAX_INT_DIGITS = 13
/** A share, once a trailing '%' is off: digits with at most one dot, and nothing else. */
const SHARE_TEXT = /^\d*\.?\d+$/

function assertYen(yen, name = 'yen') {
  if (!Number.isInteger(yen)) {
    throw new TypeError(`${name} must be an integer number of yen, got ${String(yen)}`)
  }
  return yen
}

/**
 * Which separator, if any, is the decimal point. Both present: whichever comes last, so "1,234.56"
 * and "1.234,56" are both 1234.56. Commas only: decimal unless exactly three digits follow, which
 * is grouping — "42,10" is 42.10, "1,234" is 1234; the one ambiguous case, resolved towards
 * grouping because a decimal comma carries two digits of cents. Dots only: one dot is decimal,
 * repeated dots are grouping. Answers -1 for no separator.
 */
function decimalSeparatorIndex(s) {
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot < 0 && lastComma < 0) return -1

  const last = Math.max(lastDot, lastComma)
  const bothKinds = lastDot >= 0 && lastComma >= 0
  const digitsAfter = s.length - last - 1
  const sep = s[last]
  const repeated = sep === '.' ? s.indexOf('.') !== lastDot : s.indexOf(',') !== lastComma

  const groupingOnly = !bothKinds && digitsAfter === 3 && (sep === ',' || repeated)
  return groupingOnly ? -1 : last
}

/**
 * Parse whatever a human types on a phone into whole yen. Amounts are positive magnitudes;
 * direction is carried by the entry's `payer`. A decimal part is read rather than rejected,
 * because two things write one: habit, and the bank's CSV export, which prints every yen amount
 * as "1400.000000".
 *
 * @returns {number|null} whole yen; null — never NaN, never negative — for junk, malformed
 *   grouping or negative input
 */
export function parseAmountToYen(input) {
  let raw
  if (typeof input === 'string') {
    raw = input
  } else if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null
    raw = String(input)
    // Exponential notation ("1e-7", "1e+21") is not money.
    if (raw.includes('e') || raw.includes('E')) return null
  } else {
    return null
  }

  const cleaned = raw.replace(NOISE, '')
  if (!cleaned) return null

  // Any sign at all is a rejection for '-'; '+' is tolerated and dropped.
  if (cleaned[0] === '-' || cleaned[0] === '\u2212') return null
  const body = cleaned[0] === '+' ? cleaned.slice(1) : cleaned
  if (!NUMERIC_ONLY.test(body)) return null

  const decIndex = decimalSeparatorIndex(body)
  const intPart = decIndex < 0 ? body : body.slice(0, decIndex)
  const fracPart = decIndex < 0 ? '' : body.slice(decIndex + 1)

  if (!/^\d*$/.test(fracPart)) return null

  // Grouping: first group free-form, every later group exactly 3 digits.
  const groups = intPart.length ? intPart.split(/[.,]/) : []
  if (groups.length > 1 && groups[0] === '') return null
  for (let i = 0; i < groups.length; i += 1) {
    const ok = i === 0 ? /^\d*$/.test(groups[i]) : /^\d{3}$/.test(groups[i])
    if (!ok) return null
  }

  const intDigits = groups.join('')
  if (!intDigits.length && !fracPart.length) return null
  if (intDigits.replace(/^0+/, '').length > MAX_INT_DIGITS) return null

  // Half-up on the first decimal digit, in digit arithmetic rather than floats so it is exact.
  let yen = Number(intDigits || '0')
  if (Number(fracPart[0] ?? '0') >= 5) yen += 1

  return Number.isSafeInteger(yen) ? yen : null
}

/** Whole yen -> a sheet cell: digits alone, so it is locale-independent and re-parseable. */
export function yenToSheetString(yen) {
  return String(assertYen(yen))
}

/**
 * Formatters keyed by locale alone — the currency and its zero fraction digits are fixed.
 * Constructing an `Intl.NumberFormat` costs an order of magnitude more than reusing one, and a
 * month's ledger asks for one per amount on screen.
 */
const FORMATTERS = new Map()

function formatterFor(locale) {
  return cached(
    FORMATTERS,
    locale ?? '',
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'JPY',
        // Stated rather than left to ICU: what a person reads must not vary with the ICU version.
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
  )
}

/** Whole yen -> "¥1,250", with locale grouping. Never write this back to the sheet. */
export function formatYen(yen, { locale } = {}) {
  return formatterFor(locale).format(assertYen(yen))
}

/**
 * `formatYen` as `formatToParts`, so the hero figure can style the symbol apart from the digits.
 * Render the parts in the order Intl returns them — `en`/`ja` put the symbol before, `fr-FR` after.
 */
export function formatYenParts(yen, { locale } = {}) {
  return formatterFor(locale).formatToParts(assertYen(yen))
}

/** The one reading of a usable amount and of a usable share, so two validators cannot drift. */
export function isYenAmount(value) {
  return Number.isInteger(value) && value > 0
}

export function isShare(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

/**
 * Read a share — a `payer_share` cell, or a `default_split_p*` row — into a fraction in [0,1].
 * Anything above 1 is a percentage, and a trailing `%` is accepted, because a spreadsheet is where
 * people write 50 rather than 0.5; with two readings of that rule the same `50` would mean "half"
 * in the config tab and "the payer covers all of it" in `payer_share`. The WHOLE string has to be a
 * number, hence not `parseFloat`: that reads `'0,5'` as 0 — the payer covering nothing.
 *
 * @returns {number|null} null for junk, so the caller's default wins rather than NaN reaching
 *   `splitYen`
 */
export function parseShare(value) {
  let raw
  if (typeof value === 'number') {
    raw = value
  } else if (typeof value === 'string') {
    const text = value.trim().replace(/%$/, '')
    if (!SHARE_TEXT.test(text)) return null
    raw = Number(text)
  } else {
    return null
  }
  if (!Number.isFinite(raw) || raw < 0) return null
  const fraction = raw > 1 ? raw / 100 : raw
  return Math.min(1, Math.max(0, fraction))
}

/**
 * Split an amount between the payer and the other person. The payer's portion is rounded half-up
 * and the OTHER person absorbs the remainder, so `payerYen + otherYen === yen` exactly: a shared
 * expense can never lose or invent a yen. A `payerShare` outside [0,1] is clamped.
 */
export function splitYen(yen, payerShare) {
  assertYen(yen)
  if (!Number.isFinite(payerShare)) {
    throw new TypeError(`payerShare must be a finite number, got ${String(payerShare)}`)
  }
  const share = Math.min(1, Math.max(0, payerShare))
  const payerYen = Math.round(yen * share)
  return { payerYen, otherYen: yen - payerYen }
}

/** Sum whole yen. Empty list -> 0. */
export function sumYen(list) {
  if (!Array.isArray(list)) {
    throw new TypeError(`sumYen expects an array, got ${String(list)}`)
  }
  let total = 0
  for (let i = 0; i < list.length; i += 1) {
    total += assertYen(list[i], `sumYen[${i}]`)
  }
  if (!Number.isSafeInteger(total)) {
    throw new RangeError('sumYen overflowed the safe integer range')
  }
  return total
}
