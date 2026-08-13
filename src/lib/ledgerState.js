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

import { PEOPLE, expensesTab, isActive, makeEntry, validateEntryCodes } from '../schema.js'
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
 * Fold a fresh server read into what is on screen, keeping optimistic rows the
 * server has not acknowledged yet.
 *
 * A refresh that started before an append would otherwise drop the new row — and
 * because the snapshot is written from the loaded list, that loss would survive a
 * relaunch. Pending rows go last: they are the newest thing the person did.
 *
 * @param {object[]} current what is on screen, including pending rows
 * @param {object[]} loaded what the sheet just said
 * @returns {object[]}
 */
export function mergeLoaded(current, loaded) {
  const seen = new Set(loaded.map((entry) => entry.id))
  const inFlight = current.filter((entry) => entry.pending && !seen.has(entry.id))
  return inFlight.length ? [...loaded, ...inFlight] : loaded
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
 */
export function reverted(entries, id, previous) {
  if (!previous) return entries
  return entries.map((item) => (item.id === id ? previous : item))
}

/**
 * Sheet-wide, unlike the month-scoped deleted list in the UI: this is what
 * `compact` would remove, and it removes every tombstone in both tabs.
 */
export function tombstoneCount(entries) {
  return entries.filter((entry) => entry.deletedAt).length
}

export function hasTombstones(entries) {
  return entries.some((entry) => entry.deletedAt)
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
