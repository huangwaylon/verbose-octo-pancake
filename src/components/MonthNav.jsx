import { currentMonthKey, monthLabel, shiftMonth } from '../lib/dates.js'
import { ChevronLeftIcon, ChevronRightIcon } from './icons.jsx'

export function MonthNav({ monthKey, onChange }) {
  const atCurrent = monthKey >= currentMonthKey()

  return (
    <div className="month-nav">
      <button
        type="button"
        className="btn btn--icon btn--ghost"
        onClick={() => onChange(shiftMonth(monthKey, -1))}
        aria-label="Previous month"
      >
        <ChevronLeftIcon />
      </button>
      <span className="month-nav__label">{monthLabel(monthKey)}</span>
      <button
        type="button"
        className="btn btn--icon btn--ghost"
        onClick={() => onChange(shiftMonth(monthKey, 1))}
        disabled={atCurrent}
        aria-label="Next month"
      >
        <ChevronRightIcon />
      </button>
    </div>
  )
}
