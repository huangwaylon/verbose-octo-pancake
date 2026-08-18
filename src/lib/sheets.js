/**
 * Google Sheets API v4 access.
 *
 * The sheet layout lives in schema.js; this module only knows how to talk to the
 * API. Every write uses valueInputOption RAW so a description like "=SUM(A:A)"
 * is stored as literal text and dates are never re-formatted.
 *
 * Ranges are passed through `encodeURIComponent`, which leaves '!' alone —
 * exactly what the API wants in "expenses_p1!A2:K" — while escaping the rest.
 */

import { mergeConfig } from '../config.js'
import {
  CONFIG_RANGE,
  CONFIG_TAB,
  EXPENSE_COLUMNS,
  FIRST_DATA_ROW,
  PEOPLE,
  PERSON,
  cellRange,
  cellText,
  columnIndex,
  entryToRow,
  expensesDataRange,
  expensesHeaderRange,
  expensesTab,
  isPerson,
  rowRange,
  rowToEntry,
} from '../schema.js'
import { reconcileById, tombstoneCount } from './ledgerState.js'
import { getAccessToken, refreshToken } from './connection.js'
import { defaultConfigRows, parseConfigRows } from './sheetConfig.js'
import { i18nError } from '../i18n/index.js'

const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets'
const RAW = 'RAW'

/**
 * Telling "this spreadsheet is not reachable" apart from "try again".
 *
 * 404 is always the former. 403 is both: Google returns it for a revoked share AND
 * for a tripped quota, so the reason decides — calling a rate limit a lost share
 * sends someone to re-share a spreadsheet that is fine.
 */
const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
  'dailyLimitExceeded',
])

function isUnreachable(status, payload) {
  if (status === 404) return true
  if (status !== 403) return false
  const reasons = (payload?.error?.errors ?? []).map((item) => item?.reason)
  return !reasons.some((reason) => RATE_LIMIT_REASONS.has(reason))
}

const ID_INDEX = columnIndex('id')
const DELETED_AT_INDEX = columnIndex('deleted_at')
const DATE_INDEX = columnIndex('date')

function buildQuery(params) {
  const query = new URLSearchParams()
  // Several callers pass no params at all — `:batchUpdate` takes only a body.
  for (const [key, value] of Object.entries(params ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, String(item))
    } else {
      query.set(key, String(value))
    }
  }
  return query.toString()
}

/**
 * Single entry point for every Sheets call.
 *
 * A 401 means the token was rejected (revoked, or the session moved on) even if
 * it still looked unexpired, so re-acquire once and retry exactly once. Never
 * more — a revoked grant would loop.
 *
 * This retry is what makes the refresh margin in `connection.js` a performance
 * choice rather than a correctness one: minting needs no user gesture, so the
 * recovery is silent. `refreshToken` guarantees a token newer than any mint that
 * was already in flight when the 401 arrived.
 *
 * Thrown errors carry `.status` so callers can tell 401/403/404 apart, and an
 * `i18nKey` so the sentence that reaches the screen is in the reader's language.
 * The `.message` stays English and keeps the API's own text, because that is what
 * ends up in a console and a bug report — a Japanese reader must never be shown
 * "The caller does not have permission (HTTP 403)".
 */
async function request(path, { method = 'GET', params, body, allowRetry = true } = {}) {
  const token = await getAccessToken()
  const query = buildQuery(params)

  const response = await fetch(`${BASE_URL}${path}${query ? `?${query}` : ''}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (response.ok) return response.json().catch(() => ({}))

  if (response.status === 401 && allowRetry) {
    await refreshToken()
    return request(path, { method, params, body, allowRetry: false })
  }

  const payload = await response.json().catch(() => null)
  const message = payload?.error?.message ?? response.statusText ?? 'Request failed'
  const error = new Error(`Google Sheets: ${message} (HTTP ${response.status})`)
  error.status = response.status
  // A 403/404 is not a blip: the account has lost access to the spreadsheet, or the
  // id is wrong. Reporting it as transient hides it behind the focus refresh's
  // 30-second floor and a "showing saved data" notice, forever.
  error.i18nKey = isUnreachable(response.status, payload)
    ? 'error.sheetUnreachable'
    : 'error.sheetRequest'
  throw error
}

function batchGetValues(spreadsheetId, ranges) {
  return request(`/${encodeURIComponent(spreadsheetId)}/values:batchGet`, {
    params: { ranges, majorDimension: 'ROWS' },
  })
}

function getValues(spreadsheetId, range) {
  return request(`/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`, {
    params: { majorDimension: 'ROWS' },
  })
}

function updateValues(spreadsheetId, range, values) {
  return request(`/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`, {
    method: 'PUT',
    params: { valueInputOption: RAW },
    body: { values },
  })
}

/**
 * Load everything the app needs in one round trip.
 *
 * The config is resolved before the rows, because a row whose currency cell is
 * blank is decoded at the sheet's currency and getting that order wrong is a
 * silent 100x error.
 *
 * Returns the sheet's own partial config as well as the merged one, because the
 * snapshot cache has to store the partial — see `mergeConfig`.
 *
 * The counts are how the sheet reports what it holds and the app cannot show. Each
 * one exists because the alternative is a wrong number with nothing said:
 *
 * `supersededRows` — TOMBSTONES `reconcileById` hid. Only tombstones, because the
 * consumer is the compact button and `compact` removes exactly those: counting a
 * hidden live duplicate would offer a removal that can never happen.
 *
 * `undecodedRows` — live rows with an id whose amount cannot be read at all, so the
 * ledger is short by them. A tombstoned one is correctly out of the totals already.
 *
 * `undatedRows` — live rows whose date cell is not a real ISO day. These DO reach
 * the balance but belong to no month, so they never appear in a month's list and
 * cannot be found and fixed from the app. A hand-typed date that Sheets stored as a
 * date is the common cause: reads are `FORMATTED_VALUE`, so it comes back in the
 * spreadsheet's own locale ("8/5/2026"). Asking for `UNFORMATTED_VALUE` instead
 * would make it a serial number, which is worse.
 *
 * `configMissing` — the config tab is gone or renamed, so every default applies:
 * on a USD sheet, every row with a blank currency cell silently decodes at JPY's
 * zero minor digits. Reported rather than repaired, because seeding a fresh config
 * tab would write the DEFAULT currency into the sheet and make the error permanent.
 *
 * `currencyDefaulted` — the tab is readable but names no usable currency, which carries
 * exactly the same 100x risk as the tab being absent and was the one way to reach it
 * silently: `configMissing` can only be set by a *failed* read, so a tab whose rows were
 * cleared, or which merely lost its `currency` row, ran the whole ledger on the default
 * with nothing said. Also never repaired, for the same reason.
 *
 * @returns {Promise<{entries: object[], config: object, sheetConfig: object,
 *   supersededRows: number, undecodedRows: number, undatedRows: number,
 *   configMissing: boolean, currencyDefaulted: boolean}>}
 */
export async function loadAll(spreadsheetId) {
  const ranges = [expensesDataRange(PERSON.P1), expensesDataRange(PERSON.P2), CONFIG_RANGE]
  let valueRanges
  let configMissing = false

  try {
    const data = await batchGetValues(spreadsheetId, ranges)
    valueRanges = data.valueRanges ?? []
  } catch (error) {
    // A missing config tab makes the API reject the whole batch, so retry
    // without it. The shortened reply then has no third range, and the defaults
    // win by way of `parseConfigRows([])`.
    if (error.status !== 400 && error.status !== 404) throw error
    const data = await batchGetValues(spreadsheetId, ranges.slice(0, 2))
    valueRanges = data.valueRanges ?? []
    configMissing = true
  }

  const sheetConfig = parseConfigRows(valueRanges[2]?.values ?? [])
  const config = mergeConfig(sheetConfig)

  let undecodedRows = 0
  let undatedRows = 0
  const decoded = PEOPLE.flatMap((person, index) =>
    // Same order as `ranges` above: p1's tab, then p2's, then the config.
    (valueRanges[index]?.values ?? []).flatMap((row) => {
      // A tombstoned row is meant to be absent from every total, so neither count
      // applies to it; a row with no id is a blank one and says nothing either.
      const counts = cellText(row, ID_INDEX) && !cellText(row, DELETED_AT_INDEX)
      const entry = rowToEntry(row, person, config.currency)
      if (!entry) {
        if (counts) undecodedRows += 1
        return []
      }
      // The cell held something; `rowToEntry` could not make a real day of it.
      if (counts && !entry.date && cellText(row, DATE_INDEX)) undatedRows += 1
      return [entry]
    }),
  )

  const entries = reconcileById(decoded)
  return {
    entries,
    config,
    sheetConfig,
    supersededRows: tombstoneCount(decoded) - tombstoneCount(entries),
    undecodedRows,
    undatedRows,
    configMissing,
    // Reported whether the tab is missing or merely silent on the currency; which of
    // the two it is, is `noticeKeys`' problem, not this layer's.
    currencyDefaulted: !sheetConfig.currency,
  }
}

export async function appendEntry(spreadsheetId, entry) {
  await request(
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(expensesTab(entry.payer))}:append`,
    {
      method: 'POST',
      params: { valueInputOption: RAW, insertDataOption: 'INSERT_ROWS' },
      body: { values: [entryToRow(entry)] },
    },
  )
}

/**
 * Locate an entry's current row within one person's tab.
 *
 * Row numbers cannot be cached: inserting or deleting rows in the Sheets UI shifts
 * every row below the edit, and writing to a stale row silently overwrites a
 * different expense — so this re-reads immediately before every write.
 *
 * It reads the FULL row range rather than the id column alone, because **an id is not
 * unique within a tab**. `updateEntry` leaves a same-id tombstone behind whenever the
 * payer moves, so an entry whose payer has moved away and back has the id in this tab
 * twice — once dead, once live. Taking the first match then writes to the dead row: a
 * delete stamps a row that is already tombstoned and the live one survives, so the
 * delete silently does nothing and the expense returns on the next refresh; a plain
 * edit clears that row's `deleted_at` and resurrects it into a SECOND live row. Both
 * are invisible afterwards — `reconcileById` collapses the duplicate on screen, and
 * `supersededRows` counts tombstones only, so a hidden live copy is never reported.
 */
async function resolveRow(spreadsheetId, person, id) {
  const data = await getValues(spreadsheetId, expensesDataRange(person))
  const rows = data.values ?? []

  let live = -1
  let any = -1
  rows.forEach((row, index) => {
    if (cellText(row, ID_INDEX) !== id) return
    // The LAST match wins on both counts, live or dead: rows are only ever appended,
    // so the newest copy is the one every read reconciles to. The fallback matters as
    // much as the live case, because `setDeletedAt` also CLEARS the cell — a restore
    // where every copy in this tab is tombstoned would otherwise revive the oldest
    // one, putting the values from before a payer move back on screen while the newest
    // row stays dead, and `reconcileById` prefers the live row so nothing reports it.
    any = index
    if (!cellText(row, DELETED_AT_INDEX)) live = index
  })

  const index = live >= 0 ? live : any
  // Reaches the screen through a toast, so it is translated rather than English.
  if (index < 0) throw i18nError('error.entryGone')
  return FIRST_DATA_ROW + index
}

/**
 * Overwrite an entry in place.
 *
 * If the payer changed the row must move tabs — the payer is which tab it lives
 * in, not a cell that can be overwritten. `previousPayer` says where the row is
 * now; `entry.payer` says where it belongs. The old row is tombstoned rather
 * than removed, and only after the new one is appended, so a failure between the
 * two leaves the entry visible under its old payer instead of silently gone.
 */
export async function updateEntry(spreadsheetId, entry, previousPayer) {
  /**
   * Checked before anything is written, not on the way to the second call.
   * `previousPayer` says which tab the row is in now; without a real one, the
   * branch below appends a copy to the new tab and then cannot find the original
   * to tombstone — so the sheet ends up with two live rows for one entry.
   */
  if (!isPerson(previousPayer)) {
    throw new TypeError(`updateEntry needs the row's current payer, got ${String(previousPayer)}`)
  }

  if (previousPayer !== entry.payer) {
    await appendEntry(spreadsheetId, entry)
    const oldRowNumber = await resolveRow(spreadsheetId, previousPayer, entry.id)
    await updateValues(spreadsheetId, cellRange(previousPayer, oldRowNumber, 'deleted_at'), [
      [entry.updatedAt],
    ])
    return
  }
  const rowNumber = await resolveRow(spreadsheetId, entry.payer, entry.id)
  await updateValues(spreadsheetId, rowRange(entry.payer, rowNumber), [entryToRow(entry)])
}

/**
 * Stamp or clear an entry's `deleted_at`. Deletes are soft so rows never change
 * position and undo is a single cell write.
 */
export async function setDeletedAt(spreadsheetId, person, id, deletedAtIso) {
  const rowNumber = await resolveRow(spreadsheetId, person, id)
  await updateValues(spreadsheetId, cellRange(person, rowNumber, 'deleted_at'), [
    [deletedAtIso ?? ''],
  ])
}

/**
 * Permanently remove every tombstoned row from both people's tabs.
 *
 * Reads each tab's own deleted_at column rather than trusting a caller-supplied
 * id list, because an id is not a unique lookup key: an edited entry can have left
 * a tombstone in one tab while the live row sits in the other.
 *
 * @param {Record<string, number>} sheetGids expensesTab(person) -> numeric sheetId
 * @returns {Promise<{removed: number}>}
 */
export async function compact(spreadsheetId, sheetGids) {
  const requests = []

  // One read per tab rather than a single batchGet, deliberately. Batching would save a
  // round trip on a rare, manual action, at the cost of re-deriving the row numbers
  // from a positional `valueRanges` reply — and this is the only hard delete in the
  // app, where being one row out removes somebody else's expense.
  for (const person of PEOPLE) {
    const sheetGid = sheetGids[expensesTab(person)]
    if (sheetGid == null) continue

    // The FULL row range, not just the deleted_at column, and that is not waste.
    // Row numbers here are derived from position (`FIRST_DATA_ROW + index`), and
    // that only holds while every data row is present in the reply. `deleted_at`
    // is empty on most rows, so a single-column read cannot be trusted to line up
    // — and being one row out here hard-deletes somebody else's expense.
    const data = await getValues(spreadsheetId, expensesDataRange(person))
    const rowNumbers = []
    ;(data.values ?? []).forEach((row, index) => {
      if (cellText(row, DELETED_AT_INDEX)) rowNumbers.push(FIRST_DATA_ROW + index)
    })
    if (rowNumbers.length === 0) continue

    // CRITICAL: delete from the bottom up within each tab. deleteDimension
    // shifts every row below it, so ascending order would make each request
    // after the first target the wrong row.
    rowNumbers.sort((a, b) => b - a)
    for (const rowNumber of rowNumbers) {
      requests.push({
        deleteDimension: {
          range: {
            sheetId: sheetGid,
            dimension: 'ROWS',
            // 0-based and half-open: sheet row N is index N-1.
            startIndex: rowNumber - 1,
            endIndex: rowNumber,
          },
        },
      })
    }
  }

  if (requests.length === 0) return { removed: 0 }

  await request(`/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: { requests },
  })

  return { removed: requests.length }
}

/**
 * Tab title -> numeric sheetId. `values.batchGet` cannot reveal a gid, and
 * `deleteDimension` takes nothing else, so this is the only way to name a tab to
 * `compact`.
 *
 * Exported because `compact` needs the gids and must NOT go through
 * `ensureStructure` to get them: that path WRITES. A ledger whose config tab has
 * been deleted reports `configMissing` and is deliberately never repaired, but
 * `ensureStructure` would add the tab back and seed it with `DEFAULT_CONFIG` —
 * putting the default currency into a sheet whose real one is unknown, and taking
 * the notice away with it. Reading is the whole of what `compact` is owed.
 */
export async function readSheetGids(spreadsheetId) {
  const data = await request(`/${encodeURIComponent(spreadsheetId)}`, {
    params: { fields: 'sheets(properties(sheetId,title))' },
  })
  const sheetIds = {}
  for (const sheet of data.sheets ?? []) {
    const { title, sheetId } = sheet.properties ?? {}
    if (title != null) sheetIds[title] = sheetId
  }
  return sheetIds
}

/**
 * Bring a blank or newly created spreadsheet up to the schema. Only this path
 * may build structure.
 *
 * Idempotent: existing tabs are left alone, a header row is only written when it
 * does not already match EXPENSE_COLUMNS, a config tab that already has values
 * is never reseeded, and expense data rows are never touched.
 *
 * @returns {Promise<{sheetIds: Record<string, number>}>} tab title -> numeric
 *   sheetId, for a caller that has just built the tabs. `compact` reads its own
 *   through `readSheetGids`, because this path writes.
 */
export async function ensureStructure(spreadsheetId) {
  const sheetIds = await readSheetGids(spreadsheetId)
  const wantedTabs = [...PEOPLE.map(expensesTab), CONFIG_TAB]
  const missing = wantedTabs.filter((title) => !(title in sheetIds))

  // Refuse to build structure in a spreadsheet that is evidently somebody's
  // existing work. The id arrives from the script's SHEET_ID property rather than
  // from a person choosing a file, so a wrong one is a configuration mistake —
  // and adding three tabs to an unrelated spreadsheet is not something undo can
  // reach. A freshly created spreadsheet has exactly one default tab, so several
  // tabs with none of ours among them is not the ledger we were pointed at.
  //
  // Translated, because this is the one failure whose message a person has to act
  // on: it names the property to fix, and it reaches an error gate.
  if (missing.length === wantedTabs.length && Object.keys(sheetIds).length > 1) {
    throw i18nError('error.notOurSheet')
  }

  if (missing.length > 0) {
    const reply = await request(`/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      body: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
    })
    // The reply already names every tab it just created, so re-reading the
    // spreadsheet for the same gids is a wasted round trip. Read defensively:
    // a gid that does not arrive stays absent, and `compact` skips a tab it
    // cannot name rather than deleting rows from a guess.
    for (const { addSheet } of reply.replies ?? []) {
      const { title, sheetId } = addSheet?.properties ?? {}
      if (title != null && sheetId != null) sheetIds[title] = sheetId
    }
  }

  const { valueRanges = [] } = await batchGetValues(spreadsheetId, [
    ...PEOPLE.map(expensesHeaderRange),
    CONFIG_RANGE,
  ])

  const data = []
  PEOPLE.forEach((person, tab) => {
    const headerRow = valueRanges[tab]?.values?.[0] ?? []
    const matches =
      headerRow.length === EXPENSE_COLUMNS.length &&
      EXPENSE_COLUMNS.every((column, index) => cellText(headerRow, index) === column)
    if (!matches) data.push({ range: expensesHeaderRange(person), values: [EXPENSE_COLUMNS] })
  })

  const configRows = valueRanges[PEOPLE.length]?.values ?? []
  const configIsEmpty = configRows.every((row) =>
    (row ?? []).every((_, index) => !cellText(row, index)),
  )
  if (configIsEmpty) {
    // A header row for the human who edits this tab; parseConfigRows ignores it.
    data.push({ range: `${CONFIG_TAB}!A1`, values: [['key', 'value'], ...defaultConfigRows()] })
  }

  if (data.length > 0) {
    await request(`/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
      method: 'POST',
      body: { valueInputOption: RAW, data },
    })
  }

  return { sheetIds }
}
