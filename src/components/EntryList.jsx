import { dayLabel } from '../lib/dates.js'
import { EntryRow } from './EntryRow.jsx'
import { useDayLabels, useMoney, usePeopleLabels, useT } from '../i18n/index.js'
import { WalletIcon } from './icons.jsx'

/**
 * The month's entries, grouped into day sections.
 *
 * There is no loading state here. `App` shows a gate for `idle` and `loading` and
 * paints the cached ledger for everything else, so this component only ever
 * renders real rows or a genuine empty month.
 *
 * The day labels and the two people's names are resolved once here rather than
 * per row: a long month otherwise rebuilds the same three strings for every
 * entry.
 */
export function EntryList({ groups, config, me, currency, onEdit, onDelete, onAdd }) {
  const { t, locale } = useT()
  const money = useMoney(currency)
  const labels = useDayLabels()
  const { label } = usePeopleLabels(config, me)

  if (!groups.length) {
    return (
      <div className="card empty">
        <span className="empty__icon">
          <WalletIcon width={28} height={28} />
        </span>
        <p className="empty__title">{t('list.emptyTitle')}</p>
        <p className="empty__text">{t('list.emptyText')}</p>
        <button type="button" className="btn btn--primary" onClick={onAdd}>
          {t('list.emptyAction')}
        </button>
      </div>
    )
  }

  return (
    <div>
      {groups.map((group) => (
        <section className="day-group" key={group.date}>
          {/* Outside the white card, on the page ground: structure carried by
              typography and whitespace rather than a tinted header bar. */}
          <header className="day-group__label">
            <span>{dayLabel(group.date, { locale, labels })}</span>
            <span className="day-group__total tnum">
              {money(group.totalCents, { trimZeroCents: true })}
            </span>
          </header>
          <ul className="surface">
            {group.entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                label={label}
                currency={currency}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
