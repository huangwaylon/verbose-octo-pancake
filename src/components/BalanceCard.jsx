import { formatCents, formatCentsParts } from '../lib/money.js'
import { usePeopleLabels, useT } from '../i18n/index.js'

/**
 * The composite hero figure: currency symbol and any minor units set smaller and
 * recessive, the integer part carrying the weight.
 *
 * Parts render in the order Intl returns them — never symbol-first by
 * assumption. `en`/`ja` put it before ("¥1,250"), `fr-FR` after ("1 250 €"). A
 * zero-decimal currency has no decimal/fraction part at all.
 *
 * The whole string goes on aria-label and the pieces are hidden, or a screen
 * reader announces the split as "dollar forty two point five zero".
 */
function HeroAmount({ cents, currency, locale }) {
  const flat = formatCents(cents, currency, { locale })
  const parts = formatCentsParts(cents, currency, { locale })

  // An unknown currency code from the sheet's config tab: render the flat
  // fallback rather than nothing.
  if (!parts) return <p className="balance__amount">{flat}</p>

  return (
    <p className="balance__amount" aria-label={flat}>
      {parts.map((part, index) => {
        const key = `${part.type}-${index}`
        if (part.type === 'currency') {
          return (
            <span className="balance__symbol" key={key} aria-hidden="true">
              {part.value}
            </span>
          )
        }
        if (part.type === 'decimal' || part.type === 'fraction') {
          return (
            <span className="balance__fraction" key={key} aria-hidden="true">
              {part.value}
            </span>
          )
        }
        return (
          <span key={key} aria-hidden="true">
            {part.value}
          </span>
        )
      })}
    </p>
  )
}

/**
 * The running, all-time balance — deliberately not scoped to the selected month,
 * since what one person owes the other does not reset in January.
 *
 * One line: the eyebrow, then the sentence with the figure set against the
 * trailing edge. There is no action — settling happens by wire transfer outside
 * the app, and those transfers come back into the ledger as ordinary entries —
 * so the block states a fact and has no reason to occupy a screenful.
 */
export function BalanceCard({ balance, config, me, currency }) {
  const { t, locale } = useT()
  const { name, label } = usePeopleLabels(config, me)
  const settled = balance.netCents === 0

  return (
    <section className="balance">
      <p className="eyebrow">{t('balance.title')}</p>

      {settled ? (
        <p className="balance__settled">
          <span className="balance__dot" aria-hidden="true" />
          {t('balance.settled')}
        </p>
      ) : (
        <div className="balance__row">
          <p className="balance__direction">
            {balance.debtor === me
              ? t('balance.youOwe', { name: name(balance.creditor) })
              : t('balance.owesYou', { name: label(balance.debtor) })}
          </p>
          <HeroAmount cents={balance.amountCents} currency={currency} locale={locale} />
        </div>
      )}
    </section>
  )
}
