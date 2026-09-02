/**
 * A labelled form field: the label, the control, and prose above or below it.
 *
 * One home for the `<label htmlFor>` vs `<span>` decision, which is an accessibility
 * decision rather than a styling one: `htmlFor` when the field wraps ONE control that can
 * own the name, a `<span>` when it wraps several — a radio group, a row of pills, a button
 * plus its result — because a `<label>` pointing at a group makes a screen reader announce
 * the wrong element.
 *
 * @param {object} props
 * @param {string} [props.htmlFor] id of the single control this label names
 * @param {string} [props.labelId] id to put ON the label, for a group that names itself
 *   with `aria-labelledby` instead of a `for`/`id` pair
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
 * A message a control produced.
 *
 * The `id` is required rather than generated, because the point of the element is to
 * be named by the `aria-describedby` of whichever control produced it — and that is
 * not always the control beside it: the entry form's save failure sits at the foot of
 * the form and is described from the SUBMIT button in the footer, outside the form
 * entirely. Ids are document-global, so that works; a generated one could not be
 * referenced.
 *
 * `role="status"` because the text appears and changes without a page change.
 */
export function FieldError({ id, children }) {
  return (
    <p className="field__error" id={id} role="status">
      {children}
    </p>
  )
}
