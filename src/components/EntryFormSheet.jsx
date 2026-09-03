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
 * Add or edit a single entry.
 *
 * The order is by how often a field is touched, not by how the sheet reads: the amount and
 * the note are typed every time, so they lead and are both reachable with the keyboard up.
 * The payer defaults to this device's person, the date to today and the split to the
 * payer's configured default, so those three are usually already right — and the category
 * is third because `config.categories[0]` is a guess rather than a default anyone chose.
 *
 * Nothing in the app creates a settlement, but a settlement row already in the sheet still
 * opens here: its split is pinned to 0, so the category, note and split controls are the
 * ones that drop away rather than there being a second form. They sit either side of the
 * payer and date controls, which is why there are two `!isSettlement` blocks and not one.
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
   * Derived from the exact value a submit rejected, so it clears the instant the field is
   * edited and never returns without another submit. Stored as a message it would linger
   * over a value that is now fine; keyed on a plain "has submitted" flag it would come
   * back mid-edit — every select-all-and-retype passes through the empty string.
   */
  const amountError =
    rejected != null && amount === rejected ? t('form.amountError', { example: '1250' }) : null

  const { label, possessive } = usePeopleLabels(config, me)
  const payerLabel = label(payer)
  const otherLabel = label(otherPerson(payer))

  async function handleSubmit(event) {
    event.preventDefault()
    // Cleared before the amount is judged, not after: a save that failed last time is
    // not still failing, and leaving it set would put two errors on screen at once —
    // one of them describing a write this submit never attempted.
    setSaveError(null)
    if (yen == null) {
      setRejected(amount)
      // Focus follows the refusal. The error is a newly INSERTED `role="status"`, which
      // iOS announces unreliably, and the button that was pressed is at the foot of a
      // full-screen form — so without this a VoiceOver user taps Save, hears nothing, and
      // has no idea which field is wrong. `BottomSheet`'s `focusin` handler scrolls it in.
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

  /**
   * Keyed on the type as well as the mode. A settlement opening under "Edit expense"
   * contradicts the sentence directly below it, which reads "Records that you paid them
   * back". Nothing in the UI creates one, so there is no settlement ADD title to match.
   */
  const title = isSettlement
    ? t('form.editSettlementTitle')
    : mode === 'edit'
      ? t('form.editTitle')
      : t('form.addTitle')

  return (
    <BottomSheet
      title={title}
      /* A settlement drops the note, category and split controls, leaving three fields
         that do not fill a phone — so it stays the content-sized sheet it fits, and
         only the expense form claims the whole screen. */
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
                /* push-end shoves the destructive action to the far left of the
                   right-aligned footer, away from Save. */
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

        {/* A save failure is not a field's problem, so it stays here — directly above
            the footer holding the button that produced it. */}
        {saveError && <FieldError id={saveErrorId}>{saveError}</FieldError>}
      </form>
    </BottomSheet>
  )
}
