import { useMemo } from 'react'
import { BottomSheet } from './BottomSheet.jsx'
import { isRetired, recurringRows } from '../lib/recurring.js'
import { dayOf, monthLabel } from '../lib/dates.js'
import { OpenSheetLink } from './OpenSheetLink.jsx'
import { PlusIcon } from './icons.jsx'
import { useMoney, usePeopleLabels, useT } from '../i18n/index.js'

/**
 * Every recurring cost, and what the month being looked at says about each.
 *
 * Reached from Settings rather than from the ledger, deliberately: this is a page you visit
 * to set something up, and nothing about it belongs over the balance.
 *
 * ONE list rather than a due section and a template section: a row's state is four-way, and
 * `recurringRows` answers all of it as a sentence on the row. Two sections could show two.
 *
 * Scoped to `monthKey`, the month the ledger is showing, NOT to today's: a month missed while
 * nobody was recording has to stay recordable, and `postRecurring` only ever posts the current
 * one. Which month is named on screen so it is never a mystery.
 */
export function RecurringSheet({
  templates,
  entries,
  config,
  me,
  monthKey,
  loaded,
  undecodedTemplates,
  spreadsheetId,
  onAdd,
  onEdit,
  onRecord,
  onClose,
}) {
  const { t, locale } = useT()
  const money = useMoney()
  // Resolved once for the whole list rather than per row, exactly as `EntryList` does it.
  const { label } = usePeopleLabels(config, me)

  /**
   * Computed here rather than in `useLedgerView`, so nothing walks the ledger while this
   * sheet is closed — which is almost always.
   */
  const rows = useMemo(
    () => recurringRows(templates, entries, monthKey),
    [templates, entries, monthKey],
  )

  const month = monthLabel(monthKey, { locale })

  return (
    <BottomSheet
      title={t('recurring.title')}
      /* A page's worth of list earns the whole phone screen: this is where a household's
         fixed costs are managed, not a one-sentence question. */
      full
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--primary btn--block" onClick={onAdd}>
          <PlusIcon />
          {t('recurring.add')}
        </button>
      }
    >
      <div className="stack">
        <p className="field__hint">{t('recurring.hint', { month })}</p>

        {rows.length > 0 ? (
          <ul>
            {rows.map((state) => (
              <RecurringRow
                key={state.template.id}
                state={state}
                label={label}
                money={money}
                onEdit={onEdit}
                onRecord={onRecord}
              />
            ))}
          </ul>
        ) : (
          /* "None yet" and "not read yet" are different facts, and on a cached launch the
             list is empty for the second reason — inviting someone to create a second copy
             of a cost that already exists. */
          <p className="field__hint">{loaded ? t('recurring.empty') : t('recurring.notLoaded')}</p>
        )}

        {/* Said HERE as well as on the ledger, because this is where the person is standing
            when they wonder why a cost they typed is not listed. The count comes from the
            same `loadAll` counter the notice does. */}
        {undecodedTemplates > 0 && (
          <div className="field">
            {/* On the `<p>` alone, like every other notice: a button label inside the region
                would be read out as part of the announcement. */}
            <p className="field__hint" role="status">
              {t('warning.undecodedTemplates', { count: undecodedTemplates })}
            </p>
            <div className="row">
              <OpenSheetLink spreadsheetId={spreadsheetId} />
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}

/**
 * One cost: the body edits it, the trailing control records this month's instance and appears
 * only when there is one to record. `label` and `money` arrive resolved from the list, the same
 * shape `EntryList` uses.
 */
function RecurringRow({ state, label, money, onEdit, onRecord }) {
  const { t } = useT()
  const { template, draft, due, recorded, scheduled } = state

  /**
   * Why this row has no Record button, in words rather than by its absence.
   *
   * `scheduled` is asked FIRST and retirement only refines it, because the two are about
   * different spans: `active_to` is a fact about the cost now, `scheduled` is about the month on
   * screen. Asked the other way round, a cost retired in July and viewed IN July — still inside
   * its own window, so still recordable — printed "stopped" beside its own Record button.
   * "stopped" and "not this month" are then the two ways of not applying, and a quarterly cost
   * out of quarter is only the second.
   *
   * The not-yet-due wording carries the day, so it stands in for the schedule line rather than
   * repeating it — and it takes the day from the INSTANCE, which is the clamped one. A cost
   * declared on the 31st is due on the 28th in February, and naming the 31st there would put a
   * date on screen that the row's own Record button stops agreeing with three days earlier.
   */
  const notYetDue = scheduled && !recorded && !due
  const status = recorded
    ? t('recurring.recorded')
    : !scheduled
      ? isRetired(template)
        ? t('recurring.stopped')
        : t('recurring.notThisMonth')
      : notYetDue
        ? t('recurring.notYetDue', { day: dayOf(draft.date) })
        : null

  const name = template.description || t('entry.expense')

  /**
   * The amount leads the meta line rather than taking a column of its own: at 320px a name, an
   * eight-figure figure and a Record button leave the name about 60px, and `overflow-wrap` then
   * breaks words mid-glyph. It stays inside the button, so it is part of what the row announces.
   */
  const meta = [
    template.amountYen == null ? t('recurring.amountVaries') : money(template.amountYen),
    notYetDue ? null : t('recurring.schedule', { day: template.dayOfMonth }),
    t('recurring.paidBy', { name: label(template.payer) }),
    status,
  ]
    .filter(Boolean)
    .join(t('entry.metaSeparator'))

  return (
    <li className="recurring__row">
      <button type="button" className="recurring__main" onClick={() => onEdit(template)}>
        <span className="recurring__name">{name}</span>
        <span className="recurring__meta">{meta}</span>
      </button>
      {/* `draft`, not `due`: a cost this month has not recorded can be recorded whenever
          somebody has actually paid it, and rent paid on the 3rd is the case that needs it.
          `due` only decides the wording — the schedule still governs the unattended poster,
          which is the one writer that must never run early. */}
      {draft && (
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => onRecord(draft)}
          /* Several identical "Record" buttons in a column say nothing about which cost
             each one belongs to, which is the whole of what VoiceOver reads out. The name
             goes between the two words rather than after them, so the visible label's own
             words still read in order. */
          aria-label={
            due ? t('recurring.recordName', { name }) : t('recurring.recordNowName', { name })
          }
        >
          {due ? t('recurring.record') : t('recurring.recordNow')}
        </button>
      )}
    </li>
  )
}
