import { useId } from 'react'
import { Field } from './Field.jsx'

/**
 * The segmented radio group. A `<div>` of radios has no accessible name of its own, so
 * `role="radiogroup"` plus `aria-labelledby` is what ties the visible `field__label` to it. The
 * `name` must be unique per group: radios sharing one are a single group to the browser.
 *
 * @param {object} props
 * @param {Array<[string, string]>} props.options `[value, label]` pairs
 * @param {import('react').ReactNode} [props.children] further controls in the same field, e.g. the
 *   slider the split's Custom option reveals
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
