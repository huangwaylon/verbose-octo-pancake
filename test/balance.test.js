import { describe, it, expect } from 'vitest'
import {
  owedToPayerCents,
  computeBalance,
  totalSpend,
  spendByCategory,
  spendByPerson,
  filterByMonth,
  monthKeysPresent,
  groupByDate,
  deletedEntries,
} from '../src/lib/balance.js'
import { makeEntry, PERSON, ENTRY_TYPE, EVEN_SHARE } from '../src/schema.js'

/** Deterministic entry factory: explicit id, injected `now`, no crypto. */
function entry(id, overrides = {}) {
  const now = overrides.now ?? `2026-03-01T00:00:0${id.length % 10}.000Z`
  const { now: _drop, ...rest } = overrides
  return makeEntry({ id, ...rest }, now)
}

function expense(id, amountCents, overrides = {}) {
  return entry(id, {
    type: ENTRY_TYPE.EXPENSE,
    date: '2026-03-10',
    payer: PERSON.P1,
    category: 'Groceries',
    amountCents,
    ...overrides,
  })
}

function settlement(id, amountCents, overrides = {}) {
  return entry(id, {
    type: ENTRY_TYPE.SETTLEMENT,
    date: '2026-03-31',
    payer: PERSON.P1,
    amountCents,
    ...overrides,
  })
}

describe('owedToPayerCents', () => {
  it('is the non-payer share of the amount', () => {
    expect(owedToPayerCents(expense('a', 10000, { payerShare: EVEN_SHARE }))).toBe(5000)
    expect(owedToPayerCents(expense('b', 10000, { payerShare: 1 }))).toBe(0)
    expect(owedToPayerCents(expense('c', 10000, { payerShare: 0 }))).toBe(10000)
    expect(owedToPayerCents(expense('d', 10000, { payerShare: 0.25 }))).toBe(7500)
  })

  it('rounds so the payer and other portions still add to the amount', () => {
    const e = expense('odd', 101, { payerShare: EVEN_SHARE })
    expect(owedToPayerCents(e)).toBe(50)
    expect(e.amountCents - owedToPayerCents(e)).toBe(51)
  })

  it('treats a settlement as fully owed to the payer', () => {
    const s = settlement('s1', 5000)
    expect(s.payerShare).toBe(0)
    expect(owedToPayerCents(s)).toBe(5000)
  })

  it('tolerates a numeric-string share, which a form can hand to makeEntry', () => {
    // A form input can hand '0.5' straight to makeEntry; the balance must not
    // crash on it, but genuine junk must still be loud.
    expect(owedToPayerCents(expense('str', 10000, { payerShare: '0.5' }))).toBe(5000)
    expect(computeBalance([expense('str', 10000, { payerShare: '0.25' })]).netCents).toBe(7500)
    expect(() => owedToPayerCents(expense('junk', 10000, { payerShare: 'half' }))).toThrow(
      TypeError,
    )
  })
})

describe('computeBalance', () => {
  it('reports settled for no entries', () => {
    expect(computeBalance([])).toEqual({
      netCents: 0,
      debtor: null,
      creditor: null,
      amountCents: 0,
    })
    expect(computeBalance(undefined)).toEqual({
      netCents: 0,
      debtor: null,
      creditor: null,
      amountCents: 0,
    })
  })

  it('reports settled when two mirrored expenses cancel out', () => {
    const entries = [
      expense('a', 4000, { payer: PERSON.P1 }),
      expense('b', 4000, { payer: PERSON.P2 }),
    ]
    expect(computeBalance(entries)).toEqual({
      netCents: 0,
      debtor: null,
      creditor: null,
      amountCents: 0,
    })
  })

  it('says p2 owes p1 when p1 paid', () => {
    const balance = computeBalance([expense('a', 4000, { payer: PERSON.P1 })])
    expect(balance.netCents).toBe(2000)
    expect(balance.amountCents).toBe(2000)
    expect(balance.debtor).toBe(PERSON.P2)
    expect(balance.creditor).toBe(PERSON.P1)
  })

  it('says p1 owes p2 when p2 paid', () => {
    const balance = computeBalance([expense('a', 4000, { payer: PERSON.P2 })])
    expect(balance.netCents).toBe(-2000)
    expect(balance.amountCents).toBe(2000)
    expect(balance.debtor).toBe(PERSON.P1)
    expect(balance.creditor).toBe(PERSON.P2)
  })

  it('handles an expense bought entirely for the other person', () => {
    const balance = computeBalance([expense('gift', 3000, { payer: PERSON.P1, payerShare: 0 })])
    expect(balance.netCents).toBe(3000)
    expect(balance.debtor).toBe(PERSON.P2)
  })

  it('ignores an expense the payer bought only for themselves', () => {
    const balance = computeBalance([expense('mine', 3000, { payer: PERSON.P1, payerShare: 1 })])
    expect(balance).toEqual({ netCents: 0, debtor: null, creditor: null, amountCents: 0 })
  })

  it('keeps the magnitude and sign consistent for every entry mix', () => {
    const entries = [
      expense('a', 7777, { payer: PERSON.P1, payerShare: 0.333 }),
      expense('b', 101, { payer: PERSON.P2, payerShare: EVEN_SHARE }),
      settlement('c', 12, { payer: PERSON.P2 }),
    ]
    const balance = computeBalance(entries)
    expect(balance.amountCents).toBe(Math.abs(balance.netCents))
    expect(Number.isInteger(balance.netCents)).toBe(true)
    expect(balance.debtor).not.toBe(balance.creditor)
  })

  // ── The most important test in the suite ────────────────────────────────
  it('drives the balance to exactly zero when a settlement pays off the outstanding amount', () => {
    const expenses = [
      // p1 fronts the groceries, split evenly -> p2 owes 2166 (of 4331, odd cents)
      expense('e1', 4331, { payer: PERSON.P1, payerShare: EVEN_SHARE }),
      // p1 buys something entirely for p2 -> p2 owes all 1999
      expense('e2', 1999, { payer: PERSON.P1, payerShare: 0, category: 'Other' }),
      // p2 pays for dinner, split evenly -> p1 owes 4025 (of 8049)
      expense('e3', 8049, { payer: PERSON.P2, payerShare: EVEN_SHARE, category: 'Dining' }),
      // p1 pays for something only they use -> affects nobody
      expense('e4', 5000, { payer: PERSON.P1, payerShare: 1, category: 'Household' }),
    ]

    const before = computeBalance(expenses)
    // e1: p2 owes 4331 - round(4331/2)=2166 -> 2165
    // e2: p2 owes all 1999
    // e3: p1 owes 8049 - round(8049*0.5)=4025 -> 4024
    // e4: nobody owes anything
    expect(before.netCents).toBe(2165 + 1999 - 4024)
    expect(before.netCents).toBe(140)
    expect(before.debtor).toBe(PERSON.P2)
    expect(before.creditor).toBe(PERSON.P1)
    expect(before.amountCents).toBe(140)

    // The debtor hands over exactly what is outstanding.
    const payoff = settlement('s1', before.amountCents, { payer: before.debtor })
    const after = computeBalance([...expenses, payoff])

    expect(after.netCents).toBe(0)
    expect(after.amountCents).toBe(0)
    expect(after.debtor).toBeNull()
    expect(after.creditor).toBeNull()
  })

  it('overshoots correctly if the settlement is too large, and flips the debtor', () => {
    const expenses = [expense('e1', 10000, { payer: PERSON.P1 })]
    expect(computeBalance(expenses).netCents).toBe(5000)

    const tooMuch = computeBalance([...expenses, settlement('s1', 6000, { payer: PERSON.P2 })])
    expect(tooMuch.netCents).toBe(-1000)
    expect(tooMuch.debtor).toBe(PERSON.P1)
    expect(tooMuch.creditor).toBe(PERSON.P2)
  })

  it('leaves a remainder if the settlement is a partial payment', () => {
    const entries = [
      expense('e1', 10000, { payer: PERSON.P1 }),
      settlement('s1', 2000, { payer: PERSON.P2 }),
    ]
    const balance = computeBalance(entries)
    expect(balance.netCents).toBe(3000)
    expect(balance.debtor).toBe(PERSON.P2)
  })

  it('is unaffected by entry order', () => {
    const entries = [
      expense('e1', 4331, { payer: PERSON.P1 }),
      expense('e2', 8049, { payer: PERSON.P2, payerShare: 0.7 }),
      settlement('s1', 111, { payer: PERSON.P1 }),
    ]
    const forward = computeBalance(entries).netCents
    const backward = computeBalance([...entries].reverse()).netCents
    expect(forward).toBe(backward)
  })
})

describe('soft deletes are excluded from every aggregate', () => {
  const live = expense('live', 5000, { payer: PERSON.P1, category: 'Groceries' })
  const dead = expense('dead', 999900, {
    payer: PERSON.P2,
    category: 'Dining',
    date: '2020-01-01',
    deletedAt: '2026-03-02T00:00:00.000Z',
  })
  const deadSettlement = settlement('deadS', 500000, {
    payer: PERSON.P2,
    deletedAt: '2026-03-02T00:00:00.000Z',
  })
  const entries = [live, dead, deadSettlement]

  it('computeBalance', () => {
    expect(computeBalance(entries)).toEqual(computeBalance([live]))
    expect(computeBalance(entries).netCents).toBe(2500)
  })

  it('totalSpend', () => {
    expect(totalSpend(entries)).toBe(5000)
  })

  it('spendByCategory', () => {
    expect(spendByCategory(entries)).toEqual([{ category: 'Groceries', totalCents: 5000 }])
  })

  it('spendByPerson', () => {
    expect(spendByPerson(entries)).toEqual({ p1: 5000, p2: 0 })
  })

  it('filterByMonth and monthKeysPresent', () => {
    expect(filterByMonth(entries, '2020-01')).toEqual([])
    expect(filterByMonth(entries, '2026-03')).toEqual([live])
    expect(monthKeysPresent(entries)).toEqual(['2026-03'])
  })

  it('groupByDate', () => {
    const groups = groupByDate(entries)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toEqual({ date: '2026-03-10', entries: [live], totalCents: 5000 })
  })

  it('treats any truthy deletedAt as deleted', () => {
    const oddly = expense('odd', 100, { deletedAt: 'yes' })
    expect(totalSpend([oddly])).toBe(0)
    expect(computeBalance([oddly]).netCents).toBe(0)
  })

  it('does not treat an empty-string deletedAt as deleted', () => {
    // rowToEntry normalises '' to null, but defend the boundary anyway.
    const notDeleted = expense('nd', 100, { deletedAt: '' })
    expect(totalSpend([notDeleted])).toBe(100)
  })
})

describe('deletedEntries', () => {
  const live = expense('live', 5000)
  const first = expense('first', 100, { deletedAt: '2026-03-02T00:00:00.000Z' })
  const second = expense('second', 200, { deletedAt: '2026-03-04T00:00:00.000Z' })

  it('is exactly the complement of what every aggregate keeps', () => {
    expect(deletedEntries([live, first, second], '2026-03').map((e) => e.id)).toEqual([
      'second',
      'first',
    ])
  })

  it('puts the most recently deleted first, which is what someone is looking for', () => {
    expect(deletedEntries([first, second], '2026-03')[0].id).toBe('second')
  })

  it('scopes to the month on screen: it sits under the month switcher', () => {
    // Deleted in March, but spent in January — it belongs to January's list, or
    // it reads as a January expense that was deleted from March.
    const january = expense('jan', 300, {
      date: '2026-01-15',
      deletedAt: '2026-03-03T00:00:00.000Z',
    })
    expect(deletedEntries([first, january, second], '2026-03').map((e) => e.id)).toEqual([
      'second',
      'first',
    ])
    expect(deletedEntries([first, january, second], '2026-01').map((e) => e.id)).toEqual(['jan'])
  })

  it('sorts by when it was deleted, not by when it was spent', () => {
    // Same month, opposite orders: the 1st was deleted last.
    const early = expense('early', 100, {
      date: '2026-03-01',
      deletedAt: '2026-03-20T00:00:00.000Z',
    })
    const late = expense('late', 100, {
      date: '2026-03-28',
      deletedAt: '2026-03-02T00:00:00.000Z',
    })
    expect(deletedEntries([early, late], '2026-03').map((e) => e.id)).toEqual(['early', 'late'])
  })

  it('excludes a dateless tombstone, like every other month-scoped view', () => {
    const undated = expense('undated', 100, { date: '', deletedAt: '2026-03-05T00:00:00.000Z' })
    expect(deletedEntries([undated], '2026-03')).toEqual([])
  })

  it('does not mutate the list it was handed', () => {
    const entries = [first, second]
    deletedEntries(entries, '2026-03')
    expect(entries.map((e) => e.id)).toEqual(['first', 'second'])
  })

  it('survives a missing or malformed list, and a bad month key', () => {
    expect(deletedEntries(undefined, '2026-03')).toEqual([])
    expect(deletedEntries([null, undefined], '2026-03')).toEqual([])
    expect(deletedEntries([first, second], 'nope')).toEqual([])
    expect(deletedEntries([first, second], undefined)).toEqual([])
  })
})

describe('settlements are transfers, not spending', () => {
  const entries = [
    expense('e1', 3000, { payer: PERSON.P1, category: 'Groceries' }),
    expense('e2', 2000, { payer: PERSON.P2, category: 'Dining' }),
    settlement('s1', 500, { payer: PERSON.P2 }),
    settlement('s2', 250, { payer: PERSON.P1, category: 'Groceries' }),
  ]

  it('are excluded from totalSpend', () => {
    expect(totalSpend(entries)).toBe(5000)
  })

  it('are excluded from spendByCategory even if a category leaked onto them', () => {
    expect(spendByCategory(entries)).toEqual([
      { category: 'Groceries', totalCents: 3000 },
      { category: 'Dining', totalCents: 2000 },
    ])
  })

  it('are excluded from spendByPerson', () => {
    expect(spendByPerson(entries)).toEqual({ p1: 3000, p2: 2000 })
  })

  it('DO affect computeBalance', () => {
    // Expenses alone: p2 owes 1500, p1 owes 1000 -> net +500 to p1.
    expect(computeBalance(entries.filter((e) => e.type === ENTRY_TYPE.EXPENSE)).netCents).toBe(500)
    // p2 settles 500 and p1 settles 250 -> net 500 - 500 + 250 = 250.
    expect(computeBalance(entries).netCents).toBe(250)
  })

  it('are still listed by groupByDate but not counted in the day total', () => {
    const group = groupByDate([settlement('only', 9999)])[0]
    expect(group.entries).toHaveLength(1)
    expect(group.totalCents).toBe(0)
  })
})

describe('totalSpend', () => {
  const entries = [
    expense('a', 1000, { payer: PERSON.P1, category: 'Groceries' }),
    expense('b', 2000, { payer: PERSON.P2, category: 'Dining' }),
    expense('c', 3000, { payer: PERSON.P1, category: '' }),
  ]

  it('sums all expenses', () => {
    expect(totalSpend(entries)).toBe(6000)
    expect(totalSpend([])).toBe(0)
    expect(totalSpend(null)).toBe(0)
  })

  it('can be narrowed to one payer or one category', () => {
    expect(totalSpend(entries, { payer: PERSON.P1 })).toBe(4000)
    expect(totalSpend(entries, { payer: PERSON.P2 })).toBe(2000)
    expect(totalSpend(entries, { category: 'Dining' })).toBe(2000)
    expect(totalSpend(entries, { category: 'Uncategorized' })).toBe(3000)
    expect(totalSpend(entries, { payer: PERSON.P2, category: 'Groceries' })).toBe(0)
  })

  it('returns an integer, never a float', () => {
    expect(Number.isInteger(totalSpend(entries))).toBe(true)
  })
})

describe('spendByCategory', () => {
  it('sorts descending by total', () => {
    const entries = [
      expense('a', 100, { category: 'Groceries' }),
      expense('b', 900, { category: 'Dining' }),
      expense('c', 400, { category: 'Household' }),
      expense('d', 100, { category: 'Groceries' }),
    ]
    expect(spendByCategory(entries)).toEqual([
      { category: 'Dining', totalCents: 900 },
      { category: 'Household', totalCents: 400 },
      { category: 'Groceries', totalCents: 200 },
    ])
  })

  it('groups missing, blank, and whitespace-free absent categories under Uncategorized', () => {
    const entries = [
      expense('a', 100, { category: '' }),
      expense('b', 200, { category: undefined }),
      expense('c', 300, { category: 'Dining' }),
    ]
    expect(spendByCategory(entries)).toEqual([
      { category: 'Dining', totalCents: 300 },
      { category: 'Uncategorized', totalCents: 300 },
    ])
  })

  it('breaks ties by name so the order is stable', () => {
    const entries = [
      expense('a', 500, { category: 'Zoo' }),
      expense('b', 500, { category: 'Apples' }),
      expense('c', 500, { category: 'Meals' }),
    ]
    expect(spendByCategory(entries).map((row) => row.category)).toEqual(['Apples', 'Meals', 'Zoo'])
  })

  it('returns an empty array for no expenses', () => {
    expect(spendByCategory([])).toEqual([])
    expect(spendByCategory([settlement('s', 100)])).toEqual([])
  })

  it('totals across categories equal totalSpend', () => {
    const entries = [
      expense('a', 1234, { category: 'Groceries' }),
      expense('b', 5678, { category: 'Dining' }),
      expense('c', 9, { category: '' }),
      settlement('s', 1000),
    ]
    const sum = spendByCategory(entries).reduce((acc, row) => acc + row.totalCents, 0)
    expect(sum).toBe(totalSpend(entries))
  })
})

describe('spendByPerson', () => {
  it('reports what each person actually paid out', () => {
    const entries = [
      expense('a', 1000, { payer: PERSON.P1 }),
      expense('b', 2500, { payer: PERSON.P2 }),
      expense('c', 500, { payer: PERSON.P1, payerShare: 1 }),
    ]
    expect(spendByPerson(entries)).toEqual({ p1: 1500, p2: 2500 })
  })

  it('is zero for both when there are no expenses', () => {
    expect(spendByPerson([])).toEqual({ p1: 0, p2: 0 })
    expect(spendByPerson([settlement('s', 9999)])).toEqual({ p1: 0, p2: 0 })
  })

  it('sums to totalSpend', () => {
    const entries = [
      expense('a', 1111, { payer: PERSON.P1 }),
      expense('b', 2222, { payer: PERSON.P2 }),
    ]
    const { p1, p2 } = spendByPerson(entries)
    expect(p1 + p2).toBe(totalSpend(entries))
  })
})

describe('filterByMonth', () => {
  const entries = [
    expense('jan', 100, { date: '2026-01-31' }),
    expense('feb1', 200, { date: '2026-02-01' }),
    expense('feb28', 300, { date: '2026-02-28' }),
    expense('mar', 400, { date: '2026-03-01' }),
    expense('blank', 500, { date: '' }),
  ]

  it('includes the first and last day of the month — no timezone drift', () => {
    const feb = filterByMonth(entries, '2026-02').map((e) => e.id)
    expect(feb).toEqual(['feb1', 'feb28'])
  })

  it('does not bleed into neighbouring months', () => {
    expect(filterByMonth(entries, '2026-01').map((e) => e.id)).toEqual(['jan'])
    expect(filterByMonth(entries, '2026-03').map((e) => e.id)).toEqual(['mar'])
    expect(filterByMonth(entries, '2026-04')).toEqual([])
  })

  it('excludes entries with a blank date', () => {
    const allMonths = ['2026-01', '2026-02', '2026-03', '2026-04', '2025-12']
    for (const month of allMonths) {
      expect(filterByMonth(entries, month).some((e) => e.id === 'blank')).toBe(false)
    }
  })

  it('rejects a malformed month key instead of matching by accident', () => {
    for (const bad of ['2026-2', '2026', '', null, undefined, '2026-02-01', 202602]) {
      expect(filterByMonth(entries, bad)).toEqual([])
    }
  })

  it('is a prefix match, not a substring match', () => {
    const tricky = [expense('x', 100, { date: '1926-02-05' })]
    expect(filterByMonth(tricky, '2026-02')).toEqual([])
    expect(filterByMonth(tricky, '1926-02')).toHaveLength(1)
  })

  it('composes with the other aggregates', () => {
    const feb = filterByMonth(entries, '2026-02')
    expect(totalSpend(feb)).toBe(500)
  })
})

describe('monthKeysPresent', () => {
  it('returns unique months newest first', () => {
    const entries = [
      expense('a', 100, { date: '2025-12-31' }),
      expense('b', 100, { date: '2026-02-01' }),
      expense('c', 100, { date: '2026-02-15' }),
      settlement('d', 100, { date: '2026-01-05' }),
    ]
    expect(monthKeysPresent(entries)).toEqual(['2026-02', '2026-01', '2025-12'])
  })

  it('sorts across a year boundary correctly', () => {
    const entries = [
      expense('a', 100, { date: '2025-09-01' }),
      expense('b', 100, { date: '2026-01-01' }),
      expense('c', 100, { date: '2025-10-01' }),
    ]
    expect(monthKeysPresent(entries)).toEqual(['2026-01', '2025-10', '2025-09'])
  })

  it('skips blank dates and deleted entries and returns [] for nothing', () => {
    expect(monthKeysPresent([])).toEqual([])
    expect(monthKeysPresent([expense('a', 100, { date: '' })])).toEqual([])
    expect(
      monthKeysPresent([expense('a', 100, { date: '2026-05-01', deletedAt: 'x' })]),
    ).toEqual([])
  })

  it('every returned key selects at least one entry', () => {
    const entries = [
      expense('a', 100, { date: '2026-02-01' }),
      expense('b', 100, { date: '2025-11-30' }),
    ]
    for (const key of monthKeysPresent(entries)) {
      expect(filterByMonth(entries, key).length).toBeGreaterThan(0)
    }
  })
})

describe('groupByDate', () => {
  it('groups by day, newest day first, newest entry first within a day', () => {
    const entries = [
      expense('old', 100, { date: '2026-03-01', now: '2026-03-01T10:00:00.000Z' }),
      expense('mid', 200, { date: '2026-03-05', now: '2026-03-05T08:00:00.000Z' }),
      expense('late', 300, { date: '2026-03-05', now: '2026-03-05T21:00:00.000Z' }),
      expense('newest', 400, { date: '2026-03-09', now: '2026-03-09T09:00:00.000Z' }),
    ]
    const groups = groupByDate(entries)
    expect(groups.map((g) => g.date)).toEqual(['2026-03-09', '2026-03-05', '2026-03-01'])
    expect(groups[1].entries.map((e) => e.id)).toEqual(['late', 'mid'])
    expect(groups[1].totalCents).toBe(500)
  })

  it('keeps every active entry exactly once', () => {
    const entries = [
      expense('a', 100, { date: '2026-03-01' }),
      expense('b', 100, { date: '2026-03-01' }),
      settlement('c', 100, { date: '2026-03-02' }),
      expense('d', 100, { date: '2026-03-02', deletedAt: 'x' }),
    ]
    const ids = groupByDate(entries).flatMap((g) => g.entries.map((e) => e.id))
    expect(ids.sort()).toEqual(['a', 'b', 'c'])
  })

  it('is deterministic when createdAt ties', () => {
    const same = '2026-03-05T08:00:00.000Z'
    const entries = [
      expense('bbb', 100, { date: '2026-03-05', now: same }),
      expense('aaa', 100, { date: '2026-03-05', now: same }),
      expense('ccc', 100, { date: '2026-03-05', now: same }),
    ]
    const first = groupByDate(entries)[0].entries.map((e) => e.id)
    const second = groupByDate([...entries].reverse())[0].entries.map((e) => e.id)
    expect(first).toEqual(second)
  })

  it('does not mutate or reorder the input array', () => {
    const entries = [
      expense('a', 100, { date: '2026-03-01' }),
      expense('b', 100, { date: '2026-03-09' }),
    ]
    const snapshot = entries.map((e) => e.id)
    groupByDate(entries)
    expect(entries.map((e) => e.id)).toEqual(snapshot)
  })

  it('keeps blank-dated entries visible, sorted last', () => {
    const entries = [
      expense('dated', 100, { date: '2026-03-01' }),
      expense('undated', 200, { date: '' }),
    ]
    const groups = groupByDate(entries)
    expect(groups.map((g) => g.date)).toEqual(['2026-03-01', ''])
    expect(groups.at(-1).entries.map((e) => e.id)).toEqual(['undated'])
  })

  it('day totals across all groups equal totalSpend', () => {
    const entries = [
      expense('a', 1234, { date: '2026-03-01' }),
      expense('b', 4321, { date: '2026-03-02' }),
      settlement('s', 1000, { date: '2026-03-02' }),
      expense('c', 7, { date: '' }),
    ]
    const sum = groupByDate(entries).reduce((acc, g) => acc + g.totalCents, 0)
    expect(sum).toBe(totalSpend(entries))
  })

  it('returns [] for nothing to show', () => {
    expect(groupByDate([])).toEqual([])
    expect(groupByDate(null)).toEqual([])
  })
})

describe('end-to-end: a month of shared life', () => {
  const entries = [
    expense('g1', 8735, { payer: PERSON.P1, category: 'Groceries', date: '2026-03-02' }),
    expense('d1', 6200, { payer: PERSON.P2, category: 'Dining', date: '2026-03-05' }),
    expense('h1', 4999, { payer: PERSON.P1, category: 'Household', date: '2026-03-07' }),
    expense('solo', 12000, {
      payer: PERSON.P2,
      category: 'Other',
      date: '2026-03-08',
      payerShare: 1,
    }),
    expense('gift', 3300, {
      payer: PERSON.P2,
      category: 'Other',
      date: '2026-03-09',
      payerShare: 0,
    }),
    expense('void', 50000, {
      payer: PERSON.P1,
      category: 'Dining',
      date: '2026-03-09',
      deletedAt: '2026-03-10T00:00:00.000Z',
    }),
    expense('lastmonth', 1000, { payer: PERSON.P1, category: 'Dining', date: '2026-02-27' }),
  ]

  it('spend excludes the deleted row and other months', () => {
    const march = filterByMonth(entries, '2026-03')
    expect(totalSpend(march)).toBe(8735 + 6200 + 4999 + 12000 + 3300)
    expect(spendByCategory(march).map((r) => r.category)).toEqual([
      'Other',
      'Groceries',
      'Dining',
      'Household',
    ])
    expect(spendByPerson(march)).toEqual({ p1: 8735 + 4999, p2: 6200 + 12000 + 3300 })
  })

  it('settling the whole-history balance zeroes it out', () => {
    const before = computeBalance(entries)
    expect(before.netCents).not.toBe(0)
    const payoff = settlement('payoff', before.amountCents, {
      payer: before.debtor,
      date: '2026-03-31',
    })
    const after = computeBalance([...entries, payoff])
    expect(after).toEqual({ netCents: 0, debtor: null, creditor: null, amountCents: 0 })
    // ...and the payoff changed nothing about spend.
    expect(totalSpend([...entries, payoff])).toBe(totalSpend(entries))
    expect(spendByCategory([...entries, payoff])).toEqual(spendByCategory(entries))
  })

  it('settling a single month does not zero the whole history', () => {
    const march = filterByMonth(entries, '2026-03')
    const marchBalance = computeBalance(march)
    const payoff = settlement('payoff', marchBalance.amountCents, {
      payer: marchBalance.debtor,
      date: '2026-03-31',
    })
    expect(computeBalance([...march, payoff]).netCents).toBe(0)
    expect(computeBalance([...entries, payoff]).netCents).not.toBe(0)
  })
})
