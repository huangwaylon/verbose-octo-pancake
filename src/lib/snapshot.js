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
 * ignored and re-fetched, which is free — the sheet is the source of truth and
 * this is only a cache. Bump it whenever the stored shape changes.
 */
const VERSION = 1

/**
 * Roughly 2000 entries. WebKit charges localStorage in UTF-16 code units, so the
 * stored cost is about twice the byte length of this string; the cap keeps a very
 * long history from silently blowing the origin's quota, since `writeStored`
 * swallows the resulting error and the app would just stay slow forever.
 */
const MAX_CHARS = 800_000

/**
 * Whether a restored row is safe to hand to the balance.
 *
 * The cache is the one input the app trusts without having decoded it through
 * `rowToEntry`, and it is restored in a `useState` initializer, so it paints during the
 * FIRST render — before any network call. `splitCents` throws on a non-numeric share and
 * `sumCents` on a non-integer amount, and those run inside `useLedgerView`'s memos, so a
 * single bad row from an un-bumped `VERSION` would white-screen the app with no way in
 * to clear it. Cheaper to check here and re-fetch: the sheet is the source of truth.
 */
function isRestorable(entry) {
  return (
    Boolean(entry) &&
    typeof entry === 'object' &&
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    Number.isInteger(entry.amountCents) &&
    // Not `Number(...)`: that accepts null, '' and false, all of which coerce to 0
    // and then throw in `splitCents`, which is the crash this guard exists to stop.
    Number.isFinite(entry.payerShare) &&
    typeof entry.currency === 'string' &&
    // The payer decides the SIGN of the balance, so a junk one is a wrong number
    // rather than a crash — which is worse.
    isPerson(entry.payer)
  )
}

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
    return { entries: saved.entries, config: saved.config }
  } catch {
    return null
  }
}

/**
 * The last payload written this session, so an unchanged refresh does not pay for
 * a second write. Comparing against storage instead would mean reading the whole
 * string back, which is the cost we are trying to avoid.
 */
let lastPayload = null

/**
 * @param {object[]} entries as returned by a successful read. Never the merged
 *   list `useLedger` holds in state: an unacknowledged optimistic row persisted
 *   here comes back on the next launch looking like a saved entry.
 * @param {object} sheetConfig the partial config, pre-merge
 */
export function writeSnapshot(spreadsheetId, entries, sheetConfig) {
  if (!spreadsheetId) return
  const payload = JSON.stringify({
    v: VERSION,
    spreadsheetId,
    config: sheetConfig ?? {},
    // `pending` is stripped as a second line of defence behind that @param: a
    // row that came back from the sheet is saved by definition.
    entries: entries.map(({ pending, ...entry }) => entry),
  })
  if (payload === lastPayload) return
  if (payload.length > MAX_CHARS) return
  lastPayload = payload
  writeStored(STORAGE_KEYS.snapshot, payload)
}

export function clearSnapshot() {
  lastPayload = null
  writeStored(STORAGE_KEYS.snapshot, null)
}
