import { formatYen, formatYenParts } from '../lib/money.js'
import { usePeopleLabels, useT } from '../i18n/index.js'
import { RefreshIcon, SettingsIcon } from './icons.jsx'

/** Intl part types that recede behind the integer. Anything else is plain text. */
const RECESSIVE = {
  currency: 'balance__symbol',
}

/**
 * The figure, composed from Intl's own parts so the currency symbol can recede while
 * the integer carries the weight.
 *
 * Parts come out in the order Intl returns them — never symbol-first by assumption.
 * `en`/`ja` put it before ("¥1,250"), `fr-FR` after ("1 250 ¥"). There is no decimal
 * or fraction part to style: the yen has no sub-unit, so Intl never emits one.
 *
 * No `aria-hidden` on anything: the heading that holds this carries its own
 * `aria-label`, which outranks subtree content, so hiding the parts would only turn
 * a terse heading into an empty one.
 */
function figure(parts) {
  return parts.map((part, index) => {
    const recessive = RECESSIVE[part.type]
    return recessive ? (
      <span className={recessive} key={index}>
        {part.value}
      </span>
    ) : (
      part.value
    )
  })
}

/**
 * The sticky band, and the app's one hero: the running balance, a refresh, and the
 * way into settings.
 *
 * The balance is deliberately NOT scoped to the month on screen — what one person
 * owes the other does not reset in January — and it carries no action, because
 * settling happens by wire transfer outside the app and comes back in as an
 * ordinary entry. Putting it in the chrome is what lets the cards below read
 * unambiguously as the details.
 *
 * No `role="status"`, though the figure does change without a page change. Every
 * write that moves it already announces itself through a toast, and a second live
 * region would queue behind that toast and delay the sentence naming what actually
 * happened. A cold launch would announce a figure nobody asked for, too.
 *
 * `busy` rather than the ledger's status: the only state this cares about is "a
 * refresh is in flight", and by the time the header renders at all the gates have
 * already handled `idle` and `loading`.
 */
export function Header({ balance, config, me, busy, onRefresh, onOpenSettings }) {
  const { t, locale } = useT()
  const { name } = usePeopleLabels(config, me)
  const settled = balance.netYen === 0
  const owe = balance.debtor === me
  // The figure twice over: Intl's parts for the eye, and the same amount as one flat
  // string for the heading's name. One call each, from one amount, so the two cannot
  // disagree about the number they describe.
  const amount = settled ? null : formatYen(balance.amountYen, { locale })
  const parts = settled ? null : formatYenParts(balance.amountYen, { locale })
  // The other person, whichever way the debt runs. Both sentences below need exactly
  // this and the amount.
  const vars = settled ? null : { name: name(owe ? balance.creditor : balance.debtor), amount }

  return (
    <header className="app__header">
      <div className="balance">
        {settled ? (
          <h1 className="balance__settled">
            <span className="balance__dot" aria-hidden="true" />
            {t('balance.settled')}
          </h1>
        ) : (
          <>
            {/* The whole fact in one sentence, because the visible composition is
                digits: "¥12,500" alone says nothing in a heading list, and read
                span by span a US amount announces as "dollar forty two point
                five zero". */}
            <h1
              className="balance__amount"
              aria-label={owe ? t('balance.youOweAmount', vars) : t('balance.owesYouAmount', vars)}
            >
              {figure(parts)}
            </h1>
            {/* Already spoken as part of the heading above. */}
            <p className="balance__direction" aria-hidden="true">
              {owe ? t('balance.youOwe', vars) : t('balance.owesYou', vars)}
            </p>
          </>
        )}
      </div>

      <div className="header-actions">
        <button
          type="button"
          className="btn btn--icon"
          onClick={onRefresh}
          disabled={busy}
          aria-label={t('header.refresh')}
        >
          {busy ? <span className="spinner" /> : <RefreshIcon />}
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onOpenSettings}
          aria-label={t('header.settings')}
        >
          <SettingsIcon />
        </button>
      </div>
    </header>
  )
}
