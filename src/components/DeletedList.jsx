import { dayLabel } from '../lib/dates.js'
import { ENTRY_TYPE, otherPerson } from '../schema.js'
import { useDayLabels, useEntryTitle, usePeopleLabels, useT } from '../i18n/index.js'
import { EntryLine } from './EntryLine.jsx'
import { ChevronRightIcon, SwapIcon } from './icons.jsx'

/**
 * The tombstones from the month on screen, most recently deleted first. Scoped to
 * that month because it sits under the month switcher, where a tombstone from
 * another month would read as belonging to this one; the sheet-wide count lives
 * in settings, next to `compact`, which is what acts on it.
 *
 * A `<details>` rather than React state: the open/closed flag is the element's
 * own, so it starts closed by construction, needs no reset when the list changes
 * underneath it, and keyboard and screen-reader behaviour come from the
 * platform. This is a recovery surface, not a view — hence last on the page.
 */
export function DeletedList({ entries, config, me, onRestore }) {
  const { t, locale } = useT()
  const labels = useDayLabels()
  const { label } = usePeopleLabels(config, me)

  if (!entries.length) return null

  return (
    <details className="deleted">
      <summary className="deleted__summary">
        <ChevronRightIcon className="deleted__chevron" width={16} height={16} />
        {t('deleted.title', { count: entries.length })}
      </summary>
      <p className="field__hint">{t('deleted.hint')}</p>
      <ul className="surface">
        {entries.map((entry) => (
          <DeletedRow
            key={entry.id}
            entry={entry}
            payerLabel={label(entry.payer)}
            otherLabel={label(otherPerson(entry.payer))}
            dateLabel={dayLabel(entry.date, { locale, labels })}
            onRestore={onRestore}
          />
        ))}
      </ul>
    </details>
  )
}

/**
 * Its own component because it calls a hook per row: `useEntryTitle` needs the entry,
 * and the title is wanted twice — as the visible text and inside the restore button's
 * accessible name. The row's shape and its amount are `EntryLine`'s job.
 *
 * A settlement is marked here the way `EntryRow` marks one, and for the same reason: the
 * two rows are the same fact either side of a delete. Left to the expense treatment, a
 * tombstoned payback lost its icon, its `entry--settlement` styling and its direction, and
 * read as an expense the payer had bought something with — so the one control beside it
 * offered to restore something other than what it says.
 */
function DeletedRow({ entry, payerLabel, otherLabel, dateLabel, onRestore }) {
  const { t } = useT()
  const description = useEntryTitle(entry)
  const isSettlement = entry.type === ENTRY_TYPE.SETTLEMENT

  return (
    <EntryLine
      entry={entry}
      description={description}
      meta={
        isSettlement
          ? t('deleted.settlementMeta', {
              date: dateLabel,
              payer: payerLabel,
              other: otherLabel,
            })
          : t('deleted.meta', { date: dateLabel, name: payerLabel })
      }
      settlement={isSettlement}
      icon={isSettlement ? <SwapIcon width={16} height={16} /> : null}
    >
      {/* Text, not an icon: there is no conventional glyph for "undelete", and
          several identical unlabelled buttons in a row say nothing about which
          entry each one restores — hence the per-row accessible name too. */}
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        onClick={() => onRestore(entry)}
        aria-label={t('deleted.restoreEntry', { description })}
      >
        {t('deleted.restore')}
      </button>
    </EntryLine>
  )
}
