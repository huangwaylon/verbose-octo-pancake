/**
 * The bookkeeping behind optimistic writes, as pure functions.
 *
 * Everything interesting about the ledger is a list transition or a status
 * decision — "given the list now, what is the list next" — and none of it is
 * actually React. Reaching it inside a hook would mean rendering one, which needs
 * a DOM this project does not have, so it lives here and `useLedger` is left
 * owning only state, effects and the order of the calls.
 *
 * Every function returns a new value and mutates nothing: React state, and any
 * list that has been handed to `writeSnapshot`, must never be edited in place.
 */

import {
  ENTRY_TYPE,
  PEOPLE,
  PERSON,
  expensesTab,
  isActive,
  isPerson,
  makeEntry,
  validateEntryCodes,
} from '../schema.js'
import { todayIso } from './dates.js'
import { i18nError } from '../i18n/index.js'

/**
 * One entry per id, keeping the row that is actually live.
 *
 * An id is not unique across the two tabs. Editing an entry to change who paid
 * moves the row: `updateEntry` appends to the new payer's tab and tombstones the
 * old row, deliberately in that order, so the sheet legitimately holds two rows
 * with one id — one live, one a tombstone — until `compact` runs.
 *
 * Left unreconciled, the tombstone is the copy every id lookup finds first
 * (`loadAll` reads p1's tab before p2's), and each of the three consumers goes
 * wrong in a way nothing reports: `entryById` hands the next edit the payer of a
 * dead row, so the write moves tabs again and appends a SECOND live row;
 * `deletedEntries` offers the tombstone for restore, which brings a duplicate of
 * a visible expense back into the balance permanently; and `withPendingEdit`
 * rewrites both copies, putting two of the same expense on screen.
 *
 * A live row therefore always wins, and between two tombstones the one edited
 * last does. Returns the input array itself when there is nothing to reconcile,
 * which is every load but the ones following a payer change.
 *
 * @param {object[]} entries
 * @returns {object[]}
 */
export function reconcileById(entries) {
  const byId = new Map()
  for (const entry of entries) {
    const kept = byId.get(entry.id)
    if (!kept || supersedes(entry, kept)) byId.set(entry.id, entry)
  }
  return byId.size === entries.length ? entries : [...byId.values()]
}

function supersedes(entry, kept) {
  if (isActive(entry) !== isActive(kept)) return isActive(entry)
  return String(entry.updatedAt ?? '') > String(kept.updatedAt ?? '')
}

/**
 * Fold a fresh server read into what is on screen, keeping every optimistic row the
 * server has not acknowledged yet.
 *
 * A pending row always wins, whether or not the sheet mentions its id. Both halves
 * matter, and for different reasons:
 *
 * An in-flight APPEND is absent from `loaded`, so without this it would leave the
 * screen — and because the snapshot is written from the loaded list, that loss would
 * survive a relaunch.
 *
 * An in-flight EDIT or DELETE is present in `loaded`, at its pre-write value. Taking
 * the server's copy there discards what the person just did: the deleted row
 * reappears, the balance and the month total go back to the old figure, the snapshot
 * persists it that way — and then `settled` clears `pending` on the stale row, so it
 * reads as saved. A refresh landing between the tap and the reply is enough.
 *
 * Rows the sheet no longer has and that are not pending are gone, not in flight, so
 * they leave. Order follows the sheet, with fresh appends last: they are the newest
 * thing this person did.
 *
 * @param {object[]} current what is on screen, including pending rows
 * @param {object[]} loaded what the sheet just said
 * @returns {object[]}
 */
export function mergeLoaded(current, loaded) {
  const pending = new Map()
  for (const entry of current) if (entry.pending) pending.set(entry.id, entry)
  if (pending.size === 0) return loaded

  const merged = loaded.map((entry) => pending.get(entry.id) ?? entry)
  const appended = [...pending.values()].filter(
    (entry) => !loaded.some((item) => item.id === entry.id),
  )
  return appended.length ? [...merged, ...appended] : merged
}

/** The entry with this id, or undefined. What a failed write reverts to. */
export function entryById(entries, id) {
  return entries.find((entry) => entry.id === id)
}

/** A new entry, on screen immediately and marked as not yet in the sheet. */
export function withPending(entries, entry) {
  return [...entries, { ...entry, pending: true }]
}

/** An edit, on screen immediately. Replaces the whole entry, not a patch. */
export function withPendingEdit(entries, entry) {
  return entries.map((item) => (item.id === entry.id ? { ...entry, pending: true } : item))
}

/** A soft delete or a restore, on screen immediately. */
export function withPendingDeletedAt(entries, id, deletedAt) {
  return entries.map((item) => (item.id === id ? { ...item, deletedAt, pending: true } : item))
}

/**
 * The write landed. `acknowledge` swaps in the canonical entry — used by an
 * append, where the local copy and the entry are the same object — while
 * `settled` only clears the flag, leaving fields an edit did not touch alone.
 */
export function acknowledge(entries, entry) {
  return entries.map((item) => (item.id === entry.id ? entry : item))
}

export function settled(entries, id) {
  return entries.map((item) => (item.id === id ? { ...item, pending: false } : item))
}

/** The append failed: the row was never in the sheet, so it leaves the screen. */
export function without(entries, id) {
  return entries.filter((entry) => entry.id !== id)
}

/**
 * The edit or delete failed: put back exactly what was there before, rather than
 * clearing `pending` and leaving the optimistic values on screen as if saved.
 *
 * `pending` is stripped from the restored row, because a revert means no write is in
 * flight for it any more — and `previous` can itself be a pending copy when two
 * writes to one entry overlap (restore tapped while the delete is still going). A
 * `pending` flag left set there is permanent: `mergeLoaded` keeps a pending row over
 * the server's forever, so the row freezes, stops receiving the other person's edits,
 * and blocks `compact` for the life of the install.
 */
export function reverted(entries, id, previous) {
  if (!previous) return entries
  const restored = previous.pending ? { ...previous, pending: false } : previous
  return entries.map((item) => (item.id === id ? restored : item))
}

/**
 * Sheet-wide, unlike the month-scoped deleted list in the UI: this is what
 * `compact` would remove, and it removes every tombstone in both tabs.
 */
export function tombstoneCount(entries) {
  return entries.filter((entry) => entry.deletedAt).length
}

/**
 * Whether any write has not reached the sheet yet.
 *
 * Three separate decisions turn on it and all three are load-bearing: the launch cache
 * must not persist an unacknowledged optimistic row, `compact` must not shift rows a
 * pending write already resolved a number for, and a service-worker update must not
 * reload through a write in flight. Spelled once so they cannot drift apart.
 */
export function hasPendingWrite(entries) {
  return entries.some((entry) => entry.pending)
}

/**
 * Why `compact` will not run, or null if it can.
 *
 * Never while a write is in flight: `compact` deletes rows, which shifts every row
 * below each one, and a pending `updateEntry`/`setDeletedAt` already resolved its
 * target row number before the shift — so its write would land on whichever row moved
 * into that position, blanking a cell in a live expense or un-deleting an unrelated
 * one.
 *
 * That case reports `busy` rather than a bare `{removed: 0}`: "Removed 0 deleted rows"
 * is a lie when there are rows to remove, and it gives no reason to try again.
 *
 * `supersededRows` is counted because those tombstones are real rows in the sheet that
 * `reconcileById` hid behind a live one — so there can be nothing to remove in
 * `entries` while the sheet still holds removable rows.
 */
export function compactRefusal(entries, supersededRows) {
  if (hasPendingWrite(entries)) return { removed: 0, busy: true }
  if (!tombstoneCount(entries) && !supersededRows) return { removed: 0 }
  return null
}

/**
 * A blank entry for the add form.
 *
 * The id is minted when the draft OPENS rather than per submit. A `fetch` that rejects
 * after Google committed the append — the response lost, not the request — leaves the
 * row on screen as failed; re-submitting with a fresh id would write a second expense
 * that `reconcileById` cannot collapse, and the balance would double-count it forever.
 * The same id makes a retry at worst a duplicate row the client reconciles to one.
 *
 * Deliberately not `makeEntry`, which stamps `createdAt`/`updatedAt`: a draft has not
 * been saved and must not claim to have been.
 *
 * `payerShare` is left null, meaning "follow the payer's default" — the form re-derives
 * it whenever the payer control changes. Seeding it here would pin the opening payer's
 * share onto whoever it is switched to.
 */
export function newDraftEntry(person) {
  return {
    id: crypto.randomUUID(),
    type: ENTRY_TYPE.EXPENSE,
    date: todayIso(),
    payer: isPerson(person) ? person : PERSON.P1,
    amountCents: 0,
    category: '',
    description: '',
    payerShare: null,
  }
}

/**
 * `loading` is the first read of a session and gates the UI; `refreshing` is every
 * later one and does not, because there is already something on screen — including
 * a cached launch, which starts at `stale`.
 */
export function statusOnLoadStart(current) {
  return current === 'idle' ? 'loading' : 'refreshing'
}

/**
 * A failed read with something already on screen is `stale`, not `error`: cached
 * data beats an error screen, since the sheet has not changed just because we
 * cannot reach it. This is the offline launch.
 */
export function statusOnLoadFailure(everLoaded) {
  return everLoaded ? 'stale' : 'error'
}

/**
 * Window switching is constant and every refresh spends per-user quota, so
 * focus-triggered reads have a floor.
 *
 * `lastAt` of 0 means "never refreshed" and always passes. That is stated rather
 * than left to arithmetic: with a real clock `now - 0` clears any floor, so the
 * first refresh of a session worked by accident of the epoch being 1970.
 */
export function shouldRefresh(now, lastAt, floorMs) {
  if (!lastAt) return true
  return now - lastAt >= floorMs
}

/**
 * Whether `compact` can run: it needs a numeric gid per expenses tab, and
 * `values.batchGet` cannot report them, so a session that only ever read the sheet
 * has none and has to ask `ensureStructure` for them.
 */
export function missingExpenseGid(sheetIds) {
  return PEOPLE.some((person) => sheetIds?.[expensesTab(person)] == null)
}

/**
 * Whether a failed read means "this spreadsheet has no tabs yet" rather than
 * "the read failed". A missing tab or range surfaces as a 400 from the values
 * endpoint, a missing spreadsheet as a 404; either way the answer is to build
 * structure once and retry. Anything else must not lead there — `ensureStructure`
 * is the only path that writes tabs into somebody's spreadsheet.
 */
export function looksUninitialized(cause) {
  return cause?.status === 400 || cause?.status === 404
}

/**
 * Turn form input into a complete entry, or throw something the person can read.
 *
 * Both write paths validate identically and report the FIRST problem only: a form
 * with one message slot showing four at once is a wall, and the first is always
 * the one nearest the top of the sheet. The codes are the stable contract, so the
 * thrown error carries `error.<code>` rather than an English sentence.
 *
 * @param {object} input
 * @param {string} [now] injected so tests stay deterministic
 * @returns {object}
 */
export function entryFromInput(input, now) {
  const entry = makeEntry(input, now)
  const problems = validateEntryCodes(entry)
  if (problems.length) throw i18nError(`error.${problems[0]}`)
  return entry
}

/**
 * Everything the screen has to say about itself, as catalog keys.
 *
 * Each one reports a state where the numbers on screen are incomplete or suspect,
 * and every one of them is otherwise silent. Order is worst-first, because they
 * stack above the balance and the top one is the one that gets read.
 *
 * A notice, never a gate: the sheet has not changed just because something about it
 * cannot be shown, so replacing a working screen with an error would be a
 * downgrade. `staleData` is the offline launch and needs an `error` to be real —
 * `stale` alone is where a cached launch starts, before any read has failed.
 *
 * @param {{status: string, error: unknown, mixedCurrencies: boolean,
 *   configMissing: boolean, currencyDefaulted: boolean, currency: string,
 *   undecodedRows: number, undatedRows: number}} state
 * @returns {{key: string, vars?: object}[]}
 */
export function noticeKeys(state = {}) {
  const notices = []
  if (state.status === 'stale' && state.error) notices.push({ key: 'warning.staleData' })
  if (state.configMissing) notices.push({ key: 'warning.configMissing' })
  // Only when the tab is actually there: a missing tab defaults the currency too, and
  // the notice above already says so in the more specific way.
  else if (state.currencyDefaulted) {
    notices.push({ key: 'warning.currencyDefaulted', vars: { currency: state.currency } })
  }
  if (state.mixedCurrencies) notices.push({ key: 'warning.mixedCurrencies' })
  if (state.undecodedRows > 0) {
    notices.push({ key: 'warning.undecodedRows', vars: { count: state.undecodedRows } })
  }
  if (state.undatedRows > 0) {
    notices.push({ key: 'warning.undatedRows', vars: { count: state.undatedRows } })
  }
  return notices
}
