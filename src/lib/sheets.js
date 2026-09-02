/**
 * Google Sheets API v4 access.
 *
 * The sheet layout lives in schema.js; this module only knows how to talk to the
 * API. Every write uses valueInputOption RAW so a description like "=SUM(A:A)"
 * is stored as literal text and dates are never re-formatted.
 *
 * Ranges are passed through `encodeURIComponent`, which leaves '!' alone —
 * exactly what the API wants in "expenses_p1!A2:G" — while escaping the rest.
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
  expenseTab,
  isPerson,
  rowToEntry,
  tabOf,
} from '../schema.js'
import { reconcileById, tombstoneCount } from './ledgerState.js'
import { parseAmountToYen } from './money.js'
import { getAccessToken, refreshToken } from './connection.js'
import { rowToTemplate, templateToRow } from './recurring.js'
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

/**
 * The three cells this layer reads positionally, per tab.
 *
 * Deliberately NOT module-wide constants. The two layouts put `deleted_at` at different
 * indexes, so a single shared one would have `compact` reading the settlements tab's
 * `id` column — non-empty on every row — and hard-deleting every live settlement.
 */
const idCell = (tab, row) => cellText(row, tab.index('id'))
const deletedCell = (tab, row) => cellText(row, tab.index('deleted_at'))

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
 * more — a revoked grant would loop. This retry is what makes the refresh margin in
 * `connection.js` a performance choice rather than a correctness one: minting needs no
 * user gesture, so the recovery is silent, and `refreshToken` guarantees a token newer
 * than any mint already in flight when the 401 arrived.
 *
 * Thrown errors carry `.status` so callers can tell 401/403/404 apart, and an
 * `i18nKey` so the sentence that reaches the screen is in the reader's language.
 * The `.message` stays English and keeps the API's own text, because that is what
 * ends up in a console and a bug report.
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
 * Returns the sheet's own partial config as well as the merged one, because the snapshot
 * cache has to store the partial — see `mergeConfig`.
 *
 * The four counts are how the sheet reports what it holds and the app cannot show. Each
 * exists because the alternative is a wrong number with nothing said:
 *
 * `supersededRows` — TOMBSTONES `reconcileById` hid. Only tombstones, because the
 * consumer is the compact button and `compact` removes exactly those: counting a hidden
 * live duplicate would offer a removal that can never happen.
 *
 * `undecodedRows` — live rows with an id whose amount cannot be read at all, so the
 * ledger is short by them. A tombstoned one is correctly out of the totals already.
 *
 * `unattributedRows` — live SETTLEMENT rows whose `payer` cell names neither person. Its
 * own count rather than part of `undecodedRows`, because the cell to go and fix is a
 * different one. Only the settlements tab can reach this.
 *
 * `undatedRows` — live rows whose date cell is not a real ISO day. These DO reach the
 * balance but belong to no month, so they appear in no month's list. Usual cause: a
 * hand-typed date Sheets stored as a date, which reads back in the spreadsheet's own
 * locale because reads are `FORMATTED_VALUE`. `UNFORMATTED_VALUE` would make it a serial
 * number, which is worse.
 *
 * `configMissing` — the config tab is gone or renamed, so every default applies: both
 * names, the categories, and — the one that moves money — each person's default split.
 * Reported rather than repaired: seeding a fresh tab would write this build's defaults
 * into a sheet whose real values are unknown, and take the notice away with them.
 *
 * `undecodedTemplates` — `recurring` rows somebody filled in that this cannot use: refused
 * by `rowToTemplate`, or carrying an id an earlier row already had. Nothing on screen is
 * wrong because of one, which is why it is the least urgent notice; what it costs is a
 * recurring cost silently never offered, which is the one thing that feature exists to
 * prevent.
 *
 * @returns {Promise<{entries: object[], templates: object[], config: object,
 *   sheetConfig: object, supersededRows: number, undecodedRows: number, undatedRows: number,
 *   unattributedRows: number, undecodedTemplates: number, configMissing: boolean}>}
 */
export async function loadAll(spreadsheetId) {
  // Built from `SHEET_TABS`, whose data tabs come first, so the mapping back below is
  // derived from the same list rather than from a second one that could drift.
  const ranges = [...SHEET_TABS.map((tab) => tab.dataRange), CONFIG_RANGE]
  let valueRanges
  let configMissing = false

  try {
    const data = await batchGetValues(spreadsheetId, ranges)
    valueRanges = data.valueRanges ?? []
  } catch (error) {
    // A missing config tab makes the API reject the whole batch, so retry
    // without it. The shortened reply then has no config range, and the defaults
    // win by way of `parseConfigRows([])`. Sliced from the END rather than to a
    // literal 2: a data range added later must not silently drop out of the retry.
    if (error.status !== 400 && error.status !== 404) throw error
    const data = await batchGetValues(spreadsheetId, ranges.slice(0, -1))
    valueRanges = data.valueRanges ?? []
    configMissing = true
  }

  // The last range, matching `ranges` above. Derived rather than a literal index for
  // the same reason as the slice: a data range added later would otherwise have the
  // config parser reading ledger rows, where no key matches and every config value
  // silently falls back to its default.
  const sheetConfig = parseConfigRows(valueRanges[ranges.length - 1]?.values ?? [])
  const config = mergeConfig(sheetConfig)

  let undecodedRows = 0
  let undatedRows = 0
  let unattributedRows = 0
  // Positionally coupled to `ranges` above, which is why both are built from the one
  // `DATA_TABS` list rather than two literals that could drift: a row mapped to the
  // wrong tab is decoded with the wrong type and the wrong payer.
  const decoded = DATA_TABS.flatMap((tab, index) =>
    (valueRanges[index]?.values ?? []).flatMap((row) => {
      // A tombstoned row is meant to be absent from every total, so no count
      // applies to it; a row with no id is a blank one and says nothing either.
      const counts = idCell(tab, row) && !deletedCell(tab, row)
      const entry = rowToEntry(row, tab)
      if (!entry) {
        // Which cell to go and fix. A settlement whose amount reads fine but whose
        // payer does not is a different problem from an unreadable amount, and the
        // notices name the cell rather than just the row.
        if (counts) {
          const amountReads = parseAmountToYen(cellText(row, tab.index('amount'))) != null
          if (tab.has('payer') && amountReads) unattributedRows += 1
          else undecodedRows += 1
        }
        return []
      }
      // The cell held something; `rowToEntry` could not make a real day of it.
      if (counts && !entry.date && cellText(row, tab.index('date'))) undatedRows += 1
      return [entry]
    }),
  )

  const entries = reconcileById(decoded)

  // The recurring range sits immediately after the data ones in `SHEET_TABS`, so this
  // index is derived rather than a literal for the same reason the config one is.
  let undecodedTemplates = 0
  const templates = []
  const templateIds = new Set()
  for (const row of valueRanges[DATA_TABS.length]?.values ?? []) {
    const template = rowToTemplate(row)
    // The FIRST row per id wins, exactly as `parseConfigRows` takes the first usable value
    // for a config key — the same hand-authored-tab problem. A duplicate is reachable by
    // copying the rent row to add parking and forgetting to change `id`, and by retrying an
    // append whose response was lost. Kept unreconciled it would render two identical rows
    // under one React key, and `recurringRows` would emit two drafts nothing could tell
    // apart. Counted rather than dropped silently, and `saveTemplate` refuses to write to a
    // duplicate at all, so the row on screen is always the row an edit lands on.
    if (template && !templateIds.has(template.id)) {
      templateIds.add(template.id)
      templates.push(template)
    }
    // Anything somebody filled in that this cannot use. A wholly blank row says nothing —
    // the range runs to the bottom of the tab, so most of them are blank.
    else if ((row ?? []).some((_, index) => cellText(row, index))) undecodedTemplates += 1
  }

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
  await request(
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(tab.title)}:append`,
    {
      method: 'POST',
      params: { valueInputOption: RAW, insertDataOption: 'INSERT_ROWS' },
      body: { values: [entryToRow(entry, tab)] },
    },
  )
}

/**
 * Locate an entry's current row within one tab.
 *
 * Row numbers cannot be cached: inserting or deleting rows in the Sheets UI shifts every
 * row below the edit, and writing to a stale row silently overwrites a different
 * expense — so this re-reads immediately before every write.
 *
 * It reads the FULL row range rather than the id column alone, because **an id is not
 * unique within a tab**. `updateEntry` leaves a same-id tombstone behind whenever the
 * payer moves, so an entry whose payer has moved away and back has the id in this tab
 * twice — once dead, once live. Taking the first match then writes to the dead row: a
 * delete stamps a row that is already tombstoned, so the live one survives and the
 * expense returns on the next refresh; a plain edit clears that row's `deleted_at` and
 * resurrects it into a SECOND live row. Both are invisible afterwards.
 */
async function resolveRow(spreadsheetId, tab, id) {
  const data = await getValues(spreadsheetId, tab.dataRange)
  const rows = data.values ?? []

  let live = -1
  let any = -1
  rows.forEach((row, index) => {
    if (idCell(tab, row) !== id) return
    // The LAST match wins on both counts, live or dead: rows are only ever appended, so
    // the newest copy is the one every read reconciles to. The dead fallback matters as
    // much, because `setDeletedAt` also CLEARS the cell — a restore where every copy in
    // this tab is tombstoned would otherwise revive the oldest one, putting
    // pre-payer-move values back on screen while the newest row stays dead.
    any = index
    if (!deletedCell(tab, row)) live = index
  })

  const index = live >= 0 ? live : any
  // Reaches the screen through a toast, so it is translated rather than English.
  if (index < 0) throw i18nError('error.entryGone')
  return FIRST_DATA_ROW + index
}

/**
 * Overwrite an entry in place, moving it between tabs if it now belongs in a different
 * one.
 *
 * Both tabs come from `tabOf`, so "where is this row" and "where does it belong" are
 * answered by the same function — the only way they cannot drift. That also settles the
 * settlement case without a branch: a settlement's payer is a CELL in the one settlements
 * tab, so changing it leaves `tabOf` answering the same tab and the row is simply
 * overwritten. Only an EXPENSE's payer moves a row.
 *
 * On a move the old row is tombstoned rather than removed, and only after the new one is
 * appended, so a failure between the two leaves the entry visible under its old payer
 * instead of silently gone.
 *
 * The tombstone stamp is read from the clock here rather than taken from the entry: an
 * entry carries no timestamp of its own, and it has to be a real stamp rather than any
 * non-empty marker, because `reconcileById` breaks a tombstone-vs-tombstone tie by
 * comparing exactly this cell.
 */
export async function updateEntry(spreadsheetId, entry, previousPayer) {
  // Checked before anything is written. `previousPayer` says which tab the row is in
  // now; without a real one, the branch below appends a copy to the new tab and then
  // cannot find the original to tombstone — so the sheet ends up with two live rows.
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
 * Stamp or clear an entry's `deleted_at`. Deletes are soft so rows never change
 * position and undo is a single cell write.
 *
 * Takes the TAB rather than a payer, because the payer alone does not name one: a
 * settlement lives in the settlements tab whoever paid it. The caller passes
 * `tabOf(previous)`, built from the copy in local state, so it is the tab the row is in
 * now rather than one this layer could pick wrongly.
 */
export async function setDeletedAt(spreadsheetId, tab, id, deletedAtIso) {
  const rowNumber = await resolveRow(spreadsheetId, tab, id)
  await updateValues(spreadsheetId, tab.cellRange(rowNumber, 'deleted_at'), [[deletedAtIso ?? '']])
}

/**
 * ---------------------------------------------------------------------------
 * The `recurring` tab's own writes.
 * ---------------------------------------------------------------------------
 *
 * Separate from the entry paths above rather than generalised with them, because almost
 * nothing is shared: a template has no `deleted_at` and no payer-driven tab, so there is no
 * soft delete, no row to move between tabs and no `tabOf` decision. `saveTemplate` is almost
 * the whole surface: `deleteTemplate` is the one destructive path, kept apart because it is the
 * only thing here that shifts a row and the only one that needs a gid.
 *
 * What IS shared is the rule that matters: a row number is never cached, and the write
 * re-resolves id -> row against a fresh read immediately beforehand.
 */

/**
 * The row a template's id sits on, or null if the tab does not hold it yet.
 *
 * REFUSES a duplicate rather than picking one, which is the opposite of `resolveRow` — and
 * deliberately. `resolveRow` prefers the last match because `updateEntry` leaves a same-id
 * tombstone behind; nothing in this tab does, so two rows under one id is a mistake rather
 * than a state. It is reachable by copying the rent row in the Sheets UI to add parking and
 * forgetting to change `id`, and writing to a guess would put one cost's values over
 * another's. `loadAll` shows only the first of them and counts the rest, so a person can see
 * that something is wrong; only the sheet can put it right.
 */
async function findTemplateRow(spreadsheetId, id) {
  const data = await getValues(spreadsheetId, RECURRING.dataRange)
  const rows = data.values ?? []

  const matches = []
  rows.forEach((row, index) => {
    if (cellText(row, RECURRING.index('id')) === id) matches.push(FIRST_DATA_ROW + index)
  })

  // Reaches the screen through the form's own error line, so it is translated. Only the sheet
  // can fix it, and the sentence says so.
  if (matches.length > 1) throw i18nError('error.duplicateTemplate')
  return matches[0] ?? null
}

/**
 * Write a template, wherever it belongs: append when the tab has no row for its id, overwrite
 * when it does.
 *
 * ONE function for add and edit rather than two, and that is what makes it idempotent. A
 * template's id is minted when the form OPENS, so an append whose response was lost —
 * committed, but reported as failed — gets retried under the SAME id; two calls to a dedicated
 * append would leave two rows, and from then on `findTemplateRow` refuses every edit and the
 * cost is unmaintainable from the app until somebody opens Sheets.
 *
 * The WHOLE row either way, never the edited cells: `templateToRow` writes a blank for a null
 * amount or share, and those blanks are values — variable, and "follow the payer's default". A
 * partial write could not clear one. Retiring is this same call with `active_to` set, which is
 * why there is no third function and no delete.
 */
export async function saveTemplate(spreadsheetId, template) {
  const rowNumber = await findTemplateRow(spreadsheetId, template.id)
  if (rowNumber == null) {
    await request(
      `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(RECURRING.title)}:append`,
      {
        method: 'POST',
        params: { valueInputOption: RAW, insertDataOption: 'INSERT_ROWS' },
        body: { values: [templateToRow(template)] },
      },
    )
    return
  }
  await updateValues(spreadsheetId, RECURRING.rowRange(rowNumber), [templateToRow(template)])
}

/**
 * Remove a template's row for good.
 *
 * The one hard delete outside `compact`, and it exists because a person asked for it rather
 * than because it is the safe path — `retiredTemplate` is. What it costs is stated where a
 * person can read it, in the confirmation: the instance id is the only link between a
 * declaration and the rows it has already posted, so deleting the row ORPHANS them. The rows
 * stay in the ledger, correctly; what is lost is the sheet's memory that those months were
 * handled. Add the same cost back afterwards — necessarily under a new id — and a month
 * already paid reads as unrecorded again.
 *
 * The row number comes from a read immediately beforehand, for the same reason `compact`
 * refuses to trust a cached one: `deleteDimension` shifts every row below it. Two phones
 * deleting at the same instant is the one case that can still land on the wrong row, and it is
 * the accepted last-write-wins design applied to a four-row tab that two people can talk about.
 */
export async function deleteTemplate(spreadsheetId, sheetGid, id) {
  const rowNumber = await findTemplateRow(spreadsheetId, id)
  // Already gone — from the other phone, or from the Sheets UI. Nothing to do, and nothing
  // worth interrupting somebody over: the outcome they asked for is the outcome they have.
  if (rowNumber == null) return

  await request(`/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetGid,
              dimension: 'ROWS',
              // 0-based and half-open: sheet row N is index N-1.
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  })
}

/**
 * Permanently remove every tombstoned row from every data tab.
 *
 * Reads each tab's own deleted_at column rather than trusting a caller-supplied id list,
 * because an id is not a unique lookup key: an edited entry can have left a tombstone in
 * one tab while the live row sits in the other.
 *
 * Iterates `DATA_TABS`, so the settlements tab is covered by construction. Left at the
 * two expenses tabs it would leave every tombstoned settlement behind while
 * `tombstoneCount` went on counting them — so the next compact would remove 0 rows and
 * offer the same ones again.
 *
 * @param {Record<string, number>} sheetGids tab title -> numeric sheetId
 * @returns {Promise<{removed: number}>}
 */
export async function compact(spreadsheetId, sheetGids) {
  const requests = []

  // One read per tab rather than a single batchGet, deliberately. Batching would save a
  // round trip on a rare manual action, at the cost of re-deriving the row numbers from a
  // positional `valueRanges` reply — and this is the only hard delete in the app, where
  // being one row out removes somebody else's expense.
  for (const tab of DATA_TABS) {
    const sheetGid = sheetGids[tab.title]
    if (sheetGid == null) continue

    // The FULL row range, not just the deleted_at column. Row numbers here are derived
    // from position (`FIRST_DATA_ROW + index`), which only holds while every data row is
    // present in the reply — and `deleted_at` is empty on most rows, so a single-column
    // read cannot be trusted to line up.
    const data = await getValues(spreadsheetId, tab.dataRange)
    const rowNumbers = []
    ;(data.values ?? []).forEach((row, index) => {
      if (deletedCell(tab, row)) rowNumbers.push(FIRST_DATA_ROW + index)
    })
    if (rowNumbers.length === 0) continue

    // CRITICAL: delete from the bottom up within each tab. deleteDimension shifts every
    // row below it, so ascending order would make each request after the first target
    // the wrong row.
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
 * Exported because `compact` needs the gids and must NOT go through `ensureStructure` to
 * get them: that path WRITES. A ledger whose config tab has been deleted reports
 * `configMissing` and is deliberately never repaired, but `ensureStructure` would add the
 * tab back and seed it with this build's defaults — an even split included — taking the
 * notice with them.
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
 * Idempotent: existing tabs are left alone, a header row is only written when it does
 * not already match its OWN tab's column list — the two layouts differ, so one shared
 * expectation would rewrite the settlements header with the expenses one on every call
 * — a config tab that already has values is never reseeded, and data rows are never
 * touched.
 *
 * @returns {Promise<{sheetIds: Record<string, number>}>} tab title -> numeric
 *   sheetId, for a caller that has just built the tabs. `compact` reads its own
 *   through `readSheetGids`, because this path writes.
 */
export async function ensureStructure(spreadsheetId) {
  const sheetIds = await readSheetGids(spreadsheetId)
  const wantedTabs = [...SHEET_TABS.map((tab) => tab.title), CONFIG_TAB]
  const missing = wantedTabs.filter((title) => !(title in sheetIds))

  // Refuse to build structure in a spreadsheet that is evidently somebody's existing
  // work. The id arrives from the script's SHEET_ID property rather than from a person
  // choosing a file, so a wrong one is a configuration mistake — and adding five tabs to
  // an unrelated spreadsheet is not something undo can reach. A freshly created
  // spreadsheet has exactly one default tab.
  //
  // The test is "none of ours", not "any missing": a ledger predating the settlements or
  // recurring tab is missing exactly one of the five and must have it BUILT. Translated,
  // because this is the one failure whose message a person has to act on — it names the
  // property to fix, and it reaches an error gate.
  if (missing.length === wantedTabs.length && Object.keys(sheetIds).length > 1) {
    throw i18nError('error.notOurSheet')
  }

  if (missing.length > 0) {
    const reply = await request(`/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      body: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
    })
    // The reply already names every tab it just created, so re-reading the spreadsheet
    // for the same gids is a wasted round trip. Read defensively: a gid that does not
    // arrive stays absent, and `compact` skips a tab it cannot name rather than
    // deleting rows from a guess.
    for (const { addSheet } of reply.replies ?? []) {
      const { title, sheetId } = addSheet?.properties ?? {}
      if (title != null && sheetId != null) sheetIds[title] = sheetId
    }
  }

  const { valueRanges = [] } = await batchGetValues(spreadsheetId, [
    ...SHEET_TABS.map((tab) => tab.headerRange),
    CONFIG_RANGE,
  ])

  const data = []
  SHEET_TABS.forEach((tab, index) => {
    const headerRow = valueRanges[index]?.values?.[0] ?? []
    // Compared against THIS tab's own list, not one shared expectation: the layouts
    // differ, so a shared one would find the settlements header "wrong" every time and
    // rewrite it with the expenses columns.
    const matches =
      headerRow.length === tab.columns.length &&
      tab.columns.every((column, at) => cellText(headerRow, at) === column)
    if (!matches) data.push({ range: tab.headerRange, values: [tab.columns] })
  })

  const configRows = valueRanges[SHEET_TABS.length]?.values ?? []
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
