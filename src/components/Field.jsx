/**
 * The one home of the `<label htmlFor>` vs `<span>` decision, which is an accessibility one:
 * `htmlFor` when the field wraps ONE control that can own the name, a `<span>` when it wraps several,
 * because a `<label>` naming a group announces the wrong element.
 *
 * `optional` is here rather than composed by each caller for the same reason: the marker's class,
 * and the space in front of it, are one decision. `labelId` goes ON the label, for a group named by
 * `aria-labelledby`; `description` is prose above the control and `hint` below it.
 *
 * The control is the caller's, so the ids it is described by are too: `descriptionId`, `hintId` and
 * `errorId` land on the prose they name, and the control joins them with `describedBy`. An `error`
 * renders between the control and the hint, inside the field, where it is seen from the input.
 */
export function Field({
  label,
  htmlFor,
  labelId,
  optional,
  description,
  descriptionId,
  hint,
  hintId,
  error,
  errorId,
  children,
}) {
  const text = optional ? (
    <>
      {label} <span className="field__hint">{optional}</span>
    </>
  ) : (
    label
  )

  return (
    <div className="field">
      {htmlFor ? (
        <label className="field__label" htmlFor={htmlFor} id={labelId}>
          {text}
        </label>
      ) : (
        <span className="field__label" id={labelId}>
          {text}
        </span>
      )}
      {description ? (
        <p className="field__hint" id={descriptionId}>
          {description}
        </p>
      ) : null}
      {children}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The `id` is required rather than generated because this element is named by the `aria-describedby`
 * of whichever control produced it — not always the one beside it: the entry form's save failure is
 * described from the SUBMIT button.
 *
 * `role="status"` for a field's own error, which appears as it is typed into. `urgent` is for a
 * failed write: the submit that produced it has just disabled itself and dropped VoiceOver's focus,
 * and a polite region appearing then is one iOS often never reads.
 */
export function FieldError({ id, urgent = false, children }) {
  return (
    <p className="field__error" id={id} role={urgent ? 'alert' : 'status'}>
      {children}
    </p>
  )
}

/** The ids a control is described by, or none — `aria-describedby=""` names nothing, noisily. */
export function describedBy(...ids) {
  return ids.filter(Boolean).join(' ') || undefined
}

/**
 * For a field holding a name rather than prose — a shop, a landlord, the app key: iOS capitalises
 * "Ozeki" and autocorrects it into an English word it recognises.
 */
export const LITERAL_TEXT = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }
