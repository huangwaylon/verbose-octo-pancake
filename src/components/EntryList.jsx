import { dayLabel } from '../lib/dates.js'
import { formatCents } from '../lib/money.js'
import { EntryRow } from './EntryRow.jsx'
import { WalletIcon } from './icons.jsx'

export function EntryList({ groups, config, me, currency, status, onEdit, onDelete, onAdd }) {
  if (status === 'loading') {
    return (
      <div className="stack" aria-busy="true">
        <span className="visually-hidden">Loading expenses</span>
        {[0, 1, 2, 3].map((index) => (
          <div className="skeleton skeleton--entry" key={index} />
        ))}
      </div>
    )
  }

  if (!groups.length) {
    return (
      <div className="empty">
        <WalletIcon className="empty__icon" width={32} height={32} />
        <p className="empty__title">Nothing logged this month</p>
        <p className="empty__text">Add a grocery run or a meal you split.</p>
        <button type="button" className="btn btn--primary" onClick={onAdd}>
          Add an expense
        </button>
      </div>
    )
  }

  return (
    <div className="stack">
      {groups.map((group) => (
        <section className="day-group" key={group.date}>
          <header className="day-group__label">
            <span>{dayLabel(group.date)}</span>
            <span>{formatCents(group.totalCents, currency)}</span>
          </header>
          <ul className="entry-list">
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
