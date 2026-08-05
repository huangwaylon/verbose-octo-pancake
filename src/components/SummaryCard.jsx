import { formatCents } from '../lib/money.js'
import { labelFor } from '../lib/identity.js'
import { PERSON } from '../schema.js'

export function SummaryCard({ monthSpend, byCategory, byPerson, config, me, currency }) {
  if (!monthSpend) return null

  const top = byCategory.slice(0, 5)
  const largest = top[0]?.totalCents || 1

  return (
    <section className="card summary">
      <p className="card__title">This month</p>
      <p className="summary__total">{formatCents(monthSpend, currency)}</p>

      <div className="summary__people">
        {[PERSON.P1, PERSON.P2].map((person) => (
          <div className="summary__person" key={person}>
            <span className="summary__person-name">{labelFor(config, person, me)} paid</span>
            <span className="summary__person-amount">
              {formatCents(byPerson[person] ?? 0, currency)}
            </span>
          </div>
        ))}
      </div>

      {top.length > 0 && (
        <ul className="summary__categories">
          {top.map((row) => (
            <li className="summary__row" key={row.category}>
              <span className="summary__label">{row.category}</span>
              <span className="summary__bar">
                <span
                  className="summary__bar-fill"
                  style={{ width: `${Math.max(4, (row.totalCents / largest) * 100)}%` }}
                />
              </span>
              <span className="summary__value">{formatCents(row.totalCents, currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
