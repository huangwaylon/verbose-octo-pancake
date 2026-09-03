import { useT } from '../i18n/index.js'
import { Field, FieldError } from './Field.jsx'

/**
 * The yen field, for both forms that have one.
 *
 * Written twice, the copies drifted: the two disagreed about where a save failure sits and
 * about which of them says its amount is optional. Everything here is load-bearing and none of
 * it is obvious, which is the other half of why it is one component —
 *
 * `tnum` because this is the one field digits are typed into one at a time, and proportional
 * figures shift every glyph as the value grows. `inputMode="numeric"` and not `decimal`: the
 * yen has no sub-unit, so a decimal point on the pad would only invite an amount 100x wrong.
 * `type="text"` rather than `number`, which would let a spinner and a locale's own grouping
 * near a value `parseAmountToYen` has one reading of.
 *
 * The error renders INSIDE the field. `aria-describedby` reaches it from anywhere, but at the
 * foot of the form it draws a screen's worth below the input it describes, with nothing
 * scrolling it into view on submit.
 *
 * @param {object} props
 * @param {boolean} [props.optional] whether a blank value is a real answer — true only for a
 *   template, where blank means the amount varies month to month
 */
export function AmountField({
  id,
  inputRef,
  value,
  onChange,
  error,
  errorId,
  hint,
  placeholder,
  optional = false,
}) {
  const { t } = useT()

  return (
    <Field
      htmlFor={id}
      label={
        optional ? (
          <>
            {t('form.amount')} <span className="field__hint">{t('common.optional')}</span>
          </>
        ) : (
          t('form.amount')
        )
      }
      hint={hint}
    >
      <input
        id={id}
        ref={inputRef}
        className="input tnum"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  )
}
