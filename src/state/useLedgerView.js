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
import { unpaidRecurring } from '../lib/recurring.js'
import { currentMonthKey } from '../lib/dates.js'

/**
 * Everything the signed-in screen shows: nine values, all of them a pure function of the entries,
 * the declarations and which month is on screen. `App` is then just gates, sheets and layout.
 *
 * The templates are here only for the reminder rows, which the recurring SECTION carries: what makes
 * a recorded row a fixed cost is its own id, so `monthSections` needs none of them.
 *
 * Memoised in a chain — `active` feeds the balance, `monthEntries` the four month figures — so
 * typing in a form re-runs none of it.
 */
export function useLedgerView(entries, templates, monthKey) {
  const active = useMemo(() => entries.filter(isActive), [entries])
  const monthEntries = useMemo(() => filterByMonth(active, monthKey), [active, monthKey])
  // The RAW list, not `active`: a tombstoned instance means the month is recorded.
  const unpaid = useMemo(
    () => unpaidRecurring(templates, entries, monthKey),
    [templates, entries, monthKey],
  )
  // One memo for both halves of the list, because they are one partition of the month.
  const sections = useMemo(() => monthSections(monthEntries, unpaid), [monthEntries, unpaid])

  return {
    active,
    balance: useMemo(() => computeBalance(active), [active]),
    // Month-scoped, like the list it sits under. The sheet-wide count `compact` acts on is
    // `ledger.tombstoneCount`, a different number.
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
 * Land on the newest month that actually has data, once per session. Runs on the cached paint too
 * (`stale`), which is the point: waiting for `ready` would move the month out from under someone
 * who had already started using the month switcher.
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
