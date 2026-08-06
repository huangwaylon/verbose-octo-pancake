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

import { DEFAULT_CONFIG, mergeConfig } from '../config.js'
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
  columnLetter,
  entryToRow,
  expensesDataRange,
  expensesHeaderRange,
  expensesTab,
  rowRange,
  rowToEntry,
} from '../schema.js'
import { getAccessToken, refreshToken } from './connection.js'

const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets'
const RAW = 'RAW'

const ID_COLUMN = columnLetter('id')
const DELETED_AT_INDEX = columnIndex('deleted_at')

function idColumnRange(person) {
  return `${expensesTab(person)}!${ID_COLUMN}${FIRST_DATA_ROW}:${ID_COLUMN}`
}

/**
 * Sheet key <-> config field, plus how to read the value. One list so the two
 * directions cannot drift. `list` and `fraction` values are not plain strings,
 * so they need explicit parsers; everything else is text.
 *
 * There are deliberately no email keys. Identity used to be resolved by matching
 * the signed-in Google address against them, but the access token now belongs to
 * the account that owns the sheet rather than to either person, so nothing can
 * produce an address to match. Which of the two people this is has become a
 * per-device choice, like the locale and the accent.
 */
const CONFIG_FIELDS = [
  ['person1_name', 'person1Name', 'text'],
  ['person2_name', 'person2Name', 'text'],
  ['currency', 'currency', 'text'],
  ['categories', 'categories', 'list'],
  ['default_split_p1', 'defaultSplitP1', 'fraction'],
  ['default_split_p2', 'defaultSplitP2', 'fraction'],
  ['note_presets', 'notePresets', 'list'],
]

function parseList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * A share written either as a percentage ("50") or a fraction ("0.5"). Anything
 * above 1 reads as a percentage, because a spreadsheet is where people write 50
 * rather than 0.5. Returns null for junk so the caller's default wins instead of
 * NaN reaching `splitCents`.
 */
function parseFraction(value) {
  const raw = Number.parseFloat(value)
  if (!Number.isFinite(raw) || raw < 0) return null
  const fraction = raw > 1 ? raw / 100 : raw
  return Math.min(1, Math.max(0, fraction))
}

/**
 * Tab title -> numeric sheetId for the one spreadsheet this session is
 * connected to. `values.batchGet` cannot reveal gids, so `compact` depends on
 * whatever `readSheetIds` last cached.
 */
let gidCache = { spreadsheetId: null, sheetIds: {} }

function buildQuery(params) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value == null) continue
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
 * Thrown errors carry `.status` so callers can tell 401/403/404 apart.
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
  throw error
}

function batchGetValues(spreadsheetId, ranges) {
  return request(`/${encodeURIComponent(spreadsheetId)}/values:batchGet`, {
    params: { ranges, majorDimension: 'ROWS' },
  })
}

function getValues(spreadsheetId, range) {
  return request(
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    { params: { majorDimension: 'ROWS' } },
  )
}

function updateValues(spreadsheetId, range, values) {
  return request(`/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`, {
    method: 'PUT',
    params: { valueInputOption: RAW },
    body: { values },
  })
}

/**
 * Config tab rows -> a partial config object. Exported for testing: it is pure,
 * and the percentage-vs-fraction rule needs cases pinned to it.
 *
 * A key that is absent, or present with a blank or unparseable value, is omitted
 * so the caller's defaults win. An empty list must never shadow a default, or
 * the category picker ends up empty.
 */
export function parseConfigRows(rows) {
  const byKey = new Map(CONFIG_FIELDS.map(([key, field, kind]) => [key, { field, kind }]))
  const parsed = {}

  for (const row of rows) {
    const key = cellText(row, 0).toLowerCase()
    const value = cellText(row, 1)
    const spec = byKey.get(key)
    if (!spec || !value) continue

    if (spec.kind === 'list') {
      const list = parseList(value)
      if (list.length) parsed[spec.field] = list
    } else if (spec.kind === 'fraction') {
      const fraction = parseFraction(value)
      if (fraction != null) parsed[spec.field] = fraction
    } else {
      parsed[spec.field] = value
    }
  }

  return parsed
}

function defaultConfigRows() {
  return CONFIG_FIELDS.map(([key, field]) => {
    const value = DEFAULT_CONFIG[field]
    return [key, Array.isArray(value) ? value.join(', ') : String(value ?? '')]
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
 * @returns {Promise<{entries: object[], config: object, sheetConfig: object, sheetIds: Record<string, number>}>}
 */
export async function loadAll(spreadsheetId) {
  const ranges = [expensesDataRange(PERSON.P1), expensesDataRange(PERSON.P2), CONFIG_RANGE]
  let valueRanges
  let hasConfigRange = true

  try {
    const data = await batchGetValues(spreadsheetId, ranges)
    valueRanges = data.valueRanges ?? []
  } catch (error) {
    // A missing config tab makes the API reject the whole batch, so retry
    // without it and fall back to the defaults.
    if (error.status !== 400 && error.status !== 404) throw error
    const data = await batchGetValues(spreadsheetId, ranges.slice(0, 2))
    valueRanges = data.valueRanges ?? []
    hasConfigRange = false
  }

  const sheetConfig = parseConfigRows(hasConfigRange ? (valueRanges[2]?.values ?? []) : [])
  const config = mergeConfig(sheetConfig)

  const entries = PEOPLE.flatMap((person, index) =>
    // Same order as `ranges` above: p1's tab, then p2's, then the config.
    (valueRanges[index]?.values ?? [])
      .map((row, offset) => rowToEntry(row, offset, person, config.currency))
      .filter(Boolean),
  )

  const sheetIds = gidCache.spreadsheetId === spreadsheetId ? gidCache.sheetIds : {}
  return { entries, config, sheetConfig, sheetIds }
}

/** @returns {Promise<{rowNumber: number|null}>} rowNumber of the appended row */
export async function appendEntry(spreadsheetId, entry) {
  const data = await request(
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(expensesTab(entry.payer))}:append`,
    {
      method: 'POST',
      params: { valueInputOption: RAW, insertDataOption: 'INSERT_ROWS' },
      body: { values: [entryToRow(entry)] },
    },
  )

  const match = /![A-Z]+(\d+)/.exec(data.updates?.updatedRange ?? '')
  return { rowNumber: match ? Number(match[1]) : null }
}

/**
 * Locate an entry's current row within one person's tab by re-reading its id
 * column. Row numbers cannot be cached: inserting or deleting rows in the Sheets
 * UI shifts every row below the edit, and writing to a stale row silently
 * overwrites a different expense.
 */
async function resolveRow(spreadsheetId, person, id) {
  const data = await getValues(spreadsheetId, idColumnRange(person))
  const index = (data.values ?? []).findIndex((row) => cellText(row, 0) === id)
  if (index < 0) {
    throw new Error(`That entry is no longer in the sheet (id ${id}). Reload to see the latest data.`)
  }
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
 * id list, because an id is no longer a unique lookup key once an edited entry
 * can have left a tombstone in one tab while the live row sits in the other.
 *
 * @param {Record<string, number>} sheetGids expensesTab(person) -> numeric sheetId
 * @returns {Promise<{removed: number}>}
 */
export async function compact(spreadsheetId, sheetGids) {
  const requests = []

  for (const person of PEOPLE) {
    const sheetGid = sheetGids[expensesTab(person)]
    if (sheetGid == null) continue

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

async function readSheetIds(spreadsheetId) {
  const data = await request(`/${encodeURIComponent(spreadsheetId)}`, {
    params: { fields: 'sheets(properties(sheetId,title))' },
  })
  const sheetIds = {}
  for (const sheet of data.sheets ?? []) {
    const { title, sheetId } = sheet.properties ?? {}
    if (title != null) sheetIds[title] = sheetId
  }
  gidCache = { spreadsheetId, sheetIds }
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
 *   sheetId, which is what `compact` needs.
 */
export async function ensureStructure(spreadsheetId) {
  let sheetIds = await readSheetIds(spreadsheetId)
  const wantedTabs = [...PEOPLE.map(expensesTab), CONFIG_TAB]
  const missing = wantedTabs.filter((title) => !(title in sheetIds))

  // Refuse to build structure in a spreadsheet that is evidently somebody's
  // existing work. The id arrives from the script's SHEET_ID property rather than
  // from a person choosing a file, so a wrong one is a configuration mistake —
  // and adding three tabs to an unrelated spreadsheet is not something undo can
  // reach. A freshly created spreadsheet has exactly one default tab, so several
  // tabs with none of ours among them is not the ledger we were pointed at.
  if (missing.length === wantedTabs.length && Object.keys(sheetIds).length > 1) {
    throw new Error(
      `That spreadsheet already has other tabs and none of this app's, so it is ` +
        `probably not the ledger. Check the SHEET_ID script property.`,
    )
  }

  if (missing.length > 0) {
    await request(`/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      body: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
    })
    sheetIds = await readSheetIds(spreadsheetId)
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
  const configIsEmpty = configRows.every((row) => (row ?? []).every((cell) => !cellText([cell], 0)))
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
