/**
 * The bookkeeping behind optimistic writes, as pure functions.
 *
 * Everything interesting about the ledger is a list transition or a status decision —
 * "given the list now, what is the list next" — and none of it is actually React.
 * Reaching it inside a hook would mean rendering one, which needs a DOM this project
 * does not have, so it lives here and `useLedger` owns only state, effects and the order
 * of the calls.
 *
 * Every function returns a new value and mutates nothing: React state, and any list
 * handed to `writeSnapshot`, must never be edited in place.
 */

import { ENTRY_TYPE, PERSON, isActive, isPerson, makeEntry, validateEntryCodes } from '../schema.js'
import { todayIso } from './dates.js'
import { makeTemplate, validateTemplateCodes } from './recurring.js'
import { i18nError } from '../i18n/index.js'

/**
 * One entry per id, keeping the row that is actually live.
 *
 * An id is not unique across the two tabs: editing an entry to change who paid appends
 * to the new payer's tab and tombstones the old row, so the sheet legitimately holds two
 * rows with one id until `compact` runs.
 *
 * Left unreconciled, the tombstone is the copy every id lookup finds first (`loadAll`
 * reads p1's tab before p2's), and all three consumers go wrong silently: `entryById`
 * hands the next edit the payer of a dead row, so the write moves tabs again and appends
 * a SECOND live row; `deletedEntries` offers the tombstone for restore, bringing a
 * duplicate permanently back into the balance; and `withPendingEdit` rewrites both
 * copies, putting two of the same expense on screen.
 *
 * Returns the input array itself when there is nothing to reconcile.
 */
export function reconcileById(entries) {
  const byId = new Map()
  for (const entry of entries) {
    const kept = byId.get(entry.id)
    if (!kept || supersedes(entry, kept)) byId.set(entry.id, entry)
  }
  return byId.size === entries.length ? entries : [...byId.values()]
}

/**
 * A live row wins; between two tombstones the one deleted LAST does. `deletedAt` breaks
 * the tie, NOT array order.
 *
 * Array order is tab order — all of p1's rows are decoded before any of p2's — so "last
 * seen" is not "newest". The case that gets it backwards: an entry created under p2,
 * edited to p1 (p2's row tombstoned), then deleted (p1's row tombstoned). Both are dead
 * and p1's is decoded FIRST, so last-seen keeps p2's older pre-move copy — restoring that
 * revives the entry under the wrong payer, flipping its contribution to the balance.
 *
 * Two LIVE rows for one id — an interrupted payer move — have no stamp to compare and
 * keep the incumbent; either is a correct copy, and `compact` clears the duplicate.
 */
function supersedes(entry, kept) {
  if (isActive(entry) !== isActive(kept)) return isActive(entry)
  return String(entry.deletedAt ?? '') > String(kept.deletedAt ?? '')
}

/**
 * Whether two entries are the same row, field for field.
 *
 * Every value an entry carries is a primitive — the sheet has no nested cells — so `===`
 * per key is exact. Key-driven rather than a hand-written field list, so a field added to
 * `rowToEntry` is covered by construction: a list that missed one would report two
 * different rows as equal and freeze the newer one off the screen.
 */
function sameEntry(a, b) {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}

/**
 * Fold a fresh server read into what is on screen, keeping every optimistic row the
 * server has not acknowledged yet.
 *
 * A pending row always wins, whether or not the sheet mentions its id, and both halves
 * matter. An in-flight APPEND is absent from `loaded`, so without this it would leave the
 * screen — and because the snapshot is written from the loaded list, that loss would
 * survive a relaunch. An in-flight EDIT or DELETE is present at its pre-write value, so
 * taking the server's copy discards what the person just did: the deleted row reappears,
 * the balance reverts, the snapshot persists it that way, and then `settled` clears
 * `pending` on the stale row so it reads as saved. A refresh landing between the tap and
 * the reply is enough.
 *
 * Rows the sheet no longer has and that are not pending are gone, not in flight, so they
 * leave. Order follows the sheet, with fresh appends last.
 *
 * A read that changed nothing returns the list ALREADY ON SCREEN, not an equal copy, so
 * `setEntries` can bail out. That is the common case — the app re-reads on every resume —
 * and a fresh array would re-run every memo in `useLedgerView`, re-render the month and
 * re-serialize the snapshot to discover the bytes match. Safe only because `sameEntry`
 * is exact.
 */
export function mergeLoaded(current, loaded) {
  const pending = new Map()
  for (const entry of current) if (entry.pending) pending.set(entry.id, entry)
  if (pending.size === 0) {
    const unchanged =
      current.length === loaded.length &&
      current.every((entry, index) => sameEntry(entry, loaded[index]))
    return unchanged ? current : loaded
  }

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

/** One entry replaced, everything else the same object. Never mutates. */
function replace(entries, id, next) {
  return entries.map((item) => (item.id === id ? next(item) : item))
}

/** A new entry, on screen immediately and marked as not yet in the sheet. */
export function withPending(entries, entry) {
  return [...entries, { ...entry, pending: true }]
}

/** An edit, on screen immediately. Replaces the whole entry, not a patch. */
export function withPendingEdit(entries, entry) {
  return replace(entries, entry.id, () => ({ ...entry, pending: true }))
}

/** A soft delete or a restore, on screen immediately. */
export function withPendingDeletedAt(entries, id, deletedAt) {
  return replace(entries, id, (item) => ({ ...item, deletedAt, pending: true }))
}

/**
 * The write landed. `acknowledge` swaps in the canonical entry — used by an append, where
 * the local copy and the entry are the same object — while `settled` only clears the
 * flag, leaving fields an edit did not touch alone.
 */
export function acknowledge(entries, entry) {
  return replace(entries, entry.id, () => entry)
}

export function settled(entries, id) {
  return replace(entries, id, (item) => ({ ...item, pending: false }))
}

/** The append failed: the row was never in the sheet, so it leaves the screen. */
export function without(entries, id) {
  return entries.filter((entry) => entry.id !== id)
}

/**
 * The edit or delete failed: put back exactly what was there before, rather than clearing
 * `pending` and leaving the optimistic values on screen as if saved.
 *
 * `pending` is stripped from the restored row, because a revert means no write is in
 * flight for it any more — and `previous` can itself be a pending copy when two writes to
 * one entry overlap (restore tapped while the delete is still going). A `pending` flag
 * left set there is permanent: `mergeLoaded` keeps a pending row over the server's
 * forever, so the row freezes, stops receiving the other person's edits, and blocks
 * `compact` for the life of the install.
 */
export function reverted(entries, id, previous) {
  if (!previous) return entries
  const restored = previous.pending ? { ...previous, pending: false } : previous
  return replace(entries, id, () => restored)
}

/**
 * Sheet-wide, unlike the month-scoped deleted list in the UI: this is what `compact`
 * would remove, and it removes every tombstone in every tab.
 */
export function tombstoneCount(entries) {
  return entries.filter((entry) => entry.deletedAt).length
}

/**
 * Whether any write has not reached the sheet yet.
 *
 * Three decisions turn on it: the launch cache must not persist an unacknowledged
 * optimistic row, `compact` must not shift rows a pending write already resolved a number
 * for, and a service-worker update must not reload through a write in flight. Spelled
 * once so they cannot drift apart.
 */
export function hasPendingWrite(entries) {
  return entries.some((entry) => entry.pending)
}

/**
 * Whether activating a service-worker update — which RELOADS the page — would interrupt
 * something. Here rather than in `App` because it is a decision, and a decision in a
 * component is one no test can reach.
 *
 * Three inputs, because `pending` cannot cover them all:
 *
 * - An open FORM, since a reload throws away what is half-typed.
 * - An unacknowledged optimistic entry write (`hasPendingWrite`).
 * - A write carrying no optimistic flag at all: `saveTemplate`, `deleteTemplate` and
 *   `compact`, which write and then `refresh()`. Templates are deliberately outside
 *   `mergeLoaded` and `hasPendingWrite`, so nothing in the entry list can see one — and the
 *   overlay cannot stand in for it either, since `deleteTemplate` switches the overlay to the
 *   recurring page and `compact` runs from settings, both BEFORE awaiting. Those two are the
 *   app's only irreversible writes: reloading mid-`batchUpdate` kills the follow-up read and
 *   the toast, leaving a hard delete half-reported with nothing on screen to say so.
 */
export function blocksReload({ overlay, entries, writing }) {
  const editing = overlay?.kind === 'entry' || overlay?.kind === 'template'
  return editing || Boolean(writing) || hasPendingWrite(entries)
}

/**
 * Why `compact` will not run, or null if it can.
 *
 * Never while a write is in flight: `compact` deletes rows, which shifts every row below
 * each one, and a pending `updateEntry`/`setDeletedAt` already resolved its target row
 * number before the shift — so its write would land on whichever row moved into that
 * position. That case reports `busy` rather than a bare `{removed: 0}`, because "Removed
 * 0 deleted rows" is a lie when there are rows to remove.
 *
 * `supersededRows` is counted because those tombstones are real rows that `reconcileById`
 * hid behind a live one — so there can be nothing to remove in `entries` while the sheet
 * still holds removable rows.
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
 * after Google committed the append — the response lost, not the request — leaves the row
 * on screen as failed; re-submitting with a fresh id would write a second expense that
 * `reconcileById` cannot collapse, and the balance would double-count it forever.
 *
 * `payerShare` is left null, meaning "follow the payer's default" — the form re-derives it
 * whenever the payer control changes. Seeding it here would pin the opening payer's share
 * onto whoever it is switched to.
 */
export function newDraftEntry(person) {
  return {
    id: crypto.randomUUID(),
    type: ENTRY_TYPE.EXPENSE,
    date: todayIso(),
    payer: isPerson(person) ? person : PERSON.P1,
    amountYen: 0,
    category: '',
    description: '',
    payerShare: null,
  }
}

/**
 * `loading` is the first read of a session and gates the UI; `refreshing` is every later
 * one and does not, because there is already something on screen — including a cached
 * launch, which starts at `stale`.
 */
export function statusOnLoadStart(current) {
  return current === 'idle' ? 'loading' : 'refreshing'
}

/**
 * A failed read with something already on screen is `stale`, not `error`: cached data
 * beats an error screen, since the sheet has not changed just because we cannot reach it.
 * This is the offline launch.
 */
export function statusOnLoadFailure(everLoaded) {
  return everLoaded ? 'stale' : 'error'
}

/**
 * Window switching is constant and every refresh spends per-user quota, so focus-triggered
 * reads have a floor.
 *
 * `lastAt` of 0 means "never refreshed" and always passes. Stated rather than left to
 * arithmetic: with a real clock `now - 0` clears any floor, so the first refresh of a
 * session worked by accident of the epoch being 1970.
 */
export function shouldRefresh(now, lastAt, floorMs) {
  if (!lastAt) return true
  return now - lastAt >= floorMs
}

/**
 * Whether a hard delete can run. `deleteDimension` takes nothing but a numeric gid and
 * `values.batchGet` cannot report one, so every such write reads them fresh through
 * `readSheetGids`; a gid still missing after that is what makes the caller refuse loudly rather
 * than silently skip a tab and under-report what it removed.
 *
 * Takes the tabs, because there are two callers with different lists: `compact` over
 * `DATA_TABS`, `deleteTemplate` over the recurring one alone.
 */
export function missingGid(sheetIds, tabs) {
  return tabs.some((tab) => sheetIds?.[tab.title] == null)
}

/**
 * Whether a failed read means "this spreadsheet has no tabs yet" rather than "the read
 * failed". A missing tab or range surfaces as a 400 from the values endpoint, a missing
 * spreadsheet as a 404; either way the answer is to build structure once and retry.
 * Anything else must not lead there — `ensureStructure` is the only path that writes tabs
 * into somebody's spreadsheet.
 */
export function looksUninitialized(cause) {
  return cause?.status === 400 || cause?.status === 404
}

/**
 * Form input as a complete, valid object — or a thrown sentence the person can read.
 *
 * Here rather than in the pure layers because those answer with CODES; turning one into
 * something a person reads is what needs the catalog. The FIRST problem only: a form with one
 * message slot showing four at once is a wall.
 */
const fromInput = (build, validate) => (input) => {
  const value = build(input)
  const problems = validate(value)
  if (problems.length) throw i18nError(`error.${problems[0]}`)
  return value
}

export const entryFromInput = fromInput(makeEntry, validateEntryCodes)
export const templateFromInput = fromInput(makeTemplate, validateTemplateCodes)

/**
 * Everything the screen has to say about itself, as catalog keys.
 *
 * Each reports a state where the numbers on screen are incomplete or suspect, and every
 * one is otherwise silent. Order is worst-first, because they stack above the balance and
 * the top one is the one that gets read. `undecodedTemplates` is last for that reason: it
 * is the only one where nothing on screen is actually wrong — a recurring cost is merely
 * not being offered.
 *
 * A notice, never a gate: the sheet has not changed just because something about it cannot
 * be shown. `staleData` needs an `error` to be real — `stale` alone is where a cached
 * launch starts, before any read has failed.
 *
 * @param {{status: string, error: unknown, configMissing: boolean, undecodedRows: number,
 *   undatedRows: number, unattributedRows: number, undecodedTemplates: number}} state
 * @returns {{key: string, vars?: object}[]}
 */
export function noticeKeys(state = {}) {
  const notices = []
  if (state.status === 'stale' && state.error) notices.push({ key: 'warning.staleData' })
  if (state.configMissing) notices.push({ key: 'warning.configMissing' })
  if (state.undecodedRows > 0) {
    notices.push({ key: 'warning.undecodedRows', vars: { count: state.undecodedRows } })
  }
  if (state.undatedRows > 0) {
    notices.push({ key: 'warning.undatedRows', vars: { count: state.undatedRows } })
  }
  if (state.unattributedRows > 0) {
    notices.push({ key: 'warning.unattributedRows', vars: { count: state.unattributedRows } })
  }
  if (state.undecodedTemplates > 0) {
    notices.push({
      key: 'warning.undecodedTemplates',
      vars: { count: state.undecodedTemplates },
    })
  }
  return notices
}

/**
 * Which screen stands in front of the ledger, or null for the ledger itself.
 *
 * The precedence is the whole content of this function, and every step is a decision:
 * `no-key` — which `useConnection` reports for a key that is absent AND for one the
 * endpoint rejected — outranks holding a cached sheet id, because the id is worthless
 * without a token; a failed read outranks the identity question, because asking someone
 * who they are and then showing them an error is two screens for one problem; and a cached
 * launch is `stale`, not `loading`, so it falls through to the ledger.
 *
 * Here rather than as a ladder of `if`s in `App` because a component's early returns are
 * unreachable from a test, and this order is the one thing about the gates that can be
 * wrong without looking wrong.
 *
 * @param {{connectionStatus: 'unconfigured'|'no-key'|'connected', spreadsheetId: string|null,
 *   connectionFailed: boolean, ledgerStatus: string, me: string|null}} state
 * @returns {'unconfigured'|'key'|'connectionError'|'loading'|'readError'|'identity'|null}
 */
export function gateFor(state = {}) {
  if (state.connectionStatus === 'unconfigured') return 'unconfigured'
  if (state.connectionStatus === 'no-key') return 'key'
  // Holding a key but no sheet id: the first mint is in flight, or it failed.
  if (!state.spreadsheetId) return state.connectionFailed ? 'connectionError' : 'loading'
  if (state.ledgerStatus === 'error') return 'readError'
  if (state.ledgerStatus === 'idle' || state.ledgerStatus === 'loading') return 'loading'
  if (!state.me) return 'identity'
  return null
}

/**
 * What the last read found that `entries` cannot carry, as one object.
 *
 * The key list is written once. Spelled out at both the empty value and the read, adding a
 * counter would mean editing two places and a miss would report a stale number for the life of
 * the session.
 */
export const NO_SHEET_EXTRAS = Object.freeze({
  supersededRows: 0,
  undecodedRows: 0,
  undatedRows: 0,
  unattributedRows: 0,
  undecodedTemplates: 0,
  configMissing: false,
})

export function sheetExtrasFrom(data) {
  return Object.fromEntries(Object.keys(NO_SHEET_EXTRAS).map((key) => [key, data[key]]))
}
