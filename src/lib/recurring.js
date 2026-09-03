/**
 * Recurring costs: what a month says about each declaration, and what a form may refuse.
 *
 * The row ↔ template mapping is in `schema.js` beside its entry twin, because that file is the
 * one home of the sheet's layout. What is left here is the page's decisions.
 *
 * A recurrence is a DECLARATION, never a schedule this app runs: there is no server, so a row
 * can only be written while something is running. Two writers do it — the Record control here
 * and `postRecurring` in `apps-script/Code.gs` — and they are safe to coexist because both
 * derive the same deterministic instance id, which makes a re-run a no-op for either.
 *
 * Pure and React-free: everything the recurring page decides is here, where a test can reach
 * it — a static-markup render cannot submit a form or tap a row.
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

/** The join between a template id and a month key. Spelled once, so the two halves below
 *  — minting an instance id and recognising one — cannot drift apart. */
const INSTANCE_JOIN = '#'

/**
 * A template's instance id for a month, and the one home of that join.
 *
 * Not category plus description, because both are fields a person edits: renaming a note to
 * 'Rent (Aug)' would post a second rent, and two costs sharing a category and a note would
 * collapse into one. Which is also why an id may never CHANGE once it exists — every month
 * already posted would stop matching it.
 */
function instanceId(templateId, monthKey) {
  return `${templateId}${INSTANCE_JOIN}${monthKey}`
}

/**
 * Whether an entry is some month's instance of a recurring cost — the inverse of
 * `instanceId`, and the whole of how the ledger tells a fixed cost from an ordinary one.
 *
 * The ID, not a marker in the note and not a column of its own. The note is the bank's own
 * text plus a person's, editable and searchable, so a `↻` in it is lost the first time
 * anyone corrects a typo. A `template_id` column would be a schema change in three places
 * that cannot import each other, and both writers would have to fill it in. The id already
 * carries the fact, both writers already derive it identically, and it is written once and
 * never edited.
 *
 * Deliberately reads the entry ALONE rather than matching against the loaded templates.
 * Templates are not in the launch snapshot, so a list checked against them would have the
 * section vanish on the cached paint and appear a round trip later; and `deleteTemplate`
 * orphans every instance it posted, which is a row that is still a fixed cost.
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
 * The entry a template would post for a month — the draft the form opens on, at exactly
 * the shape `newDraftEntry` produces.
 *
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
 * A row rendered as "record me or nothing" cannot tell four states apart — rent viewed on the
 * 3rd looks identical to rent already paid — so each answers all of them, in the tab's order:
 *
 *   `scheduled`  applies to this month at all — false for a quarterly cost out of quarter, and
 *                for one retired through `active_to`
 *   `recorded`   its instance id is already in the ledger, LIVE OR TOMBSTONED
 *   `due`        scheduled, not recorded, and its day has come
 *   `draft`      the entry to record, or null when this month has nothing to record
 *
 * Four fields, four states: not scheduled, scheduled but not yet due, due, recorded.
 *
 * `draft` is non-null for every month a cost MAY be recorded into, which is wider than `due`:
 * rent is recordable on the 3rd, it is simply not due yet, and someone who has already paid it
 * needs a way to say so. So `due` decides what the control is CALLED and `draft` decides
 * whether there is one — which keeps the page's one gate a single truthiness check, and keeps
 * the unattended poster in `apps-script/Code.gs` the only thing bound by the day.
 *
 * `entries` must be the RAW ledger, TOMBSTONES INCLUDED — the one place in this codebase where
 * the deleted rows are the ones that count. Soft-delete a double-charged rent and a list built
 * from the active rows alone offers it again for the rest of the month; and an optimistic row
 * counts as recorded the instant a save starts, so a second tap cannot post a duplicate.
 *
 * `due` is ONE comparison, `date <= today`, against the instance's own date, which covers all
 * three cases with no branch: a past month entirely, the current month's `day_of_month`, and a
 * future month not at all.
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
 * Whether a cost has been stopped, which is a different fact from "not scheduled this month" —
 * a quarterly cost out of quarter is the latter and not the former, and the page has to say
 * which.
 */
export function isRetired(template) {
  return Boolean(template.activeTo)
}

/**
 * Build a complete template from partial form input, minting an id if there is none.
 *
 * The counterpart to `makeEntry`, with the same two properties: it reads no clock, and it guesses
 * nothing — an unrecognised payer is passed through for the validator to refuse.
 *
 * The three scheduling fields ride through untouched, which is what lets the form edit six
 * columns of ten without silently turning a quarterly cost into a monthly one.
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
 * A blank declaration for the add form, mirroring `newDraftEntry`.
 *
 * The id is minted when the form OPENS rather than per submit, exactly as `newDraftEntry`'s is:
 * a lost response retried under a fresh id would leave two rows for one cost, both posting every
 * month from then on. `payerShare` is left null, which keeps the cost tied to the config tab.
 */
export function newTemplate(person) {
  return makeTemplate({ payer: isPerson(person) ? person : PERSON.P1 })
}

/**
 * Which field of the form a submit has to refuse, in the form's own order, or null.
 *
 * `amount` is the case that matters: blank is VALID and means "variable", so
 * `parseAmountToYen` answering null cannot fall through to blank — a fumbled `22o000` would save
 * an empty amount cell and the row would silently become a variable cost.
 *
 * Takes the raw strings the controls hold rather than a template, because the point is to judge
 * what was TYPED. `validateTemplateCodes` is the backstop behind it.
 *
 * @returns {'description'|'amount'|'day'|null}
 */
export function templateFormProblem({ description, amount, day }) {
  if (!String(description ?? '').trim()) return 'description'
  // Exactly what `rowToTemplate` refuses: a typed zero is a mistake, and blank is the only way
  // to say "the figure varies".
  const typed = String(amount ?? '').trim()
  if (typed && !isYenAmount(parseAmountToYen(typed))) return 'amount'
  if (!isDayOfMonth(Number(day))) return 'day'
  return null
}

/**
 * Validation failure codes for a template. These, not English sentences, are the stable
 * contract, exactly as `ENTRY_ERROR` is: the thrown error carries `error.<code>`.
 *
 * `BAD_PAYER` and `BAD_SHARE` deliberately reuse the entry codes — the same cell means the
 * same thing and the sentence a person reads is identical, so a second spelling would be a
 * second translation of one rule, and a literal would match these codes only by coincidence.
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
 * The FIRST row per id wins, exactly as `parseConfigRows` takes the first usable value for a
 * config key — the same hand-authored-tab problem. A duplicate is reachable by copying the rent
 * row to add parking and forgetting to change `id`; kept unreconciled it would render two
 * identical rows under one React key and this module would emit two drafts nothing could tell
 * apart. Counted rather than dropped silently, and `saveTemplate` refuses to write to one at
 * all, so the row on screen is always the row an edit lands on.
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
