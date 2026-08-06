import { ENTRY_TYPE, EVEN_SHARE, otherPerson } from '../schema.js'
import { useEntryTitle, usePeopleLabels, useMoney, useT } from '../i18n/index.js'
import { SwapIcon, TrashIcon } from './icons.jsx'

export function EntryRow({ entry, config, me, currency, onEdit, onDelete }) {
  const { t } = useT()
  // The entry's own currency wins: a sheet holding rows from before a currency
  // change is only rendered correctly per row.
  const money = useMoney(entry.currency || currency)
  const { label } = usePeopleLabels(config, me)
  const description = useEntryTitle()(entry)

  const isSettlement = entry.type === ENTRY_TYPE.SETTLEMENT
  const payerLabel = label(entry.payer)
  const otherLabel = label(otherPerson(entry.payer))

  /** Only mention the split when it is not the assumed even one. */
  const splitNote = () => {
    if (isSettlement || entry.payerShare === EVEN_SHARE) return null
    if (entry.payerShare === 1) return t('entry.onlyPerson', { name: payerLabel })
    if (entry.payerShare === 0) return t('entry.onlyPerson', { name: otherLabel })
    return t('entry.splitPercent', {
      percent: Math.round(entry.payerShare * 100),
      name: payerLabel,
    })
  }

  const separator = t('entry.metaSeparator')
  const note = splitNote()
  const meta = isSettlement
    ? t('entry.settlementMeta', { payer: payerLabel, other: otherLabel })
    : [
        entry.description && entry.category
          ? t('entry.paidCategory', { name: payerLabel, category: entry.category })
          : t('entry.paid', { name: payerLabel }),
        note,
      ]
        .filter(Boolean)
        .join(separator)

  return (
    <li
      className={`entry${isSettlement ? ' entry--settlement' : ''}${
        entry.pending ? ' entry--pending' : ''
      }`}
    >
      <button type="button" className="entry__main" onClick={() => onEdit(entry)}>
        <span className="entry__desc">
          {isSettlement ? (
            <>
              <SwapIcon width={16} height={16} />
              {description}
            </>
          ) : (
            description
          )}
        </span>
        <span className="entry__meta">{meta}</span>
      </button>

      <span className="entry__amount tnum">
        {money(entry.amountCents, { trimZeroCents: true })}
      </span>

      <button
        type="button"
        className="btn btn--icon entry__delete"
        onClick={() => onDelete(entry)}
        aria-label={
          isSettlement
            ? t('entry.deleteSettlement')
            : t('entry.delete', { description })
        }
      >
        <TrashIcon width={18} height={18} />
      </button>
    </li>
  )
}
