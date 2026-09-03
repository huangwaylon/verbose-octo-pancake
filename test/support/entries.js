/**
 * The entry fixtures every suite needs, and the raw sheet row they map to.
 *
 * One builder rather than one per file: a builder that forgets an id reintroduces
 * `crypto.randomUUID` into a fixture, and a row written out as a positional array silently
 * mis-maps every cell the moment a column list gains an entry. The defaults are only what
 * an entry needs to be valid at all — a test passes in whatever it asserts about.
 */

import {
  ENTRY_TYPE,
  EVEN_SHARE,
  PERSON,
  RECURRING,
  SETTLEMENTS,
  expenseTab,
  makeEntry,
} from '../../src/schema.js'
import { DEFAULT_CONFIG } from '../../src/config.js'

/**
 * The tombstone stamp `tombstone()` uses — a real ISO stamp rather than any non-empty
 * marker, because `reconcileById` breaks a tombstone-vs-tombstone tie by comparing it.
 */
export const DELETED_AT = '2026-08-06T00:00:00.000Z'

/** A complete, valid expense with no randomness in it. */
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
 * `payerShare` is deliberately NOT set. `makeEntry` derives 0 from the type, and stating it
 * here would turn every `payerShare === 0` assertion downstream into an assertion about
 * this file.
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
 */
export function row(fields, tab = expenseTab(PERSON.P1)) {
  return columnRow(fields, tab.columns)
}

/** The same, for the two consumers that hold a column LIST rather than a tab. */
export function columnRow(fields, columns) {
  return columns.map((column) => fields[column] ?? '')
}

/** A raw settlement row, for the one tab whose payer is a cell. */
export function settlementRow(fields) {
  return row(fields, SETTLEMENTS)
}

/** A raw `recurring` row, for the tab whose whole content is hand-authored. */
export function templateRow(fields) {
  return row(fields, RECURRING)
}

/**
 * A row read back as a field map, so an assertion names the column it means rather than an
 * index. The inverse of `row`, and why a positional expectation never appears in a test.
 */
export function asFields(cells, columns) {
  return Object.fromEntries(columns.map((column, at) => [column, cells[at]]))
}

/**
 * The config every render test renders against, and the no-op every handler takes.
 *
 * Shared because two suites asserting against two different category lists would let a
 * component pass in one and fail in the other for reasons neither test names.
 * `scripts/preview.jsx` keeps its own on purpose — it is a visual harness with real names.
 */
export const config = {
  ...DEFAULT_CONFIG,
  person1Name: 'Alex',
  person2Name: 'Sam',
  categories: ['Groceries', 'Dining', 'Household'],
}

export const noop = () => {}
