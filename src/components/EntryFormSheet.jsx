import { useMemo, useState } from 'react'
import { BottomSheet } from './BottomSheet.jsx'
import { centsToSheetString, minorDigits, parseAmountToCents, splitCents } from '../lib/money.js'
import { ENTRY_TYPE, EVEN_SHARE, PERSON, otherPerson } from '../schema.js'
import { labelFor } from '../lib/identity.js'
import { useMoney, useT } from '../i18n/index.js'
import { TrashIcon } from './icons.jsx'

/**
 * Add or edit a single entry. Doubles as the "settle up" form: a settlement is
 * the same record with the split pinned to 0, so it needs no category or split
 * controls rather than a separate form.
 */
export function EntryFormSheet({ draft, config, me, currency, onSubmit, onDelete, onClose }) {
  const { t } = useT()
  const { mode, entry } = draft
  const isSettlement = entry.type === ENTRY_TYPE.SETTLEMENT

  // The entry's own currency where it has one, so editing an old row keeps its
  // scale rather than being reinterpreted at the config currency's.
  const entryCurrency = entry.currency || currency
  const digits = minorDigits(entryCurrency)
  const money = useMoney(entryCurrency)

  const [amount, setAmount] = useState(
    entry.amountCents ? centsToSheetString(entry.amountCents, entryCurrency) : '',
  )
  const [payer, setPayer] = useState(entry.payer ?? me ?? PERSON.P1)
  const [date, setDate] = useState(entry.date)
  const [category, setCategory] = useState(entry.category || config.categories[0] || '')
  const [description, setDescription] = useState(entry.description ?? '')
  const [splitMode, setSplitMode] = useState(
    entry.payerShare === EVEN_SHARE || entry.payerShare == null ? 'even' : 'custom',
  )
  const [sharePercent, setSharePercent] = useState(Math.round((entry.payerShare ?? 0.5) * 100))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const cents = parseAmountToCents(amount, entryCurrency)
  const payerShare = isSettlement ? 0 : splitMode === 'even' ? EVEN_SHARE : sharePercent / 100

  const you = t('common.you')
  const fallbacks = { p1: t('common.person1'), p2: t('common.person2') }
  const label = (person) => labelFor(config, person, me, you, fallbacks)
  const payerLabel = label(payer)
  const otherLabel = label(otherPerson(payer))

  const breakdown = useMemo(() => {
    if (cents == null || isSettlement) return null
    const { payerCents, otherCents } = splitCents(cents, payerShare)
    return t('form.breakdown', {
      payer: payerLabel,
      payerAmount: money(payerCents),
      other: otherLabel,
      otherAmount: money(otherCents),
    })
    // `money` and `t` are memoised per locale/currency, so this recomputes only
    // when the numbers or the labels actually change.
  }, [cents, payerShare, payerLabel, otherLabel, isSettlement, money, t])

  async function handleSubmit(event) {
    event.preventDefault()
    if (cents == null) {
      setError(t('form.amountError', { example: digits ? '42.10' : '1250' }))
      return
    }
    setError(null)
    setBusy(true)
    try {
      await onSubmit({
        ...entry,
        type: entry.type,
        date,
        payer,
        amountCents: cents,
        currency: entryCurrency,
        category: isSettlement ? '' : category,
        description: description.trim(),
        payerShare,
      })
      onClose()
    } catch (cause) {
      setBusy(false)
      setError(cause.i18nKey ? t(cause.i18nKey) : cause.message || t('form.saveError'))
    }
  }

  const title = isSettlement
    ? t('form.settleTitle')
    : mode === 'edit'
      ? t('form.editTitle')
      : t('form.addTitle')

  return (
    <BottomSheet
      title={title}
      onClose={onClose}
      footer={
        <>
          {mode === 'edit' && (
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              onClick={() => {
                onDelete(entry)
                onClose()
              }}
              aria-label={t('form.deleteEntry')}
            >
              <TrashIcon />
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="entry-form" className="btn btn--primary" disabled={busy}>
            {busy ? <span className="spinner" /> : mode === 'edit' ? t('common.save') : t('common.add')}
          </button>
        </>
      }
    >
      <form id="entry-form" className="stack" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="entry-amount">
            {t('form.amount')}
          </label>
          <input
            id="entry-amount"
            className="input input--amount"
            type="text"
            /* A zero-decimal currency should get a plain numeric pad. */
            inputMode={digits ? 'decimal' : 'numeric'}
            autoComplete="off"
            placeholder={digits ? '0.00' : t('form.amountPlaceholder')}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={error && cents == null ? 'true' : undefined}
          />
        </div>

        <div className="field">
          <span className="field__label">
            {isSettlement ? t('form.paidBy') : t('form.whoPaid')}
          </span>
          <div className="segmented">
            {[PERSON.P1, PERSON.P2].map((person) => (
              <label className="segmented__option" key={person}>
                <input
                  type="radio"
                  name="payer"
                  value={person}
                  checked={payer === person}
                  onChange={() => setPayer(person)}
                />
                {label(person)}
              </label>
            ))}
          </div>
          {isSettlement && (
            <p className="field__hint">
              {t('form.settlementHint', { payer: payerLabel, other: otherLabel })}
            </p>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="entry-date">
            {t('form.date')}
          </label>
          <input
            id="entry-date"
            className="input"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>

        {!isSettlement && (
          <>
            <div className="field">
              <label className="field__label" htmlFor="entry-category">
                {t('form.category')}
              </label>
              <select
                id="entry-category"
                className="select"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {config.categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="entry-note">
                {t('form.note')} <span className="field__hint">{t('common.optional')}</span>
              </label>
              <input
                id="entry-note"
                className="input"
                type="text"
                autoComplete="off"
                placeholder={t('form.notePlaceholder')}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div className="field">
              <span className="field__label">{t('form.split')}</span>
              <div className="segmented">
                {[
                  ['even', t('form.splitEven')],
                  ['custom', t('form.splitCustom')],
                ].map(([value, optionLabel]) => (
                  <label className="segmented__option" key={value}>
                    <input
                      type="radio"
                      name="split"
                      value={value}
                      checked={splitMode === value}
                      onChange={() => {
                        setSplitMode(value)
                        if (value === 'even') setSharePercent(50)
                      }}
                    />
                    {optionLabel}
                  </label>
                ))}
              </div>

              {splitMode === 'custom' && (
                <div className="split-control">
                  <div className="split-control__presets">
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => setSharePercent(100)}
                    >
                      {t('form.splitAll', { name: payerLabel })}
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => setSharePercent(50)}
                    >
                      {t('form.splitHalf')}
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => setSharePercent(0)}
                    >
                      {t('form.splitAll', { name: otherLabel })}
                    </button>
                  </div>
                  <label className="split-control__slider">
                    <span className="field__hint">
                      {t('form.splitShare', { name: payerLabel })}
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={sharePercent}
                      onChange={(event) => setSharePercent(Number(event.target.value))}
                    />
                    <output>{t('summary.share', { percent: sharePercent })}</output>
                  </label>
                </div>
              )}

              {breakdown && <p className="field__hint">{breakdown}</p>}
            </div>
          </>
        )}

        {error && <p className="field__error">{error}</p>}
      </form>
    </BottomSheet>
  )
}
