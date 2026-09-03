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
        className="btn btn--icon"
        onClick={() => onChange(shiftMonth(monthKey, -1))}
        aria-label={t('month.previous')}
      >
        <ChevronLeftIcon />
      </button>
      {/* A heading, not a span: it names everything below it, and iOS VoiceOver's Headings rotor
          is how a long month gets navigated. `.month-nav__label` restates the size and weight so
          it outranks base.css's heading reset. */}
      <h2 className="month-nav__label">{monthLabel(monthKey, { locale })}</h2>
      <button
        type="button"
        className="btn btn--icon"
        onClick={() => onChange(shiftMonth(monthKey, 1))}
        disabled={atCurrent}
        aria-label={t('month.next')}
      >
        <ChevronRightIcon />
      </button>
    </div>
  )
}
