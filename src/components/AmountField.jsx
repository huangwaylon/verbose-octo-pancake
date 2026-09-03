import { useT } from '../i18n/index.js'
import { Field, FieldError } from './Field.jsx'

/**
 * The yen field, for both forms that have one.
 *
 * `tnum` because digits are typed in one at a time and proportional figures shift every glyph.
 * `inputMode="numeric"` and not `decimal`: the yen has no sub-unit, so a decimal point on the pad
 * only invites an amount 100x wrong. `type="text"` rather than `number`, which would let a spinner
 * and a locale's grouping near a value `parseAmountToYen` has one reading of.
 *
 * The error renders INSIDE the field: at the foot of the form it draws a screen below the input,
 * with nothing scrolling it into view on submit.
 *
 * @param {object} props
 * @param {boolean} [props.optional] blank is a real answer — true only for a template
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
