import { useT } from '../i18n/index.js'
import { formatYenParts } from '../lib/money.js'
import { Field, FieldError } from './Field.jsx'

/**
 * The yen field, for both forms that have one.
 *
 * `tnum` because digits are typed in one at a time and proportional figures shift every glyph.
 * `inputMode="numeric"` and not `decimal`: the yen has no sub-unit, so a decimal point on the pad
 * only invites an amount 100x wrong. `type="text"` rather than `number`, which would let a spinner
 * and a locale's grouping near a value `parseAmountToYen` has one reading of.
 *
 * The currency mark is the formatter's own, so it is the one the list prints, and sits on the side
 * the locale puts it. `aria-hidden` because the label already names the field; the mark is there
 * so "220000" reads as money at a glance.
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
  const { t, locale } = useT()
  const parts = formatYenParts(0, { locale })
  const symbolIndex = parts.findIndex((part) => part.type === 'currency')
  const trailing = symbolIndex > parts.findIndex((part) => part.type === 'integer')

  return (
    <Field
      htmlFor={id}
      label={t('form.amount')}
      optional={optional ? t('common.optional') : undefined}
      hint={hint}
    >
      <div className={`amount-input${trailing ? ' amount-input--trailing' : ''}`}>
        <span className="amount-input__symbol" aria-hidden="true">
          {parts[symbolIndex].value}
        </span>
        <input
          id={id}
          ref={inputRef}
          className="input input--amount tnum"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </div>
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  )
}
