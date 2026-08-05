import { dayLabel } from '../lib/dates.js'
import { EntryRow } from './EntryRow.jsx'
import { useDayLabels, useMoney, useT } from '../i18n/index.js'
import { WalletIcon } from './icons.jsx'

export function EntryList({ groups, config, me, currency, status, onEdit, onDelete, onAdd }) {
  const { t, locale } = useT()
  const money = useMoney(currency)
  // Built once per locale rather than once per row.
  const labels = useDayLabels()

  if (status === 'loading') {
    return (
      <div className="stack" aria-busy="true">
        <span className="visually-hidden">{t('list.loading')}</span>
        {[0, 1, 2, 3].map((index) => (
          <div className="skeleton skeleton--entry" key={index} />
        ))}
      </div>
    )
  }

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
                config={config}
                me={me}
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
