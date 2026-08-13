/**
 * Money as integer minor units — cents for USD, whole yen for JPY, fils for KWD.
 * Nothing in this app ever does floating-point arithmetic on money.
 *
 * Every conversion between a string and an integer takes the currency
 * explicitly, with no default: the string "1250" is ¥1250 or $12.50 depending
 * entirely on which currency it belongs to, so a guessed default is a silent
 * 100x corruption. `splitCents` and `sumCents` are scale-agnostic and need none.
 *
 * `parseAmountToCents` and `centsToSheetString` are exact inverses *for the same
 * currency*, which is what makes a read-modify-write round trip through the
 * sheet lossless.
 *
 * Functions taking minor units throw on non-integer input rather than
 * propagating NaN into a balance or a sheet cell. Only `parseAmountToCents`,
 * which handles untrusted human input, reports failure by returning null.
 */

/** Whitespace (incl. NBSP / thin spaces) and any Unicode currency symbol. */
const NOISE = /[\s\u00a0\u202f\u2009]|\p{Sc}/gu

/** After noise removal, only digits and the two separator characters remain. */
const NUMERIC_ONLY = /^[0-9.,]+$/

/** Largest integer part we will parse, to stay inside Number.MAX_SAFE_INTEGER. */
const MAX_INT_DIGITS = 13

/**
 * ISO 4217 exponents, hardcoded rather than asked of Intl: this value decides
 * what gets WRITTEN to the sheet, so it must be identical on every device
 * forever, and `Intl.NumberFormat().resolvedOptions()` would tie the stored
 * format to the browser's ICU version.
 */
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW',
  'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
])
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'])

/**
 * Minor-unit digits for a currency: 0 for JPY (the yen *is* the minor unit), 2
 * for USD, 3 for KWD. An unrecognised code answers 2, the ISO 4217 default.
 *
 * @param {string} currency
 * @returns {0|2|3}
 */
export function minorDigits(currency) {
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : ''
  if (ZERO_DECIMAL.has(code)) return 0
  if (THREE_DECIMAL.has(code)) return 3
  return 2
}

function assertCents(cents, name = 'cents') {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`${name} must be an integer number of cents, got ${String(cents)}`)
  }
  return cents
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
 * Parse whatever a human types on a phone into integer minor units.
 *
 * Returns null — never NaN, never negative — for junk, malformed grouping and
 * any negative input. Amounts are positive magnitudes; direction is carried by
 * the entry's `payer`.
 *
 * The comma-decimal rule above is currency-independent, so for JPY "42,10"
 * parses as 42 rather than 4210. Making the heuristic vary by currency would
 * cost it its one documented, testable definition.
 *
 * @param {string|number|null|undefined} input
 * @param {string} currency decides the minor-unit scale
 * @returns {number|null} integer minor units, or null if unparseable
 */
export function parseAmountToCents(input, currency) {
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

  // Half-up one digit past the last minor digit, in digit arithmetic rather than
  // floats so the rounding is exact: "1250.5" is 1251 yen, "1.005" is 101 cents.
  const digits = minorDigits(currency)
  const padded = `${fracPart}${'0'.repeat(digits + 1)}`.slice(0, digits + 1)
  let minor = Number(intDigits || '0') * 10 ** digits + Number(padded.slice(0, digits) || '0')
  if (Number(padded[digits]) >= 5) minor += 1

  return Number.isSafeInteger(minor) ? minor : null
}

/** Digits and a dot at a known scale: no symbol, no grouping, no locale. */
function decimalString(minor, digits) {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  const scale = 10 ** digits
  const whole = Math.floor(abs / scale)
  if (digits === 0) return `${sign}${whole}`
  return `${sign}${whole}.${String(abs % scale).padStart(digits, '0')}`
}

/**
 * Minor units -> the exact string that lands in a sheet cell: the currency's own
 * precision, '.' separator, no grouping, no symbol, so it is locale-independent
 * and re-parseable. A JPY amount writes "1250", not "1250.00".
 *
 * Refuses a missing currency rather than assuming the two-digit default, which
 * is the difference between ¥1250 and "12.50" in somebody's spreadsheet. The
 * display formatters below stay lenient in the same situation on purpose — a
 * missing currency must not take a render down, but it must never be written.
 *
 * @param {number} minor integer minor units
 * @param {string} currency
 * @returns {string}
 */
export function centsToSheetString(minor, currency) {
  assertCents(minor)
  if (!currency) throw new TypeError('currency is required to encode an amount for the sheet')
  return decimalString(minor, minorDigits(currency))
}

/**
 * Shared by the two display formatters. The float division is the only one in
 * this module and it is display-only: Intl needs a Number, and the result is
 * rendered immediately, never stored or summed.
 */
function currencyFormat(cents, currency, { locale, trimZeroCents = false }) {
  const digits = minorDigits(currency)
  const scale = 10 ** digits
  const fractionDigits = trimZeroCents && cents % scale === 0 ? 0 : digits
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
  return { formatter, value: cents / scale }
}

/**
 * Minor units -> a display string (symbol, locale grouping). Never write this
 * back to the sheet.
 *
 * @param {number} cents integer minor units
 * @param {string} currency ISO 4217 code
 * @param {object} [opts]
 * @param {string} [opts.locale] override the runtime locale
 * @param {boolean} [opts.trimZeroCents=false] drop a ".00" tail, easier to scan
 *   in a dense list. A no-op for a zero-decimal currency.
 * @returns {string}
 */
export function formatCents(cents, currency, opts = {}) {
  assertCents(cents)
  try {
    const { formatter, value } = currencyFormat(cents, currency, opts)
    return formatter.format(value)
  } catch {
    // An unknown code in the sheet's config tab must not crash a render. Not via
    // `centsToSheetString`, which refuses a missing currency: this is the display
    // path, where the amount still has to appear. Append the code only when there
    // is one, or a missing argument renders as the word "undefined".
    const plain = decimalString(cents, minorDigits(currency))
    return currency ? `${plain} ${currency}` : plain
  }
}

/**
 * `formatCents` as `formatToParts` output, so the hero figure can set the symbol
 * and any fraction smaller than the integer part.
 *
 * Render the parts in the order Intl returns them — `en`/`ja` put the symbol
 * before ("¥1,250"), `fr-FR` after ("1 250 €") — and never assume a `decimal`
 * or `fraction` part exists, because a zero-decimal currency has none.
 *
 * @returns {Array<{type: string, value: string}>|null} null for an unknown
 *   currency code, signalling the caller to fall back to `formatCents`.
 */
export function formatCentsParts(cents, currency, opts = {}) {
  assertCents(cents)
  try {
    const { formatter, value } = currencyFormat(cents, currency, opts)
    return formatter.formatToParts(value)
  } catch {
    return null
  }
}

/**
 * Split an amount between the payer and the other person.
 *
 * The payer's portion is rounded half-up and the OTHER person absorbs the
 * remainder, so `payerCents + otherCents === cents` exactly for every input: a
 * shared expense can never lose or invent a unit.
 *
 * @param {number} cents integer minor units
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
 * Sum integer minor units. Empty list -> 0.
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
