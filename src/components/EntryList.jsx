import { memo } from 'react'
import { dayLabel } from '../lib/dates.js'
import { EntryRow } from './EntryRow.jsx'
import { useDayLabels, useMoney, usePeopleLabels, useT } from '../i18n/index.js'
import { RepeatIcon, WalletIcon } from './icons.jsx'

/**
 * The month's entries, in sections: the recurring costs it has recorded, then one per day.
 *
 * There is no loading state here. `App` shows a gate for `idle` and `loading` and
 * paints the cached ledger for everything else, so this component only ever
 * renders real rows or a genuine empty month. The day labels and the two people's
 * names are resolved once here rather than per row.
 *
 * The fixed costs lead because that is the order the month is read in: rent and the bills
 * are settled facts, and what is worth scanning is the shopping under them. Which rows are
 * fixed is `monthSections`' decision, in `lib/`; all this owns is that a section is a section,
 * so the two are one component and cannot drift apart.
 *
 * Memoised, and it is the memo that matters most in the app: `App` re-renders on
 * every toast, every refresh and every month change, and this subtree is the only
 * one whose size grows with the ledger. All seven props are stable unless the month's
 * data actually changed — `groups` and `recurring` come from `useLedgerView`'s memo chain,
 * `onEdit` from a `useCallback` in `App`, and `onDelete` is a setter.
 */
function EntryListInner({ groups, recurring = null, config, me, onEdit, onDelete }) {
  const { t, locale } = useT()
  const money = useMoney()
  const labels = useDayLabels()
  const { label } = usePeopleLabels(config, me)

  // Both halves, because a month whose only entries are its fixed costs is not an empty one.
  if (!groups.length && !recurring) {
    return (
      <div className="card empty">
        <span className="empty__icon">
          <WalletIcon width={28} height={28} />
        </span>
        <p className="empty__title">{t('list.emptyTitle')}</p>
        {/* No button: the block add button sits a screen above this card, and two
            identically named accent buttons read as two different actions. */}
        <p className="empty__text">{t('list.emptyText')}</p>
      </div>
    )
  }

  /** What every section needs to render a row, resolved once for the whole month. */
  const shared = { money, label, onEdit, onDelete }

  return (
    <div>
      {recurring && (
        <EntrySection
          title={t('list.recurring')}
          /* The one icon in this band, and the only thing that says at a glance that the
             section is not a day. The word carries it on its own for a screen reader. */
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

/**
 * One labelled band of rows. The recurring section and a day are the same thing rendered
 * twice, and what they disagree about is the title above them.
 */
function EntrySection({ title, icon = null, entries, totalYen, money, label, onEdit, onDelete }) {
  return (
    <section className="entry-section">
      {/* Outside the white card, on the page ground: structure carried by
          typography and whitespace rather than a tinted header bar. */}
      <header className="entry-section__label">
        <h3 className="entry-section__title">
          {icon}
          {title}
        </h3>
        {/* Omitted at zero rather than printed. A day whose only entry is a
            settlement totals nothing — settlements are transfers, never spend — and
            "¥0" over a six-figure row reads as a bug rather than as arithmetic.
            Display only: no total is recomputed and no type is branched on. */}
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
