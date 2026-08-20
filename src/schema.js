/**
 * The sheet contract: column order, ranges, and row <-> entry mapping.
 *
 * Everything that touches the Google Sheet goes through here, so the column
 * layout is defined in exactly one place. Values are read and written as raw
 * strings (valueInputOption: RAW): a description like "=SUM(A:A)" must never be
 * interpreted as a formula, and dates must not be reformatted per locale.
 */

import {
  centsToSheetString,
  normalizeCurrency,
  parseAmountToCents,
  parseShare,
} from './lib/money.js'

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

/**
 * One expenses tab per person rather than a shared tab with a `payer` column.
 * Which tab a row lives in is itself the payer, so there is nothing to keep in
 * sync and no way for a row to disagree with its own tab.
 *
 * Throws on anything that is not one of the two people. Answering `expenses_p1`
 * for an unrecognised value would turn "we do not know which tab this row is in"
 * into a write against the wrong person's tab — the quietest possible way to
 * corrupt a ledger.
 */
export function expensesTab(person) {
  if (person === PERSON.P1) return 'expenses_p1'
  if (person === PERSON.P2) return 'expenses_p2'
  throw new TypeError(`expensesTab needs a person, got ${String(person)}`)
}

export const EXPENSE_COLUMNS = [
  'id',
  'type',
  'date',
  'amount',
  'currency',
  'category',
  'description',
  'payer_share',
  'created_at',
  'updated_at',
  'deleted_at',
]

/** Sheet rows are 1-indexed and row 1 is the header, so data starts at 2. */
export const FIRST_DATA_ROW = 2

export function expensesHeaderRange(person) {
  return `${expensesTab(person)}!A1:${LAST_COLUMN}1`
}

export function expensesDataRange(person) {
  return `${expensesTab(person)}!A${FIRST_DATA_ROW}:${LAST_COLUMN}`
}

export const CONFIG_RANGE = `${CONFIG_TAB}!A:B`

export const ENTRY_TYPE = {
  EXPENSE: 'expense',
  SETTLEMENT: 'settlement',
}

/** Even split: the payer is responsible for half of what they paid. */
export const EVEN_SHARE = 0.5

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Shape *and* calendar validity. The regex alone accepts 2026-02-31 and
 * 2026-13-45, which would surface as a bogus month in the month switcher.
 */
function isRealDate(value) {
  if (!ISO_DATE.test(value ?? '')) return false
  const [year, month, day] = value.split('-').map(Number)
  // The UTC round-trip is the whole check: a month or day out of range lands in
  // a different month or year, which the three comparisons below catch.
  const probe = new Date(Date.UTC(year, month - 1, day))
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  )
}

/**
 * Range for a single row's worth of columns within one person's tab, e.g.
 * rowRange('p1', 7) -> "expenses_p1!A7:K7". Only ever call this with a row
 * number resolved from a *fresh* read — row positions shift whenever the sheet
 * is edited directly in the Sheets UI.
 */
export function rowRange(person, rowNumber) {
  return `${expensesTab(person)}!A${rowNumber}:${LAST_COLUMN}${rowNumber}`
}

/**
 * The column list keyed for lookup, built once. `rowToEntry` asks ten times per
 * row and every read decodes both tabs in full, so a linear scan per field is
 * ~110 string comparisons per row on the one path a focus refresh always walks.
 */
const COLUMN_INDEX = new Map(EXPENSE_COLUMNS.map((column, index) => [column, index]))

/** 0-based position of a named column, e.g. columnIndex('deleted_at') -> 10. */
export function columnIndex(field) {
  const index = COLUMN_INDEX.get(field)
  if (index == null) throw new Error(`Unknown column: ${field}`)
  return index
}

/**
 * Column letter for a named field, e.g. columnLetter('deleted_at') -> 'K'.
 *
 * Single-character arithmetic, which is why EXPENSE_COLUMNS cannot exceed 26
 * entries: column 27 would answer '[' and every range built from it would be
 * rejected by the API. `test/schema.test.js` asserts the length, which is the only
 * way that limit can be crossed — every caller passes a name from the list.
 */
export function columnLetter(field) {
  return String.fromCharCode(65 + columnIndex(field))
}

const LAST_COLUMN = columnLetter(EXPENSE_COLUMNS[EXPENSE_COLUMNS.length - 1])

export function cellRange(person, rowNumber, field) {
  const letter = columnLetter(field)
  return `${expensesTab(person)}!${letter}${rowNumber}:${letter}${rowNumber}`
}

/** A cell as trimmed text. Sheets returns numbers as numbers and gaps as holes. */
export function cellText(row, index) {
  const value = row?.[index]
  return value == null ? '' : String(value).trim()
}

/**
 * Map a raw sheet row to an entry object.
 *
 * The payer is not a column — it is which of the two per-person tabs the row
 * came from — so the caller passes it in rather than it being read here.
 *
 * The row's position is deliberately not part of the result: it shifts whenever
 * anyone edits the sheet in the Sheets UI, so every write re-resolves id → row
 * immediately beforehand and a stored position could only ever be a trap.
 *
 * @param {string[]} row       Cell values as returned by values.get
 * @param {string}   payer     'p1' or 'p2': whichever tab this row was read from
 * @param {string}   currency  the sheet's currency, used only when a row's own
 *   currency cell is blank (a row somebody added by hand). It MUST be resolved
 *   before the amount: "1250" is ¥1250 or $12.50 depending on nothing else.
 * @returns {object|null}      null for blank or structurally invalid rows
 */
export function rowToEntry(row, payer, currency) {
  // Refuse rather than guess, exactly as `expensesTab` does: the tab a row came
  // from IS its payer, so a caller that cannot name one has lost track of which
  // tab it is reading and every entry it produces would be attributed wrongly.
  if (!isPerson(payer)) {
    throw new TypeError(`rowToEntry needs the tab's person, got ${String(payer)}`)
  }
  if (!Array.isArray(row)) return null

  const get = (field) => cellText(row, columnIndex(field))

  const id = get('id')
  if (!id) return null

  const rowCurrency = normalizeCurrency(get('currency')) || currency
  const amountCents = parseAmountToCents(get('amount'), rowCurrency)
  if (amountCents == null) return null

  // Case-folded like the currency, and for the same reason: a hand-typed
  // "Settlement" read as an expense keeps the right balance (its `payer_share` of 0
  // says everything) but is then counted in the month's spend and the category
  // donut, inflating both by the full transfer.
  const type =
    get('type').toLowerCase() === ENTRY_TYPE.SETTLEMENT ? ENTRY_TYPE.SETTLEMENT : ENTRY_TYPE.EXPENSE

  // Same percentage-or-fraction rule as the config tab's default_split rows:
  // both are a share somebody may have typed by hand.
  const share = parseShare(get('payer_share'))
  const payerShare = share ?? (type === ENTRY_TYPE.SETTLEMENT ? 0 : EVEN_SHARE)

  const date = get('date')
  const deletedAt = get('deleted_at')

  return {
    id,
    type,
    date: isRealDate(date) ? date : '',
    payer,
    amountCents,
    currency: rowCurrency,
    category: get('category'),
    description: get('description'),
    payerShare,
    createdAt: get('created_at'),
    updatedAt: get('updated_at'),
    deletedAt: deletedAt || null,
  }
}

/**
 * Map an entry object back to a raw sheet row (always EXPENSE_COLUMNS.length
 * strings). The payer is not written here — it is expressed by which person's
 * tab the caller writes this row into.
 */
export function entryToRow(entry) {
  // Loud rather than silent: without a currency the amount would be encoded at
  // the two-digit default, so a ¥1250 entry would land in the sheet as "12.50"
  // and read back as ¥13. `validateEntryCodes` is what callers check first.
  if (!entry.currency) throw new TypeError('entry.currency is required to encode an amount')
  const byField = {
    id: entry.id,
    type: entry.type,
    date: entry.date,
    // The entry's OWN currency, never the config's: a sheet holding both USD and
    // JPY rows stays correct only if each row is encoded at its own scale.
    amount: centsToSheetString(entry.amountCents, entry.currency),
    currency: entry.currency,
    category: entry.category,
    description: entry.description,
    payer_share: Number.isFinite(entry.payerShare) ? entry.payerShare : '',
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
    deleted_at: entry.deletedAt ?? '',
  }
  return EXPENSE_COLUMNS.map((field) => {
    const value = byField[field]
    return value == null ? '' : String(value)
  })
}

/**
 * Build a complete entry from partial user input, filling in id/timestamps.
 * `now` is injected so tests stay deterministic.
 *
 * Nothing here guesses: an unrecognised payer is passed through so
 * `validateEntryCodes` can refuse it, rather than being rewritten to p1 — which
 * made BAD_PAYER unreachable and filed the expense under the wrong person's tab.
 * A currency that is not a three-letter code becomes '' for the same reason: the
 * amount's scale is meaningless without one, so the write must fail loudly.
 */
export function makeEntry(input, now = new Date().toISOString()) {
  const type = input.type === ENTRY_TYPE.SETTLEMENT ? ENTRY_TYPE.SETTLEMENT : ENTRY_TYPE.EXPENSE
  return {
    id: input.id || crypto.randomUUID(),
    type,
    date: input.date ?? '',
    payer: input.payer ?? '',
    amountCents: input.amountCents ?? 0,
    currency: normalizeCurrency(input.currency),
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
    createdAt: input.createdAt || now,
    updatedAt: now,
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
  MISSING_CURRENCY: 'missingCurrency',
}

/** @returns {string[]} failure codes from ENTRY_ERROR; empty means valid. */
export function validateEntryCodes(entry) {
  const errors = []
  if (!entry.id) errors.push(ENTRY_ERROR.MISSING_ID)
  if (!isRealDate(entry.date)) errors.push(ENTRY_ERROR.BAD_DATE)
  if (!Number.isInteger(entry.amountCents) || entry.amountCents <= 0) {
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
  // Refuse rather than assume a scale: the amount is meaningless without it.
  if (!entry.currency) errors.push(ENTRY_ERROR.MISSING_CURRENCY)
  return errors
}

export function isActive(entry) {
  return Boolean(entry) && !entry.deletedAt
}
