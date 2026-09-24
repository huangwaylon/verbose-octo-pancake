import { memo } from 'react'
import { dayLabel } from '../lib/dates.js'
import { EntryLine } from './EntryLine.jsx'
import { EntryRow } from './EntryRow.jsx'
import { useDayLabels, useEntryTitle, useMoney, usePeopleLabels, useT } from '../i18n/index.js'
import { CheckIcon, RepeatIcon, WalletIcon } from './icons.jsx'

/**
 * The month's entries, in sections: the recurring costs, then one per day. Which rows are fixed is
 * `monthSections`' decision, in `lib/`. No loading state: `App` gates `idle` and `loading` and paints
 * the cached ledger otherwise.
 *
 * Memoised, and it is the memo that matters most: `App` re-renders on every toast, refresh and month
 * change, and this subtree is the only one whose size grows with the ledger.
 */
function EntryListInner({
  groups,
  recurring = null,
  today,
  config,
  me,
  onEdit,
  onDelete,
  onRecord,
}) {
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
        >
          {/* First: these are the rows asking for something, and the recorded ones are receipts. */}
          {recurring.unpaid.map((draft) => (
            <UnpaidRow key={draft.id} draft={draft} money={money} onRecord={onRecord} />
          ))}
        </EntrySection>
      )}
      {groups.map((group) => (
        <EntrySection
          key={group.date}
          title={dayLabel(group.date, { today, locale, labels })}
          entries={group.entries}
          totalYen={group.totalYen}
          {...shared}
        />
      ))}
    </div>
  )
}

function EntrySection({
  title,
  icon = null,
  entries,
  totalYen,
  money,
  label,
  onEdit,
  onDelete,
  children = null,
}) {
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
        {children}
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

/**
 * A recurring cost this month has no row for, which is what makes the section a reminder rather than
 * a receipt. Said in words as well as by the styling, because a state carried by colour alone is no
 * state at all.
 *
 * The body is inert: the one action is Record, and `App` decides whether that writes the row or opens
 * the form on it (`recordableEntry`) — an amount nobody has typed cannot be saved either way.
 */
function UnpaidRow({ draft, money, onRecord }) {
  const { t } = useT()
  const name = useEntryTitle(draft)

  return (
    <EntryLine
      entry={draft}
      description={name}
      /* The state, and only the state: at 320px this line has about 140px beside the figure and
         the tick, and a schedule appended to it is an ellipsis where the words should be. The day
         is on the recurring page, which is where a schedule is edited. */
      meta={t('recurring.unpaid')}
      amount={draft.amountYen ? money(draft.amountYen) : t('recurring.amountVaries')}
      unpaid
    >
      {/* Identical ticks down a column say nothing about which cost each records. */}
      <button
        type="button"
        className="btn btn--icon entry__record"
        onClick={() => onRecord(draft)}
        aria-label={t('recurring.recordName', { name })}
      >
        <CheckIcon width={20} height={20} />
      </button>
    </EntryLine>
  )
}

export const EntryList = memo(EntryListInner)
