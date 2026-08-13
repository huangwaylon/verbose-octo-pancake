import { useId, useState } from 'react'
import { BottomSheet } from './BottomSheet.jsx'
import { centsToSheetString, minorDigits, parseAmountToCents, splitCents } from '../lib/money.js'
import { ENTRY_TYPE, PEOPLE, PERSON, otherPerson } from '../schema.js'
import { errorMessage, usePeopleLabels, useMoney, useT } from '../i18n/index.js'
import { NoteField } from './NoteField.jsx'
import { Segmented } from './Segmented.jsx'
import { SplitField, useEntrySplit } from './SplitField.jsx'
import { TrashIcon } from './icons.jsx'

/**
 * Add or edit a single entry.
 *
 * Nothing in the app creates a settlement any more, but a settlement row already
 * in the sheet still opens here: its split is pinned to 0, so the category, note
 * and split controls are the ones that drop away rather than there being a second
 * form.
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
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const errorId = useId()

  const split = useEntrySplit(entry, config, payer)
  const cents = parseAmountToCents(amount, entryCurrency)
  const payerShare = isSettlement ? 0 : split.payerShare

  /**
   * The stored category first, even if the config tab no longer lists it. A
   * `<select>` whose value matches no option renders blank and then silently saves
   * the invisible old value — so editing a row whose category has since been
   * renamed would quietly rewrite it.
   */
  const categories = config.categories.includes(category)
    ? config.categories
    : [category, ...config.categories].filter(Boolean)

  const { label } = usePeopleLabels(config, me)
  const payerLabel = label(payer)
  const otherLabel = label(otherPerson(payer))

  // Two integer operations and a lookup, so it is recomputed rather than memoised;
  // every value it reads changes while the sheet is open anyway.
  const shares = cents == null || isSettlement ? null : splitCents(cents, payerShare)
  const breakdown =
    shares &&
    t('form.breakdown', {
      payer: payerLabel,
      payerAmount: money(shares.payerCents),
      other: otherLabel,
      otherAmount: money(shares.otherCents),
    })

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
      setError(errorMessage(cause, 'form.saveError'))
    }
  }

  return (
    <BottomSheet
      title={mode === 'edit' ? t('form.editTitle') : t('form.addTitle')}
      onClose={onClose}
      footer={
        <>
          {mode === 'edit' && (
            <button
              type="button"
              /* push-end shoves the destructive action to the far left of the
                 right-aligned footer, away from Save. */
              className="btn btn--icon push-end"
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
            {busy ? (
              <span className="spinner" />
            ) : mode === 'edit' ? (
              t('common.save')
            ) : (
              t('common.add')
            )}
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
            placeholder={digits ? '0.00' : '0'}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={error && cents == null ? 'true' : undefined}
            /* The message sits at the foot of the form, so without this a screen
               reader reaches the failed field and is told nothing about why. */
            aria-describedby={error ? errorId : undefined}
          />
        </div>

        <Segmented
          name="payer"
          label={t('common.whoPaid')}
          value={payer}
          options={PEOPLE.map((person) => [person, label(person)])}
          onChange={setPayer}
          hint={
            isSettlement ? t('form.settlementHint', { payer: payerLabel, other: otherLabel }) : null
          }
        />

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
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <NoteField value={description} presets={config.notePresets} onChange={setDescription} />

            <SplitField
              split={split}
              payerLabel={payerLabel}
              otherLabel={otherLabel}
              breakdown={breakdown}
            />
          </>
        )}

        {error && (
          <p className="field__error" id={errorId} role="status">
            {error}
          </p>
        )}
      </form>
    </BottomSheet>
  )
}
