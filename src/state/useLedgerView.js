import { useEffect, useMemo, useRef } from 'react'
import { isActive } from '../schema.js'
import {
  computeBalance,
  deletedEntries,
  filterByMonth,
  initialMonthKey,
  monthSections,
  shareByPerson,
  spendByCategory,
  spendByPerson,
  totalSpend,
} from '../lib/balance.js'
import { currentMonthKey } from '../lib/dates.js'

/**
 * Everything the signed-in screen shows, derived from the raw ledger.
 *
 * Split out of `App` because it is the only part of it that is arithmetic: nine
 * values, all of them a pure function of the entries and which month is on screen.
 * `App` is then just gates, sheets and layout.
 *
 * Nothing about the recurring TAB is here: it is a settings surface, and `RecurringSheet`
 * calls `recurringRows` itself so nothing walks the templates while that sheet is closed.
 * `monthSections` needs none of them — a recurring row is recognised from its own id.
 *
 * Memoised in a chain — `active` feeds the balance, `monthEntries` feeds the four
 * month figures — so typing in a form re-runs none of it.
 */
export function useLedgerView(entries, monthKey) {
  const active = useMemo(() => entries.filter(isActive), [entries])
  const monthEntries = useMemo(() => filterByMonth(active, monthKey), [active, monthKey])
  // One memo for both halves of the list, because they are one partition of the month.
  const sections = useMemo(() => monthSections(monthEntries), [monthEntries])

  return {
    active,
    balance: useMemo(() => computeBalance(active), [active]),
    // Month-scoped, like the list it sits under. The sheet-wide count that
    // `compact` acts on is `ledger.tombstoneCount`, which is a different number.
    deleted: useMemo(() => deletedEntries(entries, monthKey), [entries, monthKey]),
    groups: sections.groups,
    recurring: sections.recurring,
    monthSpend: useMemo(() => totalSpend(monthEntries), [monthEntries]),
    byCategory: useMemo(() => spendByCategory(monthEntries), [monthEntries]),
    byPerson: useMemo(() => spendByPerson(monthEntries), [monthEntries]),
    byShare: useMemo(() => shareByPerson(monthEntries), [monthEntries]),
  }
}

/**
 * Land on the newest month that actually has data, once per session. Which month that
 * is is `initialMonthKey`'s decision; this only owns the once-per-session latch and the
 * effect.
 *
 * Runs on the cached paint too (`stale`), which is the point: waiting for `ready`
 * would move the month out from under someone who had already started using the
 * month switcher.
 */
export function useInitialMonth(status, active, setMonthKey) {
  const jumped = useRef(false)

  useEffect(() => {
    if (jumped.current) return
    if (status !== 'ready' && status !== 'stale') return
    if (!active.length) return
    jumped.current = true
    const next = initialMonthKey(active, currentMonthKey())
    if (next) setMonthKey(next)
  }, [status, active, setMonthKey])
}
