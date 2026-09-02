import { useId, useRef, useState } from 'react'
import { BottomSheet } from './BottomSheet.jsx'
import { parseAmountToYen, splitYen, yenToSheetString } from '../lib/money.js'
import { defaultSplitFor } from '../lib/split.js'
import { templateFormProblem } from '../lib/recurring.js'
import { PEOPLE, PERSON, otherPerson } from '../schema.js'
import { errorMessage, useMoney, usePeopleLabels, useT } from '../i18n/index.js'
import { Field, FieldError } from './Field.jsx'
import { CategoryField } from './CategoryField.jsx'
import { Segmented } from './Segmented.jsx'
import { SplitField, useEntrySplit } from './SplitField.jsx'
import { RetireIcon } from './icons.jsx'

/**
 * Add or edit one recurring cost.
 *
 * The order is by what IDENTIFIES the cost rather than by how often a field is touched, which
 * is the entry form's rule and the right one there: a template is filled in once and then read
 * in a list, so the name leads because it is the only thing naming the row on screen, and the
 * amount follows because it is the second thing anyone recognises it by.
 *
 * SIX of the tab's ten columns; the other three ride the draft untouched, because a save writes
 * the whole row and dropping them would silently turn a quarterly cost into a monthly one.
 *
 * TWO ways to stop a cost, and their placement is the difference between them. Retiring is
 * reversible, so it is the footer icon and not `btn--danger`. Deleting is not, so it sits last
 * in the body behind prose that says what it costs — where `SettingsSheet` puts "Forget key",
 * and for the same reasons.
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
  const money = useMoney()
  const { mode, template } = draft
  const editing = mode === 'edit'

  const [description, setDescription] = useState(template.description ?? '')
  const [amount, setAmount] = useState(
    template.amountYen == null ? '' : yenToSheetString(template.amountYen),
  )
  const [category, setCategory] = useState(template.category || config.categories[0] || '')
  const [payer, setPayer] = useState(template.payer || PERSON.P1)
  const [day, setDay] = useState(String(template.dayOfMonth ?? 1))
  /** The values a submit refused, so each error is derived from one. `EntryFormSheet` says why. */
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

  /** `allowDefault`, so a blank `payer_share` stays blank. `useEntrySplit` says why. */
  const split = useEntrySplit(template, config, payer, { allowDefault: true })

  const { label, possessive } = usePeopleLabels(config, me)
  const payerLabel = label(payer)
  const otherLabel = label(otherPerson(payer))

  /** Which field is refused is `templateFormProblem`'s decision, in lib. */
  const refused = rejected && templateFormProblem(rejected)
  const nameError =
    refused === 'description' && rejected.description === description
      ? t('error.missingDescription')
      : null
  const amountError =
    refused === 'amount' && rejected.amount === amount ? t('error.badTemplateAmount') : null
  const dayError = refused === 'day' && rejected.day === day ? t('error.badDay') : null

  const retired = Boolean(template.activeTo)

  /** What the form says, or null with the first bad field focused. Shared by every write. */
  function collect() {
    setSaveError(null)
    const problem = templateFormProblem({ description, amount, day })
    if (problem) {
      setRejected({ description, amount, day })
      // Focus follows the refusal, for the reason `EntryFormSheet` gives.
      const field = { description: nameInput, amount: amountInput, day: dayInput }[problem]
      field.current?.focus()
      return null
    }
    return edited()
  }

  /** The form's values as a template, without judging them. Delete needs this too. */
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

  /** Every write path reports the same way; only which one it calls differs. */
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

  // Blank parses to null, which is the value that means "variable"; `templateFormProblem` has
  // already refused every other unreadable amount by the time `collect` reads this.
  const yen = amount.trim() ? parseAmountToYen(amount) : null
  const shares = yen == null || split.payerShare == null ? null : splitYen(yen, split.payerShare)
  const breakdown =
    shares &&
    t('form.breakdown', {
      payer: payerLabel,
      payerAmount: money(shares.payerYen),
      other: otherLabel,
      otherAmount: money(shares.otherYen),
    })

  return (
    <BottomSheet
      title={editing ? t('recurring.editTitle') : t('recurring.addTitle')}
      full
      onClose={onClose}
      footer={
        <>
          {editing && (
            <button
              type="button"
              /* push-end shoves it to the far left of the right-aligned footer, away from
                 Save. Not `btn--danger`: retiring is reversible, so colouring it as
                 destructive would overstate what it does. */
              className="btn btn--icon push-end"
              onClick={() => run(retired ? onRestore : onRetire)}
              disabled={busy}
              aria-label={retired ? t('recurring.restore') : t('recurring.retire')}
            >
              <RetireIcon />
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="template-form"
            className="btn btn--primary"
            disabled={busy}
            /* The failure this button produced has to be reachable FROM it. Ids are
               document-global, so sitting outside the form is no obstacle. */
            aria-describedby={saveError ? saveErrorId : undefined}
          >
            {busy ? <span className="spinner" /> : editing ? t('common.save') : t('common.add')}
          </button>
        </>
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
            /* Same reason as the note field: iOS autocorrects a shop or a landlord's name
               into an English word it recognises. */
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            placeholder={t('recurring.namePlaceholder')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-invalid={nameError ? 'true' : undefined}
            aria-describedby={nameError ? nameErrorId : undefined}
          />
          {/* Inside its own field, not at the foot: from down there it renders a screen's
              worth below the input, with nothing scrolling it into view on submit. */}
          {nameError && <FieldError id={nameErrorId}>{nameError}</FieldError>}
        </Field>

        <Field
          htmlFor="template-amount"
          label={
            <>
              {t('form.amount')} <span className="field__hint">{t('common.optional')}</span>
            </>
          }
          hint={t('recurring.amountHint')}
        >
          <input
            id="template-amount"
            ref={amountInput}
            className="input tnum"
            type="text"
            /* The yen has no sub-unit, so a decimal point on the pad would only invite an
               amount 100x wrong. */
            inputMode="numeric"
            autoComplete="off"
            placeholder={t('recurring.amountVaries')}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={amountError ? 'true' : undefined}
            aria-describedby={amountError ? amountErrorId : undefined}
          />
          {amountError && <FieldError id={amountErrorId}>{amountError}</FieldError>}
        </Field>

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
          breakdown={breakdown}
          /* `possessive`, not `label` — English inflects, and `label` reads "You’s default". */
          defaultLabel={t('recurring.splitDefault')}
          defaultHint={t('recurring.splitDefaultHint', {
            owner: possessive(payer),
            percent: Math.round(defaultSplitFor(config, payer) * 100),
          })}
        />

        {/* The three columns this form does not show, said out loud — otherwise a quarterly
            cost edited here looks like it lost its schedule. */}
        <p className="field__hint">{t('recurring.sheetOnlyHint')}</p>

        {/* And what saving does NOT do: a month already recorded keeps the figures it was
            recorded with, which is right and completely invisible. */}
        {editing && <p className="field__hint">{t('recurring.editScopeHint')}</p>}

        {saveError && <FieldError id={saveErrorId}>{saveError}</FieldError>}

        {/* Last in the body, where the irreversible thing belongs. The description is the
            whole guard: what a deleted row costs is the sheet's memory of which months this
            cost already covered, and nothing about the word "delete" says that. */}
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
      </form>
    </BottomSheet>
  )
}
