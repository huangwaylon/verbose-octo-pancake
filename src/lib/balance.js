/**
 * Pure aggregation over entries. No I/O, no Date construction, no React.
 *
 * Two conventions run through this whole file:
 *
 *   1. Soft deletes are real deletes as far as every aggregate is concerned.
 *      Rows are never removed from the sheet (row numbers would shift under
 *      concurrent edits), so `deletedAt` is the only truth — everything filters
 *      through `isActive`.
 *
 *   2. `payerShare` is the fraction of an entry the payer is responsible for
 *      themselves, so the non-payer owes `amountCents * (1 - payerShare)`.
 *      A settlement is simply an entry with payerShare 0: the payer handed
 *      over money and the other person is 100% responsible for it. That is why
 *      settlements need no special-case balance math anywhere below.
 */

import { PERSON, ENTRY_TYPE, isActive } from '../schema.js'
import { splitCents, sumCents } from './money.js'

/** Where a blank category lands. Exported so the UI labels exactly this bucket. */
export const UNCATEGORIZED = 'Uncategorized'
const MONTH_KEY = /^\d{4}-\d{2}$/

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
 * What the non-payer owes the payer for a single entry, in cents.
 *
 * Routed through splitCents so the payer's and the other person's portions
 * always add back up to amountCents exactly.
 *
 * @param {object} entry
 * @returns {number} integer cents (0 when the payer covered their own share)
 */
export function owedToPayerCents(entry) {
  // Coerced because `makeEntry` is the only thing that normalises a form's
  // '0.5' into a number, and this runs over rows straight from the sheet too.
  // Genuinely non-numeric shares still throw in splitCents rather than
  // silently becoming 0 and moving money.
  return splitCents(entry.amountCents, Number(entry.payerShare)).otherCents
}

/**
 * The single number the whole app exists to show.
 *
 * `netCents` is signed from p1's perspective: positive means p2 owes p1.
 * Expenses and settlements both flow through the same formula, so recording a
 * settlement for exactly the outstanding amount drives netCents to 0.
 *
 * @param {object[]} entries
 * @returns {{netCents: number, debtor: string|null, creditor: string|null, amountCents: number}}
 */
export function computeBalance(entries) {
  let netCents = 0
  for (const entry of activeEntries(entries)) {
    const owed = owedToPayerCents(entry)
    netCents += entry.payer === PERSON.P1 ? owed : -owed
  }

  if (netCents === 0) {
    return { netCents: 0, debtor: null, creditor: null, amountCents: 0 }
  }
  return {
    netCents,
    debtor: netCents > 0 ? PERSON.P2 : PERSON.P1,
    creditor: netCents > 0 ? PERSON.P1 : PERSON.P2,
    amountCents: Math.abs(netCents),
  }
}

/**
 * Total money that actually left the household, in cents.
 *
 * Settlements are transfers BETWEEN the two people, not spending, so they
 * never appear in spend totals or category breakdowns — counting them would
 * double-count money already counted as the original expense.
 *
 * Per-payer and per-category figures come from `spendByPerson` and
 * `spendByCategory`, which is why this takes no filters.
 *
 * @param {object[]} entries
 * @returns {number} integer cents
 */
export function totalSpend(entries) {
  const expenses = activeEntries(entries).filter(isExpense)
  return sumCents(expenses.map((entry) => entry.amountCents))
}

/**
 * Whether any entry is priced in something other than the sheet's currency.
 *
 * Aggregates sum integers across scales, which is arithmetically meaningless,
 * and there are no FX rates anywhere in this app — so the UI says so rather than
 * presenting a confident wrong total.
 *
 * @param {object[]} entries
 * @param {string} currency the sheet's configured currency
 * @returns {boolean}
 */
export function hasMixedCurrencies(entries, currency) {
  return activeEntries(entries).some((entry) => entry.currency && entry.currency !== currency)
}

/**
 * Spend per category, biggest first. Expenses only (see totalSpend); entries
 * with no category are grouped under 'Uncategorized'.
 *
 * @param {object[]} entries
 * @returns {{category: string, totalCents: number}[]}
 */
export function spendByCategory(entries) {
  const totals = new Map()
  for (const entry of activeEntries(entries)) {
    if (!isExpense(entry)) continue
    const key = entry.category || UNCATEGORIZED
    totals.set(key, (totals.get(key) ?? 0) + entry.amountCents)
  }
  return (
    [...totals.entries()]
      .map(([category, totalCents]) => ({ category, totalCents }))
      // Ties broken by name so the order is stable across reloads.
      .sort((a, b) => b.totalCents - a.totalCents || a.category.localeCompare(b.category))
  )
}

/**
 * What each person actually paid out of pocket — the cash-flow view, not the
 * fair-share view. Expenses only, for the same reason as totalSpend.
 *
 * @param {object[]} entries
 * @returns {{p1: number, p2: number}}
 */
export function spendByPerson(entries) {
  const totals = { [PERSON.P1]: 0, [PERSON.P2]: 0 }
  for (const entry of activeEntries(entries)) {
    if (!isExpense(entry)) continue
    if (entry.payer === PERSON.P2) totals[PERSON.P2] += entry.amountCents
    else totals[PERSON.P1] += entry.amountCents
  }
  return totals
}

/**
 * Whether an entry's ISO date falls inside a 'YYYY-MM' key.
 *
 * Deliberately a string prefix comparison. Constructing a Date from
 * 'YYYY-MM-DD' parses as UTC midnight and then shifts under the local timezone,
 * which silently moves the 1st and the last day of every month into the
 * neighbouring one for anyone west of UTC. A blank date is in no month rather
 * than guessed at.
 */
function inMonth(entry, monthKey) {
  if (typeof monthKey !== 'string' || !MONTH_KEY.test(monthKey)) return false
  return hasDate(entry) && entry.date.slice(0, 7) === monthKey
}

/**
 * Entries whose date falls inside a 'YYYY-MM' month.
 *
 * @param {object[]} entries
 * @param {string} monthKey 'YYYY-MM'
 * @returns {object[]}
 */
export function filterByMonth(entries, monthKey) {
  return activeEntries(entries).filter((entry) => inMonth(entry, monthKey))
}

/**
 * Every month present in the data, newest first. 'YYYY-MM' strings sort
 * lexicographically the same way they sort chronologically, so no date parsing is
 * needed here either. `initialMonthKey` is the only caller in the app; it stays
 * exported because its ordering and de-duplication are what `balance.test.js`
 * pins directly.
 *
 * @param {object[]} entries
 * @returns {string[]}
 */
export function monthKeysPresent(entries) {
  const keys = new Set()
  for (const entry of activeEntries(entries)) {
    if (hasDate(entry)) keys.add(entry.date.slice(0, 7))
  }
  return [...keys].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
}

/**
 * Which month to open on: the newest one that actually has data, so a sheet whose
 * last entry was a while ago does not open on an empty screen. `null` means stay
 * where you are, which is the answer whenever the current month has data of its
 * own — moving off it would be surprising.
 *
 * @param {object[]} entries
 * @param {string} currentKey 'YYYY-MM' for today
 * @returns {string|null}
 */
export function initialMonthKey(entries, currentKey) {
  const months = monthKeysPresent(entries)
  if (!months.length || months.includes(currentKey)) return null
  return months[0]
}

/**
 * One month's soft-deleted entries, most recently deleted first — the restore
 * surface, and the one view in the app that wants exactly the rows everything
 * else filters out.
 *
 * Month-scoped for the same reason the list above it is: it sits under a month
 * switcher, so a tombstone from another month showing there reads as belonging
 * to the month on screen. Sheet-wide is what `compact` is for, and its count in
 * settings is deliberately not this number.
 *
 * @param {object[]} entries
 * @param {string} monthKey 'YYYY-MM'
 * @returns {object[]}
 */
export function deletedEntries(entries, monthKey) {
  const tombstoned = (Array.isArray(entries) ? entries : []).filter(
    (entry) => entry?.deletedAt && inMonth(entry, monthKey),
  )
  // ISO timestamps sort lexicographically the same way they sort in time.
  return tombstoned.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
}

/**
 * Entries grouped into day sections for the list view: newest day first, and
 * newest-entered first within a day.
 *
 * `totalCents` is the day's SPEND, so settlements are excluded from it for
 * consistency with totalSpend — but the settlement entries themselves are
 * still listed, because the list is a ledger the user needs to see and be able
 * to tap. Entries with a blank date are kept under a '' date and sort last, so
 * a malformed row is visible and fixable rather than invisible.
 *
 * @param {object[]} entries
 * @returns {{date: string, entries: object[], totalCents: number}[]}
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
      entries: [...dayEntries].sort(
        (a, b) =>
          String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')) ||
          String(b.id ?? '').localeCompare(String(a.id ?? '')),
      ),
      totalCents: sumCents(dayEntries.filter(isExpense).map((entry) => entry.amountCents)),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}
