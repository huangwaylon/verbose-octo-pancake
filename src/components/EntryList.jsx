import { memo } from 'react'
import { dayLabel } from '../lib/dates.js'
import { EntryRow } from './EntryRow.jsx'
import { useDayLabels, useMoney, usePeopleLabels, useT } from '../i18n/index.js'
import { RepeatIcon, WalletIcon } from './icons.jsx'

/**
 * The month's entries, in sections: the recurring costs it has recorded, then one per day. Which rows
 * are fixed is `monthSections`' decision, in `lib/`. No loading state: `App` gates `idle` and
 * `loading` and paints the cached ledger otherwise.
 *
 * Memoised, and it is the memo that matters most: `App` re-renders on every toast, refresh and month
 * change, and this subtree is the only one whose size grows with the ledger.
 */
function EntryListInner({ groups, recurring = null, config, me, onEdit, onDelete }) {
  const { t, locale } = useT()
  const money = useMoney()
  const labels = useDayLabels()
  const { label } = usePeopleLabels(config, me)

  // Both: a month whose only entries are its fixed costs is not empty.
  if (!groups.length && !recurring) {
    return (
      <div className="card empty">
        <span className="empty__icon">
          <WalletIcon width={28} height={28} />
        </span>
        <p className="empty__title">{t('list.emptyTitle')}</p>
        {/* No button: two identically named accent buttons read as two different actions. */}
        <p className="empty__text">{t('list.emptyText')}</p>
      </div>
    )
  }

  const shared = { money, label, onEdit, onDelete }

  return (
    <div>
      {recurring && (
        <EntrySection
          title={t('list.recurring')}
          /* The only thing saying at a glance that the section is not a day; the word carries
             it for a screen reader. */
          icon={<RepeatIcon width={15} height={15} />}
          entries={recurring.entries}
          totalYen={recurring.totalYen}
          {...shared}
        />
      )}
      {groups.map((group) => (
        <EntrySection
          key={group.date}
          title={dayLabel(group.date, { locale, labels })}
          entries={group.entries}
          totalYen={group.totalYen}
          {...shared}
        />
      ))}
    </div>
  )
}

function EntrySection({ title, icon = null, entries, totalYen, money, label, onEdit, onDelete }) {
  return (
    <section className="entry-section">
      <header className="entry-section__label">
        <h3 className="entry-section__title">
          {icon}
          {title}
        </h3>
        {/* Omitted at zero: a day whose only entry is a settlement totals nothing, and "¥0"
            over a six-figure row reads as a bug. Display only — nothing is recomputed. */}
        {totalYen > 0 && <span className="entry-section__total tnum">{money(totalYen)}</span>}
      </header>
      <ul className="surface">
        {entries.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            label={label}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </section>
  )
}

export const EntryList = memo(EntryListInner)
