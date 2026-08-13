import { useMoney } from '../i18n/index.js'

/**
 * An entry's amount, priced at the entry's OWN currency.
 *
 * Its own component because that per-row currency resolution is the whole point:
 * a sheet holding rows from before a currency change is only rendered correctly
 * row by row, and every list that shows an amount — live, deleted, or in the
 * delete dialog — has to do it the same way.
 *
 * @param {object} props
 * @param {object} props.entry
 * @param {string} props.currency the sheet's currency, used when the row has none
 */
export function EntryAmount({ entry, currency }) {
  const money = useMoney(entry.currency || currency)
  return (
    <span className="entry__amount tnum">
      {money(entry.amountCents, { trimZeroCents: true })}
    </span>
  )
}
