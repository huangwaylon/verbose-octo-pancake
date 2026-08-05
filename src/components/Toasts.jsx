export function Toasts({ toasts, onDismiss }) {
  if (!toasts.length) return null

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast${toast.tone === 'error' ? ' toast--error' : ''}${
            toast.tone === 'success' ? ' toast--success' : ''
          }`}
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
      ))}
    </div>
  )
}
