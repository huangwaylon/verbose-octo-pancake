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
  isPerson,
  rowRange,
  rowToEntry,
} from '../schema.js'
import { normalizeCurrency, parseShare } from './money.js'
import { reconcileById } from './ledgerState.js'
import { getAccessToken, refreshToken } from './connection.js'
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

/** One column of one person's tab, e.g. "expenses_p1!K2:K". */
function columnRange(person, field) {
  const letter = columnLetter(field)
  return `${expensesTab(person)}!${letter}${FIRST_DATA_ROW}:${letter}`
}

/**
 * Sheet key <-> config field, plus how to read the value. One list so the two
 * directions cannot drift. `list`, `fraction` and `code` values are not plain
 * strings, so they need explicit parsers; everything else is text.
 *
 * There are deliberately no email keys. The access token belongs to the account
 * that owns the sheet rather than to either person, so nothing can produce an
 * address to match against — which of the two people this is is a per-device
 * choice, like the locale and the accent.
 */
const CONFIG_FIELDS = [
  ['person1_name', 'person1Name', 'text'],
  ['person2_name', 'person2Name', 'text'],
  ['currency', 'currency', 'code'],
  ['categories', 'categories', 'list'],
  ['default_split_p1', 'defaultSplitP1', 'fraction'],
  ['default_split_p2', 'defaultSplitP2', 'fraction'],
  ['note_presets', 'notePresets', 'list'],
]

/** Each kind answers null for a value it cannot use, so the default wins. */
const PARSERS = {
  text: (value) => value,
  code: (value) => normalizeCurrency(value) || null,
  fraction: parseShare,
  list: (value) => {
    const list = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    // An empty list must never shadow a default, or the category picker is empty.
    return list.length ? list : null
  },
}

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
  // id is wrong. Reporting it as transient hides it behind a 30-second retry loop
  // and a "showing saved data" notice, forever.
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
 * Config tab rows -> a partial config object. Exported for testing: it is pure,
 * and the percentage-vs-fraction rule needs cases pinned to it.
 *
 * A key that is absent, or present with a blank or unparseable value, is omitted
 * so the caller's defaults win. The FIRST usable value for a key wins: a tab where
 * someone added `currency, USD` at the top and forgot an old `currency, JPY` lower
 * down would otherwise run the whole sheet at JPY, which is a 100x error on every
 * row with a blank currency cell.
 */
export function parseConfigRows(rows) {
  const byKey = new Map(CONFIG_FIELDS.map(([key, field, kind]) => [key, { field, kind }]))
  const parsed = {}

  for (const row of rows) {
    const key = cellText(row, 0).toLowerCase()
    const value = cellText(row, 1)
    const spec = byKey.get(key)
    if (!spec || !value || spec.field in parsed) continue

    const result = PARSERS[spec.kind](value)
    if (result != null) parsed[spec.field] = result
  }

  return parsed
}

/**
 * What a freshly seeded `config` tab says the two people are called, and the only
 * place these strings exist. They are NOT in `DEFAULT_CONFIG`: a default there
 * would shadow the localized fallback `nameOf` applies when the sheet says
 * nothing, and everything written to the sheet stays unlocalized regardless of
 * whose device seeded it.
 */
const SEED_NAMES = { person1Name: 'Person 1', person2Name: 'Person 2' }

function defaultConfigRows() {
  return CONFIG_FIELDS.map(([key, field]) => {
    const value = SEED_NAMES[field] ?? DEFAULT_CONFIG[field]
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
 * @returns {Promise<{entries: object[], config: object, sheetConfig: object,
 *   supersededRows: number, undecodedRows: number, undatedRows: number,
 *   configMissing: boolean}>}
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
  const tombstones = (list) => list.filter((entry) => entry.deletedAt).length
  return {
    entries,
    config,
    sheetConfig,
    supersededRows: tombstones(decoded) - tombstones(entries),
    undecodedRows,
    undatedRows,
    configMissing,
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
 * Locate an entry's current row within one person's tab by re-reading its id
 * column. Row numbers cannot be cached: inserting or deleting rows in the Sheets
 * UI shifts every row below the edit, and writing to a stale row silently
 * overwrites a different expense.
 */
async function resolveRow(spreadsheetId, person, id) {
  const data = await getValues(spreadsheetId, columnRange(person, 'id'))
  const index = (data.values ?? []).findIndex((row) => cellText(row, 0) === id)
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

async function readSheetIds(spreadsheetId) {
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
  //
  // Translated, because this is the one failure whose message a person has to act
  // on: it names the property to fix, and it reaches an error gate.
  if (missing.length === wantedTabs.length && Object.keys(sheetIds).length > 1) {
    throw i18nError('error.notOurSheet')
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
