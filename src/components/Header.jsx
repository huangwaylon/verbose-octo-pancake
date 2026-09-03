import { formatYen, formatYenParts } from '../lib/money.js'
import { usePeopleLabels, useT } from '../i18n/index.js'
import { RefreshIcon, SettingsIcon } from './icons.jsx'

/**
 * The figure, from Intl's own parts so the currency symbol can recede. Parts come out in the order
 * Intl returns them — never symbol-first by assumption: `fr-FR` puts it after ("1 250 ¥").
 *
 * No `aria-hidden` on anything: the heading's own `aria-label` outranks subtree content, so hiding
 * the parts would turn a terse heading into an empty one.
 */
function figure(parts) {
  return parts.map((part, index) =>
    part.type === 'currency' ? (
      <span className="balance__symbol" key={index}>
        {part.value}
      </span>
    ) : (
      part.value
    ),
  )
}

/**
 * The sticky band. The balance is deliberately NOT scoped to the month on screen — what one person
 * owes the other does not reset in January — and carries no action, because settling happens by wire
 * transfer and comes back as an ordinary entry.
 *
 * No `role="status"`, though the figure changes without a page change: every write that moves it
 * already speaks through a toast, and a second region would queue behind it.
 */
export function Header({ balance, config, me, busy, onRefresh, onOpenSettings }) {
  const { t, locale } = useT()
  const { name } = usePeopleLabels(config, me)
  const settled = balance.netYen === 0
  const owe = balance.debtor === me
  // Parts for the eye, a flat string for the heading — one amount, so the two cannot disagree.
  const amount = settled ? null : formatYen(balance.amountYen, { locale })
  const parts = settled ? null : formatYenParts(balance.amountYen, { locale })
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
            {/* One sentence: "¥12,500" says nothing in a heading list, and span by span a US
                amount announces as "dollar forty two point five zero". */}
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
