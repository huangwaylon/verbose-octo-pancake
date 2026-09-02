/**
 * The entry fixtures every suite needs, and the raw sheet row they map to.
 *
 * One builder rather than one per file: a builder that forgets an id reintroduces
 * `crypto.randomUUID` into a fixture, and a row written out as a positional array
 * silently mis-maps every cell the moment a column list gains an entry.
 *
 * What is NOT centralised is deliberate: a test whose amounts, shares or dates are what it
 * asserts about passes them in. The defaults here are only what has to exist for an entry
 * to be valid at all.
 */

import {
  ENTRY_TYPE,
  EVEN_SHARE,
  PERSON,
  SETTLEMENTS,
  expenseTab,
  makeEntry,
} from '../../src/schema.js'

/**
 * The tombstone stamp `tombstone()` uses — a real ISO stamp rather than any non-empty
 * marker, because `reconcileById` breaks a tombstone-vs-tombstone tie by comparing it.
 */
export const DELETED_AT = '2026-08-06T00:00:00.000Z'

/**
 * A complete, valid expense with no randomness in it.
 *
 * @param {object} [over] any entry field
 */
export function expense(over = {}) {
  return makeEntry({
    id: 'e1',
    type: ENTRY_TYPE.EXPENSE,
    date: '2026-08-05',
    payer: PERSON.P1,
    // Whole yen, so a fixture's amount and its sheet string are the same digits.
    amountYen: 1250,
    category: 'Groceries',
    payerShare: EVEN_SHARE,
    ...over,
  })
}

/**
 * A settlement: no category, and no share of its own.
 *
 * `payerShare` is deliberately NOT set here. `makeEntry` derives 0 from the type, and that
 * is what the app relies on — a fixture that stated it would turn every
 * `payerShare === 0` assertion downstream into an assertion about this file.
 */
export function settlement(over = {}) {
  return expense({ type: ENTRY_TYPE.SETTLEMENT, category: '', payerShare: null, ...over })
}

/** A soft-deleted expense. `deletedAt` is the only thing that makes it one. */
export function tombstone(over = {}) {
  return expense({ deletedAt: DELETED_AT, ...over })
}

/**
 * A raw sheet row for a tab, built from that tab's own column list by field NAME.
 *
 * Never a positional literal: every range and letter in `schema.js` comes from array
 * position, so a fixture written out as N cells in order goes on passing while each of its
 * values lands under the neighbouring field. Taking the TAB matters as much, because there
 * are two layouts — a row built to the expenses list and read as a settlement puts
 * `category` under `payer`.
 *
 * @param {Record<string, string|number>} fields any subset of the tab's columns
 * @param {object} [tab] defaults to p1's expenses tab
 * @returns {string[]} one cell per column, blank for anything unnamed
 */
export function row(fields, tab = expenseTab(PERSON.P1)) {
  return tab.columns.map((column) => fields[column] ?? '')
}

/** A raw settlement row, for the one tab whose payer is a cell. */
export function settlementRow(fields) {
  return row(fields, SETTLEMENTS)
}
