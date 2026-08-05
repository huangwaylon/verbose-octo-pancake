import { formatCents, formatCentsParts } from '../lib/money.js'
import { labelFor, nameOf } from '../lib/identity.js'
import { useT } from '../i18n/index.js'
import { SwapIcon } from './icons.jsx'

/**
 * The composite hero figure: currency symbol and any minor units set smaller and
 * recessive, the integer part carrying the weight.
 *
 * Parts render in the order Intl returns them — never symbol-first by
 * assumption. `en`/`ja` put it before ("¥1,250"), `fr-FR` after ("1 250 €"). A
 * zero-decimal currency simply has no decimal/fraction part, so nothing here may
 * assume one exists.
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
 * The running, all-time balance — deliberately not scoped to the selected
 * month, since what one person owes the other does not reset in January.
 *
 * Deliberately not a `.card`: it is a bare block on the page ground. Removing the
 * frame from the most important element on the page is the strongest hierarchy
 * move available, and it makes the white cards below read as the details.
 *
 * Reading order is eyebrow, then direction, then the figure, then the action — so
 * the sentence leads in and the number is the last thing the eye lands on.
 */
export function BalanceCard({ balance, config, me, currency, onSettle }) {
  const { t, locale } = useT()
  const settled = balance.netCents === 0
  const you = t('common.you')
  const fallbacks = { p1: t('common.person1'), p2: t('common.person2') }

  return (
    <section className="balance">
      <p className="eyebrow">{t('balance.title')}</p>

      {settled ? (
        <>
          <p className="balance__settled">
            <span className="balance__dot" aria-hidden="true" />
            {t('balance.settled')}
          </p>
          <p className="balance__caption">{t('balance.settledCaption')}</p>
        </>
      ) : (
        <>
          <p className="balance__direction">
            {balance.debtor === me
              ? t('balance.youOwe', { name: nameOf(config, balance.creditor, fallbacks) })
              : t('balance.owesYou', {
                  name: labelFor(config, balance.debtor, me, you, fallbacks),
                })}
          </p>
          <HeroAmount cents={balance.amountCents} currency={currency} locale={locale} />
          <div className="balance__action">
            <button type="button" className="btn btn--primary btn--block" onClick={onSettle}>
              <SwapIcon />
              {t('balance.settle')}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
