/**
 * The last successful read, kept on the device so a cold launch paints real data
 * before any network call — and therefore before a token exists at all. This is
 * what takes Google off the launch path entirely.
 *
 * Stores the sheet's *partial* config rather than the merged one (see
 * `mergeConfig`): a merged copy would freeze the building build's defaults into
 * every future launch.
 */

import { STORAGE_KEYS, readStored, writeStored } from '../config.js'
import { isPerson } from '../schema.js'

/**
 * A drop marker, never a migration. An unrecognised version means the snapshot is
 * ignored and re-fetched, which is free — the sheet is the source of truth.
 *
 * Bump it whenever the stored shape changes, and bump it per deploy rather than per
 * field: `isRestorable` checks the id, amount, share and payer only, so a snapshot
 * written by a build with a different shape restores and paints one stale frame — with
 * extra keys that defeat `sameEntry`'s key-count check.
 */
const VERSION = 2

/**
 * Roughly 5,000 entries at the current row shape. WebKit charges localStorage in UTF-16
 * code units, so the stored cost is about twice this string's byte length; the cap keeps
 * a very long history from silently blowing the origin's quota, since `writeStored`
 * swallows the resulting error and the app would just stay slow forever.
 */
const MAX_CHARS = 800_000

/**
 * Whether a restored row is safe to hand to the balance.
 *
 * The cache is the one input the app trusts without having decoded it through
 * `rowToEntry`, and it is restored in a `useState` initializer, so it paints during the
 * FIRST render. `splitYen` throws on a non-numeric share and `sumYen` on a non-integer
 * amount, and those run inside `useLedgerView`'s memos — so a single bad row from an
 * un-bumped `VERSION` would white-screen the app with no way in to clear it.
 */
function isRestorable(entry) {
  return (
    Boolean(entry) &&
    typeof entry === 'object' &&
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    Number.isInteger(entry.amountYen) &&
    // Not `Number(...)`: that accepts null, '' and false, all of which coerce to 0
    // and then throw in `splitYen`, which is the crash this guard exists to stop.
    Number.isFinite(entry.payerShare) &&
    // The payer decides the SIGN of the balance, so a junk one is a wrong number
    // rather than a crash — which is worse.
    isPerson(entry.payer)
  )
}

/**
 * What storage is believed to hold, so an unchanged ledger does not pay for a second
 * write. Comparing against storage instead would mean reading the whole string back,
 * which is the cost we are trying to avoid. Set by a successful read as well as a write.
 */
let lastPayload = null

/**
 * The exact list and config that produced it, by reference.
 *
 * `lastPayload` is the backstop for a refresh that returned equal content in a fresh
 * array; this is for the cached launch, where the list on screen IS the one just restored.
 * It catches that case BEFORE the serialize rather than after, which is the expensive
 * half — a thousand-entry ledger is a quarter of a megabyte of JSON built to be thrown
 * away, on the frame someone is waiting for.
 */
let lastSource = null

/**
 * @param {string} spreadsheetId the sheet the caller is about to read
 * @returns {{entries: object[], config: object}|null}
 */
export function readSnapshot(spreadsheetId) {
  if (!spreadsheetId) return null

  const raw = readStored(STORAGE_KEYS.snapshot)
  if (!raw) return null

  try {
    const saved = JSON.parse(raw)
    if (saved?.v !== VERSION) return null
    // A snapshot of a different spreadsheet is somebody else's ledger.
    if (saved.spreadsheetId !== spreadsheetId) return null
    if (!Array.isArray(saved.entries)) return null
    if (!saved.config || typeof saved.config !== 'object') return null
    // All or nothing: a partially dropped list is a wrong balance on screen, which
    // is worse than the empty frame a re-fetch costs.
    if (!saved.entries.every(isRestorable)) return null
    // What storage already holds, so the launch does not immediately rewrite it.
    // `useLedger` persists whatever is on screen once nothing is pending, and on a
    // cached launch that is this very list — so without this every launch pays a full
    // serialize plus a synchronous `setItem` of bytes already there, on the one frame
    // the person is waiting for. The reference pair skips the serialize; the string is
    // the backstop.
    lastPayload = raw
    lastSource = { entries: saved.entries, config: saved.config }
    return { entries: saved.entries, config: saved.config }
  } catch {
    return null
  }
}

/**
 * @param {object[]} entries as returned by a successful read. Never the merged
 *   list `useLedger` holds in state: an unacknowledged optimistic row persisted
 *   here comes back on the next launch looking like a saved entry.
 * @param {object} sheetConfig the partial config, pre-merge
 */
export function writeSnapshot(spreadsheetId, entries, sheetConfig) {
  if (!spreadsheetId) return
  // The same list and config as last time, unchanged since: nothing to serialize.
  if (lastSource && entries === lastSource.entries && sheetConfig === lastSource.config) return
  const payload = JSON.stringify({
    v: VERSION,
    spreadsheetId,
    config: sheetConfig ?? {},
    // `pending` is stripped as a second line of defence behind that @param: a
    // row that came back from the sheet is saved by definition.
    entries: entries.map(({ pending, ...entry }) => entry),
  })
  // Remembered before the two refusals below, not after: whether the bytes turned out
  // to be already stored or too large to store, this exact list has been considered
  // and the answer will not change until one of the two references does.
  lastSource = { entries, config: sheetConfig }
  if (payload === lastPayload) return
  if (payload.length > MAX_CHARS) return
  lastPayload = payload
  writeStored(STORAGE_KEYS.snapshot, payload)
}

export function clearSnapshot() {
  lastPayload = null
  lastSource = null
  writeStored(STORAGE_KEYS.snapshot, null)
}
