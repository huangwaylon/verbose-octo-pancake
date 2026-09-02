/**
 * Money as whole yen.
 *
 * The ledger is JPY only, and the yen has no sub-unit — so an amount *is* an integer
 * number of yen. That is why nothing here takes a currency. Every function used to
 * need one because the string "1250" is ¥1250 or $12.50 depending on nothing else, so
 * a guessed default was a silent 100x corruption; with a single currency that
 * ambiguity cannot arise. Nothing in this app ever does floating-point arithmetic on
 * money, and after this file there is no scale left to get wrong.
 *
 * `parseAmountToYen` and `yenToSheetString` are exact inverses, which is what makes a
 * read-modify-write round trip through the sheet lossless.
 *
 * Functions taking yen throw on non-integer input rather than propagating NaN into a
 * balance or a sheet cell. Only `parseAmountToYen`, which handles untrusted human
 * input, reports failure by returning null.
 */

/** Whitespace (incl. NBSP / thin spaces) and any Unicode currency symbol. */
const NOISE = /[\s\u00a0\u202f\u2009]|\p{Sc}/gu

/** After noise removal, only digits and the two separator characters remain. */
const NUMERIC_ONLY = /^[0-9.,]+$/

/** Largest integer part we will parse, to stay inside Number.MAX_SAFE_INTEGER. */
const MAX_INT_DIGITS = 13

function assertYen(yen, name = 'yen') {
  if (!Number.isInteger(yen)) {
    throw new TypeError(`${name} must be an integer number of yen, got ${String(yen)}`)
  }
  return yen
}

/**
 * Decide which separator (if any) is the decimal point.
 *
 *   1. Both '.' and ',' present: whichever comes last is the decimal separator.
 *      "1,234.56" and "1.234,56" both mean 1234.56.
 *   2. Commas only: the last comma is decimal unless exactly three digits
 *      follow, which reads as grouping — "42,10" is 42.10 but "1,234" is 1234.
 *      That is the one genuinely ambiguous case, resolved towards grouping
 *      because a decimal comma is written with two digits of cents, not three.
 *   3. Dots only: a single dot is decimal, repeated dots are grouping.
 *
 * @returns {number} index of the decimal separator, or -1 if there is none.
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
 * Parse whatever a human types on a phone into whole yen.
 *
 * Returns null — never NaN, never negative — for junk, malformed grouping and
 * any negative input. Amounts are positive magnitudes; direction is carried by
 * the entry's `payer`.
 *
 * A decimal part is still read rather than rejected, because two things write one: a
 * person typing out of habit, and the bank's own CSV export, which prints every yen
 * amount as "1400.000000". Both round half-up to the yen.
 *
 * @param {string|number|null|undefined} input
 * @returns {number|null} whole yen, or null if unparseable
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

  // The fractional part may not contain further separators.
  if (!/^\d*$/.test(fracPart)) return null

  // Validate grouping: first group free-form, every later group exactly 3 digits.
  const groups = intPart.length ? intPart.split(/[.,]/) : []
  if (groups.length > 1 && groups[0] === '') return null
  for (let i = 0; i < groups.length; i += 1) {
    const ok = i === 0 ? /^\d*$/.test(groups[i]) : /^\d{3}$/.test(groups[i])
    if (!ok) return null
  }

  const intDigits = groups.join('')
  if (!intDigits.length && !fracPart.length) return null
  if (intDigits.replace(/^0+/, '').length > MAX_INT_DIGITS) return null

  // Half-up on the first decimal digit, in digit arithmetic rather than floats so the
  // rounding is exact: "1250.5" is 1251 yen and "1400.000000" is 1400, where a parse
  // through a float would be neither reliably.
  let yen = Number(intDigits || '0')
  if (Number(fracPart[0] ?? '0') >= 5) yen += 1

  return Number.isSafeInteger(yen) ? yen : null
}

/**
 * Whole yen -> the exact string that lands in a sheet cell: digits alone, no
 * separator, no grouping, no symbol, so it is locale-independent and re-parseable.
 * ¥1250 writes "1250".
 *
 * @param {number} yen
 * @returns {string}
 */
export function yenToSheetString(yen) {
  return String(assertYen(yen))
}

/**
 * Constructed formatters, keyed by locale — now the only thing that decides one,
 * since the currency and its zero fraction digits are fixed.
 *
 * A month's ledger asks for one formatter per amount on screen, and constructing an
 * `Intl.NumberFormat` costs an order of magnitude more than reusing one — enough to
 * be about half the cost of rendering the whole screen, which is paid again on the
 * cold-launch snapshot paint and on every refresh. The locale is fixed for an
 * install, so this never grows past a couple of entries.
 */
const FORMATTERS = new Map()

function formatterFor(locale) {
  const key = locale ?? ''
  const cached = FORMATTERS.get(key)
  if (cached) return cached
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'JPY',
    // Stated rather than left to ICU. This decides what a person reads, so it must
    // not vary with the browser's ICU version.
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  FORMATTERS.set(key, formatter)
  return formatter
}

/**
 * Whole yen -> a display string with the symbol and locale grouping ("¥1,250").
 * Never write this back to the sheet.
 *
 * @param {number} yen
 * @param {object} [opts]
 * @param {string} [opts.locale] override the runtime locale
 * @returns {string}
 */
export function formatYen(yen, { locale } = {}) {
  return formatterFor(locale).format(assertYen(yen))
}

/**
 * `formatYen` as `formatToParts` output, so the hero figure can style the symbol
 * apart from the digits.
 *
 * Render the parts in the order Intl returns them — `en`/`ja` put the symbol before
 * ("¥1,250"), `fr-FR` after ("1 250 ¥"). There is deliberately no `decimal` or
 * `fraction` part to handle: the yen has no sub-unit, so Intl never emits one.
 *
 * @param {number} yen
 * @param {object} [opts]
 * @param {string} [opts.locale] override the runtime locale
 * @returns {Array<{type: string, value: string}>}
 */
export function formatYenParts(yen, { locale } = {}) {
  return formatterFor(locale).formatToParts(assertYen(yen))
}

/**
 * Read a share of an expense — a `payer_share` cell, or a `default_split_p*` row
 * — into a fraction in [0,1].
 *
 * Anything above 1 reads as a percentage, because a spreadsheet is where people
 * write 50 rather than 0.5. Both places a human can type a share go through this
 * one rule: with two readings of it, the same `50` would mean "half" in the config
 * tab and "the payer covers all of it" in the `payer_share` column.
 *
 * @param {unknown} value
 * @returns {number|null} null for junk, so the caller's own default wins rather
 *   than NaN reaching `splitYen`
 */
export function parseShare(value) {
  const raw = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(raw) || raw < 0) return null
  const fraction = raw > 1 ? raw / 100 : raw
  return Math.min(1, Math.max(0, fraction))
}

/**
 * Split an amount between the payer and the other person.
 *
 * The payer's portion is rounded half-up and the OTHER person absorbs the
 * remainder, so `payerYen + otherYen === yen` exactly for every input: a shared
 * expense can never lose or invent a yen.
 *
 * @param {number} yen
 * @param {number} payerShare fraction in [0,1]; values outside are clamped
 * @returns {{payerYen: number, otherYen: number}}
 */
export function splitYen(yen, payerShare) {
  assertYen(yen)
  if (typeof payerShare !== 'number' || !Number.isFinite(payerShare)) {
    throw new TypeError(`payerShare must be a finite number, got ${String(payerShare)}`)
  }
  const share = Math.min(1, Math.max(0, payerShare))
  const payerYen = Math.round(yen * share)
  return { payerYen, otherYen: yen - payerYen }
}

/**
 * Sum whole yen. Empty list -> 0.
 *
 * @param {number[]} list
 * @returns {number}
 */
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
