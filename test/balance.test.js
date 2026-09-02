import { describe, it, expect } from 'vitest'
import {
  owedToPayerYen,
  computeBalance,
  totalSpend,
  spendByCategory,
  shareByPerson,
  spendByPerson,
  filterByMonth,
  monthKeysPresent,
  initialMonthKey,
  groupByDate,
  deletedEntries,
} from '../src/lib/balance.js'
import { PERSON, ENTRY_TYPE, EVEN_SHARE } from '../src/schema.js'
import { expense as anExpense, settlement as aSettlement } from './support/entries.js'

/**
 * Deterministic entry factory: explicit id, no crypto.
 *
 * An entry reads no clock, so nothing has to be injected for these to be reproducible.
 * The ids ARE the within-a-day order now (`groupByDate` sorts by id), so a test about
 * that ordering has to choose them deliberately rather than incidentally.
 */

/**
 * The shared fixtures at this file's own values. Almost everything here is about a
 * month, so the dates are March and stay visible in one place; the id and the amount
 * are positional because they are what nearly every assertion below turns on.
 */
function expense(id, amountYen, overrides = {}) {
  return anExpense({ id, amountYen, date: '2026-03-10', ...overrides })
}

function settlement(id, amountYen, overrides = {}) {
  return aSettlement({ id, amountYen, date: '2026-03-31', ...overrides })
}

describe('owedToPayerYen', () => {
  it('is the non-payer share of the amount', () => {
    expect(owedToPayerYen(expense('a', 10000, { payerShare: EVEN_SHARE }))).toBe(5000)
    expect(owedToPayerYen(expense('b', 10000, { payerShare: 1 }))).toBe(0)
    expect(owedToPayerYen(expense('c', 10000, { payerShare: 0 }))).toBe(10000)
    expect(owedToPayerYen(expense('d', 10000, { payerShare: 0.25 }))).toBe(7500)
  })

  it('rounds so the payer and other portions still add to the amount', () => {
    const e = expense('odd', 101, { payerShare: EVEN_SHARE })
    expect(owedToPayerYen(e)).toBe(50)
    expect(e.amountYen - owedToPayerYen(e)).toBe(51)
  })

  it('treats a settlement as fully owed to the payer', () => {
    const s = settlement('s1', 5000)
    expect(s.payerShare).toBe(0)
    expect(owedToPayerYen(s)).toBe(5000)
  })

  it('tolerates a numeric-string share, which a form can hand to makeEntry', () => {
    // A form input can hand '0.5' straight to makeEntry; the balance must not
    // crash on it, but genuine junk must still be loud.
    expect(owedToPayerYen(expense('str', 10000, { payerShare: '0.5' }))).toBe(5000)
    expect(computeBalance([expense('str', 10000, { payerShare: '0.25' })]).netYen).toBe(7500)
    expect(() => owedToPayerYen(expense('junk', 10000, { payerShare: 'half' }))).toThrow(TypeError)
  })
})

describe('computeBalance', () => {
  it('reports settled for no entries', () => {
    expect(computeBalance([])).toEqual({
      netYen: 0,
      debtor: null,
      creditor: null,
      amountYen: 0,
    })
    expect(computeBalance(undefined)).toEqual({
      netYen: 0,
      debtor: null,
      creditor: null,
      amountYen: 0,
    })
  })

  it('reports settled when two mirrored expenses cancel out', () => {
    const entries = [
      expense('a', 4000, { payer: PERSON.P1 }),
      expense('b', 4000, { payer: PERSON.P2 }),
    ]
    expect(computeBalance(entries)).toEqual({
      netYen: 0,
      debtor: null,
      creditor: null,
      amountYen: 0,
    })
  })

  it('says p2 owes p1 when p1 paid', () => {
    const balance = computeBalance([expense('a', 4000, { payer: PERSON.P1 })])
    expect(balance.netYen).toBe(2000)
    expect(balance.amountYen).toBe(2000)
    expect(balance.debtor).toBe(PERSON.P2)
    expect(balance.creditor).toBe(PERSON.P1)
  })

  it('says p1 owes p2 when p2 paid', () => {
    const balance = computeBalance([expense('a', 4000, { payer: PERSON.P2 })])
    expect(balance.netYen).toBe(-2000)
    expect(balance.amountYen).toBe(2000)
    expect(balance.debtor).toBe(PERSON.P1)
    expect(balance.creditor).toBe(PERSON.P2)
  })

  it('handles an expense bought entirely for the other person', () => {
    const balance = computeBalance([expense('gift', 3000, { payer: PERSON.P1, payerShare: 0 })])
    expect(balance.netYen).toBe(3000)
    expect(balance.debtor).toBe(PERSON.P2)
  })

  it('ignores an expense the payer bought only for themselves', () => {
    const balance = computeBalance([expense('mine', 3000, { payer: PERSON.P1, payerShare: 1 })])
    expect(balance).toEqual({ netYen: 0, debtor: null, creditor: null, amountYen: 0 })
  })

  // ── The most important test in the suite ────────────────────────────────
  it('drives the balance to exactly zero when a settlement pays off the outstanding amount', () => {
    const expenses = [
      // p1 fronts the groceries, split evenly -> p2 owes 2166 (of 4331, an odd amount)
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
    expect(before.netYen).toBe(2165 + 1999 - 4024)
    expect(before.netYen).toBe(140)
    expect(before.debtor).toBe(PERSON.P2)
    expect(before.creditor).toBe(PERSON.P1)
    expect(before.amountYen).toBe(140)

    // The debtor hands over exactly what is outstanding.
    const payoff = settlement('s1', before.amountYen, { payer: before.debtor })
    const after = computeBalance([...expenses, payoff])

    expect(after.netYen).toBe(0)
    expect(after.amountYen).toBe(0)
    expect(after.debtor).toBeNull()
    expect(after.creditor).toBeNull()
  })

  it('overshoots correctly if the settlement is too large, and flips the debtor', () => {
    const expenses = [expense('e1', 10000, { payer: PERSON.P1 })]
    expect(computeBalance(expenses).netYen).toBe(5000)

    const tooMuch = computeBalance([...expenses, settlement('s1', 6000, { payer: PERSON.P2 })])
    expect(tooMuch.netYen).toBe(-1000)
    expect(tooMuch.debtor).toBe(PERSON.P1)
    expect(tooMuch.creditor).toBe(PERSON.P2)
  })

  it('leaves a remainder if the settlement is a partial payment', () => {
    const entries = [
      expense('e1', 10000, { payer: PERSON.P1 }),
      settlement('s1', 2000, { payer: PERSON.P2 }),
    ]
    const balance = computeBalance(entries)
    expect(balance.netYen).toBe(3000)
    expect(balance.debtor).toBe(PERSON.P2)
  })

  it('is unaffected by entry order', () => {
    const entries = [
      expense('e1', 4331, { payer: PERSON.P1 }),
      expense('e2', 8049, { payer: PERSON.P2, payerShare: 0.7 }),
      settlement('s1', 111, { payer: PERSON.P1 }),
    ]
    // Against a literal, not against itself: comparing the two directions alone is
    // commutativity of integer addition, which holds however wrong the arithmetic is.
    // e1: p2 owes 4331 - round(4331/2) = 2165, in p1's favour.
    // e2: p1 owes 30% of 8049 = 8049 - round(8049 * 0.7) = 2415, in p2's favour.
    // s1: p1 hands over 111, which is 111 more owed back to p1.
    expect(computeBalance(entries).netYen).toBe(2165 - 2415 + 111)
    expect(computeBalance([...entries].reverse()).netYen).toBe(2165 - 2415 + 111)
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
    expect(computeBalance(entries).netYen).toBe(2500)
  })

  it('totalSpend', () => {
    expect(totalSpend(entries)).toBe(5000)
  })

  it('spendByCategory', () => {
    expect(spendByCategory(entries)).toEqual([{ category: 'Groceries', totalYen: 5000 }])
  })

  it('spendByPerson', () => {
    expect(spendByPerson(entries)).toEqual({ p1: 5000, p2: 0 })
  })

  it('filterByMonth', () => {
    expect(filterByMonth(entries, '2020-01')).toEqual([])
    expect(filterByMonth(entries, '2026-03')).toEqual([live])
  })

  it('groupByDate', () => {
    const groups = groupByDate(entries)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toEqual({ date: '2026-03-10', entries: [live], totalYen: 5000 })
  })

  it('treats any truthy deletedAt as deleted', () => {
    const oddly = expense('odd', 100, { deletedAt: 'yes' })
    expect(totalSpend([oddly])).toBe(0)
    expect(computeBalance([oddly]).netYen).toBe(0)
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

  it('lists a month’s tombstones, newest deletion first, and keeps live rows out', () => {
    expect(deletedEntries([live, first, second], '2026-03').map((e) => e.id)).toEqual([
      'second',
      'first',
    ])
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
      { category: 'Groceries', totalYen: 3000 },
      { category: 'Dining', totalYen: 2000 },
    ])
  })

  it('are excluded from spendByPerson', () => {
    expect(spendByPerson(entries)).toEqual({ p1: 3000, p2: 2000 })
  })

  it('DO affect computeBalance', () => {
    // Expenses alone: p2 owes 1500, p1 owes 1000 -> net +500 to p1.
    expect(computeBalance(entries.filter((e) => e.type === ENTRY_TYPE.EXPENSE)).netYen).toBe(500)
    // p2 settles 500 and p1 settles 250 -> net 500 - 500 + 250 = 250.
    expect(computeBalance(entries).netYen).toBe(250)
  })

  it('are still listed by groupByDate but not counted in the day total', () => {
    const group = groupByDate([settlement('only', 9999)])[0]
    expect(group.entries).toHaveLength(1)
    expect(group.totalYen).toBe(0)
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
      { category: 'Dining', totalYen: 900 },
      { category: 'Household', totalYen: 400 },
      { category: 'Groceries', totalYen: 200 },
    ])
  })

  it('groups missing, blank, and whitespace-free absent categories under Uncategorized', () => {
    const entries = [
      expense('a', 100, { category: '' }),
      expense('b', 200, { category: undefined }),
      expense('c', 300, { category: 'Dining' }),
    ]
    expect(spendByCategory(entries)).toEqual([
      { category: 'Dining', totalYen: 300 },
      { category: 'Uncategorized', totalYen: 300 },
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
    const sum = spendByCategory(entries).reduce((acc, row) => acc + row.totalYen, 0)
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

/**
 * The other half of `spendByPerson`: not who handed over the cash, but who the cost belongs to
 * once every `payer_share` is applied. The invariant that matters is that the two add up to the
 * month exactly — a percentage taken per person independently would lose a yen on every odd
 * split, and the loss would land in a figure nobody could check against anything.
 */
describe('shareByPerson', () => {
  it('gives each person their own share of what either of them paid', () => {
    const entries = [
      // p1 paid 1000 and covers 30% of it, so p2 owes 700.
      expense('a', 1000, { payer: PERSON.P1, payerShare: 0.3 }),
      // p2 paid 500 and covers all of it.
      expense('b', 500, { payer: PERSON.P2, payerShare: 1 }),
    ]
    expect(shareByPerson(entries)).toEqual({ p1: 300, p2: 1200 })
  })

  it('is the same figure as what was paid when everything is an even split', () => {
    const entries = [
      expense('a', 1000, { payer: PERSON.P1 }),
      expense('b', 1000, { payer: PERSON.P2 }),
    ]
    expect(shareByPerson(entries)).toEqual(spendByPerson(entries))
  })

  it('charges the whole amount to the other person at a share of 0', () => {
    // Bought FOR the other person: the payer's own share is nothing.
    expect(shareByPerson([expense('a', 900, { payer: PERSON.P1, payerShare: 0 })])).toEqual({
      p1: 0,
      p2: 900,
    })
  })

  it('conserves every yen, at shares that do not divide evenly', () => {
    // The rounding has to land somewhere, and `splitYen` puts it on the non-payer — so the two
    // shares add to the month rather than to the month plus or minus a yen per entry.
    const entries = [
      expense('a', 1001, { payer: PERSON.P1, payerShare: 1 / 3 }),
      expense('b', 777, { payer: PERSON.P2, payerShare: 0.7 }),
      expense('c', 3, { payer: PERSON.P1, payerShare: 0.5 }),
    ]
    const { p1, p2 } = shareByPerson(entries)
    expect(p1 + p2).toBe(totalSpend(entries))
  })

  it('counts no settlement and no tombstone', () => {
    // A settlement moves cash to square these two figures up; counting one charges the same
    // money twice. A tombstone is out of every total by definition.
    expect(shareByPerson([settlement('s', 9999)])).toEqual({ p1: 0, p2: 0 })
    expect(shareByPerson([])).toEqual({ p1: 0, p2: 0 })
    const live = expense('a', 1000, { payer: PERSON.P1, payerShare: 0.25 })
    const dead = { ...expense('b', 5000, { payer: PERSON.P2 }), deletedAt: '2026-08-09T00:00:00Z' }
    expect(shareByPerson([live, dead])).toEqual({ p1: 250, p2: 750 })
  })

  /**
   * The pair of figures is the point of showing both: paid minus share IS what that person is
   * owed for the month, and it has to agree with `computeBalance` over the same rows or the card
   * and the header would tell two different stories.
   */
  it('differs from what was paid by exactly the balance those rows produce', () => {
    const entries = [
      expense('a', 4820, { payer: PERSON.P1, payerShare: 0.5 }),
      expense('b', 1280, { payer: PERSON.P2, payerShare: 0.5 }),
      expense('c', 3150, { payer: PERSON.P1, payerShare: 0 }),
    ]
    const paid = spendByPerson(entries)
    const share = shareByPerson(entries)
    expect(paid.p1 - share.p1).toBe(computeBalance(entries).netYen)
    expect(paid.p2 - share.p2).toBe(-computeBalance(entries).netYen)
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
    expect(monthKeysPresent([expense('a', 100, { date: '2026-05-01', deletedAt: 'x' })])).toEqual(
      [],
    )
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
  it('groups by day, newest day first, and stably within a day', () => {
    const entries = [
      expense('old', 100, { date: '2026-03-01' }),
      expense('mid', 200, { date: '2026-03-05' }),
      expense('late', 300, { date: '2026-03-05' }),
      expense('newest', 400, { date: '2026-03-09' }),
    ]
    const groups = groupByDate(entries)
    expect(groups.map((g) => g.date)).toEqual(['2026-03-09', '2026-03-05', '2026-03-01'])
    // Within a day the order is by id, descending. Arbitrary, but it must not depend on
    // which tab the rows arrived from — so it is asserted against the reversed input
    // too, which is what pins the sort rather than the fixture's order.
    expect(groups[1].entries.map((e) => e.id)).toEqual(['mid', 'late'])
    expect(groupByDate([...entries].reverse())[1].entries.map((e) => e.id)).toEqual(['mid', 'late'])
    expect(groups[1].totalYen).toBe(500)
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

  it('orders a day by id descending, whatever order the rows arrived in', () => {
    const entries = [
      expense('bbb', 100, { date: '2026-03-05' }),
      expense('aaa', 100, { date: '2026-03-05' }),
      expense('ccc', 100, { date: '2026-03-05' }),
    ]
    // The literal order, not just "the same both ways": equal-but-arbitrary would pass
    // a stability check while still depending on which tab the rows came from.
    expect(groupByDate(entries)[0].entries.map((e) => e.id)).toEqual(['ccc', 'bbb', 'aaa'])
    expect(groupByDate([...entries].reverse())[0].entries.map((e) => e.id)).toEqual([
      'ccc',
      'bbb',
      'aaa',
    ])
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
    const sum = groupByDate(entries).reduce((acc, g) => acc + g.totalYen, 0)
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

  it('settling a single month does not zero the whole history', () => {
    const march = filterByMonth(entries, '2026-03')
    const marchBalance = computeBalance(march)
    const payoff = settlement('payoff', marchBalance.amountYen, {
      payer: marchBalance.debtor,
      date: '2026-03-31',
    })
    expect(computeBalance([...march, payoff]).netYen).toBe(0)
    expect(computeBalance([...entries, payoff]).netYen).not.toBe(0)
  })
})

/**
 * Which month the app opens on. A sheet whose last entry was months ago should not
 * open on an empty screen, but somebody who has been using the app this month must
 * not have it moved out from under them either.
 */
describe('initialMonthKey', () => {
  const march = expense('m', 1000, { date: '2026-03-10' })
  const january = expense('j', 1000, { date: '2026-01-10' })

  it('stays put when the current month has data of its own', () => {
    expect(initialMonthKey([march, january], '2026-03')).toBeNull()
  })

  it('jumps to the newest month with data when the current one has none', () => {
    expect(initialMonthKey([january, march], '2026-08')).toBe('2026-03')
  })

  it('stays put when there is no data at all, rather than jumping to nothing', () => {
    expect(initialMonthKey([], '2026-08')).toBeNull()
    // A dated-but-deleted row is not data: monthKeysPresent filters it out.
    expect(initialMonthKey([expense('d', 1000, { deletedAt: 'x' })], '2026-08')).toBeNull()
  })

  it('ignores rows with no usable date', () => {
    expect(initialMonthKey([expense('n', 1000, { date: '' })], '2026-08')).toBeNull()
  })
})
