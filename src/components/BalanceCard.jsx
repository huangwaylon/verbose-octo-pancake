import { formatCents } from '../lib/money.js'
import { labelFor, nameOf } from '../lib/identity.js'
import { SwapIcon } from './icons.jsx'

/**
 * The running, all-time balance — deliberately not scoped to the selected
 * month, since what one person owes the other does not reset in January.
 */
export function BalanceCard({ balance, config, me, currency, onSettle }) {
  const settled = balance.netCents === 0

  return (
    <section className={`card balance${settled ? ' balance--settled' : ' balance--owed'}`}>
      <p className="card__title">Balance</p>

      {settled ? (
        <>
          <p className="balance__amount">All settled up</p>
          <p className="balance__caption">Nothing owed either way.</p>
        </>
      ) : (
        <>
          <p className="balance__amount">{formatCents(balance.amountCents, currency)}</p>
          <p className="balance__caption">
            {balance.debtor === me
              ? `You owe ${nameOf(config, balance.creditor)}`
              : `${labelFor(config, balance.debtor, me)} owes you`}
          </p>
          <button type="button" className="btn btn--primary btn--block" onClick={onSettle}>
            <SwapIcon />
            Settle up
          </button>
        </>
      )}
    </section>
  )
}
