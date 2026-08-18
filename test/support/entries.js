/**
 * The entry fixtures every suite needs, and the raw sheet row they map to.
 *
 * Five files had a near-identical builder around `makeEntry`, and a sixth wrote its
 * rows out as positional arrays. Both duplications were dangerous rather than merely
 * untidy: a builder that forgets `now` reintroduces `crypto.randomUUID` and a clock
 * into a fixture, and a positional row array silently mis-maps every cell the moment
 * `EXPENSE_COLUMNS` gains an entry.
 *
 * What is NOT centralised is deliberate: a test whose amounts, shares or dates are
 * what it asserts about passes them in. The defaults here are only what has to exist
 * for an entry to be valid at all — everything a test is about stays at the call site,
 * where it can be read next to the expectation.
 */

import { ENTRY_TYPE, EVEN_SHARE, EXPENSE_COLUMNS, PERSON, makeEntry } from '../../src/schema.js'

/**
 * One fixed timestamp for every entry unless a test says otherwise, passed as
 * `makeEntry`'s `now`. Never the real clock: `createdAt` decides `groupByDate`'s
 * within-a-day order, so a fixture built from `Date.now()` orders itself by how
 * fast the machine ran.
 */
export const FIXED_NOW = '2026-08-05T10:00:00.000Z'

/** The tombstone stamp `tombstone()` uses: later than FIXED_NOW, as a real one is. */
export const DELETED_AT = '2026-08-06T00:00:00.000Z'

/**
 * A complete, valid expense with no randomness in it.
 *
 * `now` is lifted out of the overrides rather than being a second parameter, so a
 * caller that needs a different clock reads the same as one that needs a different
 * amount.
 *
 * @param {object} [over] any entry field, plus `now`
 */
export function expense(over = {}) {
  const { now = FIXED_NOW, ...fields } = over
  return makeEntry(
    {
      id: 'e1',
      type: ENTRY_TYPE.EXPENSE,
      date: '2026-08-05',
      payer: PERSON.P1,
      // JPY at whole-yen scale, so a fixture's amount and its sheet string are the
      // same digits. Tests about the two-decimal scale pass USD.
      amountCents: 1250,
      currency: 'JPY',
      category: 'Groceries',
      payerShare: EVEN_SHARE,
      ...fields,
    },
    now,
  )
}

/**
 * A settlement: no category, and no share of its own.
 *
 * `payerShare` is deliberately NOT set here. `makeEntry` derives 0 from the type, and
 * that is what the app relies on — a fixture that stated it would turn every
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
 * A raw sheet row, built from `EXPENSE_COLUMNS` by field NAME.
 *
 * Never a positional literal: every range and letter in `schema.js` comes from array
 * position, so a fixture written out as eleven cells in order goes on passing while
 * each of its values lands under the neighbouring field.
 *
 * @param {Record<string, string|number>} fields any subset of EXPENSE_COLUMNS
 * @returns {string[]} one cell per column, blank for anything unnamed
 */
export function row(fields) {
  return EXPENSE_COLUMNS.map((column) => fields[column] ?? '')
}
