/**
 * Money as integer cents. Nothing in this app ever does floating-point
 * arithmetic on money.
 *
 * The two functions the sheet layer depends on are `parseAmountToCents`
 * (sheet cell / user keyboard -> cents) and `centsToSheetString`
 * (cents -> sheet cell). They are exact inverses for every value
 * `parseAmountToCents` can return, which is what makes a read-modify-write
 * round trip through the Google Sheet lossless.
 *
 * Functions that accept cents are strict: they throw a TypeError on
 * NaN/Infinity/non-integer input instead of quietly propagating NaN into a
 * balance or into a sheet cell. Only `parseAmountToCents`, which handles
 * untrusted human input, reports failure by returning null.
 */

/** Whitespace (incl. NBSP / thin spaces) and any Unicode currency symbol. */
const NOISE = /[\s\u00a0\u202f\u2009]|\p{Sc}/gu

/** After noise removal, only digits and the two separator characters remain. */
const NUMERIC_ONLY = /^[0-9.,]+$/

/** Largest integer part we will parse, to stay inside Number.MAX_SAFE_INTEGER. */
const MAX_INT_DIGITS = 13

function assertCents(cents, name = 'cents') {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`${name} must be an integer number of cents, got ${String(cents)}`)
  }
  return cents
}

/**
 * Decide which separator (if any) is the decimal point.
 *
 * Comma ambiguity rule, chosen deliberately:
 *   1. If BOTH '.' and ',' appear, whichever occurs *last* is the decimal
 *      separator and the other is a grouping separator. So "1,234.56" and
 *      "1.234,56" both mean one thousand two hundred thirty four and 56/100.
 *   2. If only commas appear, the last comma is a DECIMAL separator unless
 *      exactly three digits follow it, in which case every comma is a
 *      thousands separator. So "42,10" -> 42.10 but "1,234" -> 1234.00.
 *      The "exactly three digits" case is the only genuinely ambiguous one
 *      and we resolve it in favour of grouping, because a phone keyboard user
 *      writing a decimal comma writes two digits of cents, not three.
 *   3. If only dots appear, a single dot is always the decimal point
 *      ("1.234" -> 1.23); repeated dots are grouping ("1.234.567" -> 1234567).
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
 * Parse whatever a human types on a phone into integer cents.
 *
 * Accepts "42", "42.", ".5", "42.10", "42,10", " $42.10 ", "1,234.56",
 * "1.234,56". Rounds half-up at the third decimal place ("1.005" -> 101),
 * using digit arithmetic rather than floats so the rounding is exact.
 *
 * Returns null — never NaN and never a negative number — for '', null,
 * undefined, non-numeric junk, malformed grouping ("12,34.5"), and any
 * negative input. Amounts are always positive magnitudes; direction is
 * carried by the entry's `payer` field.
 *
 * @param {string|number|null|undefined} input
 * @returns {number|null} integer cents, or null if unparseable
 */
export function parseAmountToCents(input) {
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

  // Half-up at the third decimal: the third digit onwards is a fraction of a
  // cent, and is >= half a cent exactly when the third digit is >= 5.
  const frac3 = `${fracPart}000`.slice(0, 3)
  let cents = Number(intDigits || '0') * 100 + Number(frac3.slice(0, 2))
  if (Number(frac3[2]) >= 5) cents += 1

  return Number.isSafeInteger(cents) ? cents : null
}

/**
 * Cents -> the exact string that lands in a sheet cell.
 *
 * Always fixed 2 decimals, '.' separator, no grouping, no currency symbol, so
 * it is locale-independent and always re-parseable by parseAmountToCents.
 * Handles 0 ("0.00") and negatives ("-42.10").
 *
 * @param {number} cents
 * @returns {string}
 */
export function centsToSheetString(cents) {
  assertCents(cents)
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${whole}.${frac}`
}

/**
 * Cents -> a display string for the UI (currency symbol, locale grouping).
 * Never use this for anything written back to the sheet.
 *
 * @param {number} cents
 * @param {string} [currency='USD'] ISO 4217 code
 * @param {object} [opts]
 * @param {string} [opts.locale] override the runtime locale
 * @param {boolean} [opts.trimZeroCents=false] render whole amounts without the
 *   ".00" tail — easier to scan in a dense list on a narrow phone screen.
 *   Off by default so cents stay visible where precision matters.
 * @returns {string}
 */
export function formatCents(cents, currency = 'USD', opts = {}) {
  assertCents(cents)
  const { locale, trimZeroCents = false } = opts
  const fractionDigits = trimZeroCents && cents % 100 === 0 ? 0 : 2
  const code = typeof currency === 'string' && currency ? currency : 'USD'
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
      // The only float division in the money layer, and it is display-only:
      // Intl needs a Number, and the result is immediately rendered, never
      // stored, summed, or written back to the sheet.
    }).format(cents / 100)
  } catch {
    // An unknown currency code from the sheet's config tab must not crash a render.
    return `${centsToSheetString(cents)} ${code}`
  }
}

/**
 * Split an amount between the payer and the other person.
 *
 * The payer's portion is rounded (half-up) and the OTHER person absorbs the
 * remainder, so payerCents + otherCents === cents exactly for every input —
 * a shared expense can never lose or invent a penny. Giving the remainder to
 * the non-payer also keeps `1 - payerShare` of the total, i.e. what the
 * non-payer owes, derivable from a single subtraction.
 *
 * @param {number} cents integer cents
 * @param {number} payerShare fraction in [0,1]; values outside are clamped
 * @returns {{payerCents: number, otherCents: number}}
 */
export function splitCents(cents, payerShare) {
  assertCents(cents)
  if (typeof payerShare !== 'number' || !Number.isFinite(payerShare)) {
    throw new TypeError(`payerShare must be a finite number, got ${String(payerShare)}`)
  }
  const share = Math.min(1, Math.max(0, payerShare))
  const payerCents = Math.round(cents * share)
  return { payerCents, otherCents: cents - payerCents }
}

/**
 * Sum a list of integer-cent values. Empty list -> 0.
 *
 * @param {number[]} list
 * @returns {number}
 */
export function sumCents(list) {
  if (!Array.isArray(list)) {
    throw new TypeError(`sumCents expects an array, got ${String(list)}`)
  }
  let total = 0
  for (let i = 0; i < list.length; i += 1) {
    total += assertCents(list[i], `sumCents[${i}]`)
  }
  if (!Number.isSafeInteger(total)) {
    throw new RangeError('sumCents overflowed the safe integer range')
  }
  return total
}
