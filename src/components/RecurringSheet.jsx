import { useMemo } from 'react'
import { BottomSheet } from './BottomSheet.jsx'
import { isRetired, recurringRows } from '../lib/recurring.js'
import { dayOf, monthLabel } from '../lib/dates.js'
import { OpenSheetLink } from './OpenSheetLink.jsx'
import { PlusIcon } from './icons.jsx'
import { useMoney, usePeopleLabels, useT } from '../i18n/index.js'

/**
 * Every recurring cost, and what the month on screen says about each. Reached from Settings, because
 * nothing about it belongs over the balance.
 *
 * ONE list, not a due section and a template section: a row's state is four-way and `recurringRows`
 * answers all of it in a sentence, where two sections could show two. Scoped to `monthKey`, NOT
 * today's: a missed month has to stay recordable, and `postRecurring` only posts the current one.
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
  const { label } = usePeopleLabels(config, me)

  /** Here, not in `useLedgerView`, so nothing walks the ledger while this sheet is closed. */
  const rows = useMemo(
    () => recurringRows(templates, entries, monthKey),
    [templates, entries, monthKey],
  )

  const month = monthLabel(monthKey, { locale })

  return (
    <BottomSheet
      title={t('recurring.title')}
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
          /* "None yet" and "not read yet" are different facts, and a cached launch is the
             second — which invites a second copy of a cost that already exists. */
          <p className="field__hint">{loaded ? t('recurring.empty') : t('recurring.notLoaded')}</p>
        )}

        {/* Said here too: this is where someone wonders why a cost they typed is missing. */}
        {undecodedTemplates > 0 && (
          <div className="field">
            {/* On the `<p>` alone: a button label inside the region would be announced too. */}
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

function RecurringRow({ state, label, money, onEdit, onRecord }) {
  const { t } = useT()
  const { template, draft, due, recorded, scheduled } = state

  /**
   * Why this row has no Record button, in words rather than by its absence.
   *
   * `scheduled` is asked FIRST and retirement only refines it, because they cover different spans:
   * `active_to` is about the cost now, `scheduled` about the month on screen. The other way round, a
   * cost retired in July and viewed IN July — still recordable — prints "stopped".
   *
   * The not-yet-due wording takes its day from the INSTANCE, the clamped one: a cost declared on the
   * 31st is due on the 28th in February, and naming the 31st there disagrees with its own button.
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

  /** At 320px, a name beside an eight-figure amount and a Record button gets about 60px. */
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
      {/* `draft`, not `due`: rent paid on the 3rd has to be enterable then. `due` only decides
          the wording; the schedule still governs the unattended poster. */}
      {draft && (
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => onRecord(draft)}
          /* Identical "Record" buttons say nothing about which cost each belongs to. The name
             goes between the two words, so the visible label still reads in order. */
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
