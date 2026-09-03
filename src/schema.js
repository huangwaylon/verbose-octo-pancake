/**
 * The sheet contract: column order, ranges, and row <-> entry mapping. The only file in `src/`
 * that knows the layout. Values are read and written as raw strings, so a description like
 * "=SUM(A:A)" is never a formula and a date is never reformatted per locale.
 *
 * There are TWO layouts, so every positional lookup is derived per TAB: `deleted_at` sits at a
 * different index in each, and one shared index would have `compact` reading the settlements tab's
 * `id` column — non-empty on every row — and hard-deleting every live settlement.
 */

import { isIsoDate, isMonthKey } from './lib/dates.js'
import {
  isShare,
  isYenAmount,
  parseAmountToYen,
  parseShare,
  yenToSheetString,
} from './lib/money.js'

export const PERSON = {
  P1: 'p1',
  P2: 'p2',
}

/** Iteration order for the two people. Both tabs, both settings rows, both radios. */
export const PEOPLE = [PERSON.P1, PERSON.P2]

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
 * One expenses tab per person rather than a shared `payer` column: which tab a row lives in IS the
 * payer, so no row can disagree with its own tab.
 *
 * Ordered to match the bank's own CSV export — 取引日, 摘要, 引出額 — so a pasted statement lands under
 * the right headings. `id` is last because it is bookkeeping, not anything to read.
 */
export const EXPENSE_COLUMNS = Object.freeze([
  'date',
  'description',
  'amount',
  'category',
  'payer_share',
  'deleted_at',
  'id',
])

/**
 * One settlements tab, which therefore cannot say who paid — hence the `payer` column, the only
 * cell in the schema that can disagree with reality.
 *
 * No `payer_share` (a transfer's share is 0 by definition) and no `category` (a transfer is not
 * spending): both would be cells with exactly one correct value, which is a cell somebody can get
 * wrong.
 */
export const SETTLEMENT_COLUMNS = Object.freeze([
  'date',
  'description',
  'amount',
  'payer',
  'deleted_at',
  'id',
])

/**
 * The `recurring` tab: what recurs, not what happened. Deliberately NOT a data tab — declarations
 * rather than entries, so `compact` must not walk it and `rowToEntry` refuses it. It carries its
 * own `payer` for the settlements tab's reason, and has no `deleted_at`: `active_to` retires a
 * cost, because the row's id is the only link to the instances it has already posted.
 */
export const RECURRING_COLUMNS = Object.freeze([
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
])

/** Sheet rows are 1-indexed and row 1 is the header, so data starts at 2. */
export const FIRST_DATA_ROW = 2

/** A blank `day_of_month` means the 1st, and the day has to be one some month can name. */
export const DEFAULT_DAY_OF_MONTH = 1

export function isDayOfMonth(day) {
  return Number.isInteger(day) && day >= 1 && day <= 31
}

/**
 * Column letter from a 0-based position. Single-character arithmetic, so no column list may exceed
 * 26 entries: column 27 answers '[' and every range built from it is rejected by the API.
 * `test/schema.test.js` asserts both lengths, which is the only way that limit can be crossed.
 */
function letterAt(index) {
  return String.fromCharCode(65 + index)
}

/**
 * A tab: its title, its column list, and every positional lookup derived from that list alone.
 *
 * `type` and `payer` are what the tab asserts about its rows. A null `payer` means "read the
 * cell"; a null `type` means the tab holds no entries, which is what `rowToEntry` and `entryToRow`
 * refuse.
 */
function sheetTab({ title, columns, type, payer }) {
  const byName = new Map(columns.map((column, index) => [column, index]))
  const last = letterAt(columns.length - 1)

  const index = (field) => {
    const found = byName.get(field)
    if (found == null) throw new Error(`Unknown column for ${title}: ${field}`)
    return found
  }
  const letter = (field) => letterAt(index(field))

  return Object.freeze({
    title,
    columns,
    type,
    payer,
    has: (field) => byName.has(field),
    index,
    letter,
    headerRange: `${title}!A1:${last}1`,
    dataRange: `${title}!A${FIRST_DATA_ROW}:${last}`,
    /** Only ever call with a row number resolved from a FRESH read: positions shift on any edit. */
    rowRange: (rowNumber) => `${title}!A${rowNumber}:${last}${rowNumber}`,
    cellRange: (rowNumber, field) => {
      const at = letter(field)
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
 * The recurring declarations. `type: null` is load-bearing: it makes "this is not a data tab"
 * something `rowToEntry` enforces rather than something a comment asks for.
 */
export const RECURRING = sheetTab({
  title: 'recurring',
  columns: RECURRING_COLUMNS,
  type: null,
  payer: null,
})

/**
 * One person's expenses tab. Throws rather than guess: answering `expenses_p1` for an unrecognised
 * value writes against the wrong person's tab.
 */
export function expenseTab(person) {
  const tab = EXPENSES[person]
  if (!tab) throw new TypeError(`expenseTab needs a person, got ${String(person)}`)
  return tab
}

/**
 * Every tab holding entries, in the order `loadAll` requests them — the one list `compact`'s gid
 * lookup and every read's row-to-tab mapping share. `recurring` is absent by construction.
 */
export const DATA_TABS = [expenseTab(PERSON.P1), expenseTab(PERSON.P2), SETTLEMENTS]

/**
 * Every tab the app maintains a header row for, with the DATA tabs as the PREFIX.
 *
 * `loadAll` maps the first `DATA_TABS.length` replies back through `DATA_TABS`, so a tab inserted
 * ahead of them decodes ledger rows against the wrong layout. `ensureStructure` reads the same
 * list, which is what stops it building a tab nothing reads, or reading one it never builds.
 */
export const SHEET_TABS = [...DATA_TABS, RECURRING]

export const CONFIG_RANGE = `${CONFIG_TAB}!A:B`

/**
 * The tab an entry belongs in — the one home of that decision, so an append and the lookup that
 * finds the row again cannot disagree. A settlement's payer is a CELL, so only an EXPENSE's payer
 * moves a row.
 */
export function tabOf(entry) {
  return entry?.type === ENTRY_TYPE.SETTLEMENT ? SETTLEMENTS : expenseTab(entry?.payer)
}

/** A cell as trimmed text. Sheets returns numbers as numbers and gaps as holes. */
export function cellText(row, index) {
  const value = row?.[index]
  return value == null ? '' : String(value).trim()
}

/** Whether a row holds anything at all. A range runs to the bottom of its tab. */
export function hasAnyCell(row) {
  return Array.isArray(row) && row.some((_, index) => cellText(row, index))
}

/**
 * Map a raw sheet row to an entry object. The tab carries what the row cannot: its type, and an
 * expenses tab's payer. The row's POSITION is deliberately not part of the result.
 *
 * @param {string[]} row  cell values as returned by values.get
 * @param {object}   tab  the tab descriptor this row was read from
 * @returns {object|null} null for a blank or structurally invalid row
 */
export function rowToEntry(row, tab) {
  // Refuse rather than guess: a caller that cannot name the tab produces entries with the wrong
  // type or payer, and a tab with no `type` is `recurring`, whose rows would all decode to null
  // here — silently, which is the problem.
  if (!tab?.columns || !tab.type) {
    throw new TypeError(`rowToEntry needs a data tab descriptor, got ${String(tab?.title ?? tab)}`)
  }
  if (!Array.isArray(row)) return null

  // A field the layout does not carry reads as blank, so one decoder serves both tabs.
  const get = (field) => (tab.has(field) ? cellText(row, tab.index(field)) : '')

  const id = get('id')
  if (!id) return null

  const amountYen = parseAmountToYen(get('amount'))
  if (amountYen == null) return null

  // The tab's answer where it has one; the cell only in the settlements tab, case-folded because
  // it is hand-typed. Refused rather than defaulted, because the payer decides this row's SIGN.
  const payer = tab.payer ?? get('payer').toLowerCase()
  if (!isPerson(payer)) return null

  // Absent from the settlements layout, where the other person is responsible for all of it.
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
 * A field map as the row a tab expects, and never a hole: a RAW write treats a missing cell as
 * "leave it alone", which is how a cleared amount would keep its old figure.
 */
function rowFromFields(tab, byField) {
  return tab.columns.map((field) => {
    const value = byField[field]
    return value == null ? '' : String(value)
  })
}

/** An entry as its tab's row: a field that tab does not carry is simply not written. */
export function entryToRow(entry, tab) {
  // A tab with no `type` holds no entries, so writing one would fill six of the `recurring` tab's
  // ten columns with values that mean something else entirely.
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
  return rowFromFields(tab, byField)
}

/**
 * One `recurring` row -> a template, or null for a row that cannot be used.
 *
 * The one place this differs from the `config` tab: a blank cell takes its documented default, but
 * a cell somebody FILLED IN and this cannot read refuses the whole row, which `loadAll` counts.
 * Every default here either moves money or decides whether a cost is offered at all.
 *
 * `payerShare` stays null for a blank cell, meaning "follow the PAYER's default": read as
 * `EVEN_SHARE` it would split every rent 50/50 on a sheet running 80/20.
 *
 * @param {string[]} row cell values as returned by values.get
 * @returns {object|null}
 */
export function rowToTemplate(row) {
  if (!Array.isArray(row)) return null

  const id = cellText(row, RECURRING.index('id'))
  if (!id) return null

  let refused = false
  /** A cell, its parsed value, and the blank rule in one line per field. */
  const read = (field, parse, blank = null) => {
    const text = cellText(row, RECURRING.index(field))
    if (!text) return blank
    const value = parse(text)
    if (value == null) refused = true
    return value
  }

  // Refused rather than defaulted, as the settlements payer cell is: this decides which person's
  // tab the instance lands in.
  const payer = read('payer', (text) => {
    const person = text.toLowerCase()
    return isPerson(person) ? person : null
  })
  // Blank is recurring-but-VARIABLE — a utility bill — so the page lists it with no figure and the
  // form opens empty. A zero is a mistake rather than a variable cost.
  const amountYen = read('amount', (text) => {
    const yen = parseAmountToYen(text)
    return isYenAmount(yen) ? yen : null
  })
  const payerShare = read('payer_share', parseShare)
  const months = read('months', parseMonths)
  const dayOfMonth = read(
    'day_of_month',
    (text) => (isDayOfMonth(Number(text)) ? Number(text) : null),
    DEFAULT_DAY_OF_MONTH,
  )
  const activeFrom = read('active_from', (text) => (isMonthKey(text) ? text : null))
  const activeTo = read('active_to', (text) => (isMonthKey(text) ? text : null))

  if (refused || !payer) return null

  return {
    id,
    description: cellText(row, RECURRING.index('description')),
    amountYen,
    category: cellText(row, RECURRING.index('category')),
    payer,
    payerShare,
    months,
    dayOfMonth,
    activeFrom,
    activeTo,
  }
}

/**
 * The `months` cell as month numbers, or null if any part of it is not one. Blank means every
 * month and `1,7` covers annual and quarterly, so there is no cadence concept to add — and no
 * weekly, which the app being month-scoped rules out.
 */
function parseMonths(text) {
  const found = text.split(',').map((part) => Number(part.trim()))
  return found.some((month) => !Number.isInteger(month) || month < 1 || month > 12) ? null : found
}

/**
 * The exact inverse of `rowToTemplate` in TEMPLATE space, so a read-modify-write round trip is
 * lossless. Not in cell space: a hand-typed `80` comes back as `0.8`, which re-parses identically.
 *
 * A null amount or share writes BLANK, a value in both — variable, and "follow the payer's
 * default". Writing '0', or the literal text 'NaN', makes `rowToTemplate` refuse the row, so the
 * template vanishes from the page the app itself just wrote it to.
 */
export function templateToRow(template) {
  return rowFromFields(RECURRING, {
    description: template.description,
    amount: template.amountYen == null ? '' : yenToSheetString(template.amountYen),
    category: template.category,
    payer: template.payer,
    payer_share: Number.isFinite(template.payerShare) ? template.payerShare : '',
    months: template.months?.length ? template.months.join(', ') : '',
    day_of_month: Number.isFinite(template.dayOfMonth) ? template.dayOfMonth : '',
    active_from: template.activeFrom ?? '',
    active_to: template.activeTo ?? '',
    id: template.id,
  })
}

/**
 * Build a complete entry from partial user input, minting an id if there is none.
 *
 * Takes no clock: the sheet records the transaction DATE, and `deleted_at` is stamped by whoever
 * deletes. Nothing here guesses either — an unrecognised payer is passed through for
 * `validateEntryCodes` to refuse, rather than filed under the wrong person's tab.
 */
export function makeEntry(input) {
  const type = input.type === ENTRY_TYPE.SETTLEMENT ? ENTRY_TYPE.SETTLEMENT : ENTRY_TYPE.EXPENSE
  return {
    id: input.id || crypto.randomUUID(),
    type,
    date: input.date ?? '',
    payer: input.payer ?? '',
    // Coerced with the share below, so a form's '4210' is a number before it reaches the balance.
    amountYen: input.amountYen == null ? 0 : Number(input.amountYen),
    category: input.category ?? '',
    description: input.description ?? '',
    payerShare:
      input.payerShare == null
        ? type === ENTRY_TYPE.SETTLEMENT
          ? 0
          : EVEN_SHARE
        : Number(input.payerShare),
    deletedAt: input.deletedAt ?? null,
  }
}

/**
 * Validation failure codes. These, not English sentences, are the stable contract: the thrown
 * error carries `error.<code>`.
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
  if (!isYenAmount(entry.amountYen)) errors.push(ENTRY_ERROR.BAD_AMOUNT)
  if (!isPerson(entry.payer)) {
    errors.push(ENTRY_ERROR.BAD_PAYER)
  }
  if (!isShare(entry.payerShare)) errors.push(ENTRY_ERROR.BAD_SHARE)
  if (entry.type === ENTRY_TYPE.EXPENSE && !entry.category) {
    errors.push(ENTRY_ERROR.MISSING_CATEGORY)
  }
  return errors
}

export function isActive(entry) {
  return Boolean(entry) && !entry.deletedAt
}
