import { dayLabel } from '../lib/dates.js'
import { ENTRY_TYPE, otherPerson } from '../schema.js'
import { useDayLabels, useEntryTitle, usePeopleLabels, useT } from '../i18n/index.js'
import { EntryLine } from './EntryLine.jsx'
import { ChevronRightIcon, SwapIcon } from './icons.jsx'

/**
 * The tombstones from the month on screen, newest first. Scoped to that month because it sits under
 * the month switcher; the sheet-wide count lives in settings, next to `compact`.
 *
 * A `<details>` rather than React state: the flag is the element's own, so it starts closed by
 * construction and needs no reset when the list changes underneath it.
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
 * Its own component because it calls a hook per row, and the title is wanted twice — visible, and
 * inside the restore button's name. A settlement is marked as `EntryRow` marks one: given the
 * expense treatment, a tombstoned payback loses its direction and reads as an expense.
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
      {/* Text: there is no glyph for "undelete". Identical unlabelled buttons say nothing about
          which entry each restores, hence the per-row name too. */}
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
