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

import { cached } from './memo.js'

/** The only English text here; callers override it from the catalog. */
const EN_DAY_LABELS = { today: 'Today', yesterday: 'Yesterday', none: 'No date' }

/**
 * Constructed date formatters, keyed by every option that decides one.
 *
 * `Date#toLocaleDateString` builds a formatter per call, which costs an order of magnitude
 * more than reusing one, and a month's list asks for one per day heading. The key space is
 * (locale × the two shapes below × with-year or not), so it stays a handful of entries.
 */
const DATE_FORMATS = new Map()

function dateFormatter(locale, options) {
  // Every option, sorted, so a shape added later cannot collide with an existing key
  // and silently render in the wrong one.
  const shape = Object.keys(options)
    .sort()
    .map((name) => `${name}:${options[name]}`)
    .join(',')
  return cached(
    DATE_FORMATS,
    `${locale ?? ''}|${shape}`,
    () => new Intl.DateTimeFormat(locale, options),
  )
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Shape *and* calendar validity — the only test of a 'YYYY-MM-DD' day, and the companion
 * to `isMonthKey` below. The regex alone accepts 2026-02-31 and 2026-13-45, which surface
 * as a bogus month in the month switcher; the UTC round-trip is what rejects them, since an
 * out-of-range month or day lands in a different one.
 */
export function isIsoDate(value) {
  if (!ISO_DATE.test(value ?? '')) return false
  const [year, month, day] = value.split('-').map(Number)
  const probe = new Date(Date.UTC(year, month - 1, day))
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  )
}

export function todayIso(now = new Date()) {
  return toIso(now)
}

/** Two-digit zero padding, which every 'YYYY-MM[-DD]' string below is built from. */
function pad(value) {
  return String(value).padStart(2, '0')
}

function toIso(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function currentMonthKey(now = new Date()) {
  return todayIso(now).slice(0, 7)
}

function partsOf(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * A 'YYYY-MM' key as numbers, or null for anything that is not one. The single parser for
 * the two functions below: without a guard, `shiftMonth` answers the string 'NaN-NaN' for
 * junk, which matches no entry in any month and reads on screen as an empty month rather
 * than as a bug.
 *
 * The SHAPE is checked before the numbers, because `split('-')` discards everything past the
 * second part — so a full ISO day ('2026-08-05') would parse as a perfectly valid August, and
 * then match no entry in any month.
 */
function monthParts(monthKey) {
  const text = String(monthKey ?? '')
  if (!/^\d{4}-\d{2}$/.test(text)) return null
  const [year, month] = text.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12) return null
  return { year, month }
}

/** Whether a string is a 'YYYY-MM' key. The only such check in the app. */
export function isMonthKey(value) {
  return monthParts(value) != null
}

/**
 * The month of a 'YYYY-MM' key as 1-12, or null.
 *
 * The one caller compares a month against a LIST of them — the `recurring` tab's `months`
 * column, which is how quarterly and annual costs are spelled — rather than against
 * another key, so a string comparison cannot serve it.
 */
export function monthNumber(monthKey) {
  return monthParts(monthKey)?.month ?? null
}

/**
 * A day of a 'YYYY-MM' as an ISO day, CLAMPED to that month's last day.
 *
 * The clamp is the point: a recurring cost dated the 31st has to land on the 28th in
 * February, where `new Date(year, 1, 31)` would silently roll forward into March and file
 * the row under the wrong month entirely. Day 0 of the NEXT month is the length of this
 * one, so there is no table of month lengths and no leap-year rule here to get wrong.
 *
 * A day that is not an integer falls back to the 1st rather than throwing: this reads a
 * hand-typed cell, and `rowToTemplate` has already refused anything outside 1-31.
 *
 * @returns {string} '' for anything that is not a month key
 */
export function dayInMonth(monthKey, day) {
  const parts = monthParts(monthKey)
  if (!parts) return ''
  const last = new Date(parts.year, parts.month, 0).getDate()
  const clamped = Math.min(Math.max(Number.isInteger(day) ? day : 1, 1), last)
  return `${parts.year}-${pad(parts.month)}-${pad(clamped)}`
}

/** Shift a 'YYYY-MM' key by n months. A key that is not one is returned as ''. */
export function shiftMonth(monthKey, delta) {
  const parts = monthParts(monthKey)
  if (!parts) return ''
  const date = new Date(parts.year, parts.month - 1 + delta, 1)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
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
  return dateFormatter(locale, {
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
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
  return dateFormatter(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
}
