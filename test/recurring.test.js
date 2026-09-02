import { describe, expect, it } from 'vitest'

import { PERSON, RECURRING } from '../src/schema.js'
import { entryFromTemplate, rowToTemplate, templatesDue } from '../src/lib/recurring.js'
import { expense, tombstone } from './support/entries.js'

/**
 * The recurring tab, and which of its rows a month is still missing.
 *
 * Three things here fail silently and cost money or a forgotten bill: a blank
 * `payer_share` read as an even split rather than as the payer's default, a tombstone
 * treated as "not yet recorded" so the card nags for the rest of the month, and a
 * template offered before its day so the balance claims money owed weeks early.
 */

/** A row built from RECURRING's own column list, by field NAME rather than position. */
const row = (fields) => RECURRING.columns.map((column) => fields[column] ?? '')

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
    // A utility bill: the card lists it with no figure and the form opens empty.
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
    // The literal, because this string IS the contract between the card, the Apps Script
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

describe('templatesDue', () => {
  const templates = [
    rowToTemplate(rent({ day_of_month: '27', payer_share: '80' })),
    rowToTemplate(row({ id: 'gym', description: 'Gym', amount: '8000', payer: 'p2' })),
  ]
  const idsDue = (entries, monthKey, today) =>
    templatesDue(templates, entries, monthKey, today).map((draft) => draft.id)

  it('offers what the month has no row for, in the tab’s order', () => {
    expect(idsDue([], '2026-09', '2026-09-30')).toEqual(['rent#2026-09', 'gym#2026-09'])
  })

  it('is empty with no templates or no real month', () => {
    expect(templatesDue([], [], '2026-09', '2026-09-30')).toEqual([])
    expect(templatesDue(undefined, [], '2026-09', '2026-09-30')).toEqual([])
    for (const monthKey of ['', '2026-13', '2026-09-01', undefined]) {
      expect(templatesDue(templates, [], monthKey, '2026-09-30')).toEqual([])
    }
  })

  /**
   * The day gate and the month on screen are ONE comparison against the instance's own
   * date. Offering the 27th's rent on the 1st would have the balance claiming 44,000 owed
   * for three weeks before the money moved.
   */
  it('does not offer a cost before its day has come', () => {
    expect(idsDue([], '2026-09', '2026-09-01')).toEqual(['gym#2026-09'])
    expect(idsDue([], '2026-09', '2026-09-26')).toEqual(['gym#2026-09'])
    expect(idsDue([], '2026-09', '2026-09-27')).toEqual(['rent#2026-09', 'gym#2026-09'])
  })

  it('offers every day of a past month, and nothing at all in a future one', () => {
    expect(idsDue([], '2026-08', '2026-09-01')).toEqual(['rent#2026-08', 'gym#2026-08'])
    expect(idsDue([], '2026-10', '2026-09-30')).toEqual([])
  })

  /**
   * A tombstone means the month is HANDLED — the one place in this codebase where the
   * deleted rows are the ones that count. Filtering them out instead offers the rent
   * again for the rest of the month, every time it is deliberately removed.
   */
  it('treats a recorded instance as handled, tombstoned or not', () => {
    const live = expense({ id: 'rent#2026-09', date: '2026-09-27' })
    const dead = tombstone({ id: 'rent#2026-09', date: '2026-09-27' })
    expect(idsDue([live], '2026-09', '2026-09-30')).toEqual(['gym#2026-09'])
    expect(idsDue([dead], '2026-09', '2026-09-30')).toEqual(['gym#2026-09'])
  })

  it('treats an optimistic row as handled, so a second tap cannot post a duplicate', () => {
    const pending = { ...expense({ id: 'gym#2026-09' }), pending: true }
    expect(idsDue([pending], '2026-09', '2026-09-30')).toEqual(['rent#2026-09'])
  })

  it('does not count another month’s instance of the same template', () => {
    const august = expense({ id: 'rent#2026-08', date: '2026-08-27' })
    expect(idsDue([august], '2026-09', '2026-09-30')).toContain('rent#2026-09')
  })

  it('honours the active window as month keys, so an ended lease stops nagging', () => {
    const bounded = [rowToTemplate(rent({ active_from: '2026-04', active_to: '2026-08' }))]
    const ids = (monthKey) =>
      templatesDue(bounded, [], monthKey, '2027-01-01').map((draft) => draft.id)
    expect(ids('2026-03')).toEqual([])
    expect(ids('2026-04')).toEqual(['rent#2026-04'])
    expect(ids('2026-08')).toEqual(['rent#2026-08'])
    expect(ids('2026-09')).toEqual([])
  })

  it('honours the months list, which is how annual and quarterly are spelled', () => {
    const quarterly = [rowToTemplate(rent({ months: '1,4,7,10' }))]
    const ids = (monthKey) =>
      templatesDue(quarterly, [], monthKey, '2027-01-01').map((draft) => draft.id)
    expect(ids('2026-01')).toEqual(['rent#2026-01'])
    expect(ids('2026-04')).toEqual(['rent#2026-04'])
    expect(ids('2026-02')).toEqual([])
    expect(ids('2026-12')).toEqual([])
  })
})
