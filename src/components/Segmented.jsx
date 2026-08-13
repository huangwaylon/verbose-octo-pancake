import { useId } from 'react'

/**
 * The segmented radio group: two or three mutually exclusive options, styled as
 * one control.
 *
 * Four places wanted this — payer, split mode, identity and language — and each
 * hand-rolled copy carried the same accessibility gap. A `<div>` of radios has no
 * accessible name of its own, so the visible `field__label` beside it was not
 * announced with the group; `role="radiogroup"` plus `aria-labelledby` is what
 * ties them together. The `name` still has to be unique per group, since radios
 * with a shared name are one group to the browser regardless of markup.
 *
 * @param {object} props
 * @param {string} props.name form-control name, unique per group on the page
 * @param {string} props.label visible label text, also the group's accessible name
 * @param {string} props.value the selected option's value
 * @param {Array<[string, string]>} props.options `[value, label]` pairs
 * @param {(value: string) => void} props.onChange
 * @param {import('react').ReactNode} [props.children] further controls belonging to
 *   the same field, e.g. the slider the split's Custom option reveals
 * @param {import('react').ReactNode} [props.hint] shown last, under the control
 */
export function Segmented({ name, label, value, options, onChange, children, hint }) {
  const labelId = `${useId()}-label`

  return (
    <div className="field">
      <span className="field__label" id={labelId}>
        {label}
      </span>
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
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  )
}
