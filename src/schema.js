/**
 * The sheet contract: column order, ranges, and row <-> entry mapping.
 *
 * Everything that touches the Google Sheet goes through here, so the column
 * layout is defined in exactly one place. Values are always read and written
 * as raw strings (valueInputOption: RAW) — a description like "=SUM(A:A)" or
 * "+1 pizza" must never be interpreted as a formula, and dates must not be
 * silently reformatted per locale.
 */

import { centsToSheetString, parseAmountToCents } from './lib/money.js'

export const EXPENSES_TAB = 'expenses'
export const CONFIG_TAB = 'config'

export const EXPENSE_COLUMNS = [
  'id',
  'type',
  'date',
  'payer',
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

export const EXPENSES_HEADER_RANGE = `${EXPENSES_TAB}!A1:L1`
export const EXPENSES_DATA_RANGE = `${EXPENSES_TAB}!A${FIRST_DATA_ROW}:L`
export const CONFIG_RANGE = `${CONFIG_TAB}!A:B`

export const ENTRY_TYPE = {
  EXPENSE: 'expense',
  SETTLEMENT: 'settlement',
}

export const PERSON = {
  P1: 'p1',
  P2: 'p2',
}

export function otherPerson(person) {
  return person === PERSON.P1 ? PERSON.P2 : PERSON.P1
}

/** Even split: the payer is responsible for half of what they paid. */
export const EVEN_SHARE = 0.5

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Shape *and* calendar validity. The regex alone happily accepts 2026-02-31
 * and 2026-13-45, which would then surface as a bogus month like "2026-13" in
 * the month switcher.
 */
export function isRealDate(value) {
  if (!ISO_DATE.test(value ?? '')) return false
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1) return false
  const probe = new Date(Date.UTC(year, month - 1, day))
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  )
}

/**
 * Range for a single row's worth of columns, e.g. rowRange(7) -> "expenses!A7:L7".
 * Only ever call this with a row number resolved from a *fresh* read — row
 * positions shift whenever the sheet is edited directly in the Sheets UI.
 */
export function rowRange(rowNumber) {
  return `${EXPENSES_TAB}!A${rowNumber}:L${rowNumber}`
}

/** Column letter for a named field, e.g. columnLetter('deleted_at') -> 'L'. */
export function columnLetter(field) {
  const index = EXPENSE_COLUMNS.indexOf(field)
  if (index < 0) throw new Error(`Unknown column: ${field}`)
  return String.fromCharCode(65 + index)
}

export function cellRange(rowNumber, field) {
  const letter = columnLetter(field)
  return `${EXPENSES_TAB}!${letter}${rowNumber}:${letter}${rowNumber}`
}

/**
 * Map a raw sheet row to an entry object.
 *
 * @param {string[]} row      Cell values as returned by values.get
 * @param {number}   index    0-based offset within EXPENSES_DATA_RANGE
 * @returns {object|null}     null for blank or structurally invalid rows
 */
export function rowToEntry(row, index) {
  if (!Array.isArray(row)) return null

  const get = (field) => {
    const value = row[EXPENSE_COLUMNS.indexOf(field)]
    return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
  }

  const id = get('id')
  if (!id) return null

  // MUST be read before the amount. The stored string "1250" means ¥1250 or
  // $12.50 depending entirely on this cell, so decoding in the other order is a
  // silent 100x corruption. A blank cell keeps meaning USD — that fallback is
  // what migrates every pre-existing sheet for free, so do not point it at
  // DEFAULT_CONFIG.currency.
  const currency = get('currency') || 'USD'

  const amountCents = parseAmountToCents(get('amount'), currency)
  if (amountCents == null) return null

  const payer = get('payer') === PERSON.P2 ? PERSON.P2 : PERSON.P1
  const type = get('type') === ENTRY_TYPE.SETTLEMENT ? ENTRY_TYPE.SETTLEMENT : ENTRY_TYPE.EXPENSE

  const rawShare = Number.parseFloat(get('payer_share'))
  const payerShare = Number.isFinite(rawShare)
    ? Math.min(1, Math.max(0, rawShare))
    : type === ENTRY_TYPE.SETTLEMENT
      ? 0
      : EVEN_SHARE

  const date = get('date')
  const deletedAt = get('deleted_at')

  return {
    id,
    type,
    date: isRealDate(date) ? date : '',
    payer,
    amountCents,
    currency,
    category: get('category'),
    description: get('description'),
    payerShare,
    createdAt: get('created_at'),
    updatedAt: get('updated_at'),
    deletedAt: deletedAt || null,
    rowNumber: FIRST_DATA_ROW + index,
  }
}

/** Map an entry object back to a raw sheet row (always 12 strings). */
export function entryToRow(entry) {
  const byField = {
    id: entry.id,
    type: entry.type,
    date: entry.date,
    payer: entry.payer,
    // Always the entry's OWN currency, never config.currency: a sheet holding
    // both USD and JPY rows stays correct only if each row is encoded at its own
    // scale.
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
 */
export function makeEntry(input, now = new Date().toISOString()) {
  const type = input.type === ENTRY_TYPE.SETTLEMENT ? ENTRY_TYPE.SETTLEMENT : ENTRY_TYPE.EXPENSE
  return {
    id: input.id || crypto.randomUUID(),
    type,
    date: input.date ?? '',
    payer: input.payer === PERSON.P2 ? PERSON.P2 : PERSON.P1,
    amountCents: input.amountCents ?? 0,
    currency: input.currency || 'USD',
    category: input.category ?? '',
    description: input.description ?? '',
    payerShare:
      input.payerShare == null
        ? type === ENTRY_TYPE.SETTLEMENT
          ? 0
          : EVEN_SHARE
        : // Coerced here so a form input handing over '0.5' becomes a real
          // number before it can reach validation or the balance math.
          Number(input.payerShare),
    createdAt: input.createdAt || now,
    updatedAt: now,
    deletedAt: input.deletedAt ?? null,
    rowNumber: input.rowNumber,
  }
}

/**
 * Validation failure codes. These, not the English sentences, are the stable
 * contract: `useLedger` attaches one to the thrown error as `i18nKey` so the UI
 * can translate it, and `validateEntry` maps them back to English for callers
 * (and tests) that want a readable string.
 */
export const ENTRY_ERROR = {
  MISSING_ID: 'missingId',
  BAD_DATE: 'badDate',
  BAD_AMOUNT: 'badAmount',
  BAD_PAYER: 'badPayer',
  BAD_SHARE: 'badShare',
  MISSING_CATEGORY: 'missingCategory',
}

const EN_ENTRY_ERRORS = {
  missingId: 'Missing id.',
  badDate: 'Date must be a real day, as YYYY-MM-DD.',
  badAmount: 'Amount must be greater than zero.',
  badPayer: 'Payer must be one of the two people.',
  badShare: 'Split must be between 0 and 100%.',
  missingCategory: 'Pick a category.',
}

/** @returns {string[]} failure codes from ENTRY_ERROR; empty means valid. */
export function validateEntryCodes(entry) {
  const errors = []
  if (!entry.id) errors.push(ENTRY_ERROR.MISSING_ID)
  if (!isRealDate(entry.date)) errors.push(ENTRY_ERROR.BAD_DATE)
  if (!Number.isInteger(entry.amountCents) || entry.amountCents <= 0) {
    errors.push(ENTRY_ERROR.BAD_AMOUNT)
  }
  if (entry.payer !== PERSON.P1 && entry.payer !== PERSON.P2) {
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

/** @returns {string[]} human-readable English problems; empty means valid. */
export function validateEntry(entry) {
  return validateEntryCodes(entry).map((code) => EN_ENTRY_ERRORS[code])
}

export function isActive(entry) {
  return Boolean(entry) && !entry.deletedAt
}
