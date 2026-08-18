/**
 * A labelled form field: the label, the control, and prose above or below it.
 *
 * One home for the `<label htmlFor>` vs `<span>` decision, which is an accessibility
 * decision rather than a styling one: `htmlFor` when the field wraps ONE control that
 * can own the name, a `<span>` when it wraps several — a radio group, a row of pills, a
 * button plus its result — because a `<label>` pointing at a group makes a screen
 * reader announce the wrong element.
 *
 * `description` sits above the control and `hint` below it; which one a field wants
 * is a reading-order decision the call site makes. `labelId` is for a group that
 * names itself with `aria-labelledby` instead of a `for`/`id` pair.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.label
 * @param {string} [props.htmlFor] id of the single control this label names
 * @param {string} [props.labelId] id to put ON the label, for aria-labelledby
 * @param {import('react').ReactNode} [props.description] prose above the control
 * @param {import('react').ReactNode} [props.hint] prose below the control
 * @param {import('react').ReactNode} [props.children] the control
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
