import { useMemo } from 'react'
import { BottomSheet } from './BottomSheet.jsx'
import { recurringRows } from '../lib/recurring.js'
import { monthLabel } from '../lib/dates.js'
import { sheetUrl } from '../config.js'
import { PlusIcon } from './icons.jsx'
import { useMoney, usePeopleLabels, useT } from '../i18n/index.js'

/**
 * Every recurring cost, and what the month being looked at says about each.
 *
 * Reached from Settings rather than from the ledger, deliberately: this is a page you visit
 * to set something up, and nothing about it belongs over the balance.
 *
 * ONE list rather than a due section and a template section. A row's state is four-way —
 * recorded, due now, scheduled but not yet due, not scheduled this month — and every one of
 * those is a sentence on the row itself. Two sections could only show two of the four, and
 * a row with no Record button and no explanation reads as broken when in fact a quarterly
 * cost simply is not due in September.
 *
 * Scoped to `monthKey`, the month the ledger is showing, NOT to today's month. A month
 * missed while nobody was recording — away in October, back in November — has to stay
 * recordable, and `postRecurring` only ever posts the current one. The month is named on
 * screen so it is never a mystery which one is being answered.
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
          <ul className="recurring__list">
            {rows.map((state) => (
              <RecurringRow
                key={state.template.id}
                state={state}
                config={config}
                me={me}
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
          <div className="field" role="status">
            <p className="field__hint">
              {t('warning.undecodedTemplates', { count: undecodedTemplates })}
            </p>
            <a
              className="btn btn--ghost btn--sm"
              href={sheetUrl(spreadsheetId)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t('settings.openSheet')}
            </a>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}

/**
 * One cost. The body edits it; the trailing control records this month's instance, and only
 * when there is one to record.
 *
 * Its own component because it needs the two people's names and a money formatter, and
 * because the state sentence is the part worth reading in one place.
 */
function RecurringRow({ state, config, me, onEdit, onRecord }) {
  const { t } = useT()
  const money = useMoney()
  const { label } = usePeopleLabels(config, me)
  const { template, due, recorded, scheduled } = state

  /**
   * Why this row has no Record button, in words rather than by its absence — and never by
   * colour alone. `recorded` counts a tombstoned instance, so "already recorded" is the
   * honest reading of a month whose rent was deliberately removed.
   */
  const status = recorded
    ? t('recurring.recorded')
    : !scheduled
      ? t('recurring.notThisMonth')
      : !due
        ? t('recurring.notYetDue', { day: template.dayOfMonth })
        : null

  /**
   * The amount leads the meta line rather than sitting in a column of its own. At the 320px
   * floor a name, an eight-figure figure and a Record button cannot share a row: the name
   * gets about 60px and `overflow-wrap: anywhere` starts breaking words mid-glyph. The
   * figure is still the strongest thing on the line, and it is inside the button, so it is
   * part of what the row announces.
   */
  const amount =
    template.amountYen == null ? t('recurring.amountVaries') : money(template.amountYen)

  const name = template.description || t('entry.expense')

  const meta = [
    t('recurring.schedule', { day: template.dayOfMonth }),
    t('common.paid', { name: label(template.payer) }),
    status,
  ]
    .filter(Boolean)
    .join(t('entry.metaSeparator'))

  return (
    <li className="recurring__row">
      <button type="button" className="recurring__main" onClick={() => onEdit(template)}>
        <span className="recurring__name">{name}</span>
        <span className="recurring__meta">
          <span
            className={template.amountYen == null ? 'recurring__amount' : 'recurring__amount tnum'}
          >
            {amount}
          </span>
          {t('entry.metaSeparator')}
          {meta}
        </span>
      </button>
      {due && (
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => onRecord(due)}
          /* Several identical "Record" buttons in a column say nothing about which cost
             each one belongs to, which is the whole of what VoiceOver reads out. */
          aria-label={t('recurring.recordName', { name })}
        >
          {t('recurring.record')}
        </button>
      )}
    </li>
  )
}
