/**
 * Local-date helpers.
 *
 * Dates in the sheet are plain ISO calendar days ("2026-08-05") with no time
 * or zone. Every function here builds Date objects with explicit y/m/d parts
 * rather than parsing the string, because `new Date('2026-08-05')` is treated
 * as UTC midnight and shifts to the previous day west of Greenwich.
 */

export function todayIso(now = new Date()) {
  return toIso(now)
}

export function toIso(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** '2026-08-05' -> '2026-08' */
export function monthKeyOf(iso) {
  return typeof iso === 'string' ? iso.slice(0, 7) : ''
}

export function currentMonthKey(now = new Date()) {
  return monthKeyOf(toIso(now))
}

function partsOf(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** Shift a 'YYYY-MM' key by n months. */
export function shiftMonth(monthKey, delta) {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  if (!year || !month) return ''
  const date = new Date(year, month - 1, 1)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** 'Today' / 'Yesterday' / 'Mon, Aug 4' — short enough for a narrow phone. */
export function dayLabel(iso, now = new Date()) {
  if (!iso) return 'No date'
  const today = toIso(now)
  if (iso === today) return 'Today'

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (iso === toIso(yesterday)) return 'Yesterday'

  const date = partsOf(iso)
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
