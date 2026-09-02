import { describe, expect, it } from 'vitest'

import { PERSON, RECURRING, rowToTemplate, templateToRow } from '../src/schema.js'
import {
  TEMPLATE_ERROR,
  templateFormProblem,
  entryFromTemplate,
  makeTemplate,
  recurringRows,
  restoredTemplate,
  retiredTemplate,
  reconcileTemplates,
  validateTemplateCodes,
} from '../src/lib/recurring.js'
import { expense, templateRow as row, tombstone } from './support/entries.js'

/** What a month says about each recurring declaration, and what a form may refuse. */

/** The rent template every case below varies. */
const rent = (fields) =>
  row({
    id: 'rent',
    description: 'Rent',
    amount: '220000',
    category: 'Rent',
    payer: 'p1',
    ...fields,
  })

describe('rowToTemplate', () => {
  it('reads a full row', () => {
    expect(
      rowToTemplate(
        rent({ payer_share: '80', months: '1, 7', day_of_month: '27', active_from: '2026-04' }),
      ),
    ).toEqual({
      id: 'rent',
      description: 'Rent',
      amountYen: 220000,
      category: 'Rent',
      payer: PERSON.P1,
      payerShare: 0.8,
      months: [1, 7],
      dayOfMonth: 27,
      activeFrom: '2026-04',
      activeTo: null,
    })
  })

  it('returns null for a blank or unusable row rather than a half-template', () => {
    expect(rowToTemplate([])).toBeNull()
    expect(rowToTemplate(null)).toBeNull()
    expect(rowToTemplate('not a row')).toBeNull()
    // No id means no instance id, so nothing could tell whether it had been posted.
    expect(rowToTemplate(rent({ id: '' }))).toBeNull()
  })

  it('refuses a payer naming neither person, whatever its case', () => {
    for (const payer of ['', 'p3', 'Waylon', 'both']) {
      expect(rowToTemplate(rent({ payer }))).toBeNull()
    }
    expect(rowToTemplate(rent({ payer: ' P2 ' })).payer).toBe(PERSON.P2)
  })

  /**
   * The rule that separates this tab from the config tab: a blank cell takes its
   * documented default, a FILLED one that cannot be read refuses the whole row. Every
   * default here either moves money or decides whether the cost is offered at all, so a
   * typo has to be counted and said out loud instead of absorbed.
   */
  describe('a filled cell it cannot read refuses the row', () => {
    it.each([
      ['amount', 'about ten'],
      ['amount', '0'],
      ['amount', '-5'],
      ['payer_share', 'half'],
      ['payer_share', '-3'],
      ['months', '13'],
      ['months', 'January'],
      ['months', '1,0'],
      ['day_of_month', '0'],
      ['day_of_month', '32'],
      ['day_of_month', '27.5'],
      ['day_of_month', 'last'],
      ['active_from', '2026-04-01'],
      ['active_to', 'next year'],
      ['active_to', '2026-13'],
    ])('%s = %s', (field, value) => {
      expect(rowToTemplate(rent({ [field]: value }))).toBeNull()
    })
  })

  /**
   * A blank share means "follow the PAYER's default". Read as EVEN_SHARE here — which is
   * what `rowToEntry` correctly does for an already-written row — every rent would split
   * 50/50 on a sheet running 80/20, on the one expense large enough for it to matter.
   */
  it('leaves a blank share null rather than defaulting it to an even split', () => {
    expect(rowToTemplate(rent({})).payerShare).toBeNull()
    expect(rowToTemplate(rent({ payer_share: '0' })).payerShare).toBe(0)
    expect(rowToTemplate(rent({ payer_share: '0.8' })).payerShare).toBe(0.8)
  })

  it('leaves a blank amount null, meaning recurring but variable', () => {
    // A utility bill: the page lists it with no figure and the form opens empty.
    expect(rowToTemplate(rent({ amount: '' })).amountYen).toBeNull()
  })

  it('defaults a blank day to the 1st and a blank months to every month', () => {
    const template = rowToTemplate(rent({}))
    expect(template.dayOfMonth).toBe(1)
    expect(template.months).toBeNull()
    expect(template.activeFrom).toBeNull()
    expect(template.activeTo).toBeNull()
  })

  it('reads a cell Sheets returned as a number rather than a string', () => {
    const template = rowToTemplate(rent({ amount: 220000, day_of_month: 27, payer_share: 80 }))
    expect(template).toMatchObject({ amountYen: 220000, dayOfMonth: 27, payerShare: 0.8 })
  })
})

describe('entryFromTemplate', () => {
  const template = rowToTemplate(rent({ day_of_month: '27', payer_share: '80' }))

  it('derives the id from the template and the month, not from what a person can edit', () => {
    // The literal, because this string IS the contract between the page, the Apps Script
    // poster and the ledger. Category plus description would post a second rent the
    // moment somebody renamed a note to 'Rent (Aug)'.
    expect(entryFromTemplate(template, '2026-09').id).toBe('rent#2026-09')
  })

  it('is the shape the form opens on', () => {
    expect(entryFromTemplate(template, '2026-09')).toEqual({
      id: 'rent#2026-09',
      type: 'expense',
      date: '2026-09-27',
      payer: PERSON.P1,
      amountYen: 220000,
      category: 'Rent',
      description: 'Rent',
      payerShare: 0.8,
    })
  })

  it('clamps the day to the month, so a 31st never rolls into the next month', () => {
    const monthly = rowToTemplate(rent({ day_of_month: '31' }))
    expect(entryFromTemplate(monthly, '2026-02').date).toBe('2026-02-28')
    expect(entryFromTemplate(monthly, '2024-02').date).toBe('2024-02-29')
    expect(entryFromTemplate(monthly, '2026-04').date).toBe('2026-04-30')
    expect(entryFromTemplate(monthly, '2026-01').date).toBe('2026-01-31')
  })

  it('opens the amount empty for a variable template, rather than at nothing owed', () => {
    const variable = rowToTemplate(rent({ amount: '', payer_share: '80' }))
    expect(entryFromTemplate(variable, '2026-09').amountYen).toBe(0)
  })
})

describe('recurringRows', () => {
  const templates = [
    rowToTemplate(rent({ day_of_month: '27', payer_share: '80' })),
    rowToTemplate(row({ id: 'gym', description: 'Gym', amount: '8000', payer: 'p2' })),
  ]
  const rowsFor = (entries, monthKey, today) => recurringRows(templates, entries, monthKey, today)
  const dueIds = (entries, monthKey, today) =>
    rowsFor(entries, monthKey, today)
      .filter((state) => state.due)
      .map((state) => state.due.id)

  it('answers for every template, in the tab’s order, whatever the month says', () => {
    // Every row, not only the due ones: a list that drops the rest cannot be edited.
    expect(rowsFor([], '2026-09', '2026-09-30').map((state) => state.template.id)).toEqual([
      'rent',
      'gym',
    ])
  })

  it('is empty only when there are no templates', () => {
    // The pure layer trusts its callers for shape — `loadAll` always hands it two arrays — and
    // says so by not guarding. What it does NOT trust is the month key, which comes from state.
    expect(recurringRows([], [], '2026-09', '2026-09-30')).toEqual([])
  })

  it('still lists every template for a month key that is not one', () => {
    // The rows are what the sheet edits, so they must not vanish with a bad month —
    // nothing is due or scheduled, which is the honest answer.
    for (const monthKey of ['', '2026-13', '2026-09-01', undefined]) {
      const rows = rowsFor([], monthKey, '2026-09-30')
      expect(rows).toHaveLength(2)
      expect(rows.every((state) => !state.due && !state.scheduled && !state.recorded)).toBe(true)
    }
  })

  it('offers what the month has no row for', () => {
    expect(dueIds([], '2026-09', '2026-09-30')).toEqual(['rent#2026-09', 'gym#2026-09'])
  })

  /**
   * The day gate and the month being looked at are ONE comparison against the instance's own
   * date. Offering the 27th's rent on the 1st would have the balance claiming 44,000 owed for
   * three weeks before the money moved.
   */
  it('does not offer a cost before its day has come, but still calls it scheduled', () => {
    const [rentRow] = rowsFor([], '2026-09', '2026-09-01')
    expect(rentRow.due).toBeNull()
    // The distinction two states could not draw: not-yet-due reads identically to already-paid
    // unless the row can tell them apart.
    expect(rentRow.scheduled).toBe(true)
    expect(rentRow.recorded).toBe(false)

    expect(dueIds([], '2026-09', '2026-09-26')).toEqual(['gym#2026-09'])
    expect(dueIds([], '2026-09', '2026-09-27')).toEqual(['rent#2026-09', 'gym#2026-09'])
  })

  it('offers every day of a past month, and nothing at all in a future one', () => {
    expect(dueIds([], '2026-08', '2026-09-02')).toEqual(['rent#2026-08', 'gym#2026-08'])
    expect(dueIds([], '2026-10', '2026-09-30')).toEqual([])
  })

  /**
   * A tombstone means the month is RECORDED — the one place in this codebase where the
   * deleted rows are the ones that count. Filtering them out instead offers the rent again
   * for the rest of the month, every time it is deliberately removed.
   */
  it('treats a recorded instance as recorded, tombstoned or not', () => {
    for (const recordedRow of [
      expense({ id: 'rent#2026-09', date: '2026-09-27' }),
      tombstone({ id: 'rent#2026-09', date: '2026-09-27' }),
    ]) {
      const [rentRow] = rowsFor([recordedRow], '2026-09', '2026-09-30')
      expect(rentRow.recorded).toBe(true)
      expect(rentRow.due).toBeNull()
    }
  })

  it('treats an optimistic row as recorded, so a second tap cannot post a duplicate', () => {
    const pending = { ...expense({ id: 'gym#2026-09' }), pending: true }
    expect(dueIds([pending], '2026-09', '2026-09-30')).toEqual(['rent#2026-09'])
  })

  it('does not count another month’s instance of the same template', () => {
    const august = expense({ id: 'rent#2026-08', date: '2026-08-27' })
    expect(dueIds([august], '2026-09', '2026-09-30')).toContain('rent#2026-09')
  })

  it('reports a retired template as not scheduled rather than dropping it', () => {
    // Retiring is `active_to`, so the row stays in the sheet and stays on the page — which
    // is what makes it restorable, and what keeps its posted months recorded.
    const retired = [rowToTemplate(rent({ active_to: '2026-08' }))]
    const [state] = recurringRows(retired, [], '2026-09', '2026-09-30')
    expect(state.scheduled).toBe(false)
    expect(state.due).toBeNull()
    expect(state.template.id).toBe('rent')
  })

  it('honours the active window as month keys', () => {
    const bounded = [rowToTemplate(rent({ active_from: '2026-04', active_to: '2026-08' }))]
    const scheduledIn = (monthKey) =>
      recurringRows(bounded, [], monthKey, '2027-01-01')[0].scheduled
    expect(scheduledIn('2026-03')).toBe(false)
    expect(scheduledIn('2026-04')).toBe(true)
    expect(scheduledIn('2026-08')).toBe(true)
    expect(scheduledIn('2026-09')).toBe(false)
  })

  it('honours the months list, which is how annual and quarterly are spelled', () => {
    const quarterly = [rowToTemplate(rent({ months: '1,4,7,10' }))]
    const scheduledIn = (monthKey) =>
      recurringRows(quarterly, [], monthKey, '2027-01-01')[0].scheduled
    expect(scheduledIn('2026-01')).toBe(true)
    expect(scheduledIn('2026-04')).toBe(true)
    expect(scheduledIn('2026-02')).toBe(false)
    expect(scheduledIn('2026-12')).toBe(false)
  })
})

describe('retiring and restoring', () => {
  const template = rowToTemplate(rent({}))

  /**
   * The whole reason there is no delete. The instance id is the only link between a
   * declaration and the rows it has already posted, so a deleted row orphans them: re-create
   * the cost under a new id and the month already paid reads as unrecorded, which is enough
   * for the unattended poster to append a second rent that night.
   */
  it('ends the template as of last month, keeping its id', () => {
    const retired = retiredTemplate(template, '2026-09')
    expect(retired.activeTo).toBe('2026-08')
    expect(retired.id).toBe(template.id)
    // Inclusive, so this month would leave it due for the rest of the month.
    expect(recurringRows([retired], [], '2026-09', '2026-09-30')[0].scheduled).toBe(false)
    expect(recurringRows([retired], [], '2026-08', '2026-09-30')[0].scheduled).toBe(true)
  })

  it('restores by clearing the window, not by minting anything', () => {
    const restored = restoredTemplate(retiredTemplate(template, '2026-09'))
    expect(restored.activeTo).toBeNull()
    expect(restored.id).toBe(template.id)
    expect(recurringRows([restored], [], '2026-09', '2026-09-30')[0].scheduled).toBe(true)
  })

  it('never mutates the template it was given', () => {
    // React state and the list on screen both hold these.
    retiredTemplate(template, '2026-09')
    expect(template.activeTo).toBeNull()
  })
})

describe('templateToRow', () => {
  const full = { ...rowToTemplate(rent({ payer_share: '80', months: '1, 7', day_of_month: '27' })) }

  it('is the exact inverse of rowToTemplate', () => {
    expect(rowToTemplate(templateToRow(full))).toEqual(full)
  })

  it('writes one string per column, never a hole or the text "null"', () => {
    // Ten is what the `A2:J` range spells. A hole leaves the cell UNTOUCHED on a RAW
    // write, so a cleared amount would keep its old figure.
    const row = templateToRow(makeTemplate({ id: 'x', payer: PERSON.P1 }))
    expect(row).toHaveLength(10)
    for (const cell of row) expect(typeof cell).toBe('string')
    expect(row.every((cell) => cell !== 'null' && cell !== 'undefined')).toBe(true)
  })

  /**
   * Blank is a VALUE in two columns and it has to survive the round trip: a blank amount
   * means variable, a blank share means "follow the payer's default" — and a blank share
   * is also what makes the Apps Script poster skip the row.
   */
  it('writes a null amount and a null share as blank, not as zero', () => {
    const variable = makeTemplate({ id: 'x', payer: PERSON.P1, description: 'Gas' })
    const row = templateToRow(variable)
    expect(row[RECURRING.index('amount')]).toBe('')
    expect(row[RECURRING.index('payer_share')]).toBe('')
    expect(rowToTemplate(row)).toMatchObject({ amountYen: null, payerShare: null })
  })

  it('keeps a zero share, which is not the same as a blank one', () => {
    // payer_share 0 means the other person owes all of it. Folded into blank it would
    // become the payer's default instead — money, silently.
    const row = templateToRow(makeTemplate({ id: 'x', payer: PERSON.P1, payerShare: 0 }))
    expect(row[RECURRING.index('payer_share')]).toBe('0')
    expect(rowToTemplate(row).payerShare).toBe(0)
  })

  it('round-trips the three columns the form does not edit', () => {
    // The form writes the whole row, so a quarterly template edited through it must come
    // back quarterly rather than monthly.
    const scheduled = rowToTemplate(
      rent({ payer_share: '50', months: '1,4,7,10', active_from: '2026-04', active_to: '2027-03' }),
    )
    expect(rowToTemplate(templateToRow(scheduled))).toMatchObject({
      months: [1, 4, 7, 10],
      activeFrom: '2026-04',
      activeTo: '2027-03',
    })
  })
})

describe('makeTemplate', () => {
  it('mints an id when there is none, and keeps one that exists', () => {
    expect(makeTemplate({ id: 'rent' }).id).toBe('rent')
    expect(makeTemplate({}).id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reads no clock and claims no timestamps', () => {
    const template = makeTemplate({ id: 'x', payer: PERSON.P1 })
    expect(makeTemplate({ ...template })).toEqual(template)
    expect('createdAt' in template).toBe(false)
  })

  it('defaults a blank amount and share to null, and the day to the 1st', () => {
    expect(makeTemplate({ id: 'x' })).toMatchObject({
      amountYen: null,
      payerShare: null,
      dayOfMonth: 1,
      months: null,
      activeFrom: null,
      activeTo: null,
    })
  })

  it('keeps a share of 0, which is falsy but meaningful', () => {
    expect(makeTemplate({ id: 'x', payerShare: 0 }).payerShare).toBe(0)
    expect(makeTemplate({ id: 'x', payerShare: '0.8' }).payerShare).toBe(0.8)
  })

  it('passes an unrecognised payer through so validation can refuse it', () => {
    // Rewritten to p1 it would file this cost under the wrong person every month, and
    // BAD_PAYER would be unreachable from the form.
    const template = makeTemplate({ id: 'x', payer: 'nonsense' })
    expect(template.payer).toBe('nonsense')
    expect(validateTemplateCodes(template)).toContain(TEMPLATE_ERROR.BAD_PAYER)
  })
})

describe('validateTemplateCodes', () => {
  const valid = (over) =>
    makeTemplate({ id: 'x', description: 'Rent', payer: PERSON.P1, dayOfMonth: 27, ...over })

  it('accepts a full template, and one with no amount or share', () => {
    expect(validateTemplateCodes(valid({ amountYen: 220000, payerShare: 0.8 }))).toEqual([])
    expect(validateTemplateCodes(valid())).toEqual([])
  })

  it('requires a description, because it is the only thing naming the row', () => {
    for (const description of ['', '   ', undefined]) {
      expect(validateTemplateCodes(valid({ description }))).toEqual([
        TEMPLATE_ERROR.MISSING_DESCRIPTION,
      ])
    }
  })

  it('rejects a filled-in amount that is not a positive whole number of yen', () => {
    for (const amountYen of [0, -5, 4.5, NaN, Infinity]) {
      expect(validateTemplateCodes(valid({ amountYen }))).toEqual([
        TEMPLATE_ERROR.BAD_TEMPLATE_AMOUNT,
      ])
    }
    // And a blank one is still valid, which is the whole point of the column.
    expect(validateTemplateCodes(valid({ amountYen: null }))).toEqual([])
  })

  it('rejects a numeric STRING amount, which means makeTemplate was bypassed', () => {
    // `makeTemplate` coerces all three numerics, so validation only sees a string when
    // something skipped it — and a string amount reaching `yenToSheetString` throws.
    expect(validateTemplateCodes({ ...valid(), amountYen: '220000' })).toEqual([
      TEMPLATE_ERROR.BAD_TEMPLATE_AMOUNT,
    ])
  })

  it('rejects a share outside 0..1 but accepts both ends and a blank', () => {
    for (const payerShare of [-0.01, 1.01, 2, NaN]) {
      expect(validateTemplateCodes(valid({ payerShare }))).toEqual([TEMPLATE_ERROR.BAD_SHARE])
    }
    for (const payerShare of [0, 0.5, 1, null]) {
      expect(validateTemplateCodes(valid({ payerShare }))).toEqual([])
    }
  })

  it('rejects a numeric STRING share, which means makeTemplate was bypassed', () => {
    // `makeTemplate` coerces, so validation only sees a string when something skipped it —
    // and a string share reaching `splitYen` is the one shape that moves money silently.
    expect(validateTemplateCodes({ ...valid(), payerShare: '0.5' })).toEqual([
      TEMPLATE_ERROR.BAD_SHARE,
    ])
  })

  it('rejects a day outside the 1-31 a month can name', () => {
    for (const dayOfMonth of [0, 32, -1, 5.5, NaN]) {
      expect(validateTemplateCodes(valid({ dayOfMonth }))).toEqual([TEMPLATE_ERROR.BAD_DAY])
    }
    for (const dayOfMonth of [1, 27, 31]) {
      expect(validateTemplateCodes(valid({ dayOfMonth }))).toEqual([])
    }
  })

  it('reports every problem at once, and a code per problem', () => {
    expect(validateTemplateCodes(makeTemplate({ id: 'x', amountYen: -1, dayOfMonth: 99 }))).toEqual(
      [
        TEMPLATE_ERROR.MISSING_DESCRIPTION,
        TEMPLATE_ERROR.BAD_TEMPLATE_AMOUNT,
        TEMPLATE_ERROR.BAD_PAYER,
        TEMPLATE_ERROR.BAD_DAY,
      ],
    )
  })
})

/**
 * The refusal that stands between a typo and a silent money change.
 *
 * A blank amount is VALID — it means the figure varies — so `parseAmountToYen` answering null
 * cannot fall through to blank: a fumbled `22o000` would save an empty amount cell, the row
 * would read "Varies", and `postRecurring` would quietly stop posting rent, because it posts
 * only a template that spells out both its amount and its share.
 */
describe('templateFormProblem', () => {
  const form = (over) => ({ description: 'Rent', amount: '220000', day: '27', ...over })

  it('accepts a filled form', () => {
    expect(templateFormProblem(form())).toBeNull()
  })

  it('accepts a BLANK amount, which is what a variable cost is', () => {
    expect(templateFormProblem(form({ amount: '' }))).toBeNull()
    expect(templateFormProblem(form({ amount: '   ' }))).toBeNull()
  })

  it('refuses an amount somebody typed and this cannot read', () => {
    // Each of these is what a thumb produces on a phone, and every one of them would
    // otherwise be saved as "the amount varies".
    for (const amount of ['22o000', 'abc', '1..2', '12 34x', '-500', '¥¥', '0']) {
      expect(templateFormProblem(form({ amount })), amount).toBe('amount')
    }
  })

  it('refuses a blank or impossible day', () => {
    for (const day of ['', '0', '32', '-1', '27.5', 'last']) {
      expect(templateFormProblem(form({ day })), day).toBe('day')
    }
    for (const day of ['1', '27', '31']) {
      expect(templateFormProblem(form({ day }))).toBeNull()
    }
  })

  it('refuses a blank name, and refuses it FIRST', () => {
    expect(templateFormProblem(form({ description: '   ' }))).toBe('description')
    // Field order, because focus follows the answer: reporting the day while the name above
    // it is also empty sends someone to the wrong control.
    expect(templateFormProblem({ description: '', amount: 'abc', day: '99' })).toBe('description')
    expect(templateFormProblem({ description: 'Rent', amount: 'abc', day: '99' })).toBe('amount')
  })

  it('tolerates missing keys rather than throwing at a half-built form', () => {
    expect(templateFormProblem({})).toBe('description')
  })
})
