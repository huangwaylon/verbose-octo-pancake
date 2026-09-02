import { memo } from 'react'
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
 *
 * Memoised, and it is the memo that matters most in the app: `App` re-renders on
 * every toast, every refresh and every month change, and this subtree is the only
 * one whose size grows with the ledger. All six props are stable unless the month's
 * data actually changed — `groups` comes from `useLedgerView`'s memo chain, `onEdit`
 * from a `useCallback` in `App`, and `onDelete` is a setter.
 */
function EntryListInner({ groups, config, me, onEdit, onDelete }) {
  const { t, locale } = useT()
  const money = useMoney()
  const labels = useDayLabels()
  const { label } = usePeopleLabels(config, me)

  if (!groups.length) {
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

  return (
    <div>
      {groups.map((group) => (
        <section className="day-group" key={group.date}>
          {/* Outside the white card, on the page ground: structure carried by
              typography and whitespace rather than a tinted header bar. */}
          <header className="day-group__label">
            <h3 className="day-group__day">{dayLabel(group.date, { locale, labels })}</h3>
            {/* Omitted at zero rather than printed. A day whose only entry is a
                settlement totals nothing — settlements are transfers, never spend — and
                "¥0" over a six-figure row reads as a bug rather than as arithmetic.
                Display only: no total is recomputed and no type is branched on. */}
            {group.totalYen > 0 && (
              <span className="day-group__total tnum">{money(group.totalYen)}</span>
            )}
          </header>
          <ul className="surface">
            {group.entries.map((entry) => (
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
      ))}
    </div>
  )
}

export const EntryList = memo(EntryListInner)
