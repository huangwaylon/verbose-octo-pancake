import { useId, useRef, useState } from 'react'
import { BottomSheet } from './BottomSheet.jsx'
import { parseAmountToYen, yenToSheetString } from '../lib/money.js'
import { isRetired, templateFormProblem } from '../lib/recurring.js'
import { PEOPLE, PERSON, otherPerson } from '../schema.js'
import { errorMessage, usePeopleLabels, useT } from '../i18n/index.js'
import { Field, FieldError } from './Field.jsx'
import { AmountField } from './AmountField.jsx'
import { SheetFormFooter } from './SheetFormFooter.jsx'
import { CategoryField } from './CategoryField.jsx'
import { Segmented } from './Segmented.jsx'
import { SplitField, useEntrySplit } from './SplitField.jsx'
import { RetireIcon } from './icons.jsx'

/**
 * Add or edit one recurring cost. The order is by what IDENTIFIES the cost, not by how often a field
 * is touched (the entry form's rule): a template is filled in once and then read in a list.
 *
 * SIX of the tab's ten columns; the other three ride the draft untouched, because a save writes the
 * whole row and dropping them would turn a quarterly cost into a monthly one. Retiring is reversible,
 * so it is the footer icon and not `btn--danger`; deleting is not, so it sits last behind prose.
 */
export function TemplateFormSheet({
  draft,
  config,
  me,
  onSubmit,
  onRetire,
  onRestore,
  onDelete,
  onClose,
}) {
  const { t } = useT()
  const { mode, template } = draft
  const editing = mode === 'edit'

  const [description, setDescription] = useState(template.description ?? '')
  const [amount, setAmount] = useState(
    template.amountYen == null ? '' : yenToSheetString(template.amountYen),
  )
  const [category, setCategory] = useState(template.category || config.categories[0] || '')
  const [payer, setPayer] = useState(template.payer || PERSON.P1)
  const [day, setDay] = useState(String(template.dayOfMonth ?? 1))
  /** The values a submit refused, so each error derives from one; `EntryFormSheet` says why. */
  const [rejected, setRejected] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [busy, setBusy] = useState(false)
  const nameErrorId = useId()
  const amountErrorId = useId()
  const dayErrorId = useId()
  const saveErrorId = useId()
  const nameInput = useRef(null)
  const amountInput = useRef(null)
  const dayInput = useRef(null)

  /** `allowDefault`, so a blank `payer_share` stays blank; `useEntrySplit` says why. */
  const split = useEntrySplit(template, config, payer, { allowDefault: true })

  const { label, possessive } = usePeopleLabels(config, me)
  const payerLabel = label(payer)
  const otherLabel = label(otherPerson(payer))

  const refused = rejected && templateFormProblem(rejected)
  const nameError =
    refused === 'description' && rejected.description === description
      ? t('error.missingDescription')
      : null
  const amountError =
    refused === 'amount' && rejected.amount === amount ? t('error.badTemplateAmount') : null
  const dayError = refused === 'day' && rejected.day === day ? t('error.badDay') : null

  // Through `isRetired`, never a second reading of `activeTo`: this picks which of two opposite
  // writes the footer performs, so a drift between readings flips a control.
  const retired = isRetired(template)

  function collect() {
    setSaveError(null)
    const problem = templateFormProblem({ description, amount, day })
    if (problem) {
      setRejected({ description, amount, day })
      // Focus follows the refusal; `EntryFormSheet` says why.
      const field = { description: nameInput, amount: amountInput, day: dayInput }[problem]
      field.current?.focus()
      return null
    }
    return edited()
  }

  /** Unjudged, because Delete needs the values too. */
  function edited() {
    return {
      ...template,
      description: description.trim(),
      amountYen: yen,
      category,
      payer,
      dayOfMonth: Number(day),
      payerShare: split.payerShare,
    }
  }

  async function run(write) {
    const input = collect()
    if (!input) return
    setBusy(true)
    try {
      await write(input)
      onClose()
    } catch (cause) {
      setBusy(false)
      setSaveError(errorMessage(cause, 'form.saveError'))
    }
  }

  // Blank is null, the value meaning "variable"; every other unreadable amount is already refused.
  const yen = amount.trim() ? parseAmountToYen(amount) : null
  return (
    <BottomSheet
      title={editing ? t('recurring.editTitle') : t('recurring.addTitle')}
      full
      onClose={onClose}
      footer={
        <SheetFormFooter
          formId="template-form"
          busy={busy}
          editing={editing}
          onCancel={onClose}
          leading={
            editing && (
              <button
                type="button"
                /* Away from Save, and not `btn--danger`: retiring is reversible. */
                className="btn btn--icon push-end"
                onClick={() => run(retired ? onRestore : onRetire)}
                disabled={busy}
                aria-label={retired ? t('recurring.restore') : t('recurring.retire')}
                /* Produces the same `saveError` Save does, and it is icon-only: described from
                   Save alone, nothing on the failing control could be re-read. */
                aria-describedby={saveError ? saveErrorId : undefined}
              >
                <RetireIcon />
              </button>
            )
          }
          describedBy={saveError ? saveErrorId : undefined}
        />
      }
    >
      <form
        id="template-form"
        className="stack"
        onSubmit={(event) => {
          event.preventDefault()
          run(onSubmit)
        }}
      >
        <Field htmlFor="template-name" label={t('recurring.name')}>
          <input
            id="template-name"
            ref={nameInput}
            className="input"
            type="text"
            autoComplete="off"
            /* iOS autocorrects a landlord's name into an English word it recognises. */
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            placeholder={t('recurring.namePlaceholder')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-invalid={nameError ? 'true' : undefined}
            aria-describedby={nameError ? nameErrorId : undefined}
          />
          {/* Inside its own field: at the foot it renders a screen below the input. */}
          {nameError && <FieldError id={nameErrorId}>{nameError}</FieldError>}
        </Field>

        <AmountField
          id="template-amount"
          inputRef={amountInput}
          value={amount}
          onChange={setAmount}
          error={amountError}
          errorId={amountErrorId}
          hint={t('recurring.amountHint')}
          placeholder={t('recurring.amountVaries')}
          /* Blank is a real answer, and the one a utility bill needs. */
          optional
        />

        <CategoryField
          id="template-category"
          value={category}
          categories={config.categories}
          onChange={setCategory}
        />

        <Segmented
          name="template-payer"
          label={t('common.whoPaid')}
          value={payer}
          options={PEOPLE.map((person) => [person, label(person)])}
          onChange={setPayer}
        />

        <Field htmlFor="template-day" label={t('recurring.day')} hint={t('recurring.dayHint')}>
          <input
            id="template-day"
            ref={dayInput}
            className="input tnum"
            type="number"
            min="1"
            max="31"
            step="1"
            value={day}
            onChange={(event) => setDay(event.target.value)}
            aria-invalid={dayError ? 'true' : undefined}
            aria-describedby={dayError ? dayErrorId : undefined}
          />
          {dayError && <FieldError id={dayErrorId}>{dayError}</FieldError>}
        </Field>

        <SplitField
          split={split}
          payerLabel={payerLabel}
          payerPossessive={possessive(payer)}
          otherLabel={otherLabel}
          amountYen={yen}
          /* `possessive`, not `label`: English inflects, and `label` reads "You’s default". */
          defaultLabel={t('recurring.splitDefault')}
          defaultHint={t('recurring.splitDefaultHint', {
            owner: possessive(payer),
            percent: split.configuredPercent,
          })}
        />

        <p className="field__hint">{t('recurring.sheetOnlyHint')}</p>

        {/* And what saving does NOT do — right, and invisible. */}
        {editing && <p className="field__hint">{t('recurring.editScopeHint')}</p>}

        {/* Last, where the irreversible thing belongs. The description is the whole guard: what is
            lost is the sheet's memory of which months this cost covered. */}
        {editing && (
          <Field label={t('recurring.deleteTitle')} description={t('recurring.deleteHint')}>
            <div className="row">
              <button
                type="button"
                className="btn btn--danger btn--sm"
                onClick={() => onDelete(edited())}
                disabled={busy}
              >
                {t('recurring.delete')}
              </button>
            </div>
          </Field>
        )}

        {/* Above the footer that produced it, and below the delete block, or the nearest words
            to a failed save are "Delete for good". */}
        {saveError && <FieldError id={saveErrorId}>{saveError}</FieldError>}
      </form>
    </BottomSheet>
  )
}
