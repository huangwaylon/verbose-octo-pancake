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
 * @param {object[]} entries as returned by a successful read — never optimistic
 *   rows, whose `pending` flag would come back looking like a saved entry
 * @param {object} sheetConfig the partial config, pre-merge
 */
export function writeSnapshot(spreadsheetId, entries, sheetConfig) {
  if (!spreadsheetId) return
  const payload = JSON.stringify({
    v: VERSION,
    spreadsheetId,
    config: sheetConfig ?? {},
    // `rowNumber` is advisory everywhere (updateEntry and setDeletedAt re-resolve
    // id -> row before writing) and meaningless once the sheet has been edited
    // elsewhere, so it is not worth persisting.
    entries: entries.map(({ rowNumber, pending, ...entry }) => entry),
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
