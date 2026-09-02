/**
 * The sheet contract: column order, ranges, and row <-> entry mapping.
 *
 * Everything that touches the Google Sheet goes through here, so the column
 * layout is defined in exactly one place. Values are read and written as raw
 * strings (valueInputOption: RAW): a description like "=SUM(A:A)" must never be
 * interpreted as a formula, and dates must not be reformatted per locale.
 *
 * There are TWO layouts, and every positional lookup is derived per tab rather than
 * module-wide. That is not tidiness: `deleted_at` sits at a different index in each
 * list, so one shared index would have `compact` reading the settlements tab's `id`
 * column — non-empty on every row — and hard-deleting every live settlement.
 */

import { isIsoDate } from './lib/dates.js'
import { parseAmountToYen, parseShare, yenToSheetString } from './lib/money.js'

export const PERSON = {
  P1: 'p1',
  P2: 'p2',
}

/** Iteration order for the two people. Both tabs, both settings rows, both radios. */
export const PEOPLE = [PERSON.P1, PERSON.P2]

/** Whether a value is one of the two people, for callers that must refuse instead. */
export function isPerson(value) {
  return value === PERSON.P1 || value === PERSON.P2
}

export function otherPerson(person) {
  return person === PERSON.P1 ? PERSON.P2 : PERSON.P1
}

export const CONFIG_TAB = 'config'

export const ENTRY_TYPE = {
  EXPENSE: 'expense',
  SETTLEMENT: 'settlement',
}

/** Even split: the payer is responsible for half of what they paid. */
export const EVEN_SHARE = 0.5

/**
 * One expenses tab per person rather than a shared tab with a `payer` column.
 * Which tab a row lives in is itself the payer, so there is nothing to keep in
 * sync and no way for a row to disagree with its own tab.
 *
 * Ordered to match the bank's own CSV export — 取引日, 摘要, 引出額 — so a pasted
 * statement lands under the right headings and the columns a person reads come first.
 * `id` is last for the same reason: it is the app's bookkeeping, not anything to read.
 */
export const EXPENSE_COLUMNS = [
  'date',
  'description',
  'amount',
  'category',
  'payer_share',
  'deleted_at',
  'id',
]

/**
 * Settlements live in one tab of their own, so that tab cannot say who paid the way an
 * expenses tab does — hence the `payer` column, the only cell in the schema that can
 * disagree with reality. `rowToEntry` refuses a row whose payer it cannot read rather
 * than guessing, and `loadAll` counts what it refused.
 *
 * No `payer_share`: a settlement is a transfer, so the payer is owed all of it and the
 * share is 0 by definition. No `category` either — a transfer is not spending. Both
 * would be cells with exactly one correct value, which is a cell somebody can get wrong.
 */
export const SETTLEMENT_COLUMNS = ['date', 'description', 'amount', 'payer', 'deleted_at', 'id']

/**
 * The `recurring` tab: what recurs, not what happened. Authored by hand in the Sheet like
 * `config` is, and read-only from the app.
 *
 * Deliberately NOT a data tab. It holds declarations rather than entries — no date, no
 * `deleted_at`, no id that any row in the ledger shares — so `compact` must not walk it
 * and `rowToEntry` must refuse it outright. `lib/recurring.js` is the only reader.
 *
 * It carries its own `payer` column for the same reason the settlements tab does: one tab
 * cannot say who pays. There is no `deleted_at` because nothing references a template, so
 * deleting the row is the retire path — and `active_to` is how a lease ends without
 * losing the history of what it cost.
 */
export const RECURRING_COLUMNS = [
  'description',
  'amount',
  'category',
  'payer',
  'payer_share',
  'months',
  'day_of_month',
  'active_from',
  'active_to',
  'id',
]

/** Sheet rows are 1-indexed and row 1 is the header, so data starts at 2. */
export const FIRST_DATA_ROW = 2

/**
 * Column letter from a 0-based position, e.g. 0 -> 'A'.
 *
 * Single-character arithmetic, which is why no column list may exceed 26 entries:
 * column 27 would answer '[' and every range built from it would be rejected by the
 * API. `test/schema.test.js` asserts both lengths, which is the only way that limit can
 * be crossed — every caller passes a name from a list.
 */
function letterAt(index) {
  return String.fromCharCode(65 + index)
}

/**
 * A tab: its title, its column list, and every positional lookup derived from that list
 * alone.
 *
 * `type` and `payer` are what the tab itself asserts about its rows. `payer` is null for
 * the settlements tab, meaning "this tab does not know — read the cell"; for an expenses
 * tab it is the answer, and no cell can contradict it. A `type` of null means the tab
 * holds no entries at all, which is what `rowToEntry` and `entryToRow` refuse on.
 */
function sheetTab({ title, columns, type, payer }) {
  const byName = new Map(columns.map((column, index) => [column, index]))
  const last = letterAt(columns.length - 1)

  const index = (field) => {
    const found = byName.get(field)
    if (found == null) throw new Error(`Unknown column for ${title}: ${field}`)
    return found
  }

  return Object.freeze({
    title,
    columns,
    type,
    payer,
    has: (field) => byName.has(field),
    index,
    letter: (field) => letterAt(index(field)),
    headerRange: `${title}!A1:${last}1`,
    dataRange: `${title}!A${FIRST_DATA_ROW}:${last}`,
    /**
     * Range for a single row's worth of columns, e.g. "expenses_p1!A7:G7". Only ever
     * call this with a row number resolved from a *fresh* read — row positions shift
     * whenever the sheet is edited directly in the Sheets UI.
     */
    rowRange: (rowNumber) => `${title}!A${rowNumber}:${last}${rowNumber}`,
    cellRange: (rowNumber, field) => {
      const at = letterAt(index(field))
      return `${title}!${at}${rowNumber}:${at}${rowNumber}`
    },
  })
}

const EXPENSES = {
  [PERSON.P1]: sheetTab({
    title: 'expenses_p1',
    columns: EXPENSE_COLUMNS,
    type: ENTRY_TYPE.EXPENSE,
    payer: PERSON.P1,
  }),
  [PERSON.P2]: sheetTab({
    title: 'expenses_p2',
    columns: EXPENSE_COLUMNS,
    type: ENTRY_TYPE.EXPENSE,
    payer: PERSON.P2,
  }),
}

export const SETTLEMENTS = sheetTab({
  title: 'settlements',
  columns: SETTLEMENT_COLUMNS,
  type: ENTRY_TYPE.SETTLEMENT,
  payer: null,
})

/**
 * The recurring declarations. `type: null` is load-bearing: it is what makes "this is not
 * a data tab" something `rowToEntry` enforces rather than something a comment asks for.
 */
export const RECURRING = sheetTab({
  title: 'recurring',
  columns: RECURRING_COLUMNS,
  type: null,
  payer: null,
})

/**
 * One person's expenses tab.
 *
 * Throws on anything that is not one of the two people. Answering `expenses_p1` for an
 * unrecognised value would turn "we do not know which tab this row is in" into a write
 * against the wrong person's tab — the quietest possible way to corrupt a ledger.
 */
export function expenseTab(person) {
  const tab = EXPENSES[person]
  if (!tab) throw new TypeError(`expenseTab needs a person, got ${String(person)}`)
  return tab
}

/**
 * Every tab holding entries, in the order `loadAll` requests them. The one list
 * `compact`'s gid lookup and every read's row-to-tab mapping share, so none of them can
 * be given a tab the others do not know about — and the `recurring` tab is absent by
 * construction, since a template decoded as an entry has no type and no payer.
 */
export const DATA_TABS = [expenseTab(PERSON.P1), expenseTab(PERSON.P2), SETTLEMENTS]

/**
 * Every tab the app maintains a header row for, with the DATA tabs as the PREFIX.
 *
 * That order is load-bearing twice. `loadAll` builds its ranges from this list and maps
 * the first `DATA_TABS.length` replies back through `DATA_TABS`, so a tab inserted ahead
 * of them would decode ledger rows against the wrong layout. And `ensureStructure` reads
 * the same list, which is what stops it building a tab nothing reads — or reading one it
 * never builds.
 */
export const SHEET_TABS = [...DATA_TABS, RECURRING]

export const CONFIG_RANGE = `${CONFIG_TAB}!A:B`

/**
 * The tab an entry belongs in — the one home of that decision, so an append and the
 * lookup that finds the row again can never disagree about where it is.
 *
 * A settlement's payer is a CELL, so changing it does NOT move the row: only an
 * expense's payer moves a row between tabs.
 */
export function tabOf(entry) {
  return entry?.type === ENTRY_TYPE.SETTLEMENT ? SETTLEMENTS : expenseTab(entry?.payer)
}

/** A cell as trimmed text. Sheets returns numbers as numbers and gaps as holes. */
export function cellText(row, index) {
  const value = row?.[index]
  return value == null ? '' : String(value).trim()
}

/**
 * Map a raw sheet row to an entry object.
 *
 * The tab carries what the row itself cannot: its type, and — for an expenses tab — its
 * payer. The row's position is deliberately not part of the result: it shifts whenever
 * anyone edits the sheet in the Sheets UI, so every write re-resolves id → row
 * immediately beforehand.
 *
 * @param {string[]} row  Cell values as returned by values.get
 * @param {object}   tab  the tab descriptor this row was read from
 * @returns {object|null} null for a blank or structurally invalid row
 */
export function rowToEntry(row, tab) {
  // Refuse rather than guess. A caller that cannot name the tab has lost track of what
  // it is reading, and every entry it produced would carry the wrong type or payer. A tab
  // with no `type` is the `recurring` one: its rows are declarations, and decoded here
  // every one of them would answer null anyway — silently, which is the problem.
  if (!tab?.columns || !tab.type) {
    throw new TypeError(`rowToEntry needs a data tab descriptor, got ${String(tab?.title ?? tab)}`)
  }
  if (!Array.isArray(row)) return null

  // A field the layout does not carry reads as blank rather than throwing, so one
  // decoder serves both tabs.
  const get = (field) => (tab.has(field) ? cellText(row, tab.index(field)) : '')

  const id = get('id')
  if (!id) return null

  const amountYen = parseAmountToYen(get('amount'))
  if (amountYen == null) return null

  // The tab's answer where it has one; the cell only in the settlements tab. Folded for
  // case because that cell is hand-typed, and refused rather than defaulted: the payer
  // decides the SIGN of this row's contribution. `loadAll` counts what this drops.
  const payer = tab.payer ?? get('payer').toLowerCase()
  if (!isPerson(payer)) return null

  // Absent from the settlements layout, where it is 0 by definition: the payer handed
  // money over and the other person is responsible for all of it.
  const share = parseShare(get('payer_share'))
  const payerShare = tab.has('payer_share') ? (share ?? EVEN_SHARE) : 0

  const date = get('date')
  const deletedAt = get('deleted_at')

  return {
    id,
    type: tab.type,
    date: isIsoDate(date) ? date : '',
    payer,
    amountYen,
    category: get('category'),
    description: get('description'),
    payerShare,
    deletedAt: deletedAt || null,
  }
}

/**
 * Map an entry object back to a raw sheet row — always one cell per column of the tab
 * it is being written to, so a field that tab does not carry is simply not written.
 *
 * @param {object} entry
 * @param {object} tab the tab descriptor being written to
 * @returns {string[]}
 */
export function entryToRow(entry, tab) {
  // A tab with no `type` holds no entries, so writing one into it would fill six of the
  // `recurring` tab's ten columns with values that mean something else entirely.
  if (!tab?.columns || !tab.type) {
    throw new TypeError(`entryToRow needs a data tab descriptor, got ${String(tab?.title ?? tab)}`)
  }
  const byField = {
    id: entry.id,
    date: entry.date,
    // Throws on a non-integer rather than writing "NaN" into somebody's ledger.
    amount: yenToSheetString(entry.amountYen),
    payer: entry.payer,
    category: entry.category,
    description: entry.description,
    payer_share: Number.isFinite(entry.payerShare) ? entry.payerShare : '',
    deleted_at: entry.deletedAt ?? '',
  }
  return tab.columns.map((field) => {
    const value = byField[field]
    return value == null ? '' : String(value)
  })
}

/**
 * Build a complete entry from partial user input, minting an id if there is none.
 *
 * Takes no clock, because an entry carries no timestamp of its own: the sheet records the
 * transaction DATE, and `deleted_at` — the one timestamp left — is stamped by whoever
 * performs the delete. That is also why nothing here has to be injected for a test to be
 * deterministic.
 *
 * Nothing here guesses: an unrecognised payer is passed through so `validateEntryCodes`
 * can refuse it. Rewriting it to p1 would make BAD_PAYER unreachable and file the expense
 * under the wrong person's tab.
 */
export function makeEntry(input) {
  const type = input.type === ENTRY_TYPE.SETTLEMENT ? ENTRY_TYPE.SETTLEMENT : ENTRY_TYPE.EXPENSE
  return {
    id: input.id || crypto.randomUUID(),
    type,
    date: input.date ?? '',
    payer: input.payer ?? '',
    amountYen: input.amountYen ?? 0,
    category: input.category ?? '',
    description: input.description ?? '',
    payerShare:
      input.payerShare == null
        ? type === ENTRY_TYPE.SETTLEMENT
          ? 0
          : EVEN_SHARE
        : // Coerced so a form handing over '0.5' becomes a number before it can
          // reach validation or the balance math.
          Number(input.payerShare),
    deletedAt: input.deletedAt ?? null,
  }
}

/**
 * Validation failure codes. These, not English sentences, are the stable
 * contract: `useLedger` attaches one to the thrown error as `i18nKey` and the UI
 * translates it against `error.<code>`.
 */
export const ENTRY_ERROR = {
  MISSING_ID: 'missingId',
  BAD_DATE: 'badDate',
  BAD_AMOUNT: 'badAmount',
  BAD_PAYER: 'badPayer',
  BAD_SHARE: 'badShare',
  MISSING_CATEGORY: 'missingCategory',
}

/** @returns {string[]} failure codes from ENTRY_ERROR; empty means valid. */
export function validateEntryCodes(entry) {
  const errors = []
  if (!entry.id) errors.push(ENTRY_ERROR.MISSING_ID)
  if (!isIsoDate(entry.date)) errors.push(ENTRY_ERROR.BAD_DATE)
  if (!Number.isInteger(entry.amountYen) || entry.amountYen <= 0) {
    errors.push(ENTRY_ERROR.BAD_AMOUNT)
  }
  if (!isPerson(entry.payer)) {
    errors.push(ENTRY_ERROR.BAD_PAYER)
  }
  if (
    typeof entry.payerShare !== 'number' ||
    !Number.isFinite(entry.payerShare) ||
    entry.payerShare < 0 ||
    entry.payerShare > 1
  ) {
    errors.push(ENTRY_ERROR.BAD_SHARE)
  }
  if (entry.type === ENTRY_TYPE.EXPENSE && !entry.category) {
    errors.push(ENTRY_ERROR.MISSING_CATEGORY)
  }
  return errors
}

export function isActive(entry) {
  return Boolean(entry) && !entry.deletedAt
}
