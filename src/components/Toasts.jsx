/**
 * The live region sits on each toast rather than on the stack, because the two
 * tones need different urgency: a write failure must interrupt, a "Deleted"
 * confirmation must not. Two wrapper regions inside the stack would each need
 * their own layout and would break the visual order the two tones share, while
 * per-toast roles need no CSS at all.
 *
 * The cost of that choice: a region announces on INSERTION rather than on a
 * change to one already being watched. Safari does that reliably for
 * `role="alert"`, which is the failure — the half that must never be missed — and
 * best-effort for the polite confirmation, whose own sentence is also the least
 * consequential thing on screen. Keep the ordering if this is ever revisited.
 */
export function Toasts({ toasts }) {
  if (!toasts.length) return null

  return (
    <div className="toast-stack">
      {toasts.map((toast) => {
        const isError = toast.tone === 'error'
        return (
          <div
            key={toast.id}
            className={`toast${isError ? ' toast--error' : ''}`}
            role={isError ? 'alert' : 'status'}
            aria-live={isError ? 'assertive' : 'polite'}
          >
            <span>{toast.message}</span>
          </div>
        )
      })}
    </div>
  )
}
