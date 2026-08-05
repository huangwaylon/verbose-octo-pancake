import { useCallback, useRef, useState } from 'react'

const DEFAULT_DURATION = 4000
const UNDO_DURATION = 7000
const ERROR_DURATION = 6000

/**
 * A tiny toast stack. Used for two things: reporting write failures, and
 * offering Undo after a delete — which is why deletes need no confirm dialog.
 */
export function useToasts() {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    ({ message, tone = 'info', action, duration }) => {
      const id = crypto.randomUUID()
      const ttl = duration ?? (action ? UNDO_DURATION : DEFAULT_DURATION)
      setToasts((current) => [...current, { id, message, tone, action }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), ttl),
      )
    },
    [dismiss],
  )

  const error = useCallback(
    (message) => push({ message, tone: 'error', duration: ERROR_DURATION }),
    [push],
  )

  return { toasts, push, error, dismiss }
}
