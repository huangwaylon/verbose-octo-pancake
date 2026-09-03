import { describe, expect, it } from 'vitest'

import {
  currentMonthKey,
  dayInMonth,
  dayLabel,
  isIsoDate,
  isMonthKey,
  monthLabel,
  monthNumber,
  shiftMonth,
  todayIso,
} from '../src/lib/dates.js'
import { cached } from '../src/lib/memo.js'

// These helpers exist because `new Date('2026-08-05')` parses as UTC midnight and lands on the
// 4th west of Greenwich — invisible, since a date one day out still renders. So every case
// here is a boundary.

/** Local midnight, built from parts, exactly as the module under test does. */
const at = (year, month, day) => new Date(year, month - 1, day)

const LABELS = { today: 'Today', yesterday: 'Yesterday', none: 'No date' }

describe('todayIso', () => {
  it('formats the local calendar day, not a UTC instant', () => {
    expect(todayIso(at(2026, 8, 5))).toBe('2026-08-05')
    expect(todayIso(at(2026, 1, 1))).toBe('2026-01-01')
    expect(todayIso(at(2026, 12, 31))).toBe('2026-12-31')
  })

  // 23:30 local on the 5th is already the 6th in UTC east of London.
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

  // A month key is the 1st, so no shift can land on a day the target month lacks.
  it('cannot overflow out of a short month', () => {
    expect(shiftMonth('2026-01', 1)).toBe('2026-02')
    expect(shiftMonth('2026-03', -1)).toBe('2026-02')
  })

  it('returns nothing for a key that is not one, rather than the string NaN-NaN', () => {
    // 'NaN-NaN' matches no entry, so the screen reads as an empty month, not as a bug.
    for (const key of ['', 'nope', '2026', '2026-13', undefined, null, {}]) {
      expect(shiftMonth(key, 1)).toBe('')
    }
  })
})

// The only direct test of a 'YYYY-MM-DD' day: `rowToEntry` and `validateEntryCodes` cannot
// tell "rejected the shape" from "rejected the calendar".
describe('isIsoDate', () => {
  it('accepts a real calendar day', () => {
    for (const value of ['2026-08-05', '2026-01-01', '2026-12-31', '2024-02-29']) {
      expect(isIsoDate(value)).toBe(true)
    }
  })

  it('rejects a day the calendar does not have, which the regex alone accepts', () => {
    // A shape check passes these; the UTC round-trip is what catches them.
    for (const value of ['2026-02-31', '2026-13-45', '2026-00-10', '2026-08-00', '2025-02-29']) {
      expect(isIsoDate(value)).toBe(false)
    }
  })

  it('rejects anything that is not a full ISO day', () => {
    for (const value of ['2026-08', '2026-8-5', '26-08-05', ' 2026-08-05', '', undefined, null]) {
      expect(isIsoDate(value)).toBe(false)
    }
  })
})

// The only direct test of a 'YYYY-MM' key: `shiftMonth` and `filterByMonth` cannot tell
// "rejected" from "shifted to something harmless".
describe('isMonthKey', () => {
  it('accepts a month key and nothing else', () => {
    expect(isMonthKey('2026-08')).toBe(true)
    expect(isMonthKey('2026-01')).toBe(true)
    expect(isMonthKey('2026-12')).toBe(true)
  })

  it('rejects a full ISO day, which is the one piece of junk in reach', () => {
    // `inMonth` compares against `date.slice(0, 7)`, so a ten-character string matches
    // nothing: the ledger renders empty, correctly formatted, with no notice at all.
    expect(isMonthKey('2026-08-05')).toBe(false)
  })

  it('rejects a month that is not a month, and a shape that only looks like one', () => {
    for (const value of [
      '2026-13',
      '2026-00',
      '2026-2',
      '202-08',
      '20260-08',
      ' 2026-08',
      '2026-08 ',
      '0000-01',
      '2026/08',
      '',
      'nope',
      202608,
      undefined,
      null,
      {},
    ]) {
      expect(isMonthKey(value)).toBe(false)
    }
  })
})

describe('monthNumber', () => {
  it('answers the month of a key, and null for anything that is not one', () => {
    expect(monthNumber('2026-01')).toBe(1)
    expect(monthNumber('2026-12')).toBe(12)
    // Null rather than NaN: NaN matches nothing in `months`, so a quarterly cost would
    // never be offered.
    for (const value of ['2026-13', '2026-08-05', '', undefined]) {
      expect(monthNumber(value)).toBeNull()
    }
  })
})

// The clamp is the whole point: a cost dated the 31st has to land on the last day of a short
// month, and `new Date(2026, 1, 31)` rolls into March — filing the row under the wrong month.
describe('dayInMonth', () => {
  it('builds the day inside the month', () => {
    expect(dayInMonth('2026-08', 5)).toBe('2026-08-05')
    expect(dayInMonth('2026-08', 27)).toBe('2026-08-27')
    expect(dayInMonth('2026-12', 31)).toBe('2026-12-31')
  })

  it('clamps to the last day of a short month, February included', () => {
    expect(dayInMonth('2026-02', 31)).toBe('2026-02-28')
    expect(dayInMonth('2026-02', 30)).toBe('2026-02-28')
    expect(dayInMonth('2024-02', 31)).toBe('2024-02-29') // leap
    expect(dayInMonth('2000-02', 31)).toBe('2000-02-29') // leap, divisible by 400
    expect(dayInMonth('1900-02', 31)).toBe('1900-02-28') // not leap, divisible by 100
    expect(dayInMonth('2026-04', 31)).toBe('2026-04-30')
    expect(dayInMonth('2026-11', 31)).toBe('2026-11-30')
  })

  it('falls back to the 1st for a day that is not one', () => {
    for (const day of [0, -3, 5.5, NaN, undefined, null, '5']) {
      expect(dayInMonth('2026-08', day)).toBe('2026-08-01')
    }
  })

  it('answers empty for anything that is not a month key', () => {
    for (const monthKey of ['2026-13', '2026-08-05', '', undefined, null]) {
      expect(dayInMonth(monthKey, 5)).toBe('')
    }
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
    // The 1st is where a UTC-parsed string slips into the previous month: 'Fri, Jul 31'
    // would be the wrong day AND the wrong month.
    expect(dayLabel('2026-08-01', { locale: 'en', now, labels: LABELS })).toBe('Sat, Aug 1')
    expect(dayLabel('2025-08-01', { locale: 'en', now, labels: LABELS })).toBe('Fri, Aug 1, 2025')
  })
})

// The formatter cache behind this module and `money.js`: no file of its own, and both
// callers hide it behind an `Intl` object, so it is exercised here.
describe('the memo behind the formatter caches', () => {
  it('keeps a cached value that is falsy, rather than rebuilding it every call', () => {
    // Testing the stored value for TRUTHINESS rather than the key for presence looks right
    // on an `Intl` object and silently rebuilds anything falsy on every heading.
    const store = new Map()
    let built = 0
    const make = () => {
      built += 1
      return ''
    }
    expect(cached(store, 'k', make)).toBe('')
    expect(cached(store, 'k', make)).toBe('')
    expect(built).toBe(1)
  })

  it('builds once per key and hands back the same object', () => {
    const store = new Map()
    const first = cached(store, 'a', () => ({}))
    expect(cached(store, 'a', () => ({}))).toBe(first)
    expect(cached(store, 'b', () => ({}))).not.toBe(first)
  })
})
