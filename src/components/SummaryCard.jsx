import { memo } from 'react'
import { PEOPLE, PERSON } from '../schema.js'
import { STORAGE_KEYS } from '../config.js'
import { storedPreference } from '../lib/preference.js'
import { UNCATEGORIZED } from '../lib/balance.js'
import { usePeopleLabels, useMoney, useT } from '../i18n/index.js'
import { DonutChart } from './DonutChart.jsx'

/**
 * Which of the two per-person figures the card shows. Both matter — cash out of pocket, and what that
 * person owes once every `payer_share` is applied — but two lines per person is four rows of the
 * card, so one is shown and the other is a tap away.
 *
 * A stored preference rather than component state, like the locale and the accent: it survives a
 * reload and a month change, and a test can set it without a DOM.
 */
export const SUMMARY_VIEWS = ['share', 'paid']

export const summaryView = storedPreference({
  key: STORAGE_KEYS.summaryView,
  values: SUMMARY_VIEWS,
  fallback: SUMMARY_VIEWS[0],
})

/**
 * The month's spending. Two forms on purpose: the category split is genuine part-to-whole across
 * many classes, so it gets the donut, while "Per person" is two values — the number IS the chart —
 * so it gets a meter bar. Memoised, like `EntryList`: a toast must not re-lay-out a chart.
 */
function SummaryCardInner({ monthSpend, byCategory, byPerson, byShare, config, me }) {
  // Every hook runs before the early return below: hook order must not depend on props.
  const { t } = useT()
  const money = useMoney()
  const { label, possessive } = usePeopleLabels(config, me)
  const showPaid = summaryView.use() === 'paid'

  if (!monthSpend) return null

  /** Split one way while the lines read another, the meter would be a second, silent claim. */
  const totals = showPaid ? byPerson : byShare
  const first = totals[PERSON.P1] ?? 0
  const second = totals[PERSON.P2] ?? 0

  const items = byCategory.map((row) => ({
    key: row.category,
    label: row.category === UNCATEGORIZED ? t('summary.uncategorized') : row.category,
    valueYen: row.totalYen,
  }))

  return (
    <section className="card summary">
      <div>
        <h2 className="eyebrow">{t('summary.title')}</h2>
        <p className="summary__total tnum">{money(monthSpend)}</p>
      </div>

      <div className="summary__section">
        <div className="summary__heading">
          <h2 className="eyebrow">{t('summary.perPerson')}</h2>
          {/* `aria-pressed` rather than a label that flips: a flipping label never says whether
              it names the figure on screen or the one a tap away. */}
          <button
            type="button"
            className={`btn btn--sm ${showPaid ? 'btn--primary' : 'btn--ghost'}`}
            aria-pressed={showPaid}
            onClick={() => summaryView.set(showPaid ? 'share' : 'paid')}
          >
            {t('summary.paidToggle')}
          </button>
        </div>
        {first + second > 0 && (
          <div
            className="summary__meter"
            role="img"
            aria-label={t('summary.meterLabel', {
              name1: label(PERSON.P1),
              amount1: money(first),
              name2: label(PERSON.P2),
              amount2: money(second),
            })}
          >
            <span className="summary__meter-fill" style={{ flexGrow: first, flexBasis: 0 }} />
            <span
              className="summary__meter-fill summary__meter-fill--other"
              style={{ flexGrow: second, flexBasis: 0 }}
            />
          </div>
        )}
        {/* A SENTENCE, not a bare figure: read alone, each line still says which one it is. */}
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
                {showPaid
                  ? t('common.paid', { name: label(person) })
                  : t('common.share', { owner: possessive(person) })}
              </span>
              <span className="summary__person-amount tnum">{money(totals[person] ?? 0)}</span>
            </span>
          ))}
        </div>
      </div>

      {items.length > 0 && (
        <div className="summary__section">
          <h2 className="eyebrow">{t('summary.byCategory')}</h2>
          <DonutChart
            items={items}
            formatMoney={money}
            formatShare={(percent) => t('summary.share', { percent })}
            label={t('summary.chartLabel')}
            otherLabel={t('summary.other')}
          />
        </div>
      )}
    </section>
  )
}

export const SummaryCard = memo(SummaryCardInner)
