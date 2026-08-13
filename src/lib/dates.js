/**
 * Local-date helpers.
 *
 * Dates in the sheet are plain ISO calendar days ("2026-08-05") with no time
 * or zone. Every function here builds Date objects with explicit y/m/d parts
 * rather than parsing the string, because `new Date('2026-08-05')` is treated
 * as UTC midnight and shifts to the previous day west of Greenwich.
 *
 * These helpers stay pure and know nothing about the i18n catalogs: the locale
 * and the three relative-day words arrive as arguments with English defaults.
 */

/** The only English text here; callers override it from the catalog. */
const EN_DAY_LABELS = { today: 'Today', yesterday: 'Yesterday', none: 'No date' }

export function todayIso(now = new Date()) {
  return toIso(now)
}

function toIso(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function currentMonthKey(now = new Date()) {
  return toIso(now).slice(0, 7)
}

function partsOf(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * A 'YYYY-MM' key as numbers, or null for anything that is not one. The single
 * parser for the two functions below: without a guard, `shiftMonth` answers the
 * string 'NaN-NaN' for junk, which then matches no entry in any month and reads on
 * screen as an empty month rather than as a bug.
 */
function monthParts(monthKey) {
  const [year, month] = String(monthKey ?? '')
    .split('-')
    .map(Number)
  if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 1 || month > 12) {
    return null
  }
  return { year, month }
}

/** Shift a 'YYYY-MM' key by n months. A key that is not one is returned as ''. */
export function shiftMonth(monthKey, delta) {
  const parts = monthParts(monthKey)
  if (!parts) return ''
  const date = new Date(parts.year, parts.month - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 'August' / '8月'. The year is only shown when it is not the current one.
 *
 * @param {string} monthKey 'YYYY-MM'
 * @param {object} [opts]
 * @param {string} [opts.locale] undefined means the runtime locale
 * @param {Date} [opts.now] injected by `test/dates.test.js` to pin the same-year
 *   branch; the app always takes the default
 */
export function monthLabel(monthKey, { locale, now = new Date() } = {}) {
  const parts = monthParts(monthKey)
  if (!parts) return ''
  const date = new Date(parts.year, parts.month - 1, 1)
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(locale, {
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * 'Today' / 'Yesterday' / 'Mon, Aug 4' — short enough for a narrow phone.
 *
 * @param {string} iso
 * @param {object} [opts]
 * @param {Date} [opts.now]
 * @param {string} [opts.locale]
 * @param {{today: string, yesterday: string, none: string}} [opts.labels]
 */
export function dayLabel(iso, { now = new Date(), locale, labels = EN_DAY_LABELS } = {}) {
  if (!iso) return labels.none
  const today = toIso(now)
  if (iso === today) return labels.today

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (iso === toIso(yesterday)) return labels.yesterday

  const date = partsOf(iso)
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
