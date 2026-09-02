/**
 * Pure aggregation over entries. No I/O, no Date construction, no React.
 *
 * Two conventions run through the whole file:
 *
 *   1. Soft deletes are real deletes as far as every aggregate is concerned. Rows are
 *      never removed from the sheet (row numbers would shift under concurrent edits),
 *      so `deletedAt` is the only truth and everything filters through `isActive`.
 *
 *   2. `payerShare` is the fraction of an entry the payer covers themselves, so the
 *      non-payer owes `amountYen * (1 - payerShare)`. A settlement is simply an entry
 *      with payerShare 0 — which is why nothing below special-cases the type.
 */

import { PERSON, ENTRY_TYPE, isActive } from '../schema.js'
import { splitYen, sumYen } from './money.js'
import { isMonthKey } from './dates.js'

/** Where a blank category lands. Exported so the UI labels exactly this bucket. */
export const UNCATEGORIZED = 'Uncategorized'

/**
 * Newest-first for anything whose keys sort lexicographically the same way they sort
 * chronologically — ISO days, 'YYYY-MM' keys, ISO delete stamps. The one comparator, so
 * no list can end up ordered the other way by a typo.
 */
function descending(a, b) {
  return a < b ? 1 : a > b ? -1 : 0
}

function activeEntries(entries) {
  return Array.isArray(entries) ? entries.filter(isActive) : []
}

function isExpense(entry) {
  return entry.type === ENTRY_TYPE.EXPENSE
}

/** An ISO date we can safely take a 'YYYY-MM' prefix from. */
function hasDate(entry) {
  return typeof entry.date === 'string' && entry.date.length >= 7
}

/**
 * What the non-payer owes the payer for a single entry, in yen. Routed through
 * `splitYen` so the two portions always add back up to `amountYen` exactly.
 *
 * The share is coerced because `makeEntry` is the only thing that normalises a form's
 * '0.5' into a number, and this also runs over rows straight from the sheet. A genuinely
 * non-numeric share still throws in `splitYen` rather than becoming 0 and moving money.
 */
export function owedToPayerYen(entry) {
  return splitYen(entry.amountYen, Number(entry.payerShare)).otherYen
}

/**
 * The single number the whole app exists to show.
 *
 * `netYen` is signed from p1's perspective: positive means p2 owes p1. Expenses and
 * settlements flow through the same formula, so recording a settlement for exactly the
 * outstanding amount drives netYen to 0.
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
 * Total money that actually left the household, in yen.
 *
 * Settlements are transfers BETWEEN the two people, not spending, so they appear in no
 * spend total and no category breakdown — counting them would double-count money already
 * counted as the original expense.
 */
export function totalSpend(entries) {
  const expenses = activeEntries(entries).filter(isExpense)
  return sumYen(expenses.map((entry) => entry.amountYen))
}

/**
 * Spend per category, biggest first. Expenses only (see `totalSpend`); a blank category
 * lands under 'Uncategorized'.
 *
 * @returns {{category: string, totalYen: number}[]}
 */
export function spendByCategory(entries) {
  const totals = new Map()
  for (const entry of activeEntries(entries)) {
    if (!isExpense(entry)) continue
    const key = entry.category || UNCATEGORIZED
    totals.set(key, (totals.get(key) ?? 0) + entry.amountYen)
  }
  return (
    [...totals.entries()]
      .map(([category, totalYen]) => ({ category, totalYen }))
      // Ties broken by name so the order is stable across reloads.
      .sort((a, b) => b.totalYen - a.totalYen || a.category.localeCompare(b.category))
  )
}

/**
 * What each person actually paid out of pocket — the cash-flow view, not the fair-share
 * one. Expenses only, for the same reason as `totalSpend`.
 *
 * @returns {{p1: number, p2: number}}
 */
export function spendByPerson(entries) {
  const totals = { [PERSON.P1]: 0, [PERSON.P2]: 0 }
  for (const entry of activeEntries(entries)) {
    if (!isExpense(entry)) continue
    if (entry.payer === PERSON.P2) totals[PERSON.P2] += entry.amountYen
    else totals[PERSON.P1] += entry.amountYen
  }
  return totals
}

/**
 * Whether an entry's ISO date falls inside a 'YYYY-MM' key.
 *
 * A string prefix comparison, deliberately: constructing a Date from 'YYYY-MM-DD' parses
 * as UTC midnight and then shifts under the local timezone, silently moving the 1st and
 * the last day of every month into the neighbouring one for anyone west of UTC.
 *
 * `isMonthKey`, not a second regex: a local one accepted month 13 while `shiftMonth`
 * rejected it, so the two disagreed about what a month even is.
 */
function inMonth(entry, monthKey) {
  if (!isMonthKey(monthKey)) return false
  return hasDate(entry) && entry.date.slice(0, 7) === monthKey
}

export function filterByMonth(entries, monthKey) {
  return activeEntries(entries).filter((entry) => inMonth(entry, monthKey))
}

/**
 * Every month present in the data, newest first. `initialMonthKey` is the only caller in
 * the app; it stays exported because its ordering and de-duplication are what
 * `balance.test.js` pins directly.
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
 * Which month to open on: the newest one that actually has data, so a sheet whose last
 * entry was a while ago does not open on an empty screen. `null` means stay where you
 * are, which is the answer whenever the current month has data of its own.
 *
 * @returns {string|null}
 */
export function initialMonthKey(entries, currentKey) {
  const months = monthKeysPresent(entries)
  if (!months.length || months.includes(currentKey)) return null
  return months[0]
}

/**
 * One month's soft-deleted entries, most recently deleted first — the restore surface,
 * and the one view that wants exactly the rows everything else filters out.
 *
 * Month-scoped for the same reason the list above it is: it sits under a month switcher,
 * so a tombstone from another month reads as belonging to the month on screen.
 * Sheet-wide is what `compact` is for, and its count in settings is a different number.
 */
export function deletedEntries(entries, monthKey) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.deletedAt && inMonth(entry, monthKey))
    .sort((a, b) => descending(String(a.deletedAt), String(b.deletedAt)))
}

/**
 * Entries grouped into day sections for the list view: newest day first, and a stable
 * arbitrary order within a day.
 *
 * Within-day order is by id — arbitrary, but STABLE, and immune to the order the tabs
 * were read in. Arrival order would sort every one of p1's expenses above every one of
 * p2's on the same day, and an optimistic row is appended, so it would sit at the bottom
 * of its day and then visibly jump on the next refresh.
 *
 * `totalYen` comes from `totalSpend`, not a copy of it, so the rule that a day's total is
 * SPEND — and therefore excludes settlements — holds by construction. The settlement rows
 * themselves are still listed: the list is a ledger someone needs to see and tap. A blank
 * date is kept under '' and sorts last, so a malformed row is visible and fixable.
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
