/**
 * The one home of the `<label htmlFor>` vs `<span>` decision, which is an accessibility one:
 * `htmlFor` when the field wraps ONE control that can own the name, a `<span>` when it wraps several,
 * because a `<label>` naming a group announces the wrong element.
 *
 * @param {object} props
 * @param {string} [props.labelId] id to put ON the label, for a group using `aria-labelledby`
 * @param {import('react').ReactNode} [props.description] prose above the control
 * @param {import('react').ReactNode} [props.hint] prose below the control
 */
export function Field({ label, htmlFor, labelId, description, hint, children }) {
  return (
    <div className="field">
      {htmlFor ? (
        <label className="field__label" htmlFor={htmlFor} id={labelId}>
          {label}
        </label>
      ) : (
        <span className="field__label" id={labelId}>
          {label}
        </span>
      )}
      {description ? <p className="field__hint">{description}</p> : null}
      {children}
      {hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  )
}

/**
 * The `id` is required rather than generated because this element is named by the `aria-describedby`
 * of whichever control produced it — not always the one beside it: the entry form's save failure is
 * described from the SUBMIT button. `role="status"` because it appears without a page change.
 */
export function FieldError({ id, children }) {
  return (
    <p className="field__error" id={id} role="status">
      {children}
    </p>
  )
}
