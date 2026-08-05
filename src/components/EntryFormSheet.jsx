import { useMemo, useState } from 'react'
import { BottomSheet } from './BottomSheet.jsx'
import { centsToSheetString, formatCents, parseAmountToCents, splitCents } from '../lib/money.js'
import { ENTRY_TYPE, EVEN_SHARE, PERSON, otherPerson } from '../schema.js'
import { labelFor } from '../lib/identity.js'
import { TrashIcon } from './icons.jsx'

/**
 * Add or edit a single entry. Doubles as the "settle up" form: a settlement is
 * the same record with the split pinned to 0, so it needs no category or split
 * controls rather than a separate form.
 */
export function EntryFormSheet({ draft, config, me, currency, onSubmit, onDelete, onClose }) {
  const { mode, entry } = draft
  const isSettlement = entry.type === ENTRY_TYPE.SETTLEMENT

  const [amount, setAmount] = useState(
    entry.amountCents ? centsToSheetString(entry.amountCents) : '',
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

  const cents = parseAmountToCents(amount)
  const payerShare = isSettlement ? 0 : splitMode === 'even' ? EVEN_SHARE : sharePercent / 100
  const payerLabel = labelFor(config, payer, me)
  const otherLabel = labelFor(config, otherPerson(payer), me)

  const breakdown = useMemo(() => {
    if (cents == null || isSettlement) return null
    const { payerCents, otherCents } = splitCents(cents, payerShare)
    return `${payerLabel}: ${formatCents(payerCents, currency)} · ${otherLabel}: ${formatCents(
      otherCents,
      currency,
    )}`
  }, [cents, payerShare, payerLabel, otherLabel, currency, isSettlement])

  async function handleSubmit(event) {
    event.preventDefault()
    if (cents == null) {
      setError('Enter an amount, like 42.10')
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
        currency,
        category: isSettlement ? '' : category,
        description: description.trim(),
        payerShare,
      })
      onClose()
    } catch (cause) {
      setBusy(false)
      setError(cause.message || 'Could not save that.')
    }
  }

  const title = isSettlement ? 'Settle up' : mode === 'edit' ? 'Edit expense' : 'Add expense'

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
              aria-label="Delete this entry"
            >
              <TrashIcon />
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="entry-form"
            className="btn btn--primary"
            disabled={busy}
          >
            {busy ? <span className="spinner" /> : mode === 'edit' ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <form id="entry-form" className="stack" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="entry-amount">
            Amount
          </label>
          <input
            id="entry-amount"
            className="input input--amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={error && cents == null ? 'true' : undefined}
          />
        </div>

        <div className="field">
          <span className="field__label">{isSettlement ? 'Paid by' : 'Who paid'}</span>
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
                {labelFor(config, person, me)}
              </label>
            ))}
          </div>
          {isSettlement && (
            <p className="field__hint">
              Records that {payerLabel} paid {otherLabel} back.
            </p>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="entry-date">
            Date
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
                Category
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
                Note <span className="field__hint">optional</span>
              </label>
              <input
                id="entry-note"
                className="input"
                type="text"
                autoComplete="off"
                placeholder="Trader Joe's"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div className="field">
              <span className="field__label">Split</span>
              <div className="segmented">
                {[
                  ['even', 'Even'],
                  ['custom', 'Custom'],
                ].map(([value, label]) => (
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
                    {label}
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
                      All {payerLabel}
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => setSharePercent(50)}
                    >
                      Half
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => setSharePercent(0)}
                    >
                      All {otherLabel}
                    </button>
                  </div>
                  <label className="split-control__slider">
                    <span className="field__hint">{payerLabel}&rsquo;s share</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={sharePercent}
                      onChange={(event) => setSharePercent(Number(event.target.value))}
                    />
                    <output>{sharePercent}%</output>
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
