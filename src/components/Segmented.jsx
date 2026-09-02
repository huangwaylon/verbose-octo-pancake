import { useId } from 'react'
import { Field } from './Field.jsx'

/**
 * The segmented radio group: two or three mutually exclusive options, styled as
 * one control. Four call sites — payer, split mode, identity and language.
 *
 * A `<div>` of radios has no accessible name of its own, so the visible `field__label`
 * beside it is not announced with the group; `role="radiogroup"` plus `aria-labelledby`
 * is what ties them together. The `name` still has to be unique per group, since radios
 * with a shared name are one group to the browser regardless of markup.
 *
 * @param {object} props
 * @param {string} props.name form-control name, unique per group on the page
 * @param {Array<[string, string]>} props.options `[value, label]` pairs
 * @param {import('react').ReactNode} [props.children] further controls belonging to the
 *   same field, e.g. the slider the split's Custom option reveals
 * @param {import('react').ReactNode} [props.hint] shown last, under the control
 */
export function Segmented({ name, label, value, options, onChange, children, hint }) {
  const labelId = useId()

  return (
    <Field label={label} labelId={labelId} hint={hint}>
      <div className="segmented" role="radiogroup" aria-labelledby={labelId}>
        {options.map(([optionValue, optionLabel]) => (
          <label className="segmented__option" key={optionValue}>
            <input
              type="radio"
              name={name}
              value={optionValue}
              checked={value === optionValue}
              onChange={() => onChange(optionValue)}
            />
            {optionLabel}
          </label>
        ))}
      </div>
      {children}
    </Field>
  )
}
