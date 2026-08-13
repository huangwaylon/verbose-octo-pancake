import { describe, expect, it } from 'vitest'

import { currentMonthKey, dayLabel, monthLabel, shiftMonth, todayIso } from '../src/lib/dates.js'

/**
 * These helpers exist because `new Date('2026-08-05')` parses as UTC midnight and
 * lands on the 4th anywhere west of Greenwich. That failure is invisible — a date
 * one day out still renders — so the cases below are all about boundaries: the
 * 1st, the 31st, a year end, and the relative-day words.
 *
 * Every `now` here is injected. That is what the parameters are for, and until
 * this file existed the JSDoc claiming so was aspirational.
 */

/** Local midnight, built from parts, exactly as the module under test does. */
const at = (year, month, day) => new Date(year, month - 1, day)

const LABELS = { today: 'Today', yesterday: 'Yesterday', none: 'No date' }

describe('todayIso', () => {
  it('formats the local calendar day, not a UTC instant', () => {
    expect(todayIso(at(2026, 8, 5))).toBe('2026-08-05')
    expect(todayIso(at(2026, 1, 1))).toBe('2026-01-01')
    expect(todayIso(at(2026, 12, 31))).toBe('2026-12-31')
  })

  // 23:30 local on the 5th is already the 6th in UTC for anyone east of London.
  // Reading the local parts is what keeps a late-evening entry on the right day.
  it('keeps a late-evening date on its own day', () => {
    const lateEvening = new Date(2026, 7, 5, 23, 30)
    expect(todayIso(lateEvening)).toBe('2026-08-05')
  })
})

describe('currentMonthKey', () => {
  it('is the YYYY-MM prefix of the local day', () => {
    expect(currentMonthKey(at(2026, 8, 31))).toBe('2026-08')
    expect(currentMonthKey(at(2026, 1, 1))).toBe('2026-01')
  })
})

describe('shiftMonth', () => {
  it('crosses a year boundary in both directions', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-08', 0)).toBe('2026-08')
    expect(shiftMonth('2026-08', -12)).toBe('2025-08')
  })

  // A month key is the 1st by construction, so no shift can land on a day the
  // target month does not have — the January 31st → February problem.
  it('cannot overflow out of a short month', () => {
    expect(shiftMonth('2026-01', 1)).toBe('2026-02')
    expect(shiftMonth('2026-03', -1)).toBe('2026-02')
  })
})

describe('monthLabel', () => {
  it('shows the year only when it is not the current one', () => {
    const now = at(2026, 8, 5)
    expect(monthLabel('2026-08', { locale: 'en', now })).toBe('August')
    expect(monthLabel('2025-08', { locale: 'en', now })).toBe('August 2025')
  })

  it('is empty for a key it cannot read, rather than "Invalid Date"', () => {
    expect(monthLabel('', { locale: 'en' })).toBe('')
    expect(monthLabel(undefined, { locale: 'en' })).toBe('')
    expect(monthLabel('not-a-month', { locale: 'en' })).toBe('')
  })
})

describe('dayLabel', () => {
  const now = at(2026, 8, 5)

  it('uses the words the caller supplies, never its own', () => {
    expect(dayLabel('2026-08-05', { now, labels: LABELS })).toBe('Today')
    expect(dayLabel('2026-08-04', { now, labels: LABELS })).toBe('Yesterday')
    expect(dayLabel('', { now, labels: LABELS })).toBe('No date')
    // The catalogs pass Japanese here; the module must not reach for English.
    const ja = { today: '今日', yesterday: '昨日', none: '日付なし' }
    expect(dayLabel('2026-08-05', { now, labels: ja })).toBe('今日')
  })

  it('crosses a month boundary to find yesterday', () => {
    expect(dayLabel('2026-07-31', { now: at(2026, 8, 1), labels: LABELS })).toBe('Yesterday')
  })

  it('crosses a year boundary to find yesterday', () => {
    expect(dayLabel('2025-12-31', { now: at(2026, 1, 1), labels: LABELS })).toBe('Yesterday')
  })

  it('spells out an older day, adding the year only outside the current one', () => {
    expect(dayLabel('2026-08-01', { locale: 'en', now, labels: LABELS })).toBe('Sat, Aug 1')
    expect(dayLabel('2025-08-01', { locale: 'en', now, labels: LABELS })).toBe('Fri, Aug 1, 2025')
  })

  // The whole reason this module builds dates from parts: the 1st of a month is
  // where a UTC-parsed ISO string slips back into the previous month.
  it('does not shift the first of the month backwards', () => {
    expect(dayLabel('2026-08-01', { locale: 'en', now, labels: LABELS })).toContain('Aug 1')
  })
})
