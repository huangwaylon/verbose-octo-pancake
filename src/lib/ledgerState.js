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
 * Whether two entries — or two templates — are the same row, field for field. Key-driven rather
 * than a hand-written field list, so a field added to `rowToEntry` is covered: a list that missed
 * one would report two different rows as equal and freeze the newer one off the screen. An array
 * field (a template's `months`) compares by its items.
 */
function sameEntry(a, b) {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => {
    const x = a[key]
    const y = b[key]
    if (Array.isArray(x) && Array.isArray(y)) {
      return x.length === y.length && x.every((item, index) => item === y[index])
    }
    return x === y
  })
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
 * Every row the read did not change keeps its on-screen OBJECT, so one edit re-renders one memo'd
 * row, and a read that changed nothing returns the list already on screen, so `setEntries` bails.
 * Safe only because `sameEntry` is exact.
 */
export function mergeLoaded(current, loaded) {
  const pending = new Map()
  const onScreen = new Map()
  for (const entry of current) (entry.pending ? pending : onScreen).set(entry.id, entry)

  let merged = loaded.map((entry) => {
    const mine = pending.get(entry.id)
    if (mine) return mine
    const shown = onScreen.get(entry.id)
    return shown && sameEntry(shown, entry) ? shown : entry
  })
  if (pending.size) {
    const loadedIds = new Set(loaded.map((entry) => entry.id))
    const appended = [...pending.values()].filter((entry) => !loadedIds.has(entry.id))
    if (appended.length) merged = [...merged, ...appended]
  }
  const unchanged =
    merged.length === current.length && merged.every((entry, index) => entry === current[index])
  return unchanged ? current : merged
}

/** The entry with this id, or undefined. What a failed write reverts to. */
export function entryById(entries, id) {
  return entries.find((entry) => entry.id === id)
}

/**
 * Whether an add appends a row or overwrites one. A form keeps its draft id through a failed save,
 * and a failure can be a lost RESPONSE to an append that landed: once a refresh has read that row,
 * appending again puts the entry in the sheet, and on screen, twice. So an id already present is an
 * edit of it — refused, like any edit, while that row is still pending.
 */
export function addWriteKind(entries, id) {
  return entryById(entries, id) ? 'edit' : 'append'
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
 * The write landed. `acknowledge` swaps in the canonical entry, for an append; `settled` only drops
 * the flag, leaving fields an edit did not touch alone.
 *
 * DROPS it rather than setting it false, because `sameEntry` compares key COUNTS: a row carrying a
 * tenth key can never equal the sheet's copy, so `mergeLoaded` stops recognising a read that
 * changed nothing and every later read re-runs every memo and re-serialises the snapshot.
 */
export function acknowledge(entries, entry) {
  return replace(entries, entry.id, () => entry)
}

export function settled(entries, id) {
  return replace(entries, id, (item) => withoutPending(item))
}

/** @returns {object} the entry without its `pending` key, never with it set false. */
function withoutPending({ pending: _pending, ...rest }) {
  return rest
}

/** The append failed: the row was never in the sheet, so it leaves the screen. */
export function without(entries, id) {
  return entries.filter((entry) => entry.id !== id)
}

/**
 * The edit or delete failed: put back exactly what was there before, rather than clearing
 * `pending` and leaving the optimistic values on screen as if saved.
 *
 * `pending` is stripped whatever `previous` carries. `entryWriteRefusal` keeps a pending copy from
 * reaching here today, but left set the flag is permanent: `mergeLoaded` keeps a pending row over
 * the server's, so the row would freeze and block `compact` for the life of the install.
 */
export function reverted(entries, id, previous) {
  if (!previous) return entries
  const restored = previous.pending ? withoutPending(previous) : previous
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
 * Four inputs, because `pending` cannot cover them all:
 *
 * - An open FORM, or one a delete confirmation will return to, since a reload throws away what is
 *   half-typed.
 * - An unacknowledged optimistic entry write (`hasPendingWrite`).
 * - A write carrying no optimistic flag: `saveTemplate`, `deleteTemplate` and `compact`, which sit
 *   outside `mergeLoaded` and change or leave the overlay BEFORE awaiting. The hard deletes are also
 *   irreversible, and reloading mid-`batchUpdate` leaves one half-reported.
 * - A read in flight (`status`). Nothing is lost, but the reloaded page spends the same round trips
 *   again — and a worker already waiting at launch would otherwise throw away the launch read.
 */
export function blocksReload({ overlay, entries, writing, status }) {
  return (
    isForm(overlay) ||
    isForm(overlay?.returnTo) ||
    Boolean(writing) ||
    hasPendingWrite(entries) ||
    status === 'loading' ||
    isRefreshing(status)
  )
}

/** A delete confirmation opened from a form holds that form's typed fields in `returnTo`. */
function isForm(overlay) {
  return overlay?.kind === 'entry' || overlay?.kind === 'template'
}

/**
 * Why a write to an existing entry is refused before it starts, as an i18n key, or null. A row
 * still pending may not be in the tab its payer names yet, and `updateEntry`/`setDeletedAt` resolve
 * the row from that payer.
 */
export function entryWriteRefusal(previous) {
  if (!previous) return 'error.entryGone'
  if (previous.pending) return 'error.stillSaving'
  return null
}

/**
 * Why `compact` will not run, or null if it can.
 *
 * Never while a write is in flight: deleting rows shifts every row below, and a pending
 * `updateEntry`/`setDeletedAt` already resolved its target row number — and never beside another
 * compact, whose row numbers this one would shift. `writing` counts the writes with no optimistic
 * flag, a compact among them. That reports `busy`, not a `{removed: 0}` that would be a lie when
 * there are rows to remove. `supersededRows` counts, because those tombstones are real rows
 * `reconcileById` hid behind a live one.
 */
export function compactRefusal(entries, supersededRows, writing = 0) {
  if (writing > 0 || hasPendingWrite(entries)) return { removed: 0, busy: true }
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
 * `loading` gates the UI and `refreshing` does not, because there is already something on screen —
 * including a cached launch, which starts at `stale`. `error` is only reached when nothing ever
 * loaded, so its Retry is a first read too, and a read begun during `loading` still has nothing.
 */
export function statusOnLoadStart(current) {
  return current === 'idle' || current === 'loading' || current === 'error'
    ? 'loading'
    : 'refreshing'
}

/** Whether a read is in flight with something already on screen — the header's spinner. */
export function isRefreshing(status) {
  return status === 'refreshing'
}

/**
 * Whether the sheet has actually been read this session, which is NOT "not loading": `stale` is a
 * cached launch, holding no templates, where the recurring page must say it has not loaded rather
 * than claim there are no recurring costs.
 */
export function hasLoaded(status) {
  return status === 'ready' || isRefreshing(status)
}

/**
 * A failed read with something already on screen is `stale`, not `error`: the sheet has not
 * changed just because we cannot reach it. This is the offline launch.
 */
export function statusOnLoadFailure(everLoaded) {
  return everLoaded ? 'stale' : 'error'
}

/**
 * Which reads may apply. Only the NEWEST: two reads on a flaky connection can resolve out of order,
 * and one in flight when the key is forgotten would repopulate a sheet the app has left. And none
 * that an entry write SETTLED during: the server may have answered before the write landed, and
 * with `pending` already cleared `mergeLoaded` would take that copy and undo the write on screen —
 * a recurring tick's draft back, one tap from a duplicate. That read is re-read instead.
 *
 * @returns {{start: () => {verdict: () => 'apply'|'reread'|'drop'}, invalidate: () => void,
 *   writeSettled: () => void}}
 */
export function createReadGate() {
  let generation = 0
  let writes = 0
  return {
    start() {
      const startedAt = (generation += 1)
      const writesAtStart = writes
      return {
        verdict() {
          if (startedAt !== generation) return 'drop'
          return writesAtStart === writes ? 'apply' : 'reread'
        },
      }
    },
    invalidate() {
      generation += 1
    },
    writeSettled() {
      writes += 1
    },
  }
}

/**
 * Whether two template lists say the same thing, so a read that changed none keeps the array on
 * screen and every memo keyed on it holds.
 */
export function sameTemplates(a, b) {
  return a.length === b.length && a.every((template, index) => sameEntry(template, b[index]))
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
 * Whether a fresh `readSheetGids` left any of these tabs unnamed, which `requireGids` refuses loudly
 * rather than skip a tab — an append, `compact` or `deleteTemplate` acting on gid 0 instead.
 */
export function missingGid(sheetGids, tabs) {
  return tabs.some((tab) => sheetGids?.[tab.title] == null)
}

/**
 * Whether a status means "the range or the spreadsheet is not there": a missing tab or range is a
 * 400, a missing spreadsheet a 404. Two decisions turn on those two numbers — `loadAll` retrying
 * without the config range, and this one — so they are written down once.
 */
export function missingRangeOrSheet(status) {
  return status === 400 || status === 404
}

/**
 * Whether a failed read means "this spreadsheet has no tabs yet" rather than "the read failed".
 * Anything else must not lead there — `ensureStructure` is the only path that writes tabs into
 * somebody's spreadsheet.
 */
export function looksUninitialized(cause) {
  return missingRangeOrSheet(cause?.status)
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
 * Takes a `status`, an `error` and the counts of `NO_SHEET_EXTRAS`.
 *
 * @returns {{key: string, vars?: object}[]}
 */
export function noticeKeys(state = {}) {
  const notices = []
  if (state.status === 'stale' && state.error) notices.push({ key: 'warning.staleData' })
  if (state.configMissing) notices.push({ key: 'warning.configMissing' })
  for (const [count, key] of COUNTED_NOTICES) {
    if (state[count] > 0) notices.push({ key, vars: { count: state[count] } })
  }
  return notices
}

/**
 * The counted notices in order. The duplicates sit beside the unreadable rows: both are an amount
 * the sheet holds and no total carries.
 */
// prettier-ignore
const COUNTED_NOTICES = [
  ['undecodedRows',      'warning.undecodedRows'],
  ['duplicateRows',      'warning.duplicateRows'],
  ['undatedRows',        'warning.undatedRows'],
  ['unattributedRows',   'warning.unattributedRows'],
  ['undecodedTemplates', 'warning.undecodedTemplates'],
]

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
  duplicateRows: 0,
  undecodedRows: 0,
  undatedRows: 0,
  unattributedRows: 0,
  undecodedTemplates: 0,
  configMissing: false,
})

export function sheetExtrasFrom(data) {
  return Object.fromEntries(Object.keys(NO_SHEET_EXTRAS).map((key) => [key, data[key]]))
}
