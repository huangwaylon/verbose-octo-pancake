/**
 * Google Sheets API v4 access. The layout lives in `schema.js`.
 *
 * Every write uses `valueInputOption: RAW`. Ranges go through `encodeURIComponent`, which leaves
 * '!' alone — exactly what the API wants in "expenses_p1!A2:G".
 */

import { mergeConfig } from '../config.js'
import {
  CONFIG_RANGE,
  CONFIG_TAB,
  DATA_TABS,
  FIRST_DATA_ROW,
  RECURRING,
  SHEET_TABS,
  cellText,
  entryToRow,
  hasAnyCell,
  isPerson,
  rowToEntry,
  tabOf,
  templateToRow,
} from '../schema.js'
import { reconcileById, tombstoneCount } from './ledgerState.js'
import { parseAmountToYen } from './money.js'
import { getAccessToken, refreshToken } from './connection.js'
import { reconcileTemplates } from './recurring.js'
import { defaultConfigRows, parseConfigRows } from './sheetConfig.js'
import { i18nError } from '../i18n/index.js'

const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets'
const RAW = 'RAW'

/**
 * 404 is always "not reachable"; 403 is both that and "try again", since Google returns it for a
 * revoked share AND a tripped quota — so the reason decides. Calling a rate limit a lost share
 * sends someone to re-share a sheet that is fine.
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

/** Every cell this layer reads by name, so no reader below reaches for an index of its own. */
const idCell = (tab, row) => cellText(row, tab.index('id'))
const deletedCell = (tab, row) => cellText(row, tab.index('deleted_at'))
const amountCell = (tab, row) => cellText(row, tab.index('amount'))
const dateCell = (tab, row) => cellText(row, tab.index('date'))

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
 * A 401 means the token was rejected even if it still looked unexpired, so re-acquire and retry
 * exactly once — never more, or a revoked grant loops. That retry is what makes `connection.js`'s
 * refresh margin a performance choice rather than a correctness one.
 *
 * Thrown errors carry `.status`, and an `i18nKey` so the sentence reaching the screen is
 * translated; `.message` keeps the API's own English for consoles.
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
  // A 403/404 is not a blip: the account has lost access, or the id is wrong. Reported as
  // transient it hides behind the focus refresh's 30-second floor forever.
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
 * The range is the tab's own A-anchored `dataRange`, NEVER the bare tab title: `values.append`
 * SEARCHES its range for a logical table, so a bare sheet name lets Google pick where that table
 * begins and every value can land six fields to the right. `rowToEntry` then reports it as an
 * unreadable AMOUNT, naming the wrong cell entirely.
 */
function appendRow(spreadsheetId, tab, cells) {
  return request(
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(tab.dataRange)}:append`,
    {
      method: 'POST',
      params: { valueInputOption: RAW, insertDataOption: 'INSERT_ROWS' },
      body: { values: [cells] },
    },
  )
}

/**
 * 0-based and half-open: sheet row N is index N-1. The one home of that arithmetic.
 *
 * The gid is asserted here because `JSON.stringify` DROPS an undefined `sheetId` and a `GridRange`
 * without one reads as gid 0 — so a missing gid hard-deletes whatever row sits at that index in
 * `expenses_p1`.
 */
function deleteRowRequest(sheetGid, rowNumber) {
  if (!Number.isInteger(sheetGid)) {
    throw new TypeError(`deleteRowRequest needs a numeric sheet gid, got ${String(sheetGid)}`)
  }
  return {
    deleteDimension: {
      range: {
        sheetId: sheetGid,
        dimension: 'ROWS',
        startIndex: rowNumber - 1,
        endIndex: rowNumber,
      },
    },
  }
}

/**
 * Load everything the app needs in one round trip. The counts are how the sheet reports what it
 * holds and the app cannot show; the alternative to each is a wrong number with nothing said.
 *
 * - `supersededRows` — TOMBSTONES `reconcileById` hid, and only those: the consumer is the compact
 *   button, and a hidden live duplicate would be a removal that can never happen.
 * - `undecodedRows` — live rows with an id whose amount cannot be read, so the ledger is short.
 * - `unattributedRows` — live SETTLEMENT rows whose `payer` names neither person. Its own count
 *   because the cell to go and fix is a different one.
 * - `undatedRows` — live rows whose date is not a real ISO day: they reach the balance but belong to
 *   no month. Usual cause is a hand-typed date Sheets stored as a date, read back in the
 *   spreadsheet's locale because reads are `FORMATTED_VALUE`.
 * - `configMissing` — the config tab is gone or renamed, so every default applies, each person's
 *   split included. Never repaired: seeding writes this build's defaults into a sheet whose real
 *   values are unknown, and takes the notice with them.
 * - `undecodedTemplates` — `recurring` rows `rowToTemplate` refused, or repeating an earlier id.
 *   Least urgent, because nothing on screen is wrong; the cost is a cost silently never offered.
 *
 * @returns {Promise<{entries: object[], templates: object[], config: object,
 *   sheetConfig: object, supersededRows: number, undecodedRows: number, undatedRows: number,
 *   unattributedRows: number, undecodedTemplates: number, configMissing: boolean}>}
 *   `sheetConfig` is the sheet's own PARTIAL config, pre-merge, which the snapshot has to store.
 */
export async function loadAll(spreadsheetId) {
  // Built from `SHEET_TABS`, whose data tabs come first, so the mapping back below derives from
  // the same list.
  const ranges = [...SHEET_TABS.map((tab) => tab.dataRange), CONFIG_RANGE]
  let valueRanges
  let configMissing = false

  try {
    const data = await batchGetValues(spreadsheetId, ranges)
    valueRanges = data.valueRanges ?? []
  } catch (error) {
    // A missing config tab makes the API reject the whole batch, so retry without it and let
    // `parseConfigRows([])` default. Sliced from the END: a data range added later must not
    // silently drop out of the retry.
    if (error.status !== 400 && error.status !== 404) throw error
    const data = await batchGetValues(spreadsheetId, ranges.slice(0, -1))
    valueRanges = data.valueRanges ?? []
    configMissing = true
  }

  // Derived rather than a literal index: a data range added later would have the config parser
  // reading ledger rows, where no key matches and every value silently defaults.
  const sheetConfig = parseConfigRows(valueRanges[ranges.length - 1]?.values ?? [])
  const config = mergeConfig(sheetConfig)

  let undecodedRows = 0
  let undatedRows = 0
  let unattributedRows = 0
  // Positionally coupled to `ranges`, hence the one `DATA_TABS` list: a row mapped to the wrong
  // tab is decoded with the wrong type and the wrong payer.
  const decoded = DATA_TABS.flatMap((tab, index) =>
    (valueRanges[index]?.values ?? []).flatMap((row) => {
      // A tombstoned row is absent from every total by design, and a row with no id is blank.
      const counts = idCell(tab, row) && !deletedCell(tab, row)
      const entry = rowToEntry(row, tab)
      if (!entry) {
        // The notices name the cell rather than the row, and an unreadable payer is a different
        // problem from an unreadable amount.
        if (counts) {
          const amountReads = parseAmountToYen(amountCell(tab, row)) != null
          if (tab.has('payer') && amountReads) unattributedRows += 1
          else undecodedRows += 1
        }
        return []
      }
      // The cell held something; `rowToEntry` could not make a real day of it.
      if (counts && !entry.date && dateCell(tab, row)) undatedRows += 1
      return [entry]
    }),
  )

  const entries = reconcileById(decoded)

  // Immediately after the data ranges in `SHEET_TABS`; derived, for the config one's reason.
  const { templates, undecoded: undecodedTemplates } = reconcileTemplates(
    valueRanges[DATA_TABS.length]?.values ?? [],
  )

  return {
    entries,
    templates,
    config,
    sheetConfig,
    supersededRows: tombstoneCount(decoded) - tombstoneCount(entries),
    undecodedRows,
    undatedRows,
    unattributedRows,
    undecodedTemplates,
    configMissing,
  }
}

export async function appendEntry(spreadsheetId, entry) {
  const tab = tabOf(entry)
  await appendRow(spreadsheetId, tab, entryToRow(entry, tab))
}

/**
 * An entry's current row, re-read immediately before every write: an edit in the Sheets UI shifts
 * every row below it, and a stale row number silently overwrites a different expense.
 *
 * Reads the FULL row range rather than the id column alone, because an id is not unique within a
 * tab — `updateEntry` leaves a same-id tombstone behind on every payer move.
 */
async function resolveRow(spreadsheetId, tab, id) {
  const data = await getValues(spreadsheetId, tab.dataRange)
  const rows = data.values ?? []

  let live = -1
  let any = -1
  rows.forEach((row, index) => {
    if (idCell(tab, row) !== id) return
    // The LAST match wins, live or dead: rows are only appended, so the newest copy is the one
    // every read reconciles to. The dead fallback matters as much — `setDeletedAt` also CLEARS the
    // cell, and reviving the oldest tombstone puts pre-payer-move values back on screen.
    any = index
    if (!deletedCell(tab, row)) live = index
  })

  const index = live >= 0 ? live : any
  if (index < 0) throw i18nError('error.entryGone')
  return FIRST_DATA_ROW + index
}

/**
 * Overwrite an entry in place, moving it between tabs if it now belongs in a different one.
 *
 * Both tabs come from `tabOf`, so "where is this row" and "where does it belong" cannot drift —
 * which also settles the settlement case without a branch, since only an EXPENSE's payer moves a
 * row.
 *
 * On a move the old row is tombstoned rather than removed, and only AFTER the new one is appended,
 * so a failure between the two leaves the entry visible under its old payer. The stamp comes from
 * the clock and must be a real one: `reconcileById` breaks a tombstone tie on exactly this cell.
 */
export async function updateEntry(spreadsheetId, entry, previousPayer) {
  // `previousPayer` says which tab the row is in now. Without a real one the branch below appends
  // a copy and then cannot find the original to tombstone — two live rows.
  if (!isPerson(previousPayer)) {
    throw new TypeError(`updateEntry needs the row's current payer, got ${String(previousPayer)}`)
  }

  const tab = tabOf(entry)
  const previousTab = tabOf({ ...entry, payer: previousPayer })

  if (previousTab !== tab) {
    await appendEntry(spreadsheetId, entry)
    const oldRowNumber = await resolveRow(spreadsheetId, previousTab, entry.id)
    await updateValues(spreadsheetId, previousTab.cellRange(oldRowNumber, 'deleted_at'), [
      [new Date().toISOString()],
    ])
    return
  }
  const rowNumber = await resolveRow(spreadsheetId, tab, entry.id)
  await updateValues(spreadsheetId, tab.rowRange(rowNumber), [entryToRow(entry, tab)])
}

/**
 * Stamp or clear an entry's `deleted_at`. Deletes are soft, so rows never change position and undo
 * is a single cell write.
 *
 * Takes the TAB rather than a payer, which does not name one: a settlement lives in the
 * settlements tab whoever paid it. The caller passes `tabOf(previous)` from local state.
 */
export async function setDeletedAt(spreadsheetId, tab, id, deletedAtIso) {
  const rowNumber = await resolveRow(spreadsheetId, tab, id)
  await updateValues(spreadsheetId, tab.cellRange(rowNumber, 'deleted_at'), [[deletedAtIso ?? '']])
}

/**
 * The row a template's id sits on, or null. REFUSES a duplicate rather than picking one, unlike
 * `resolveRow`: nothing here leaves a same-id row behind, so a duplicate is a sheet-side mistake
 * only the sheet can put right.
 */
async function findTemplateRow(spreadsheetId, id) {
  const data = await getValues(spreadsheetId, RECURRING.dataRange)
  const rows = data.values ?? []

  const matches = []
  rows.forEach((row, index) => {
    if (idCell(RECURRING, row) === id) matches.push(FIRST_DATA_ROW + index)
  })

  if (matches.length > 1) throw i18nError('error.duplicateTemplate')
  return matches[0] ?? null
}

/**
 * Append when the tab has no row for this id, overwrite when it does; retiring is the same call
 * with `active_to` set. ONE function is what makes a retried add idempotent — the id is minted
 * when the form opens, and a dedicated append would leave two rows. The WHOLE row either way.
 */
export async function saveTemplate(spreadsheetId, template) {
  const rowNumber = await findTemplateRow(spreadsheetId, template.id)
  const cells = templateToRow(template)
  if (rowNumber == null) await appendRow(spreadsheetId, RECURRING, cells)
  else await updateValues(spreadsheetId, RECURRING.rowRange(rowNumber), [cells])
}

/**
 * The second hard delete, and not the safe path — `retiredTemplate` is, and what this costs
 * instead is stated in the caller's confirmation. The row number comes from a read immediately
 * beforehand, because `deleteDimension` shifts every row below it.
 */
export async function deleteTemplate(spreadsheetId, sheetGid, id) {
  const rowNumber = await findTemplateRow(spreadsheetId, id)
  // Already gone, from the other phone or the Sheets UI: the outcome asked for is the outcome they
  // have, so there is nothing worth interrupting them over.
  if (rowNumber == null) return

  await request(`/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: { requests: [deleteRowRequest(sheetGid, rowNumber)] },
  })
}

/**
 * Permanently remove every tombstoned row from every data tab.
 *
 * Reads each tab's own rows rather than a caller-supplied id list, because an edited entry can
 * have left a tombstone in one tab while the live row sits in the other. Iterates `DATA_TABS`, so
 * the settlements tab is covered by construction: stranded tombstones there would keep
 * `tombstoneCount` offering a compact that removes 0 rows.
 *
 * @param {Record<string, number>} sheetGids tab title -> numeric sheetId
 * @returns {Promise<{removed: number}>}
 */
export async function compact(spreadsheetId, sheetGids) {
  const requests = []

  // One read per tab rather than a batchGet: that would save a round trip on a rare manual action
  // at the cost of re-deriving row numbers from a positional reply, and being one row out here
  // removes somebody else's expense.
  for (const tab of DATA_TABS) {
    const sheetGid = sheetGids[tab.title]
    if (sheetGid == null) continue

    // The FULL row range: row numbers are derived from position, which only holds while every data
    // row is present in the reply.
    const data = await getValues(spreadsheetId, tab.dataRange)
    const rowNumbers = []
    ;(data.values ?? []).forEach((row, index) => {
      if (deletedCell(tab, row)) rowNumbers.push(FIRST_DATA_ROW + index)
    })
    if (rowNumbers.length === 0) continue

    // Bottom up within each tab. `deleteDimension` shifts every row below it, so ascending order
    // makes each request after the first target the wrong row.
    rowNumbers.sort((a, b) => b - a)
    for (const rowNumber of rowNumbers) requests.push(deleteRowRequest(sheetGid, rowNumber))
  }

  if (requests.length === 0) return { removed: 0 }

  await request(`/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: { requests },
  })

  return { removed: requests.length }
}

/**
 * Tab title -> numeric sheetId. `values.batchGet` cannot reveal a gid and `deleteDimension` takes
 * nothing else, so this is the only way to name a tab to `compact` — and it must not get them
 * through `ensureStructure`, which WRITES: on a ledger whose config tab was deleted that re-seeds
 * this build's defaults and takes the `configMissing` notice with them.
 */
export async function readSheetGids(spreadsheetId) {
  const data = await request(`/${encodeURIComponent(spreadsheetId)}`, {
    params: { fields: 'sheets(properties(sheetId,title))' },
  })
  const sheetGids = {}
  for (const sheet of data.sheets ?? []) {
    const { title, sheetId } = sheet.properties ?? {}
    if (title != null) sheetGids[title] = sheetId
  }
  return sheetGids
}

/**
 * Bring a blank or newly created spreadsheet up to the schema. Only this path may build structure.
 *
 * Idempotent: existing tabs are left alone, a header row is written only when it does not match
 * its OWN tab's column list, a config tab holding values is never reseeded, and data rows are
 * untouched.
 *
 * @returns {Promise<{sheetGids: Record<string, number>}>} tab title -> numeric sheetId, for a caller
 *   that has just built the tabs. `compact` reads its own through `readSheetGids`.
 */
export async function ensureStructure(spreadsheetId) {
  const sheetGids = await readSheetGids(spreadsheetId)
  const wantedTabs = [...SHEET_TABS.map((tab) => tab.title), CONFIG_TAB]
  const missing = wantedTabs.filter((title) => !(title in sheetGids))

  // Refuse to build structure in a spreadsheet that is evidently somebody's existing work: the id
  // comes from the script's SHEET_ID property, so a wrong one is a configuration mistake, and five
  // tabs added to an unrelated spreadsheet is not something undo can reach. A freshly created one
  // has exactly one default tab.
  //
  // The test is "none of ours", not "any missing": a ledger predating the settlements or recurring
  // tab must have it BUILT. Translated, because this is the one failure a person has to act on.
  if (missing.length === wantedTabs.length && Object.keys(sheetGids).length > 1) {
    throw i18nError('error.notOurSheet')
  }

  if (missing.length > 0) {
    const reply = await request(`/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      body: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
    })
    // The reply already names every tab it created, so re-reading is a wasted round trip. A gid
    // that does not arrive stays absent, and `compact` skips a tab it cannot name.
    for (const { addSheet } of reply.replies ?? []) {
      const { title, sheetId } = addSheet?.properties ?? {}
      if (title != null && sheetId != null) sheetGids[title] = sheetId
    }
  }

  const { valueRanges = [] } = await batchGetValues(spreadsheetId, [
    ...SHEET_TABS.map((tab) => tab.headerRange),
    CONFIG_RANGE,
  ])

  const data = []
  SHEET_TABS.forEach((tab, index) => {
    const headerRow = valueRanges[index]?.values?.[0] ?? []
    // THIS tab's own list: the layouts differ, so one shared expectation would find the
    // settlements header wrong every time and rewrite it with the expenses columns.
    const matches =
      headerRow.length === tab.columns.length &&
      tab.columns.every((column, at) => cellText(headerRow, at) === column)
    if (!matches) data.push({ range: tab.headerRange, values: [tab.columns] })
  })

  const configRows = valueRanges[SHEET_TABS.length]?.values ?? []
  const configIsEmpty = !configRows.some(hasAnyCell)
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

  return { sheetGids }
}
