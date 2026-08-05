/**
 * The live region sits on each toast rather than on the stack, because the two
 * tones need different urgency: a write failure must interrupt, an Undo offer
 * must not. Two wrapper regions inside the stack would need their own layout —
 * per-toast roles need no CSS at all, and a freshly inserted alert/status is
 * announced the same way.
 */
export function Toasts({ toasts, onDismiss }) {
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
            {toast.action ? (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  onDismiss(toast.id)
                  toast.action.onClick()
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
