import { currentMonthKey, monthLabel, shiftMonth } from '../lib/dates.js'
import { useT } from '../i18n/index.js'
import { ChevronLeftIcon, ChevronRightIcon } from './icons.jsx'

export function MonthNav({ monthKey, onChange }) {
  const { t, locale } = useT()
  const atCurrent = monthKey >= currentMonthKey()

  return (
    <div className="month-nav">
      <button
        type="button"
        className="btn btn--icon btn--ghost"
        onClick={() => onChange(shiftMonth(monthKey, -1))}
        aria-label={t('month.previous')}
      >
        <ChevronLeftIcon />
      </button>
      <span className="month-nav__label">{monthLabel(monthKey, { locale })}</span>
      <button
        type="button"
        className="btn btn--icon btn--ghost"
        onClick={() => onChange(shiftMonth(monthKey, 1))}
        disabled={atCurrent}
        aria-label={t('month.next')}
      >
        <ChevronRightIcon />
      </button>
    </div>
  )
}
