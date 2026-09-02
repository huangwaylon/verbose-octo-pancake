import { useId, useRef, useState } from 'react'
import { BottomSheet } from './BottomSheet.jsx'
import { parseAmountToYen, splitYen, yenToSheetString } from '../lib/money.js'
import { ENTRY_TYPE, PEOPLE, PERSON, otherPerson } from '../schema.js'
import { errorMessage, usePeopleLabels, useMoney, useT } from '../i18n/index.js'
import { Field, FieldError } from './Field.jsx'
import { NoteField } from './NoteField.jsx'
import { Segmented } from './Segmented.jsx'
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

  const money = useMoney()

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

  /**
   * The stored category first, even if the config tab no longer lists it. A
   * `<select>` whose value matches no option renders blank and then silently saves
   * the invisible old value — so editing a row whose category has since been
   * renamed would quietly rewrite it.
   */
  const categories = config.categories.includes(category)
    ? config.categories
    : [category, ...config.categories].filter(Boolean)

  const { label, possessive } = usePeopleLabels(config, me)
  const payerLabel = label(payer)
  const otherLabel = label(otherPerson(payer))

  // Two integer operations and a lookup, so it is recomputed rather than memoised;
  // every value it reads changes while the sheet is open anyway.
  const shares = yen == null || isSettlement ? null : splitYen(yen, payerShare)
  const breakdown =
    shares &&
    t('form.breakdown', {
      payer: payerLabel,
      payerAmount: money(shares.payerYen),
      other: otherLabel,
      otherAmount: money(shares.otherYen),
    })

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
          <button
            type="submit"
            form="entry-form"
            className="btn btn--primary"
            disabled={busy}
            /* The failure this button produced has to be reachable FROM it, not merely
               rendered above it. Ids are document-global, so sitting outside the form
               is no obstacle — the same is already true of `form`. */
            aria-describedby={saveError ? saveErrorId : undefined}
          >
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
        <Field htmlFor="entry-amount" label={t('form.amount')}>
          <input
            id="entry-amount"
            ref={amountInput}
            /* Tabular figures because this is the one field digits are typed into one at
               a time, and proportional ones shift every glyph as the value grows. */
            className="input tnum"
            type="text"
            /* The yen has no sub-unit, so a decimal point on the pad would only
               invite an amount 100x wrong. */
            inputMode="numeric"
            autoComplete="off"
            placeholder={t('form.amountPlaceholder')}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={amountError ? 'true' : undefined}
            aria-describedby={amountError ? amountErrorId : undefined}
          />
          {/* Inside the field, not at the foot of the form: `aria-describedby` reaches it
              either way, but from down there it renders a screen's worth below the input
              it describes, with nothing scrolling it into view on submit. */}
          {amountError && <FieldError id={amountErrorId}>{amountError}</FieldError>}
        </Field>

        {!isSettlement && (
          <>
            <NoteField value={description} presets={config.notePresets} onChange={setDescription} />

            <Field htmlFor="entry-category" label={t('form.category')}>
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
            </Field>
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
            breakdown={breakdown}
          />
        )}

        {/* A save failure is not a field's problem, so it stays here — directly above
            the footer holding the button that produced it. */}
        {saveError && <FieldError id={saveErrorId}>{saveError}</FieldError>}
      </form>
    </BottomSheet>
  )
}
