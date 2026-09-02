/**
 * Recurring costs: the `recurring` tab's rows, and which of them the month on screen has
 * no entry for yet.
 *
 * A recurrence is a DECLARATION, never a schedule this app runs. There is no server —
 * Apps Script mints tokens and nothing else — so a row can only be written while
 * something is running, and two phones can be open at once with last-write-wins and no
 * conflict detection. So the tab says what recurs, every writer derives the same
 * deterministic id for a month's instance, and a re-run is a no-op for all of them.
 *
 * There are two such writers and they are safe to coexist: the card in `LedgerScreen`,
 * where a person confirms, and `postRecurring` in `apps-script/Code.gs`, which posts
 * unattended once a day. Neither can post a month twice and neither can undo the other.
 *
 * The tab is read-only from the app. A template is authored by hand in the Sheet, like
 * `config`, and deleting the row is the retire path — nothing references a template, so
 * one way to retire beats two.
 *
 * Pure and React-free: the card's whole decision is here, where a test can reach it.
 */

import { ENTRY_TYPE, RECURRING, cellText, isPerson } from '../schema.js'
import { dayInMonth, isMonthKey, monthNumber, todayIso } from './dates.js'
import { parseAmountToYen, parseShare } from './money.js'

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
 * The entry a template would post for a month — the draft the form opens on, at exactly
 * the shape `newDraftEntry` produces.
 *
 * The id is DERIVED rather than minted, and that is the whole of "already recorded": every
 * writer derives it the same way, so two of them cannot post one month twice and re-running
 * either is a no-op. Not category plus description, because both are fields a person
 * edits: renaming a note to 'Rent (Aug)' would post a second rent, and two templates
 * sharing a category and a note — one gym membership each — would collapse into one.
 */
export function entryFromTemplate(template, monthKey) {
  return {
    id: `${template.id}#${monthKey}`,
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
 * The instances the month on screen is still missing, in the tab's own order.
 *
 * `entries` must be the RAW ledger, TOMBSTONES INCLUDED. That is the half everything else
 * in this codebase gets the other way round, because every other consumer filters through
 * `isActive`: soft-delete a rent that was double-charged and a list built from the active
 * rows alone offers it again for the rest of the month. The id being present at all — live
 * or dead — means the month is handled. It also means an optimistic row removes its own
 * card row the instant a save starts, so a second tap cannot post a duplicate.
 *
 * Due is ONE comparison, `date <= today`, against the instance's own date, and it covers
 * all three cases with no branch: every day of a past month is due, the current month
 * gates on `day_of_month`, and a future month offers nothing. Offering the 27th's rent on
 * the 1st would have the balance claiming half of it owed for three weeks before the money
 * moved.
 *
 * @param {object[]} templates from `rowToTemplate`
 * @param {object[]} entries the raw list, tombstones and pending rows included
 * @param {string} monthKey the month on screen
 * @param {string} [today] injected by the tests; the app always takes the default
 * @returns {object[]} draft entries, ready for the form
 */
export function templatesDue(templates, entries, monthKey, today = todayIso()) {
  if (!templates?.length || !isMonthKey(monthKey)) return []

  const recorded = new Set((entries ?? []).map((entry) => entry.id))
  const due = []
  for (const template of templates) {
    if (!activeIn(template, monthKey)) continue
    const draft = entryFromTemplate(template, monthKey)
    if (draft.date > today) continue
    if (recorded.has(draft.id)) continue
    due.push(draft)
  }
  return due
}

/**
 * Whether a template applies to a month at all: the active window, then the `months` list.
 *
 * Month keys compare as STRINGS, which is why `active_from`/`active_to` are keys rather
 * than dates — an ended lease stops nagging without deleting what it cost.
 */
function activeIn(template, monthKey) {
  if (template.activeFrom && monthKey < template.activeFrom) return false
  if (template.activeTo && monthKey > template.activeTo) return false
  return !template.months || template.months.includes(monthNumber(monthKey))
}
