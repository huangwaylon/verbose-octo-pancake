import { memo } from 'react'
import { EVEN_SHARE, isSettlement as isTransfer, otherPerson } from '../schema.js'
import { percentOf } from '../lib/split.js'
import { useEntryTitle, useT } from '../i18n/index.js'
import { EntryLine } from './EntryLine.jsx'
import { TrashIcon } from './icons.jsx'

/**
 * One row in the month's list. `label` arrives from the list, so a long month resolves the two names
 * once instead of per row.
 *
 * Memoised because a row is the app's most repeated unit: without it, adding one entry makes every
 * other row re-derive its title, meta sentence and `Intl` formatter for byte-identical markup.
 */
function EntryRowInner({ entry, label, onEdit, onDelete }) {
  const { t } = useT()
  const description = useEntryTitle(entry)

  const isSettlement = isTransfer(entry)
  const payerLabel = label(entry.payer)
  const otherLabel = label(otherPerson(entry.payer))

  /** Only mention the split when it is not the assumed even one. */
  function splitNote() {
    if (isSettlement || entry.payerShare === EVEN_SHARE) return null
    if (entry.payerShare === 1) return t('entry.onlyPerson', { name: payerLabel })
    if (entry.payerShare === 0) return t('entry.onlyPerson', { name: otherLabel })
    return t('entry.splitPercent', {
      percent: percentOf(entry.payerShare),
      name: payerLabel,
    })
  }

  const note = splitNote()
  const meta = isSettlement
    ? t('entry.settlementMeta', { payer: payerLabel, other: otherLabel })
    : [
        entry.description && entry.category
          ? t('entry.paidCategory', { name: payerLabel, category: entry.category })
          : t('common.paid', { name: payerLabel }),
        note,
      ]
        .filter(Boolean)
        .join(t('entry.metaSeparator'))

  return (
    <EntryLine
      entry={entry}
      description={description}
      meta={meta}
      settlement={isSettlement}
      onOpen={() => onEdit(entry)}
    >
      <button
        type="button"
        className="btn btn--icon entry__delete"
        onClick={() => onDelete(entry)}
        aria-label={isSettlement ? t('entry.deleteSettlement') : t('entry.delete', { description })}
      >
        <TrashIcon width={18} height={18} />
      </button>
    </EntryLine>
  )
}

export const EntryRow = memo(EntryRowInner)
