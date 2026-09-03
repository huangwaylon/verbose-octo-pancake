/**
 * Recurring costs: what a month says about each declaration, and what a form may refuse. The row
 * <-> template mapping is in `schema.js`.
 *
 * A recurrence is a DECLARATION, never a schedule this app runs. Two writers post one — the Record
 * control here and `postRecurring` in `apps-script/Code.gs` — and they coexist because both derive
 * the same deterministic instance id, which makes a re-run a no-op for either. Pure and
 * React-free, because a static-markup render cannot submit a form.
 */

import {
  DEFAULT_DAY_OF_MONTH,
  ENTRY_ERROR,
  ENTRY_TYPE,
  PERSON,
  hasAnyCell,
  isDayOfMonth,
  isPerson,
  rowToTemplate,
} from '../schema.js'
import { dayInMonth, isMonthKey, monthNumber, shiftMonth, todayIso } from './dates.js'
import { isShare, isYenAmount, parseAmountToYen } from './money.js'

/** Spelled once, so minting an instance id and recognising one cannot drift apart. */
const INSTANCE_JOIN = '#'

/**
 * A template's instance id for a month, and the one home of that join.
 *
 * Not category plus description, because both are edited: renaming a note to 'Rent (Aug)' would
 * post a second rent, and two costs sharing a category and a note would collapse into one. Which
 * is also why an id may never CHANGE — every month already posted would stop matching it.
 */
function instanceId(templateId, monthKey) {
  return `${templateId}${INSTANCE_JOIN}${monthKey}`
}

/**
 * Whether an entry is some month's instance of a recurring cost — the inverse of `instanceId`, and
 * the whole of how the ledger tells a fixed cost from an ordinary one.
 *
 * The ID, not a marker in the note (lost the first time anyone corrects a typo) and not a column
 * of its own (a schema change in three files that cannot import each other). Reads the ENTRY
 * rather than the loaded templates: those are not in the launch snapshot, so the section would
 * vanish on the cached paint, and `deleteTemplate` orphans instances that are still fixed costs.
 *
 * The last join wins, so a hand-authored template id containing one still resolves.
 */
export function isRecurringInstance(entry) {
  const id = entry?.id
  if (typeof id !== 'string') return false
  const join = id.lastIndexOf(INSTANCE_JOIN)
  // `> 0`, not `>= 0`: an id that is only a month key names no template.
  return join > 0 && isMonthKey(id.slice(join + INSTANCE_JOIN.length))
}

/**
 * The entry a template would post for a month — the draft the form opens on, at exactly the shape
 * `newDraftEntry` produces.
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
 * Whether a template applies to a month at all: the active window, then the `months` list. Month
 * keys compare as STRINGS, which is why `active_from`/`active_to` are keys rather than dates.
 */
function scheduledIn(template, monthKey) {
  if (template.activeFrom && monthKey < template.activeFrom) return false
  if (template.activeTo && monthKey > template.activeTo) return false
  return !template.months || template.months.includes(monthNumber(monthKey))
}

/**
 * Every template with what the month on screen says about it — the ONE derivation of "due".
 *
 * A row rendered as "record me or nothing" cannot tell four states apart, so each answers all of
 * them: not scheduled, scheduled but not yet due, due, recorded.
 *
 *   `scheduled`  applies to this month at all — false for a quarterly cost out of quarter, and for
 *                one retired through `active_to`
 *   `recorded`   its instance id is already in the ledger, LIVE OR TOMBSTONED
 *   `due`        scheduled, not recorded, and its day has come
 *   `draft`      the entry to record, or null when this month has nothing to record
 *
 * `draft` is non-null for every month a cost MAY be recorded into, which is wider than `due`: rent
 * is recordable on the 3rd, it is simply not due yet. So `due` names the control and `draft`
 * decides whether there is one, which keeps the unattended poster the only thing bound by the day.
 *
 * `entries` must be the RAW ledger, TOMBSTONES INCLUDED — the one place here where deleted rows
 * are the ones that count, or a soft-deleted double charge is offered again all month. An
 * optimistic row counts as recorded the instant a save starts, so a second tap cannot duplicate
 * it.
 *
 * `due` is ONE comparison, `date <= today`, against the instance's own date, which covers a past
 * month, the current month's `day_of_month` and a future month with no branch.
 *
 * @param {object[]} templates from `reconcileTemplates`
 * @param {object[]} entries the raw list, tombstones and pending rows included
 * @param {string} monthKey the month being looked at
 * @param {string} [today] injected by the tests; the app always takes the default
 * @returns {{template: object, scheduled: boolean, recorded: boolean, due: boolean,
 *            draft: object|null}[]}
 */
export function recurringRows(templates, entries, monthKey, today = todayIso()) {
  if (!templates.length) return []
  const known = new Set(entries.map((entry) => entry.id))
  const real = isMonthKey(monthKey)

  return templates.map((template) => {
    const instance = real ? entryFromTemplate(template, monthKey) : null
    const scheduled = Boolean(real && scheduledIn(template, monthKey))
    const recorded = Boolean(instance && known.has(instance.id))
    const recordable = scheduled && !recorded
    return {
      template,
      scheduled,
      recorded,
      due: recordable && instance.date <= today,
      draft: recordable ? instance : null,
    }
  })
}

/**
 * A template retired as of this month, and one brought back.
 *
 * Retiring is `active_to`, NOT a deleted row, and that is correctness: the instance id is the only
 * link between a declaration and the rows it has posted, so re-created under a new id a month
 * already paid reads as unrecorded, and the unattended poster appends a second rent that night. It
 * is also reversible, which is why nothing here confirms.
 *
 * The PREVIOUS month, because `active_to` is inclusive.
 */
export function retiredTemplate(template, monthKey) {
  return { ...template, activeTo: shiftMonth(monthKey, -1) }
}

export function restoredTemplate(template) {
  return { ...template, activeTo: null }
}

/**
 * Whether a cost has been stopped, which is a different fact from "not scheduled this month" — a
 * quarterly cost out of quarter is the latter and not the former, and the page has to say which.
 */
export function isRetired(template) {
  return Boolean(template.activeTo)
}

/**
 * Build a complete template from partial form input, minting an id if there is none. Reads no
 * clock and guesses nothing, like `makeEntry`. The three scheduling fields ride through untouched,
 * which is what lets the form edit six columns of ten without turning a quarterly cost monthly.
 */
export function makeTemplate(input) {
  return {
    id: input.id || crypto.randomUUID(),
    description: input.description ?? '',
    // null, not 0: blank IS the value that means "recurring but variable".
    amountYen: input.amountYen == null ? null : Number(input.amountYen),
    category: input.category ?? '',
    payer: input.payer ?? '',
    payerShare: input.payerShare == null ? null : Number(input.payerShare),
    months: input.months ?? null,
    dayOfMonth: input.dayOfMonth == null ? DEFAULT_DAY_OF_MONTH : Number(input.dayOfMonth),
    activeFrom: input.activeFrom ?? null,
    activeTo: input.activeTo ?? null,
  }
}

/**
 * A blank declaration for the add form, mirroring `newDraftEntry`. The id is minted when the form
 * OPENS rather than per submit: retried under a fresh id, a lost response leaves two rows for one
 * cost, both posting every month. `payerShare` is left null, keeping the cost tied to the config
 * tab.
 */
export function newTemplate(person) {
  return makeTemplate({ payer: isPerson(person) ? person : PERSON.P1 })
}

/**
 * Which field of the form a submit has to refuse, in the form's own order, or null.
 *
 * `amount` is the case that matters: blank is VALID and means "variable", so `parseAmountToYen`
 * answering null cannot fall through to blank — a fumbled `22o000` would silently save a variable
 * cost. Takes the raw strings the controls hold, to judge what was TYPED; `validateTemplateCodes`
 * backs it.
 *
 * @returns {'description'|'amount'|'day'|null}
 */
export function templateFormProblem({ description, amount, day }) {
  if (!String(description ?? '').trim()) return 'description'
  // Exactly what `rowToTemplate` refuses: a typed zero is a mistake, and blank is the only way to
  // say "the figure varies".
  const typed = String(amount ?? '').trim()
  if (typed && !isYenAmount(parseAmountToYen(typed))) return 'amount'
  if (!isDayOfMonth(Number(day))) return 'day'
  return null
}

/**
 * Validation failure codes for a template, the stable contract exactly as `ENTRY_ERROR` is.
 *
 * `BAD_PAYER` and `BAD_SHARE` deliberately reuse the entry codes: the same cell means the same
 * thing and the sentence is identical, so a second spelling would be a second translation of one
 * rule.
 */
export const TEMPLATE_ERROR = {
  MISSING_DESCRIPTION: 'missingDescription',
  BAD_TEMPLATE_AMOUNT: 'badTemplateAmount',
  BAD_PAYER: ENTRY_ERROR.BAD_PAYER,
  BAD_SHARE: ENTRY_ERROR.BAD_SHARE,
  BAD_DAY: 'badDay',
}

/**
 * @returns {string[]} failure codes from TEMPLATE_ERROR; empty means valid.
 *
 * A blank amount and a blank share are both VALID, each carrying a meaning no other value can:
 * variable, and "follow the payer's default".
 *
 * The description is required, unlike an entry's note, because it is the only thing naming the
 * template on screen — a row reading "Recurring cost" twice tells nobody which of the two to edit.
 */
export function validateTemplateCodes(template) {
  const errors = []
  if (!template.description?.trim()) errors.push(TEMPLATE_ERROR.MISSING_DESCRIPTION)
  if (template.amountYen != null && !isYenAmount(template.amountYen)) {
    errors.push(TEMPLATE_ERROR.BAD_TEMPLATE_AMOUNT)
  }
  if (!isPerson(template.payer)) errors.push(TEMPLATE_ERROR.BAD_PAYER)
  if (template.payerShare != null && !isShare(template.payerShare)) {
    errors.push(TEMPLATE_ERROR.BAD_SHARE)
  }
  if (!isDayOfMonth(template.dayOfMonth)) errors.push(TEMPLATE_ERROR.BAD_DAY)
  return errors
}

/**
 * Every usable template from the tab's rows, and how many rows were not.
 *
 * The FIRST row per id wins, as `parseConfigRows` does for a config key. A duplicate — the rent
 * row copied without changing `id` — renders two identical rows under one React key and emits two
 * drafts nothing can tell apart. Counted rather than dropped, and `saveTemplate` refuses to write
 * to one at all, so the row on screen is the row an edit lands on.
 *
 * @returns {{templates: object[], undecoded: number}}
 */
export function reconcileTemplates(rows) {
  const templates = []
  const seen = new Set()
  let undecoded = 0

  for (const row of rows) {
    const template = rowToTemplate(row)
    if (template && !seen.has(template.id)) {
      seen.add(template.id)
      templates.push(template)
    } else if (hasAnyCell(row)) {
      undecoded += 1
    }
  }
  return { templates, undecoded }
}
