import { formatCents } from '../lib/money.js'
import { ENTRY_TYPE, EVEN_SHARE, PERSON } from '../schema.js'
import { labelFor } from '../lib/identity.js'
import { SwapIcon, TrashIcon } from './icons.jsx'

/** Only mention the split when it is not the assumed even one. */
function splitNote(entry, config, me) {
  if (entry.payerShare === EVEN_SHARE) return null
  const other = entry.payer === PERSON.P1 ? PERSON.P2 : PERSON.P1
  if (entry.payerShare === 1) return `${labelFor(config, entry.payer, me)} only`
  if (entry.payerShare === 0) return `${labelFor(config, other, me)} only`
  return `${Math.round(entry.payerShare * 100)}% ${labelFor(config, entry.payer, me)}`
}

export function EntryRow({ entry, config, me, currency, onEdit, onDelete }) {
  const isSettlement = entry.type === ENTRY_TYPE.SETTLEMENT
  const note = isSettlement ? null : splitNote(entry, config, me)
  const payerLabel = labelFor(config, entry.payer, me)
  const otherLabel = labelFor(config, entry.payer === PERSON.P1 ? PERSON.P2 : PERSON.P1, me)

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
              Settled up
            </>
          ) : (
            entry.description || entry.category || 'Expense'
          )}
        </span>
        <span className="entry__meta">
          {isSettlement ? (
            `${payerLabel} paid ${otherLabel}`
          ) : (
            <>
              {payerLabel} paid
              {entry.description && entry.category ? ` · ${entry.category}` : ''}
              {note ? ` · ${note}` : ''}
            </>
          )}
        </span>
      </button>

      <span className="entry__amount">{formatCents(entry.amountCents, currency)}</span>

      <button
        type="button"
        className="btn btn--icon btn--ghost entry__delete"
        onClick={() => onDelete(entry)}
        aria-label={
          isSettlement
            ? 'Delete settlement'
            : `Delete ${entry.description || entry.category || 'expense'}`
        }
      >
        <TrashIcon width={18} height={18} />
      </button>
    </li>
  )
}
