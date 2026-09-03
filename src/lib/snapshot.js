/**
 * The last successful read, kept on the device so a cold launch paints real data before any
 * network call — and therefore before a token exists. Stores the sheet's PARTIAL config rather
 * than the merged one, or the building build's defaults would freeze into every future launch.
 */

import { STORAGE_KEYS, readStored, writeStored } from '../config.js'
import { isPerson } from '../schema.js'

/**
 * A drop marker, never a migration: an unrecognised version is ignored and re-fetched, which is
 * free.
 *
 * Bump it whenever the stored shape changes, and per deploy rather than per field — `isRestorable`
 * checks the id, amount, share and payer only, so a snapshot of a different shape restores, paints
 * one stale frame, and carries extra keys that defeat `sameEntry`'s key-count check.
 */
const VERSION = 2

/**
 * Roughly 5,000 entries at the current row shape. WebKit charges localStorage in UTF-16 code
 * units, so the stored cost is about twice this. The cap keeps a very long history from silently
 * blowing the origin's quota, since `writeStored` swallows that error and the app would stay slow
 * forever.
 */
const MAX_CHARS = 800_000

/**
 * Whether a restored row is safe to hand to the balance. The cache is the one input never decoded
 * through `rowToEntry` and it is restored in a `useState` initializer, so `splitYen` throwing on a
 * junk share inside `useLedgerView`'s memos white-screens the app with no way in to clear it.
 */
function isRestorable(entry) {
  return (
    Boolean(entry) &&
    typeof entry === 'object' &&
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    Number.isInteger(entry.amountYen) &&
    // Not `Number(...)`: that accepts null, '' and false, which coerce to 0 and then throw in
    // `splitYen` — the crash this guard exists to stop.
    Number.isFinite(entry.payerShare) &&
    // The payer decides the SIGN of the balance, so a junk one is a wrong number rather than a
    // crash, which is worse.
    isPerson(entry.payer)
  )
}

/**
 * What storage is believed to hold, so an unchanged ledger does not pay for a second write;
 * comparing against storage would mean reading the whole string back. Set by a successful read as
 * well as a write.
 */
let lastPayload = null

/**
 * The exact list and config that produced it, by reference — for the cached launch, where the list
 * on screen IS the one just restored. It catches that case BEFORE the serialize, which for a
 * thousand-entry ledger is a quarter of a megabyte of JSON built to be thrown away.
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
    // All or nothing: a partially dropped list is a wrong balance on screen, which is worse than
    // the empty frame a re-fetch costs.
    if (!saved.entries.every(isRestorable)) return null
    // What storage already holds, so the launch does not immediately rewrite it: `useLedger`
    // persists whatever is on screen once nothing is pending, which on a cached launch is this
    // very list.
    lastPayload = raw
    lastSource = { spreadsheetId, entries: saved.entries, config: saved.config }
    return { entries: saved.entries, config: saved.config }
  } catch {
    return null
  }
}

/**
 * @param {object[]} entries as returned by a successful read. Never the merged list `useLedger`
 *   holds in state: an unacknowledged optimistic row persisted here comes back on the next launch
 *   looking like a saved entry.
 * @param {object} sheetConfig the partial config, pre-merge
 */
export function writeSnapshot(spreadsheetId, entries, sheetConfig) {
  if (!spreadsheetId) return
  // The same list and config as last time, for the same SHEET: without the id, switching
  // spreadsheets while both references are still the first sheet's caches its ledger under the
  // second one's id.
  if (
    lastSource &&
    lastSource.spreadsheetId === spreadsheetId &&
    entries === lastSource.entries &&
    sheetConfig === lastSource.config
  ) {
    return
  }
  const payload = JSON.stringify({
    v: VERSION,
    spreadsheetId,
    config: sheetConfig ?? {},
    // `pending` is stripped as a second line of defence behind that @param.
    entries: entries.map(({ pending, ...entry }) => entry),
  })
  // Remembered before the two refusals below: stored or too large to store, this exact list has
  // been considered and the answer holds until a reference changes.
  lastSource = { spreadsheetId, entries, config: sheetConfig }
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
