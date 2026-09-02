/**
 * Recurring costs: the `recurring` tab's rows, what a month says about each of them, and
 * the shape that goes back.
 *
 * A recurrence is a DECLARATION, never a schedule this app runs. There is no server —
 * Apps Script mints tokens and nothing else — so a row can only be written while
 * something is running, and two phones can be open at once with last-write-wins and no
 * conflict detection. So the tab says what recurs, every writer derives the same
 * deterministic id for a month's instance, and a re-run is a no-op for all of them.
 *
 * There are two such writers and they are safe to coexist: the Record control on
 * `RecurringSheet`, where a person confirms, and `postRecurring` in `apps-script/Code.gs`,
 * which posts unattended once a day. Neither can post a month twice and neither can undo
 * the other.
 *
 * A template is EDITABLE from the app but never removable from it, and that asymmetry is
 * the instance id's doing rather than an omission — `retiredTemplate` says why. Removing a
 * row for good is a Sheets action.
 *
 * Pure and React-free: everything the recurring list decides is here, where a test can
 * reach it.
 */

import { ENTRY_TYPE, PERSON, RECURRING, cellText, isPerson } from '../schema.js'
import { dayInMonth, isMonthKey, monthNumber, shiftMonth, todayIso } from './dates.js'
import { parseAmountToYen, parseShare, yenToSheetString } from './money.js'

/**
 * One `recurring` row -> a template, or null for a row that cannot be used.
 *
 * The rule, and the one place it differs from the `config` tab: **a blank cell takes its
 * documented default; a cell somebody FILLED IN and this cannot read refuses the whole
 * row.** A config default is cosmetic, so a parser there answers null and the default
 * quietly wins. Here every default either moves money (`payer_share`) or decides whether a
 * cost is offered at all (`day_of_month`, `months`, `active_from`/`active_to`), so a typo
 * has to be counted and said out loud instead of absorbed. `loadAll` counts what this
 * refused and `warning.undecodedTemplates` is what says so.
 *
 * `payerShare` stays null for a blank cell, meaning "follow the PAYER's default". Reading
 * it as `EVEN_SHARE` here — which is what `rowToEntry` does for an entry, correctly, since
 * an entry's blank share is a row that was already written — would split every rent 50/50
 * on a sheet running 80/20.
 *
 * @param {string[]} row cell values as returned by values.get
 * @returns {object|null}
 */
export function rowToTemplate(row) {
  if (!Array.isArray(row)) return null
  const get = (field) => cellText(row, RECURRING.index(field))

  const id = get('id')
  if (!id) return null

  // Case-folded and refused rather than defaulted, exactly as the settlements tab's payer
  // cell is: this decides which person's tab the instance lands in.
  const payer = get('payer').toLowerCase()
  if (!isPerson(payer)) return null

  // Blank is recurring-but-VARIABLE — utilities — so the card lists it with no figure and
  // the form opens with the amount empty. A zero is a mistake rather than a variable cost.
  const amountText = get('amount')
  const amountYen = amountText ? parseAmountToYen(amountText) : null
  if (amountText && !(amountYen > 0)) return null

  const shareText = get('payer_share')
  const payerShare = shareText ? parseShare(shareText) : null
  if (shareText && payerShare == null) return null

  const monthsText = get('months')
  const months = monthsText ? parseMonths(monthsText) : null
  if (monthsText && !months) return null

  const dayText = get('day_of_month')
  const dayOfMonth = dayText ? Number(dayText) : 1
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return null

  const activeFrom = get('active_from') || null
  const activeTo = get('active_to') || null
  if (activeFrom && !isMonthKey(activeFrom)) return null
  if (activeTo && !isMonthKey(activeTo)) return null

  return {
    id,
    description: get('description'),
    amountYen,
    category: get('category'),
    payer,
    payerShare,
    months,
    dayOfMonth,
    activeFrom,
    activeTo,
  }
}

/**
 * The `months` cell as month numbers, or null if any part of it is not one.
 *
 * Blank means every month, and `1,7` covers annual and quarterly — so there is no cadence
 * concept to add, and no weekly, which the whole app being month-scoped rules out anyway.
 */
function parseMonths(text) {
  const found = text.split(',').map((part) => Number(part.trim()))
  if (found.some((month) => !Number.isInteger(month) || month < 1 || month > 12)) return null
  return found
}

/**
 * A template's instance id for a month, and the one home of that join.
 *
 * Derived rather than matched, and derived IDENTICALLY here and in `apps-script/Code.gs`:
 * it is the whole of "already recorded", so two writers deriving it the same way is what
 * makes them safe to coexist and a re-run a no-op. Not category plus description, because
 * both are fields a person edits — renaming a note to 'Rent (Aug)' would post a second
 * rent, and two templates sharing a category and a note would collapse into one.
 *
 * This is also why a template's id may never CHANGE once it exists, and why retiring one
 * keeps the row: every month already posted would stop matching, and the poster would post
 * all of them again.
 */
function instanceId(templateId, monthKey) {
  return `${templateId}#${monthKey}`
}

/**
 * The entry a template would post for a month — the draft the form opens on, at exactly
 * the shape `newDraftEntry` produces.
 *
 * `payerShare` stays null when the tab left it blank, meaning "follow the PAYER's
 * default". Filling in `EVEN_SHARE` here would split every rent 50/50 on a sheet running
 * 80/20.
 */
export function entryFromTemplate(template, monthKey) {
  return {
    id: instanceId(template.id, monthKey),
    type: ENTRY_TYPE.EXPENSE,
    date: dayInMonth(monthKey, template.dayOfMonth),
    payer: template.payer,
    // 0 rather than null, so the form's `entry.amountYen ? … : ''` opens it empty and
    // `validateEntryCodes` refuses a submit that never filled it in.
    amountYen: template.amountYen ?? 0,
    category: template.category,
    description: template.description,
    payerShare: template.payerShare,
  }
}

/**
 * Whether a template applies to a month at all: the active window, then the `months` list.
 *
 * Month keys compare as STRINGS, which is why `active_from`/`active_to` are keys rather
 * than dates — and why retiring one is a single cell write rather than a deleted row.
 */
function scheduledIn(template, monthKey) {
  if (template.activeFrom && monthKey < template.activeFrom) return false
  if (template.activeTo && monthKey > template.activeTo) return false
  return !template.months || template.months.includes(monthNumber(monthKey))
}

/**
 * Every template with what the month on screen says about it — the ONE derivation of
 * "due", and the whole of what the recurring list decides.
 *
 * A row has four states, not two, and a list that renders only "record me" or nothing
 * cannot tell them apart: rent viewed on the 3rd looks identical to rent already paid.
 * So each row answers all of them, in the tab's own order:
 *
 *   `scheduled`  this template applies to this month at all — false for a quarterly cost
 *                out of quarter, and for one retired through `active_to`
 *   `recorded`   its instance id is already in the ledger, LIVE OR TOMBSTONED
 *   `due`        the draft to record, or null: scheduled, not recorded, and its day has come
 *
 * `entries` must be the RAW ledger, tombstones included. That is the half everything else
 * in this codebase gets the other way round, because every other consumer filters through
 * `isActive`: soft-delete a rent that was double-charged and a list built from the active
 * rows alone offers it again for the rest of the month. It also means an optimistic row
 * counts as recorded the instant a save starts, so a second tap cannot post a duplicate.
 *
 * `due` is ONE comparison, `date <= today`, against the instance's own date, and it covers
 * all three cases with no branch: every day of a past month is due, the current month gates
 * on `day_of_month`, and a future month offers nothing. Offering the 27th's rent on the 1st
 * would have the balance claiming half of it owed for three weeks before the money moved.
 *
 * @param {object[]} templates from `rowToTemplate`
 * @param {object[]} entries the raw list, tombstones and pending rows included
 * @param {string} monthKey the month being looked at
 * @param {string} [today] injected by the tests; the app always takes the default
 * @returns {{template: object, scheduled: boolean, recorded: boolean, due: object|null}[]}
 */
export function recurringRows(templates, entries, monthKey, today = todayIso()) {
  if (!templates?.length) return []
  const known = new Set((entries ?? []).map((entry) => entry.id))
  const real = isMonthKey(monthKey)

  return templates.map((template) => {
    const draft = real ? entryFromTemplate(template, monthKey) : null
    const scheduled = Boolean(real && scheduledIn(template, monthKey))
    const recorded = Boolean(draft && known.has(draft.id))
    return {
      template,
      scheduled,
      recorded,
      due: scheduled && !recorded && draft.date <= today ? draft : null,
    }
  })
}

/**
 * A template retired as of this month, and one brought back.
 *
 * Retiring is `active_to`, NOT a deleted row, and that is a correctness decision rather
 * than a convenience: the instance id is the only link between a declaration and the rows
 * it has already posted, so deleting the row orphans them. Re-create a cost with the same
 * name afterwards — a new id — and the month already paid reads as unrecorded, which is
 * enough for the unattended poster in `apps-script/Code.gs` to append a second rent that
 * night. Keeping the id keeps every month it has handled handled.
 *
 * It also costs one cell instead of a `deleteDimension`, which shifts every row below it —
 * the thing `compact` serializes its whole design around — and it is reversible, which is
 * why nothing here needs a confirmation dialog.
 *
 * The PREVIOUS month, so a cost retired today stops applying today. `active_to` is
 * inclusive, so this month would leave it due for the rest of it.
 */
export function retiredTemplate(template, monthKey) {
  return { ...template, activeTo: shiftMonth(monthKey, -1) }
}

export function restoredTemplate(template) {
  return { ...template, activeTo: null }
}

/**
 * A template as the row that goes back into the sheet — the exact inverse of
 * `rowToTemplate`, so a read-modify-write round trip through the sheet is lossless.
 *
 * Every value is a string, because the write is RAW and a hole in the array would leave
 * the cell untouched rather than clearing it. A null amount or share writes BLANK, which
 * is what carries "variable" and "follow the payer's default" — writing '0' or 'null'
 * there would turn a variable utility bill into a bill for nothing.
 */
export function templateToRow(template) {
  const byField = {
    description: template.description,
    amount: template.amountYen == null ? '' : yenToSheetString(template.amountYen),
    category: template.category,
    payer: template.payer,
    payer_share: template.payerShare == null ? '' : template.payerShare,
    months: template.months?.length ? template.months.join(', ') : '',
    day_of_month: template.dayOfMonth,
    active_from: template.activeFrom ?? '',
    active_to: template.activeTo ?? '',
    id: template.id,
  }
  return RECURRING.columns.map((field) => {
    const value = byField[field]
    return value == null ? '' : String(value)
  })
}

/**
 * Build a complete template from partial form input, minting an id if there is none.
 *
 * Takes no clock, exactly as `makeEntry` takes none: a template records no timestamp, so
 * nothing here has to be injected for a test to be deterministic.
 *
 * Nothing here guesses — an unrecognised payer is passed through so
 * `validateTemplateCodes` can refuse it, rather than being rewritten to p1 and filed under
 * the wrong person every month from then on. The three scheduling fields are carried
 * through untouched, which is what lets the form edit six columns of ten without silently
 * turning a quarterly cost into a monthly one.
 */
export function makeTemplate(input) {
  return {
    id: input.id || crypto.randomUUID(),
    description: input.description ?? '',
    // null, not 0: blank IS the value that means "recurring but variable".
    amountYen: input.amountYen == null ? null : Number(input.amountYen),
    category: input.category ?? '',
    payer: input.payer ?? '',
    // All three numerics coerced the same way, so a form handing over '0.5' becomes a number
    // before it can reach the balance — and null preserved in the two where null is a VALUE.
    payerShare: input.payerShare == null ? null : Number(input.payerShare),
    months: input.months ?? null,
    dayOfMonth: input.dayOfMonth == null ? 1 : Number(input.dayOfMonth),
    activeFrom: input.activeFrom ?? null,
    activeTo: input.activeTo ?? null,
  }
}

/**
 * A blank declaration for the add form, mirroring `newDraftEntry`.
 *
 * The id is minted when the form OPENS rather than per submit, for the same reason an
 * entry's is: an append whose response was lost — committed, but reported as failed — would
 * otherwise be retried under a fresh id, and two rows carrying two ids for one cost both
 * post every month from then on.
 *
 * `payerShare` is left null, meaning "follow this payer's default", which is both the
 * kindest default and the one that keeps the cost tied to the config tab.
 */
export function newTemplate(person) {
  return makeTemplate({ payer: isPerson(person) ? person : PERSON.P1 })
}

/**
 * Which field of the form a submit has to refuse, in the form's own order, or null.
 *
 * Here rather than in the component for the reason CLAUDE.md gives: a static-markup render
 * cannot submit a form, so a refusal decided in the component is unreachable from a test — and
 * this one is the difference between a typo and a silent money change.
 *
 * `amount` is the case that matters. Blank is VALID and means "variable", so
 * `parseAmountToYen` answering null cannot simply fall through to blank: a fumbled `22o000`
 * would save an empty amount cell, the row would read "Varies", and `postRecurring` — which
 * posts only a template that spells out both its amount and its share — would quietly stop
 * posting rent, with nothing on screen having said a word.
 *
 * Takes the raw strings the controls hold, not a template, because the point is to judge what
 * was TYPED. `validateTemplateCodes` is the backstop behind it.
 *
 * @returns {'description'|'amount'|'day'|null}
 */
export function templateFormProblem({ description, amount, day }) {
  if (!String(description ?? '').trim()) return 'description'
  // `> 0` rather than "readable", so this refuses exactly what `rowToTemplate` refuses: a
  // typed zero is a mistake, and blank is the only way to say "the figure varies".
  const typed = String(amount ?? '').trim()
  if (typed && !(parseAmountToYen(typed) > 0)) return 'amount'
  const dayNumber = Number(day)
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) return 'day'
  return null
}

/**
 * Validation failure codes for a template. These, not English sentences, are the stable
 * contract, exactly as `ENTRY_ERROR` is: the thrown error carries `error.<code>`.
 *
 * `BAD_PAYER` and `BAD_SHARE` deliberately reuse the entry codes — the same cell means the
 * same thing and the sentence a person reads is identical, so a second spelling would be a
 * second translation of one rule.
 */
export const TEMPLATE_ERROR = {
  MISSING_DESCRIPTION: 'missingDescription',
  BAD_TEMPLATE_AMOUNT: 'badTemplateAmount',
  BAD_PAYER: 'badPayer',
  BAD_SHARE: 'badShare',
  BAD_DAY: 'badDay',
}

/**
 * @returns {string[]} failure codes from TEMPLATE_ERROR; empty means valid.
 *
 * A blank amount and a blank share are both VALID, and each carries a meaning no other
 * value can: variable, and "follow the payer's default". So the amount check is about a
 * filled-in one, mirroring `rowToTemplate`'s reading of the same cell.
 *
 * The description is required, unlike an entry's note, because it is the only thing naming
 * the template on screen — a row reading "Recurring cost" twice tells nobody which of the
 * two to edit.
 */
export function validateTemplateCodes(template) {
  const errors = []
  if (!template.description?.trim()) errors.push(TEMPLATE_ERROR.MISSING_DESCRIPTION)
  if (
    template.amountYen != null &&
    !(Number.isInteger(template.amountYen) && template.amountYen > 0)
  ) {
    errors.push(TEMPLATE_ERROR.BAD_TEMPLATE_AMOUNT)
  }
  if (!isPerson(template.payer)) errors.push(TEMPLATE_ERROR.BAD_PAYER)
  if (
    template.payerShare != null &&
    (typeof template.payerShare !== 'number' ||
      !Number.isFinite(template.payerShare) ||
      template.payerShare < 0 ||
      template.payerShare > 1)
  ) {
    errors.push(TEMPLATE_ERROR.BAD_SHARE)
  }
  if (
    !Number.isInteger(template.dayOfMonth) ||
    template.dayOfMonth < 1 ||
    template.dayOfMonth > 31
  ) {
    errors.push(TEMPLATE_ERROR.BAD_DAY)
  }
  return errors
}
