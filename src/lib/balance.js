/**
 * Pure aggregation over entries. No I/O, no Date construction, no React.
 *
 * Soft deletes are real deletes to every aggregate, so everything filters through `isActive`. And
 * `payerShare` is the fraction the payer covers themselves, so the non-payer owes `amountYen * (1
 * - payerShare)` — a settlement is an entry with `payerShare` 0, which is why nothing below
 * special-cases the type.
 */

import { PEOPLE, PERSON, isActive, isSettlement, otherPerson } from '../schema.js'
import { splitYen, sumYen } from './money.js'
import { isMonthKey } from './dates.js'
import { isRecurringInstance } from './recurring.js'

/** Where a blank category lands. Exported so the UI labels exactly this bucket. */
export const UNCATEGORIZED = 'Uncategorized'

/**
 * Newest-first for anything whose keys sort lexicographically the way they sort chronologically.
 * The one comparator, so no list can end up ordered the other way by a typo.
 */
function descending(a, b) {
  return a < b ? 1 : a > b ? -1 : 0
}

function activeEntries(entries) {
  return Array.isArray(entries) ? entries.filter(isActive) : []
}

/** What every spend figure counts: settlements are transfers, so they are in none of them. */
function activeExpenses(entries) {
  return activeEntries(entries).filter((entry) => !isSettlement(entry))
}

/** An ISO date we can safely take a 'YYYY-MM' prefix from. */
function hasDate(entry) {
  return typeof entry.date === 'string' && entry.date.length >= 7
}

/**
 * What the non-payer owes the payer for a single entry, in yen. Through `splitYen`, so the two
 * portions always add back up to `amountYen`. The share is passed UNCOERCED, so `splitYen` throws
 * on a junk one rather than a `Number()` turning null into 0 — "the other person owes all of it",
 * silently.
 */
export function owedToPayerYen(entry) {
  return splitYen(entry.amountYen, entry.payerShare).otherYen
}

/**
 * The single number the whole app exists to show. `netYen` is signed from p1's perspective:
 * positive means p2 owes p1, and expenses and settlements flow through the same formula, so a
 * settlement for exactly the outstanding amount drives it to 0.
 *
 * @returns {{netYen: number, debtor: string|null, creditor: string|null, amountYen: number}}
 */
export function computeBalance(entries) {
  let netYen = 0
  for (const entry of activeEntries(entries)) {
    const owed = owedToPayerYen(entry)
    netYen += entry.payer === PERSON.P1 ? owed : -owed
  }

  if (netYen === 0) {
    return { netYen: 0, debtor: null, creditor: null, amountYen: 0 }
  }
  return {
    netYen,
    debtor: netYen > 0 ? PERSON.P2 : PERSON.P1,
    creditor: netYen > 0 ? PERSON.P1 : PERSON.P2,
    amountYen: Math.abs(netYen),
  }
}

/**
 * Total money that actually left the household, in yen. Settlements are transfers BETWEEN the two
 * people, so they appear in no spend total and no category breakdown — counting one double-counts
 * money already counted as the original expense.
 */
export function totalSpend(entries) {
  return sumYen(activeExpenses(entries).map((entry) => entry.amountYen))
}

/**
 * Spend per category, biggest first. Expenses only (see `totalSpend`); a blank category lands
 * under 'Uncategorized'.
 *
 * @returns {{category: string, totalYen: number}[]}
 */
export function spendByCategory(entries) {
  const amounts = new Map()
  for (const entry of activeExpenses(entries)) {
    const key = entry.category || UNCATEGORIZED
    if (!amounts.has(key)) amounts.set(key, [])
    amounts.get(key).push(entry.amountYen)
  }
  return (
    [...amounts.entries()]
      .map(([category, list]) => ({ category, totalYen: sumYen(list) }))
      // Ties by CODEPOINT, through the one comparator with its arguments flipped for A-Z.
      // `localeCompare` with no locale reads the RUNTIME's, so two phones would disagree.
      .sort((a, b) => b.totalYen - a.totalYen || descending(b.category, a.category))
  )
}

/**
 * What each person actually paid out of pocket — the cash-flow view, not the fair-share one.
 * Expenses only, for the same reason as `totalSpend`.
 *
 * @returns {{p1: number, p2: number}}
 */
export function spendByPerson(entries) {
  const expenses = activeExpenses(entries)
  return Object.fromEntries(
    PEOPLE.map((person) => [
      person,
      sumYen(expenses.filter((entry) => entry.payer === person).map((entry) => entry.amountYen)),
    ]),
  )
}

/**
 * What each person's share of the month comes to once every `payer_share` is applied — the
 * counterpart to `spendByPerson`. Through `splitYen`, so the two shares add back up to
 * `totalSpend` EXACTLY, the remainder absorbing the rounding: a percentage computed per person
 * invents a yen on every odd split. Expenses only, for the same reason as `totalSpend`.
 *
 * @returns {{p1: number, p2: number}}
 */
export function shareByPerson(entries) {
  const totals = { [PERSON.P1]: 0, [PERSON.P2]: 0 }
  for (const entry of activeExpenses(entries)) {
    const { payerYen, otherYen } = splitYen(entry.amountYen, entry.payerShare)
    totals[entry.payer] += payerYen
    totals[otherPerson(entry.payer)] += otherYen
  }
  return totals
}

/**
 * Whether an entry's ISO date falls inside a 'YYYY-MM' key. A string prefix comparison,
 * deliberately: a Date built from 'YYYY-MM-DD' is UTC midnight and shifts the 1st and last of
 * every month into the neighbouring one west of UTC. `isMonthKey`, not a second regex, so this and
 * `shiftMonth` agree.
 */
function inMonth(entry, monthKey) {
  if (!isMonthKey(monthKey)) return false
  return hasDate(entry) && entry.date.slice(0, 7) === monthKey
}

export function filterByMonth(entries, monthKey) {
  return activeEntries(entries).filter((entry) => inMonth(entry, monthKey))
}

/**
 * Every month present in the data, newest first. `initialMonthKey` is the only caller; it stays
 * exported because `balance.test.js` pins its ordering and de-duplication directly.
 *
 * @returns {string[]}
 */
export function monthKeysPresent(entries) {
  const keys = new Set()
  for (const entry of activeEntries(entries)) {
    if (hasDate(entry)) keys.add(entry.date.slice(0, 7))
  }
  return [...keys].sort(descending)
}

/**
 * Which month to open on: the newest one that actually has data, so a sheet whose last entry was a
 * while ago does not open on an empty screen. `null` means stay where you are.
 *
 * @returns {string|null}
 */
export function initialMonthKey(entries, currentKey) {
  const months = monthKeysPresent(entries)
  if (!months.length || months.includes(currentKey)) return null
  return months[0]
}

/**
 * One month's soft-deleted entries, most recently deleted first — the restore surface, and the one
 * view that wants exactly the rows everything else filters out. Month-scoped because it sits under
 * a month switcher, so a tombstone from another month would read as this month's. Sheet-wide is
 * `compact`.
 */
export function deletedEntries(entries, monthKey) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.deletedAt && inMonth(entry, monthKey))
    .sort((a, b) => descending(String(a.deletedAt), String(b.deletedAt)))
}

/**
 * Entries grouped into day sections: newest day first, and within a day by id — arbitrary, STABLE
 * and immune to tab read order. Arrival order would sort all of p1's expenses above all of p2's,
 * and an appended optimistic row would sit at the bottom of its day and visibly jump on the next
 * refresh.
 *
 * `totalYen` comes from `totalSpend`, not a copy, so a day's total excluding settlements holds by
 * construction — the settlement rows themselves are still listed. A blank date is kept under ''
 * and sorts last, so a malformed row is visible and fixable.
 *
 * @returns {{date: string, entries: object[], totalYen: number}[]}
 */
export function groupByDate(entries) {
  const byDate = new Map()
  for (const entry of activeEntries(entries)) {
    const key = hasDate(entry) ? entry.date : ''
    if (!byDate.has(key)) byDate.set(key, [])
    byDate.get(key).push(entry)
  }

  return [...byDate.entries()]
    .map(([date, dayEntries]) => ({
      date,
      entries: [...dayEntries].sort((a, b) => descending(String(a.id ?? ''), String(b.id ?? ''))),
      totalYen: totalSpend(dayEntries),
    }))
    .sort((a, b) => descending(a.date, b.date))
}

/**
 * The month's list as the two sections it renders: the recurring costs, then the days.
 *
 * ONE function rather than a filter at each end, because the two halves have to PARTITION. A row in
 * both reads as a double charge of money that moved once; a row in neither vanishes from the list
 * while still counting in every total above it.
 *
 * An instance is lifted OUT of its day, so a day's total is what that day holds on screen; the
 * month's own figures come from the month. The section's order comes from `groupByDate` rather than
 * a comparator of its own, so it cannot disagree with the days below it.
 *
 * `unpaid` is what this month has NOT recorded (`unpaidRecurring`), riding in the same section
 * because it is the reason the section leads the page. Those are drafts, not entries: they are
 * absent from `totalYen` and from every figure above, since no money has moved.
 *
 * @returns {{recurring: {entries: object[], unpaid: object[], totalYen: number}|null,
 *            groups: object[]}}
 */
export function monthSections(entries, unpaid = []) {
  const recurring = []
  const rest = []
  for (const entry of activeEntries(entries)) {
    ;(isRecurringInstance(entry) ? recurring : rest).push(entry)
  }
  const drafts = Array.isArray(unpaid) ? unpaid : []

  return {
    // Null rather than an empty section, so nothing renders a heading over no rows.
    recurring:
      recurring.length || drafts.length
        ? {
            entries: groupByDate(recurring).flatMap((group) => group.entries),
            unpaid: drafts,
            totalYen: totalSpend(recurring),
          }
        : null,
    groups: groupByDate(rest),
  }
}
