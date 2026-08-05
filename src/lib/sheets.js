/**
 * Google Sheets API v4 access.
 *
 * The sheet layout lives in schema.js; this module only knows how to talk to
 * the API. Every write uses valueInputOption RAW so that a description like
 * "=SUM(A:A)" is stored as literal text and dates are never re-formatted.
 */

import { DEFAULT_CONFIG } from '../config.js'
import {
  CONFIG_RANGE,
  CONFIG_TAB,
  EXPENSE_COLUMNS,
  FIRST_DATA_ROW,
  PERSON,
  cellRange,
  columnLetter,
  entryToRow,
  expensesDataRange,
  expensesHeaderRange,
  expensesTab,
  rowRange,
  rowToEntry,
} from '../schema.js'
import { getAccessToken, signIn } from './googleAuth.js'

const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets'
const RAW = 'RAW'

const ID_COLUMN = columnLetter('id')
const DELETED_AT_INDEX = EXPENSE_COLUMNS.indexOf('deleted_at')

function idColumnRange(person) {
  return `${expensesTab(person)}!${ID_COLUMN}${FIRST_DATA_ROW}:${ID_COLUMN}`
}

/**
 * Sheet key <-> config field, plus how to read the value. One list so the two
 * directions cannot drift.
 *
 * `list` and `fraction` values are not plain strings, so they need explicit
 * parsers; everything else is text.
 */
const CONFIG_FIELDS = [
  ['person1_name', 'person1Name', 'text'],
  ['person2_name', 'person2Name', 'text'],
  ['person1_email', 'person1Email', 'text'],
  ['person2_email', 'person2Email', 'text'],
  ['currency', 'currency', 'text'],
  ['categories', 'categories', 'list'],
  ['default_split_p1', 'defaultSplitP1', 'fraction'],
  ['default_split_p2', 'defaultSplitP2', 'fraction'],
  ['note_presets', 'notePresets', 'list'],
]

/**
 * The universal split key that `default_split_p1`/`_p2` replaced. Still read, so
 * a sheet created before the change keeps working untouched; never written.
 */
const LEGACY_SPLIT_KEY = 'default_split'

function parseList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * A share written either as a percentage ("50") or a fraction ("0.5").
 *
 * Anything above 1 is read as a percentage, because a spreadsheet is a place
 * where people naturally write 50 rather than 0.5, and nobody means "1%" when
 * they type 1. Returns null for junk so the caller falls back to the default
 * rather than putting NaN into the split control.
 */
function parseFraction(value) {
  const raw = Number.parseFloat(value)
  if (!Number.isFinite(raw) || raw < 0) return null
  const fraction = raw > 1 ? raw / 100 : raw
  return Math.min(1, Math.max(0, fraction))
}

/** Filled by ensureStructure / readSheetIds so loadAll can hand them back. */
const sheetIdCache = new Map()

/**
 * `encodeURIComponent` leaves '!' untouched, which is exactly what the API
 * wants in "expenses!A2:L", while still escaping anything else.
 */
function encodePath(segment) {
  return encodeURIComponent(segment)
}

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
 * A 401 means the in-memory token was rejected (revoked, or the session moved
 * on) even if it still looked unexpired, so we force one fresh silent grant and
 * retry exactly once. Never more — a revoked grant would otherwise loop.
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
    await signIn({ silent: true })
    return request(path, { method, params, body, allowRetry: false })
  }

  const payload = await response.json().catch(() => null)
  const message = payload?.error?.message ?? response.statusText ?? 'Request failed'
  const error = new Error(`Google Sheets: ${message} (HTTP ${response.status})`)
  error.status = response.status
  throw error
}

function batchGetValues(spreadsheetId, ranges) {
  return request(`/${encodePath(spreadsheetId)}/values:batchGet`, {
    params: { ranges, majorDimension: 'ROWS' },
  })
}

function updateValues(spreadsheetId, range, values) {
  return request(`/${encodePath(spreadsheetId)}/values/${encodePath(range)}`, {
    method: 'PUT',
    params: { valueInputOption: RAW },
    body: { values },
  })
}

function text(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function cellText(row, index) {
  return text(row?.[index])
}

/**
 * Config tab rows -> a partial config object. Exported for testing: it is pure,
 * and the percentage-vs-fraction rule for the split keys is exactly the kind of
 * thing that needs cases pinned to it.
 *
 * A key that is absent, or present with a blank value, is simply omitted so the
 * caller's defaults win.
 */
export function parseConfigRows(rows) {
  const byKey = new Map(CONFIG_FIELDS.map(([key, field, kind]) => [key, { field, kind }]))
  const parsed = {}
  // The pre-split-per-person key. Read after the loop so an explicit
  // default_split_p1/p2 always wins over it.
  let legacySplit = null

  for (const row of rows) {
    const key = cellText(row, 0).toLowerCase()
    const value = cellText(row, 1)

    // Sheets seeded before the split became per-person carry one universal
    // `default_split`. It meant "the payer's share", so it maps to the same
    // number for both people — which is exactly what it already did.
    if (key === LEGACY_SPLIT_KEY) {
      if (value) legacySplit = parseFraction(value)
      continue
    }

    const spec = byKey.get(key)
    if (!spec) continue
    if (!value) continue

    if (spec.kind === 'list') {
      const list = parseList(value)
      // An empty list must not shadow the default; a blank cell means "unset".
      if (list.length) parsed[spec.field] = list
    } else if (spec.kind === 'fraction') {
      const fraction = parseFraction(value)
      if (fraction != null) parsed[spec.field] = fraction
    } else {
      parsed[spec.field] = value
    }
  }

  if (legacySplit != null) {
    parsed.defaultSplitP1 ??= legacySplit
    parsed.defaultSplitP2 ??= legacySplit
  }

  return parsed
}

function configToRows() {
  return CONFIG_FIELDS.map(([key, field]) => {
    const value = DEFAULT_CONFIG[field]
    return [key, Array.isArray(value) ? value.join(', ') : String(value ?? '')]
  })
}

/**
 * Load everything the app needs in one round trip.
 *
 * `sheetIds` is whatever ensureStructure already discovered for this
 * spreadsheet (tab title -> numeric sheetId), or `{}` if it has not run yet —
 * fetching it here would cost a second request.
 *
 * @returns {Promise<{entries: object[], config: object, sheetIds: Record<string, number>}>}
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

  const entries = [
    ...(valueRanges[0]?.values ?? []).map((row, index) => rowToEntry(row, index, PERSON.P1)),
    ...(valueRanges[1]?.values ?? []).map((row, index) => rowToEntry(row, index, PERSON.P2)),
  ].filter(Boolean)
  const configRows = hasConfigRange ? (valueRanges[2]?.values ?? []) : []

  const config = {
    ...DEFAULT_CONFIG,
    // Cloned so a caller mutating the arrays cannot corrupt the shared defaults.
    categories: [...DEFAULT_CONFIG.categories],
    notePresets: [...DEFAULT_CONFIG.notePresets],
    ...parseConfigRows(configRows),
  }

  return { entries, config, sheetIds: sheetIdCache.get(spreadsheetId) ?? {} }
}

/** @returns {Promise<{rowNumber: number|null}>} rowNumber of the appended row */
export async function appendEntry(spreadsheetId, entry) {
  const data = await request(
    `/${encodePath(spreadsheetId)}/values/${encodePath(expensesTab(entry.payer))}:append`,
    {
      method: 'POST',
      params: { valueInputOption: RAW, insertDataOption: 'INSERT_ROWS' },
      body: { values: [entryToRow(entry)] },
    },
  )

  const match = /![A-Z]+(\d+)/.exec(data.updates?.updatedRange ?? '')
  return { rowNumber: match ? Number(match[1]) : null }
}

async function readIdColumn(spreadsheetId, person) {
  const data = await request(`/${encodePath(spreadsheetId)}/values/${encodePath(idColumnRange(person))}`, {
    params: { majorDimension: 'ROWS' },
  })
  return data.values ?? []
}

/**
 * Locate an entry's current row within one person's tab by re-reading its id
 * column. Row numbers cannot be cached: editing the sheet directly in the
 * Sheets UI (inserting or deleting rows) shifts every row below the edit.
 *
 * @returns {Promise<number|null>} null when the id is no longer in that tab
 */
export async function findRowNumber(spreadsheetId, person, id) {
  const rows = await readIdColumn(spreadsheetId, person)
  const index = rows.findIndex((row) => cellText(row, 0) === id)
  return index < 0 ? null : FIRST_DATA_ROW + index
}

async function resolveRow(spreadsheetId, person, id) {
  const rowNumber = await findRowNumber(spreadsheetId, person, id)
  if (rowNumber == null) {
    throw new Error(`That entry is no longer in the sheet (id ${id}). Reload to see the latest data.`)
  }
  return rowNumber
}

/**
 * Overwrite an entry in place.
 *
 * The row number is re-resolved from a fresh read of the id column first,
 * because any row number held by the UI may be stale — someone editing the
 * sheet directly moves rows around, and writing to a stale row would silently
 * overwrite a different expense.
 *
 * If the payer changed, the row must move tabs — the payer is which tab it
 * lives in, not a cell that can just be overwritten. `previousPayer` says
 * where to find the existing row; `entry.payer` says where it belongs now.
 * The old row is tombstoned rather than removed outright, consistent with
 * every other delete in this app, and only after the new one is appended
 * successfully — so a failure between the two steps leaves the entry still
 * visible under its old payer instead of silently gone.
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

/** Tombstone an entry by stamping deleted_at; the row itself stays put. */
export async function softDeleteEntry(spreadsheetId, person, id, deletedAtIso = new Date().toISOString()) {
  const rowNumber = await resolveRow(spreadsheetId, person, id)
  await updateValues(spreadsheetId, cellRange(person, rowNumber, 'deleted_at'), [[deletedAtIso]])
}

/** Undo a soft delete by blanking the same cell. */
export async function restoreEntry(spreadsheetId, person, id) {
  const rowNumber = await resolveRow(spreadsheetId, person, id)
  await updateValues(spreadsheetId, cellRange(person, rowNumber, 'deleted_at'), [['']])
}

/**
 * Permanently remove every tombstoned row from both people's tabs.
 *
 * Reads each tab's own deleted_at column directly rather than trusting a
 * caller-supplied id list, because an id is no longer a unique lookup key on
 * its own once an edited entry can have left a tombstone behind in one tab
 * while the live row sits in the other.
 *
 * @param {Record<string, number>} sheetGids expensesTab(person) -> numeric sheetId
 * @returns {Promise<{removed: number}>}
 */
export async function compact(spreadsheetId, sheetGids) {
  const requests = []

  for (const person of [PERSON.P1, PERSON.P2]) {
    const sheetGid = sheetGids[expensesTab(person)]
    if (sheetGid == null) continue

    const data = await request(
      `/${encodePath(spreadsheetId)}/values/${encodePath(expensesDataRange(person))}`,
      { params: { majorDimension: 'ROWS' } },
    )
    const rows = data.values ?? []
    const rowNumbers = []
    rows.forEach((row, index) => {
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

  await request(`/${encodePath(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: { requests },
  })

  return { removed: requests.length }
}

async function readSheetIds(spreadsheetId) {
  const data = await request(`/${encodePath(spreadsheetId)}`, {
    params: { fields: 'sheets(properties(sheetId,title))' },
  })
  const sheetIds = {}
  for (const sheet of data.sheets ?? []) {
    const { title, sheetId } = sheet.properties ?? {}
    if (title != null) sheetIds[title] = sheetId
  }
  sheetIdCache.set(spreadsheetId, sheetIds)
  return sheetIds
}

/**
 * Report which of the app's tabs a spreadsheet already has, WITHOUT writing
 * anything.
 *
 * This is the guard in front of `ensureStructure`. Picking a file in the Google
 * Picker is one tap and the list is every spreadsheet you own, so picking the
 * wrong one is easy — and `ensureStructure` would then add tabs to somebody's
 * unrelated spreadsheet. Callers on the picker path must check this first and
 * refuse rather than adopt a file that was never a ledger.
 *
 * @returns {Promise<{sheetIds: Record<string, number>, hasExpenses: boolean,
 *   hasConfig: boolean, isLedger: boolean}>}
 */
export async function readStructure(spreadsheetId) {
  const sheetIds = await readSheetIds(spreadsheetId)
  const hasExpenses = expensesTab(PERSON.P1) in sheetIds && expensesTab(PERSON.P2) in sheetIds
  const hasConfig = CONFIG_TAB in sheetIds
  return { sheetIds, hasExpenses, hasConfig, isLedger: hasExpenses && hasConfig }
}

/**
 * Bring a blank or newly created spreadsheet up to the schema.
 *
 * Idempotent: existing tabs are left alone, a header row is only rewritten
 * when it does not already match EXPENSE_COLUMNS, a config tab that already has
 * any values is never reseeded, and expense data rows are never touched.
 *
 * @returns {Promise<{sheetIds: Record<string, number>, created: string[]}>}
 *   `sheetIds` maps tab title -> numeric sheetId (what compact needs);
 *   `created` lists the tabs that had to be added.
 */
export async function ensureStructure(spreadsheetId) {
  let sheetIds = await readSheetIds(spreadsheetId)
  const wantedTabs = [expensesTab(PERSON.P1), expensesTab(PERSON.P2), CONFIG_TAB]
  const created = wantedTabs.filter((title) => !(title in sheetIds))

  if (created.length > 0) {
    await request(`/${encodePath(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      body: { requests: created.map((title) => ({ addSheet: { properties: { title } } })) },
    })
    sheetIds = await readSheetIds(spreadsheetId)
  }

  const { valueRanges = [] } = await batchGetValues(spreadsheetId, [
    expensesHeaderRange(PERSON.P1),
    expensesHeaderRange(PERSON.P2),
    CONFIG_RANGE,
  ])
  const configRows = valueRanges[2]?.values ?? []

  const data = []
  for (const [person, headerRow] of [
    [PERSON.P1, valueRanges[0]?.values?.[0] ?? []],
    [PERSON.P2, valueRanges[1]?.values?.[0] ?? []],
  ]) {
    const headerMatches =
      headerRow.length === EXPENSE_COLUMNS.length &&
      EXPENSE_COLUMNS.every((column, index) => cellText(headerRow, index) === column)
    if (!headerMatches) {
      data.push({ range: expensesHeaderRange(person), values: [EXPENSE_COLUMNS] })
    }
  }

  const configIsEmpty = configRows.every((row) => (row ?? []).every((cell) => text(cell) === ''))
  if (configIsEmpty) {
    data.push({ range: `${CONFIG_TAB}!A1`, values: [['key', 'value'], ...configToRows()] })
  }

  if (data.length > 0) {
    await request(`/${encodePath(spreadsheetId)}/values:batchUpdate`, {
      method: 'POST',
      body: { valueInputOption: RAW, data },
    })
  }

  return { sheetIds, created }
}
