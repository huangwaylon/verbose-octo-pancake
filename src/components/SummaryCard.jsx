import { PEOPLE, PERSON } from '../schema.js'
import { UNCATEGORIZED } from '../lib/balance.js'
import { usePeopleLabels, useMoney, useT } from '../i18n/index.js'
import { DonutChart } from './DonutChart.jsx'

/**
 * The month's spending: a total, who paid how much, and a category breakdown.
 *
 * Two different forms on purpose. The category split is genuine part-to-whole
 * across many classes, so it gets the donut. "Who paid" is exactly two values,
 * and a two-slice pie is the canonical chart anti-pattern — the number is the
 * chart — so that gets a meter bar plus the two figures.
 */
export function SummaryCard({ monthSpend, byCategory, byPerson, config, me, currency }) {
  // Every hook runs before the early return below: hook order must not depend
  // on props.
  const { t } = useT()
  const money = useMoney(currency)
  const { label } = usePeopleLabels(config, me)

  if (!monthSpend) return null

  const paid1 = byPerson[PERSON.P1] ?? 0
  const paid2 = byPerson[PERSON.P2] ?? 0
  const paidTotal = paid1 + paid2

  const items = byCategory.map((row) => ({
    key: row.category,
    label: row.category === UNCATEGORIZED ? t('summary.uncategorized') : row.category,
    valueCents: row.totalCents,
  }))

  return (
    <section className="card summary">
      <div>
        <p className="eyebrow">{t('summary.title')}</p>
        <p className="summary__total tnum">{money(monthSpend, { trimZeroCents: true })}</p>
      </div>

      <div className="summary__section">
        <p className="eyebrow">{t('common.whoPaid')}</p>
        {paidTotal > 0 && (
          <div
            className="summary__meter"
            role="img"
            aria-label={t('summary.meterLabel', {
              name1: label(PERSON.P1),
              amount1: money(paid1),
              name2: label(PERSON.P2),
              amount2: money(paid2),
            })}
          >
            <span className="summary__meter-fill" style={{ flexGrow: paid1, flexBasis: 0 }} />
            <span
              className="summary__meter-fill summary__meter-fill--other"
              style={{ flexGrow: paid2, flexBasis: 0 }}
            />
          </div>
        )}
        <div className="summary__people">
          {PEOPLE.map((person) => (
            <span className="summary__person" key={person}>
              <span
                className={`summary__person-swatch${
                  person === PERSON.P2 ? ' summary__person-swatch--other' : ''
                }`}
                aria-hidden="true"
              />
              <span className="summary__person-name">
                {t('common.paid', { name: label(person) })}
              </span>
              <span className="summary__person-amount tnum">
                {money(byPerson[person] ?? 0, { trimZeroCents: true })}
              </span>
            </span>
          ))}
        </div>
      </div>

      {items.length > 0 && (
        <div className="summary__section">
          <p className="eyebrow">{t('summary.byCategory')}</p>
          <DonutChart
            items={items}
            formatMoney={(cents) => money(cents, { trimZeroCents: true })}
            formatShare={(percent) => t('summary.share', { percent })}
            label={t('summary.chartLabel')}
            otherLabel={t('summary.other')}
          />
        </div>
      )}
    </section>
  )
}
