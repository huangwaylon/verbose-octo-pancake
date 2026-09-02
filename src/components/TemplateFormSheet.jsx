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
 * SIX of the tab's ten columns. `months`, `active_from` and `active_to` stay Sheets-only —
 * quarterly and annual costs are rare and three more controls would earn their place on
 * nobody's phone — but they ride along on the draft and get written back, because a save writes
 * the whole row and a form that dropped them would silently turn a quarterly cost into a
 * monthly one.
 *
 * TWO ways to stop a cost, and the footer holds the safe one. Retiring sets `active_to`, which
 * keeps the row and therefore the instance id, so every month it has already posted stays
 * recorded — `retiredTemplate` says why that matters. Being reversible is also why it needs no
 * confirmation and is not `btn--danger`.
 *
 * Deleting the row is the other, and it sits LAST IN THE BODY behind a confirmation, where
 * `SettingsSheet` puts "Forget key" and for the same reasons: reachable, explained, and not the
 * button a thumb lands on by default. Its own `Field` carries what it costs, because the cost is
 * not guessable from the word "delete".
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
  /**
   * The exact values a submit rejected, so each field's error is DERIVED from the value that
   * was refused: it clears the instant that field is edited and never returns without another
   * submit. Stored as messages they would linger over values that are now fine and freeze in
   * whichever language was current when they were built; keyed on a bare "has submitted" flag
   * they would come back mid-edit, because every select-all-and-retype passes through ''.
   */
  const [rejected, setRejected] = useState(null)
  /**
   * `saveError` IS stored, and that is the deliberate opposite: nothing about the form's own
   * values can tell you the network failed.
   */
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

  /**
   * Each error derived from the exact value that was refused, and which field is refused at all
   * is `templateFormProblem`'s decision — in lib, where a test can reach it.
   */
  const refused = rejected && templateFormProblem(rejected)
  const nameError =
    refused === 'description' && rejected.description === description
      ? t('recurring.nameError')
      : null
  const amountError =
    refused === 'amount' && rejected.amount === amount ? t('error.badTemplateAmount') : null
  const dayError = refused === 'day' && rejected.day === day ? t('error.badDay') : null

  const retired = Boolean(template.activeTo)

  /**
   * What the form says, or null with the first bad field focused.
   *
   * Shared by Save and by Stop/Start, so retiring cannot silently discard an edit made in the
   * same visit — and so the two paths cannot disagree about what a blank amount means.
   */
  function collect() {
    setSaveError(null)
    const problem = templateFormProblem({ description, amount, day })
    if (problem) {
      setRejected({ description, amount, day })
      // Focus follows the refusal. Each error is a newly INSERTED `role="status"`, which iOS
      // announces unreliably, and the button pressed is at the foot of a full-screen sheet —
      // so without this a VoiceOver user hears nothing and has no idea which field is wrong.
      // `BottomSheet`'s `focusin` handler scrolls it in.
      const field = { description: nameInput, amount: amountInput, day: dayInput }[problem]
      field.current?.focus()
      return null
    }
    return {
      ...template,
      description: description.trim(),
      // Blank IS a value here: it means variable, which is what a utility bill is.
      amountYen: amount.trim() ? parseAmountToYen(amount) : null,
      category,
      payer,
      dayOfMonth: Number(day),
      payerShare: split.payerShare,
    }
  }

  /** Both write paths report the same way; only which one they call differs. */
  async function run(write) {
    const input = collect()
    if (!input) return
    setBusy(true)
    try {
      await write(input)
      onClose()
    } catch (cause) {
      setBusy(false)
      setSaveError(errorMessage(cause, 'recurring.saveError'))
    }
  }

  // Two integer operations, so it is recomputed rather than memoised. Absent in Default mode,
  // where the share is deliberately null and there is no number to split by yet.
  const yen = parseAmountToYen(amount)
  const shares = yen == null || split.payerShare == null ? null : splitYen(yen, split.payerShare)

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
          breakdown={
            shares &&
            t('form.breakdown', {
              payer: payerLabel,
              payerAmount: money(shares.payerYen),
              other: otherLabel,
              otherAmount: money(shares.otherYen),
            })
          }
          /* Names the person and the number it would follow: "Default" alone says nothing
             about what gets saved, and what gets saved is a BLANK cell. `possessive`, not
             `label` — English inflects, and `label` reads "You’s default split". */
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
                onClick={() => onDelete(template)}
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
