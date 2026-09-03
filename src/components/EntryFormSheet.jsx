import { useId, useRef, useState } from 'react'
import { BottomSheet } from './BottomSheet.jsx'
import { parseAmountToYen, yenToSheetString } from '../lib/money.js'
import { ENTRY_TYPE, PEOPLE, PERSON, otherPerson } from '../schema.js'
import { errorMessage, usePeopleLabels, useT } from '../i18n/index.js'
import { Field, FieldError } from './Field.jsx'
import { AmountField } from './AmountField.jsx'
import { CategoryField } from './CategoryField.jsx'
import { NoteField } from './NoteField.jsx'
import { Segmented } from './Segmented.jsx'
import { SheetFormFooter } from './SheetFormFooter.jsx'
import { SplitField, useEntrySplit } from './SplitField.jsx'
import { TrashIcon } from './icons.jsx'

/**
 * Add or edit a single entry. The order is by how often a field is touched, not by how the sheet
 * reads: the amount and the note are typed every time, so they lead and stay reachable with the
 * keyboard up, and the category is third because `config.categories[0]` is only a guess.
 *
 * Nothing in the app creates a settlement, but one already in the sheet still opens here, with its
 * split pinned to 0 and three controls dropped rather than a second form. They sit either side of
 * the payer and date, hence two `!isSettlement` blocks.
 */
export function EntryFormSheet({ draft, config, me, onSubmit, onDelete, onClose }) {
  const { t } = useT()
  const { mode, entry } = draft
  const isSettlement = entry.type === ENTRY_TYPE.SETTLEMENT

  const [amount, setAmount] = useState(entry.amountYen ? yenToSheetString(entry.amountYen) : '')
  const [payer, setPayer] = useState(entry.payer ?? me ?? PERSON.P1)
  const [date, setDate] = useState(entry.date)
  const [category, setCategory] = useState(entry.category || config.categories[0] || '')
  const [description, setDescription] = useState(entry.description ?? '')
  const [rejected, setRejected] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [busy, setBusy] = useState(false)
  const amountErrorId = useId()
  const saveErrorId = useId()
  const amountInput = useRef(null)

  const split = useEntrySplit(entry, config, payer)
  const yen = parseAmountToYen(amount)
  const payerShare = isSettlement ? 0 : split.payerShare

  /**
   * Derived from the exact value a submit rejected, so it clears as the field is edited. Stored as a
   * message it lingers over a value that is now fine; keyed on a "has submitted" flag it returns
   * mid-edit, since every select-all-and-retype passes through the empty string.
   */
  const amountError =
    rejected != null && amount === rejected ? t('form.amountError', { example: '1250' }) : null

  const { label, possessive } = usePeopleLabels(config, me)
  const payerLabel = label(payer)
  const otherLabel = label(otherPerson(payer))

  async function handleSubmit(event) {
    event.preventDefault()
    // Before the amount is judged, or two errors sit on screen — one about a write never attempted.
    setSaveError(null)
    if (yen == null) {
      setRejected(amount)
      // The error is a newly INSERTED `role="status"`, which iOS announces unreliably, so without
      // this a VoiceOver user hears nothing at all.
      amountInput.current?.focus()
      return
    }
    setBusy(true)
    try {
      await onSubmit({
        ...entry,
        date,
        payer,
        amountYen: yen,
        category: isSettlement ? '' : category,
        description: description.trim(),
        payerShare,
      })
      onClose()
    } catch (cause) {
      setBusy(false)
      setSaveError(errorMessage(cause, 'form.saveError'))
    }
  }

  /** Keyed on the type too: a settlement under "Edit expense" contradicts the sentence below it. */
  const title = isSettlement
    ? t('form.editSettlementTitle')
    : mode === 'edit'
      ? t('form.editTitle')
      : t('form.addTitle')

  return (
    <BottomSheet
      title={title}
      /* A settlement's three remaining fields do not fill a phone. */
      full={!isSettlement}
      onClose={onClose}
      footer={
        <SheetFormFooter
          formId="entry-form"
          busy={busy}
          editing={mode === 'edit'}
          onCancel={onClose}
          leading={
            mode === 'edit' && (
              <button
                type="button"
                /* push-end puts the destructive action at the far left, away from Save. */
                className="btn btn--icon push-end"
                onClick={() => onDelete(entry)}
                disabled={busy}
                aria-label={t('form.deleteEntry')}
              >
                <TrashIcon />
              </button>
            )
          }
          describedBy={saveError ? saveErrorId : undefined}
        />
      }
    >
      <form id="entry-form" className="stack" onSubmit={handleSubmit}>
        <AmountField
          id="entry-amount"
          inputRef={amountInput}
          value={amount}
          onChange={setAmount}
          error={amountError}
          errorId={amountErrorId}
          placeholder={t('form.amountPlaceholder')}
        />

        {!isSettlement && (
          <>
            <NoteField value={description} presets={config.notePresets} onChange={setDescription} />

            <CategoryField
              id="entry-category"
              value={category}
              categories={config.categories}
              onChange={setCategory}
            />
          </>
        )}

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

        <Field htmlFor="entry-date" label={t('form.date')}>
          <input
            id="entry-date"
            className="input"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>

        {!isSettlement && (
          <SplitField
            split={split}
            payerLabel={payerLabel}
            payerPossessive={possessive(payer)}
            otherLabel={otherLabel}
            amountYen={yen}
          />
        )}

        {/* A save failure belongs directly above the footer that produced it. */}
        {saveError && <FieldError id={saveErrorId}>{saveError}</FieldError>}
      </form>
    </BottomSheet>
  )
}
