import { useEntryTitle, useMoney, useT } from '../i18n/index.js'

/**
 * What this month is expected to hold and does not yet — rent, the gym, anything whose
 * amount and split are known in advance and whose only real failure mode is being
 * forgotten. Read from the `recurring` tab, against the month ON SCREEN;
 * `lib/recurring.js`'s `templatesDue` owns every decision about which rows appear.
 *
 * A tap prefills the entry form rather than posting: the confirming Save is the ordinary
 * optimistic write, so validation, `splitYen`, `tabOf` and the toasts all apply unchanged,
 * and there is no second write path and no race.
 *
 * Not a notice. `noticeKeys` means "the sheet holds something the app cannot show", and a
 * missing rent row is not that — it is something the sheet is missing.
 */
export function RecurringCard({ expected, onPick }) {
  const { t } = useT()

  if (!expected.length) return null

  return (
    <section className="card expected">
      <h2 className="eyebrow">{t('expected.title')}</h2>
      <p className="field__hint">{t('expected.hint')}</p>
      <ul className="expected__list">
        {expected.map((entry) => (
          <ExpectedRow key={entry.id} entry={entry} onPick={onPick} />
        ))}
      </ul>
    </section>
  )
}

/**
 * Its own component because it calls a hook per row: `useEntryTitle` is the one place an
 * entry becomes a one-line title, and it needs the entry.
 *
 * The visible text is the accessible name on purpose — with several rows of these, "Rent
 * ¥220,000" is what says which one this is, and an `aria-label` would replace it with
 * something that leaves the figure out.
 */
function ExpectedRow({ entry, onPick }) {
  const { t } = useT()
  const money = useMoney()
  const description = useEntryTitle(entry)

  return (
    <li className="expected__row">
      <button type="button" className="expected__item" onClick={() => onPick(entry)}>
        <span className="expected__name">{description}</span>
        {/* A template with a blank amount is recurring-but-variable — utilities — so the
            word goes where the figure would. "¥0" would read as a bill for nothing, and
            `.tnum` is for digits, so it comes off with them. */}
        <span className={entry.amountYen ? 'expected__amount tnum' : 'expected__amount'}>
          {entry.amountYen ? money(entry.amountYen) : t('expected.amountVaries')}
        </span>
      </button>
    </li>
  )
}
