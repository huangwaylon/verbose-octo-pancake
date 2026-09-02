import { describe, expect, it } from 'vitest'

import { EXPENSE_COLUMNS, RECURRING_COLUMNS, expenseTab, PERSON } from '../src/schema.js'
import { loadPoster } from './support/apps-script.js'

/**
 * `postRecurring` in `apps-script/Code.gs`: the writer that runs unattended.
 *
 * Everything here is a write into somebody's ledger with nobody watching, and every failure
 * mode is silent in a different way — a second rent row, a rent that never posts in February,
 * a date the client then cannot read. `test/schema.test.js` pins the column lists this file
 * builds rows from; this file is about what the rows ARE.
 *
 * The source is `new Function`'d, so a syntax error fails every case below rather than
 * surfacing at 3am in an execution log nobody is reading.
 */

const P1 = expenseTab(PERSON.P1)
const P2 = expenseTab(PERSON.P2)

const template = (fields) => RECURRING_COLUMNS.map((column) => fields[column] ?? '')

const RENT = {
  id: 'rent',
  description: 'Rent',
  amount: '220000',
  category: 'Rent',
  payer: 'p1',
  payer_share: '80',
  day_of_month: '27',
}

const GYM = {
  id: 'gym',
  description: 'Gym',
  amount: '8000',
  category: 'Gym',
  payer: 'p2',
  payer_share: '0.5',
  day_of_month: '1',
}

/** A ledger with the given recurring rows and, optionally, rows already in a tab. */
const poster = ({ recurring = [], p1 = [], p2 = [] } = {}) =>
  loadPoster({
    tabs: {
      expenses_p1: { rows: p1 },
      expenses_p2: { rows: p2 },
      recurring: { rows: recurring },
    },
  })

/** An expenses row, by field name, exactly as `entryToRow` would build it. */
const expenseRow = (fields) => EXPENSE_COLUMNS.map((column) => fields[column] ?? '')

/** One appended row as a field map, so an assertion names the column it means. */
const appendedAt = (sheet, index = 0) =>
  Object.fromEntries(
    EXPENSE_COLUMNS.map((column, at) => [column, sheet.appended[index].values[at]]),
  )

describe('what it writes', () => {
  it('appends one instance to the payer’s own tab, at the schema’s column order', () => {
    const app = poster({ recurring: [template(RENT)] })

    expect(app.postRecurringFor('2026-09', 27)).toBe(1)
    expect(app.sheets.expenses_p2.appended).toHaveLength(0)
    expect(appendedAt(app.sheets.expenses_p1)).toEqual({
      date: '2026-09-27',
      description: 'Rent',
      amount: '220000',
      category: 'Rent',
      payer_share: '0.8',
      deleted_at: '',
      id: 'rent#2026-09',
    })
  })

  it('sends each template to its own payer’s tab', () => {
    const app = poster({ recurring: [template(RENT), template(GYM)] })

    expect(app.postRecurringFor('2026-09', 27)).toBe(2)
    expect(appendedAt(app.sheets.expenses_p1).id).toBe('rent#2026-09')
    expect(appendedAt(app.sheets.expenses_p2).id).toBe('gym#2026-09')
  })

  /**
   * `setValues` coerces like the `USER_ENTERED` the schema contract forbids: '2026-09-27'
   * becomes a date serial that reads back in the spreadsheet's own locale as '9/27/2026',
   * which `rowToEntry` rejects and `loadAll` reports as `undatedRows`. A description
   * starting with '=' becomes a formula.
   */
  it('formats the range as text before it writes, not after', () => {
    const app = poster({ recurring: [template({ ...RENT, description: '=SUM(A:A)' })] })

    app.postRecurringFor('2026-09', 27)

    expect(app.sheets.expenses_p1.appended[0].textFormatted).toBe(true)
    expect(appendedAt(app.sheets.expenses_p1).description).toBe('=SUM(A:A)')
  })

  it('writes below whatever the tab already holds', () => {
    const app = poster({
      recurring: [template(RENT)],
      p1: [expenseRow({ id: 'a', amount: '100' }), expenseRow({ id: 'b', amount: '200' })],
    })

    app.postRecurringFor('2026-09', 27)

    // Sheet row 4: header, two existing rows, then this one.
    expect(app.sheets.expenses_p1.appended[0].row).toBe(4)
  })

  it('reads the amount the way the app does, commas and trailing decimals included', () => {
    const app = poster({
      recurring: [template({ ...RENT, amount: '220,000' }), template({ ...GYM, amount: '8000.4' })],
    })

    app.postRecurringFor('2026-09', 27)

    expect(appendedAt(app.sheets.expenses_p1).amount).toBe('220000')
    expect(appendedAt(app.sheets.expenses_p2).amount).toBe('8000')
  })
})

describe('what it refuses to write', () => {
  /**
   * The poster's own rule, and the reason it is stricter than the client's decoder: **it only
   * posts a template that spells out BOTH its amount and its share.** A blank amount is a
   * variable cost with nothing to write; a blank share means "the payer's default", which
   * lives in the config tab, and resolving it here would put a fourth copy of the
   * percentage-versus-fraction rule in the repo — one that splits every rent 50/50 if it is
   * wrong. Both belong to the card, where a person confirms the figure.
   */
  it('skips a template with no amount, and one with no share', () => {
    const app = poster({
      recurring: [
        template({ ...RENT, amount: '' }),
        template({ ...GYM, payer_share: '' }),
        template(RENT),
      ],
    })

    expect(app.postRecurringFor('2026-09', 27)).toBe(1)
    expect(app.sheets.expenses_p2.appended).toHaveLength(0)
  })

  /**
   * Skipped rather than thrown on, unlike an unexpected failure: one typo in a gym row must
   * not stop rent posting for the month. The client counts and reports the same rows.
   */
  it('skips a row it cannot read without taking the good ones down with it', () => {
    const app = poster({
      recurring: [
        template({ ...GYM, id: '' }),
        template({ ...GYM, payer: 'Waylon' }),
        template({ ...GYM, amount: 'about ten' }),
        template({ ...GYM, payer_share: 'half' }),
        template({ ...GYM, day_of_month: 'last' }),
        template({ ...GYM, months: '13' }),
        template({ ...GYM, active_to: 'next year' }),
        [],
        template(RENT),
      ],
    })

    expect(app.postRecurringFor('2026-09', 27)).toBe(1)
    expect(appendedAt(app.sheets.expenses_p1).id).toBe('rent#2026-09')
  })

  it('does not post before the day has come', () => {
    const app = poster({ recurring: [template(RENT)] })

    expect(app.postRecurringFor('2026-09', 26)).toBe(0)
    expect(app.postRecurringFor('2026-09', 27)).toBe(1)
  })

  /**
   * Trap 4, the half that is easy to miss: the day is CLAMPED before the comparison, not just
   * before the date is stamped. Left unclamped, `31 > 28` is never satisfied in February and a
   * monthly cost dated the 31st silently skips that month every single year.
   */
  it('posts a 31st on the last day of a short month, and dates it there', () => {
    const app = poster({ recurring: [template({ ...RENT, day_of_month: '31' })] })

    expect(app.postRecurringFor('2026-02', 28)).toBe(1)
    expect(appendedAt(app.sheets.expenses_p1).date).toBe('2026-02-28')
  })

  it('honours the active window, as month keys', () => {
    const app = poster({
      recurring: [
        template({ ...RENT, id: 'future', active_from: '2026-10' }),
        template({ ...RENT, id: 'ended', active_to: '2026-08' }),
      ],
    })

    expect(app.postRecurringFor('2026-09', 28)).toBe(0)
    expect(app.postRecurringFor('2026-08', 28)).toBe(1)
    expect(appendedAt(app.sheets.expenses_p1).id).toBe('ended#2026-08')
  })

  it('honours the months list, which is how annual and quarterly are spelled', () => {
    const app = poster({ recurring: [template({ ...RENT, id: 'tax', months: '1,7' })] })

    expect(app.postRecurringFor('2026-09', 28)).toBe(0)
    expect(app.postRecurringFor('2026-07', 28)).toBe(1)
    expect(appendedAt(app.sheets.expenses_p1).id).toBe('tax#2026-07')
  })
})

describe('already recorded', () => {
  it('is a no-op on a second run, which is what makes a daily trigger safe', () => {
    const app = poster({ recurring: [template(RENT), template(GYM)] })

    expect(app.postRecurringFor('2026-09', 27)).toBe(2)
    expect(app.postRecurringFor('2026-09', 27)).toBe(0)
    expect(app.postRecurringFor('2026-09', 28)).toBe(0)
    expect(app.sheets.expenses_p1.appended).toHaveLength(1)
  })

  /**
   * TRAP 1, and the one every other consumer in this codebase gets the other way round:
   * everything in the client filters through `isActive`. Soft-delete this month's rent
   * because it was double-charged and a scan that skipped tombstones re-posts it tomorrow,
   * and the day after, for the rest of the month.
   */
  it('treats a TOMBSTONED instance as handled', () => {
    const app = poster({
      recurring: [template(RENT)],
      p1: [
        expenseRow({ id: 'rent#2026-09', amount: '220000', deleted_at: '2026-09-27T00:00:00Z' }),
      ],
    })

    expect(app.postRecurringFor('2026-09', 27)).toBe(0)
    expect(app.sheets.expenses_p1.appended).toHaveLength(0)
  })

  /**
   * TRAP 2. Editing an instance's payer MOVES the row to the other tab, so a scan of the
   * payer's own tab finds nothing and posts a second copy while the first sits under the
   * other person — double-counting the cost in the balance until a compact runs.
   */
  it('scans BOTH expense tabs, so a moved instance is still handled', () => {
    const app = poster({
      recurring: [template(RENT)],
      p2: [expenseRow({ id: 'rent#2026-09', amount: '220000' })],
    })

    expect(app.postRecurringFor('2026-09', 27)).toBe(0)
  })

  it('does not confuse one month’s instance for another’s', () => {
    const app = poster({
      recurring: [template(RENT)],
      p1: [expenseRow({ id: 'rent#2026-08', amount: '220000' })],
    })

    expect(app.postRecurringFor('2026-09', 27)).toBe(1)
  })

  it('reads the id from the column the schema puts it in', () => {
    // The id is LAST in an expense row. Reading the first column instead would find the
    // date on every row, match nothing, and post a duplicate every single day.
    expect(EXPENSE_COLUMNS.indexOf('id')).toBe(6)
    const app = poster({
      recurring: [template(RENT)],
      p1: [expenseRow({ id: 'rent#2026-09', date: '2026-09-27', amount: '220000' })],
    })
    expect(app.postRecurringFor('2026-09', 27)).toBe(0)
  })
})

describe('whose month it is', () => {
  /**
   * TRAP 3. `new Date()` is UTC underneath, so on a script defaulting to a US zone a 03:00
   * JST run on the 1st computes the PREVIOUS month and files September's rent as August's.
   * The date has to come from `Utilities.formatDate` in the script's own zone — which is what
   * the fake here only answers for, so a `new Date().getMonth()` would produce `undefined`.
   */
  it('derives the month and day from the script’s own formatted date', () => {
    const app = poster({ recurring: [template({ ...RENT, day_of_month: '1' })] })
    app.setToday('2026-09-01')

    app.postRecurring()

    expect(appendedAt(app.sheets.expenses_p1)).toMatchObject({
      date: '2026-09-01',
      id: 'rent#2026-09',
    })
  })

  it('does nothing on a day before the first due date of the month', () => {
    const app = poster({ recurring: [template(RENT)] })
    app.setToday('2026-09-26')

    app.postRecurring()

    expect(app.sheets.expenses_p1.appended).toHaveLength(0)
  })
})

describe('a ledger the poster cannot use', () => {
  it('does nothing at all when there is no recurring tab', () => {
    const app = loadPoster({
      tabs: {
        expenses_p1: { rows: [] },
        expenses_p2: { rows: [] },
      },
    })

    expect(app.postRecurringFor('2026-09', 27)).toBe(0)
  })

  it('does not fabricate a tab for a payer whose tab is missing', () => {
    const app = loadPoster({
      tabs: {
        expenses_p1: { rows: [] },
        recurring: { rows: [template(GYM)] },
      },
    })

    // p2's tab is gone, so there is nowhere to write. Reported as posted-and-skipped
    // rather than throwing: the next run will find the tab if somebody restores it.
    app.postRecurringFor('2026-09', 27)
    expect(app.sheets.expenses_p1.appended).toHaveLength(0)
  })

  // Named after what it asserts: both titles come from `schema.js` via schema.test.js's pin,
  // so this only proves the poster asks for them and nothing else.
  it('touches no tab beyond the two expenses tabs and recurring', () => {
    const app = poster({ recurring: [template(RENT)] })
    app.postRecurringFor('2026-09', 27)
    expect(Object.keys(app.sheets).sort()).toEqual([P1.title, P2.title, 'recurring'].sort())
  })
})
