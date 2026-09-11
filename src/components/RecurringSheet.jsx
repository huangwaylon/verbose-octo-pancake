import { useMemo } from 'react'
import { BottomSheet } from './BottomSheet.jsx'
import { isRetired, recurringRows, templateTitle } from '../lib/recurring.js'
import { monthLabel } from '../lib/dates.js'
import { OpenSheetLink } from './OpenSheetLink.jsx'
import { PlusIcon } from './icons.jsx'
import { useMoney, usePeopleLabels, useT } from '../i18n/index.js'

/**
 * Every recurring cost, and what the month on screen says about each. Reached from Settings, because
 * nothing about it belongs over the balance. Recording happens on the LEDGER, where the costs a month
 * is missing are listed: this page declares them.
 *
 * ONE list, not a due section and a template section: a row's state is three-way and `recurringRows`
 * answers all of it in a sentence, where two sections could show two. Scoped to `monthKey`, NOT
 * today's, because a missed month has to stay answerable.
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
  onClose,
}) {
  const { t, locale } = useT()
  const money = useMoney()
  const { label } = usePeopleLabels(config, me)

  /** Every template, including the ones the ledger has nothing to show for — that is this page. */
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

function RecurringRow({ state, label, money, onEdit }) {
  const { t } = useT()
  const { template, recorded, scheduled } = state

  /**
   * What the month on screen says about this cost, in words: with no control on the row, its absence
   * can say nothing.
   *
   * `scheduled` is asked BEFORE retirement, because they cover different spans: `active_to` is about
   * the cost now, `scheduled` about the month on screen. The other way round, a cost retired in July
   * and viewed IN July — still recordable — prints "stopped".
   */
  const status = recorded
    ? t('recurring.recorded')
    : scheduled
      ? t('recurring.unpaid')
      : isRetired(template)
        ? t('recurring.stopped')
        : t('recurring.notThisMonth')

  const name = templateTitle(template, t('entry.expense'))

  /** At 320px, a name beside an eight-figure amount gets about 100px, so the amount rides here. */
  const meta = [
    template.amountYen == null ? t('recurring.amountVaries') : money(template.amountYen),
    t('recurring.schedule', { day: template.dayOfMonth }),
    t('recurring.paidBy', { name: label(template.payer) }),
    status,
  ].join(t('entry.metaSeparator'))

  return (
    <li className="recurring__row">
      <button type="button" className="recurring__main" onClick={() => onEdit(template)}>
        <span className="recurring__name">{name}</span>
        <span className="recurring__meta">{meta}</span>
      </button>
    </li>
  )
}
