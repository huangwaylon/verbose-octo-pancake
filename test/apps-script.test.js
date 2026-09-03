import { describe, expect, it } from 'vitest'

import { EXPENSE_COLUMNS, RECURRING_COLUMNS, expenseTab, PERSON } from '../src/schema.js'
import { isYenAmount, parseAmountToYen, parseShare } from '../src/lib/money.js'
import { asFields, columnRow } from './support/entries.js'
import { loadPoster } from './support/apps-script.js'

/**
 * `postRecurring` in `apps-script/Code.gs`: the writer that runs unattended, where every failure
 * mode is silent in its own way — a second rent row, a rent that never posts in February, a date
 * the client cannot read. `test/schema.test.js` pins the column lists; this file is about what the
 * rows ARE, and the source is `new Function`'d so a syntax error fails every case here.
 */

const P1 = expenseTab(PERSON.P1)
const P2 = expenseTab(PERSON.P2)

const template = (fields) => columnRow(fields, RECURRING_COLUMNS)

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
const poster = ({ recurring = [], p1 = [], p2 = [], config = null } = {}) =>
  loadPoster({
    tabs: {
      expenses_p1: { header: EXPENSE_COLUMNS, rows: p1 },
      expenses_p2: { header: EXPENSE_COLUMNS, rows: p2 },
      recurring: { header: RECURRING_COLUMNS, rows: recurring },
      // The config header is data to `defaultShares`: no key matches 'key', as `parseConfigRows`.
      ...(config ? { config: { header: ['key', 'value'], rows: config } } : {}),
    },
  })

/** An expenses row, by field name, exactly as `entryToRow` would build it. */
const expenseRow = (fields) => columnRow(fields, EXPENSE_COLUMNS)

/** One appended row as a field map, so an assertion names the column it means. */
const appendedAt = (sheet, index = 0) => asFields(sheet.appended[index].values, EXPENSE_COLUMNS)

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
   * `setValues` coerces like the `USER_ENTERED` the schema contract forbids: '2026-09-27' becomes
   * a date serial that reads back in the spreadsheet's locale, which `rowToEntry` rejects and
   * `loadAll` reports as `undatedRows`. A description starting with '=' becomes a formula.
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

  it('reads the amount and the share the way the app does, or refuses the row', () => {
    // ONE table through BOTH readings, which is the only thing that can see them drift: a
    // disagreement either posts a figure the app never read, or skips a cost the page calls due.
    const AMOUNTS = ['220,000', '8000.4', '¥220,000', '42,10', '1.234,56', '2,20,000', '1250.5']

    for (const amount of AMOUNTS) {
      const app = poster({ recurring: [template({ ...RENT, amount })] })
      app.postRecurringFor('2026-09', 27)

      const yen = parseAmountToYen(amount)
      const appended = app.sheets.expenses_p1.appended
      // The app refusing it is the poster skipping it: never a write of its own reading.
      expect(
        appended.map(() => 'wrote'),
        amount,
      ).toEqual(isYenAmount(yen) ? ['wrote'] : [])
      if (isYenAmount(yen)) expect(appendedAt(app.sheets.expenses_p1).amount, amount).toBe(`${yen}`)
    }
  })

  it('resolves a share the way the app does, or refuses the row', () => {
    const SHARES = ['80', '0.5', '80%', '150', '0,5', 'half', '60%']

    for (const payer_share of SHARES) {
      const app = poster({ recurring: [template({ ...RENT, payer_share })] })
      app.postRecurringFor('2026-09', 27)

      const share = parseShare(payer_share)
      const appended = app.sheets.expenses_p1.appended
      expect(
        appended.map(() => 'wrote'),
        payer_share,
      ).toEqual(share == null ? [] : ['wrote'])
      if (share != null) {
        expect(appendedAt(app.sheets.expenses_p1).payer_share, payer_share).toBe(`${share}`)
      }
    }
  })

  it('reads a default_split config cell the way the app does', () => {
    // Blank share, so the config tab decides — a reading unlike the app's splits one cost twice.
    const app = poster({
      recurring: [template({ ...RENT, payer_share: '' })],
      config: [['default_split_p1', '60%']],
    })

    app.postRecurringFor('2026-09', 27)

    expect(appendedAt(app.sheets.expenses_p1).payer_share).toBe(`${parseShare('60%')}`)
  })
})

describe('what it refuses to write', () => {
  /**
   * The ONE thing that cannot post itself: a blank amount is recurring-but-variable, with no
   * figure to write. Everything else posts — a blank share included, the form's default state.
   */
  it('skips a template with no amount, because there is nothing to write', () => {
    const app = poster({ recurring: [template({ ...RENT, amount: '' }), template(GYM)] })

    expect(app.postRecurringFor('2026-09', 27)).toBe(1)
    expect(app.sheets.expenses_p1.appended).toHaveLength(0)
    expect(appendedAt(app.sheets.expenses_p2).id).toBe('gym#2026-09')
  })

  /**
   * Skipped rather than thrown on: one typo in a gym row must not stop rent posting for the
   * month. The client counts and reports the same rows.
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

  /**
   * A NON-INTEGER day gets through every gate: `Number` reads it, a `>= 1 && <= 31` bound accepts
   * it, `clampDay` leaves it alone and `pad2` writes `2026-09-27.5`. The client refuses such a row
   * outright, so what lands is an expense in the balance belonging to no month, reported as
   * `undatedRows` a screen away from the `undecodedTemplates` notice naming its cause.
   *
   * Day 28, not 27: at 27 `day > dayOfMonth` skips the row for the wrong reason, so a case there
   * passes whether the bug is fixed or not.
   */
  it('refuses a non-integer day rather than writing a date with a fraction in it', () => {
    const app = poster({ recurring: [template({ ...GYM, day_of_month: '27.5' })] })

    expect(app.postRecurringFor('2026-09', 28)).toBe(0)
    expect(app.sheets.expenses_p2.appended).toEqual([])
  })

  it('does not post before the day has come', () => {
    const app = poster({ recurring: [template(RENT)] })

    expect(app.postRecurringFor('2026-09', 26)).toBe(0)
    expect(app.postRecurringFor('2026-09', 27)).toBe(1)
  })

  /**
   * The day is CLAMPED before the comparison, not just before the date is stamped. Unclamped,
   * `31 > 28` is never satisfied in February and a cost dated the 31st skips it every year.
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

/**
 * A blank `payer_share` means "follow that payer's `default_split`", and resolving it is the
 * poster's job: the Split control starts on Default, so refusing a blank cell would leave the
 * most likely cost anyone sets up never posting.
 */
describe('a blank share follows the payer’s default', () => {
  const CONFIG = [
    ['default_split_p1', '80'],
    ['default_split_p2', '20'],
  ]

  it('reads the config tab, taking a percentage above 1 as a percentage', () => {
    const app = poster({
      recurring: [template({ ...RENT, payer_share: '' }), template({ ...GYM, payer_share: '' })],
      config: CONFIG,
    })

    expect(app.postRecurringFor('2026-09', 27)).toBe(2)
    expect(appendedAt(app.sheets.expenses_p1).payer_share).toBe('0.8')
    // The PAYER's own key, not one household number: 80/20 has to not invert when p2 pays.
    expect(appendedAt(app.sheets.expenses_p2).payer_share).toBe('0.2')
  })

  it('reads a fraction as a fraction', () => {
    const app = poster({
      recurring: [template({ ...RENT, payer_share: '' })],
      config: [['default_split_p1', '0.7']],
    })

    app.postRecurringFor('2026-09', 27)
    expect(appendedAt(app.sheets.expenses_p1).payer_share).toBe('0.7')
  })

  it('takes the FIRST usable value for a key, like the app does', () => {
    // A row added at the top with the old one left below: last-wins runs every rent at 50/50.
    const app = poster({
      recurring: [template({ ...RENT, payer_share: '' })],
      config: [
        ['default_split_p1', '80'],
        ['default_split_p1', '50'],
      ],
    })

    app.postRecurringFor('2026-09', 27)
    expect(appendedAt(app.sheets.expenses_p1).payer_share).toBe('0.8')
  })

  it('falls back to an even split when the tab is missing or says nothing usable', () => {
    for (const config of [null, [['default_split_p1', 'half']], [['note_presets', 'Life']]]) {
      const app = poster({ recurring: [template({ ...RENT, payer_share: '' })], config })
      app.postRecurringFor('2026-09', 27)
      expect(appendedAt(app.sheets.expenses_p1).payer_share).toBe('0.5')
    }
  })

  it('leaves an explicit share alone, whatever the config says', () => {
    // 30, not RENT's own 80, which would collide with the config value and prove nothing.
    const app = poster({
      recurring: [template({ ...RENT, payer_share: '30' })],
      config: CONFIG,
    })

    app.postRecurringFor('2026-09', 27)
    expect(appendedAt(app.sheets.expenses_p1).payer_share).toBe('0.3')
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
   * TRAP 1, which every other consumer here gets the other way round, filtering through
   * `isActive`: skipping tombstones re-posts a deliberately deleted rent every day of the month.
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
   * TRAP 2. Editing an instance's payer MOVES the row to the other tab, so a scan of the payer's
   * own tab finds nothing and posts a second copy — double-counting the cost until a compact.
   */
  it('scans BOTH expense tabs, so a moved instance is still handled', () => {
    const app = poster({
      recurring: [template(RENT)],
      p2: [expenseRow({ id: 'rent#2026-09', amount: '220000' })],
    })

    expect(app.postRecurringFor('2026-09', 27)).toBe(0)
  })

  /**
   * TRAP 3, which needs no history at all — both rows post in the SAME run. `readHandledIds` is
   * read once before the loop, so the handled set has to grow as rows land or two templates
   * sharing an id both write `<id>#<month>`. The client keeps the FIRST row per id, so the
   * second one's money sits in the sheet invisible to the balance, past every compact.
   */
  it('posts a duplicated id once, not once per row', () => {
    const app = poster({
      recurring: [template(RENT), template({ ...RENT, description: 'Parking', amount: '15000' })],
    })

    expect(app.postRecurringFor('2026-09', 27)).toBe(1)
    expect(app.sheets.expenses_p1.appended).toHaveLength(1)
    // The FIRST row wins, exactly as `reconcileTemplates` keeps the first template.
    expect(appendedAt(app.sheets.expenses_p1).description).toBe('Rent')
  })

  it('does not confuse one month’s instance for another’s', () => {
    const app = poster({
      recurring: [template(RENT)],
      p1: [expenseRow({ id: 'rent#2026-08', amount: '220000' })],
    })

    expect(app.postRecurringFor('2026-09', 27)).toBe(1)
  })

  it('reads the id from the column the schema puts it in', () => {
    // The first column instead would find the date on every row, match nothing, and post daily.
    const app = poster({
      recurring: [template(RENT)],
      p1: [expenseRow({ id: 'rent#2026-09', date: '2026-09-27', amount: '220000' })],
    })
    expect(app.postRecurringFor('2026-09', 27)).toBe(0)
  })
})

describe('whose month it is', () => {
  /**
   * TRAP 3. `new Date()` is UTC underneath, so on a script defaulting to a US zone a 03:00 JST run
   * on the 1st computes the PREVIOUS month and files September's rent as August's. The date comes
   * from `Utilities.formatDate` in the script's zone — the only thing the fake answers for.
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
        expenses_p1: { header: EXPENSE_COLUMNS, rows: [] },
        expenses_p2: { header: EXPENSE_COLUMNS, rows: [] },
      },
    })

    expect(app.postRecurringFor('2026-09', 27)).toBe(0)
  })

  it('does not fabricate a tab for a payer whose tab is missing', () => {
    const app = loadPoster({
      tabs: {
        expenses_p1: { header: EXPENSE_COLUMNS, rows: [] },
        recurring: { header: RECURRING_COLUMNS, rows: [template(GYM)] },
      },
    })

    // GYM pays from p2, whose tab is gone, so there is nowhere to write. Counted as NOT posted:
    // that number is a manual run's only signal, and the assertion has to name p2 — checking p1
    // would pass for a poster that wrote nowhere. Not thrown on: a restored tab works next run.
    expect(app.postRecurringFor('2026-09', 27)).toBe(0)
    expect(app.asked).toContain(P2.title)
    expect(app.sheets.expenses_p1.appended).toHaveLength(0)
  })

  it('asks for exactly the four tabs it needs, and nothing else', () => {
    // The harness records the ASK: `Object.keys(app.sheets)` would read back the test's own tabs.
    const app = poster({ recurring: [template(RENT)], config: [['default_split_p1', '80']] })
    app.postRecurringFor('2026-09', 27)
    expect([...new Set(app.asked)].sort()).toEqual(
      [P1.title, P2.title, 'config', 'recurring'].sort(),
    )
  })
})
