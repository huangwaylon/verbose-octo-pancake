/**
 * The bookkeeping behind optimistic writes, as pure functions: every list transition and status
 * decision, where a test can reach it without a DOM. `useLedger` owns only state, effects and the
 * order of the calls. Nothing here mutates.
 */

import { ENTRY_TYPE, PERSON, isActive, isPerson, makeEntry, validateEntryCodes } from '../schema.js'
import { todayIso } from './dates.js'
import { makeTemplate, validateTemplateCodes } from './recurring.js'
import { i18nError } from '../i18n/index.js'

/**
 * One entry per id, keeping the row that is actually live. An id is not unique across the two
 * tabs: a payer move appends to the new tab and tombstones the old row.
 *
 * Left unreconciled the tombstone is what every id lookup finds first, and all three consumers go
 * wrong silently — `entryById` hands the next edit a dead row's payer, so the write appends a
 * SECOND live row; `deletedEntries` offers the tombstone for restore; `withPendingEdit` rewrites
 * both.
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
 * A live row wins; between two tombstones the one deleted LAST does. `deletedAt` breaks the tie,
 * NOT array order — that is tab order, so "last seen" can be a pre-move copy whose restore revives
 * the entry under the wrong payer.
 *
 * Two LIVE rows for one id have no stamp to compare and keep the incumbent; either is correct.
 * `compact` removes only non-empty `deleted_at`, so the duplicate stays hidden until an edit or a
 * delete tombstones one of them.
 */
function supersedes(entry, kept) {
  if (isActive(entry) !== isActive(kept)) return isActive(entry)
  return String(entry.deletedAt ?? '') > String(kept.deletedAt ?? '')
}

/**
 * Whether two entries are the same row, field for field. Key-driven rather than a hand-written
 * field list, so a field added to `rowToEntry` is covered: a list that missed one would report two
 * different rows as equal and freeze the newer one off the screen.
 */
function sameEntry(a, b) {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}

/**
 * Fold a fresh server read into what is on screen, keeping every optimistic row the server has not
 * acknowledged yet — a refresh landing between a tap and its reply is enough to need both halves.
 * An in-flight APPEND is absent from `loaded`, and the snapshot is written from that list, so the
 * loss survives a relaunch; an in-flight EDIT or DELETE is there at its pre-write value, and
 * taking the server's copy discards what the person just did, after which `settled` clears
 * `pending` so the stale row reads as saved.
 *
 * Rows the sheet no longer has and that are not pending leave. Order follows the sheet, appends
 * last.
 *
 * A read that changed nothing returns the list ALREADY ON SCREEN, so `setEntries` can bail out; a
 * fresh array would re-run every memo and re-serialize the snapshot to find the bytes match. Safe
 * only because `sameEntry` is exact.
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

/** One entry replaced, everything else the same object. */
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
 * The write landed. `acknowledge` swaps in the canonical entry, for an append; `settled` only
 * clears the flag, leaving fields an edit did not touch alone.
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
 * `pending` is stripped, because `previous` can itself be a pending copy when two writes to one
 * entry overlap — and left set it is permanent: `mergeLoaded` keeps a pending row over the
 * server's, so the row freezes and blocks `compact` for the life of the install.
 */
export function reverted(entries, id, previous) {
  if (!previous) return entries
  const restored = previous.pending ? { ...previous, pending: false } : previous
  return replace(entries, id, () => restored)
}

/** Sheet-wide, unlike the UI's month-scoped deleted list: this is what `compact` would remove. */
export function tombstoneCount(entries) {
  return entries.filter((entry) => entry.deletedAt).length
}

/**
 * Whether any write has not reached the sheet yet. Spelled once, because three decisions turn on
 * it: the cache must not persist an unacknowledged row, `compact` must not shift rows a pending
 * write already resolved a number for, and a worker update must not reload through one.
 */
export function hasPendingWrite(entries) {
  return entries.some((entry) => entry.pending)
}

/**
 * Whether activating a service-worker update — which RELOADS the page — would interrupt something.
 * Here rather than in `App`, whose decisions no test can reach.
 *
 * Three inputs, because `pending` cannot cover them all:
 *
 * - An open FORM, since a reload throws away what is half-typed.
 * - An unacknowledged optimistic entry write (`hasPendingWrite`).
 * - A write carrying no optimistic flag: `saveTemplate`, `deleteTemplate` and `compact`, which sit
 *   outside `mergeLoaded` and change or leave the overlay BEFORE awaiting. The hard deletes are also
 *   irreversible, and reloading mid-`batchUpdate` leaves one half-reported.
 */
export function blocksReload({ overlay, entries, writing }) {
  const editing = overlay?.kind === 'entry' || overlay?.kind === 'template'
  return editing || Boolean(writing) || hasPendingWrite(entries)
}

/**
 * Why `compact` will not run, or null if it can.
 *
 * Never while a write is in flight: deleting rows shifts every row below, and a pending
 * `updateEntry`/`setDeletedAt` already resolved its target row number. That reports `busy`, not a
 * `{removed: 0}` that would be a lie when there are rows to remove. `supersededRows` counts,
 * because those tombstones are real rows `reconcileById` hid behind a live one.
 */
export function compactRefusal(entries, supersededRows) {
  if (hasPendingWrite(entries)) return { removed: 0, busy: true }
  if (!tombstoneCount(entries) && !supersededRows) return { removed: 0 }
  return null
}

/**
 * A blank entry for the add form. The id is minted when the draft OPENS rather than per submit:
 * re-submitting a lost response under a fresh id writes a second expense `reconcileById` cannot
 * collapse. `payerShare` is left null, or the opening payer's default would follow a switch of
 * payer.
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
 * `loading` is the first read of a session and gates the UI; `refreshing` is every later one and
 * does not, because there is already something on screen — including a cached launch, which starts
 * at `stale`.
 */
export function statusOnLoadStart(current) {
  return current === 'idle' ? 'loading' : 'refreshing'
}

/**
 * A failed read with something already on screen is `stale`, not `error`: the sheet has not
 * changed just because we cannot reach it. This is the offline launch.
 */
export function statusOnLoadFailure(everLoaded) {
  return everLoaded ? 'stale' : 'error'
}

/**
 * Focus-triggered reads have a floor: window switching is constant and every refresh spends
 * per-user quota. `lastAt` of 0 means "never refreshed" and always passes — stated rather than
 * left to arithmetic, which would work only by accident of the epoch being 1970.
 */
export function shouldRefresh(now, lastAt, floorMs) {
  if (!lastAt) return true
  return now - lastAt >= floorMs
}

/**
 * Whether a hard delete can run: a gid still missing after a fresh `readSheetGids` is what makes
 * the caller refuse loudly rather than skip a tab and under-report what it removed. Takes the
 * tabs, because `compact` covers `DATA_TABS` and `deleteTemplate` the recurring one alone.
 */
export function missingGid(sheetGids, tabs) {
  return tabs.some((tab) => sheetGids?.[tab.title] == null)
}

/**
 * Whether a failed read means "this spreadsheet has no tabs yet" rather than "the read failed": a
 * missing tab or range is a 400, a missing spreadsheet a 404. Anything else must not lead there —
 * `ensureStructure` is the only path that writes tabs into somebody's spreadsheet.
 */
export function looksUninitialized(cause) {
  return cause?.status === 400 || cause?.status === 404
}

/**
 * Form input as a complete, valid object — or a thrown sentence the person can read. Here rather
 * than in the pure layers because those answer with CODES. The FIRST problem only: a form with one
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
 * Everything the screen has to say about itself, as catalog keys. Worst-first, because they stack
 * above the balance and the top one is what gets read; `undecodedTemplates` is last because it is
 * the only one where nothing on screen is wrong. A notice, never a gate — and `staleData` needs an
 * `error`, since `stale` alone is where a cached launch starts.
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
 * Every step of the precedence is a decision: `no-key` — reported for a key that is absent AND for
 * one the endpoint rejected — outranks a cached sheet id, which is worthless without a token; a
 * failed read outranks the identity question, since asking who someone is and then showing an
 * error is two screens for one problem; and a cached launch is `stale`, so it falls through to the
 * ledger.
 *
 * Here rather than as a ladder of `if`s in `App`, whose early returns no test can reach.
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
 * What the last read found that `entries` cannot carry. The key list is written once: spelled out
 * at both the empty value and the read, a missed counter would report a stale number all session.
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
