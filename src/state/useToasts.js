import { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_DURATION = 4000
const ERROR_DURATION = 6000

/**
 * How many are on screen at once. The stack takes no pointer events and the layout
 * reserves no band for it, so it overlays the last rows of the ledger — six failed
 * writes in six seconds would cover them. The NEWEST are kept: an older toast has
 * had its moment, and its timer still fires, so nothing leaks.
 */
const MAX_VISIBLE = 3

/**
 * A tiny toast stack. Two jobs: reporting a write failure, and confirming that a
 * delete or a restore actually reached the sheet. Nothing here is interactive —
 * a deleted entry is recovered from the deleted list, not from a toast that has
 * probably already timed out.
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
    ({ message, tone = 'info', duration = DEFAULT_DURATION }) => {
      const id = crypto.randomUUID()
      setToasts((current) => [...current, { id, message, tone }].slice(-MAX_VISIBLE))
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      )
    },
    [dismiss],
  )

  const error = useCallback(
    (message) => push({ message, tone: 'error', duration: ERROR_DURATION }),
    [push],
  )

  // A toast outlives its ttl on sign-out: the timeout fires against an unmounted
  // component and setState warns. Read the ref once, per the exhaustive-deps
  // rule about touching `.current` in a cleanup.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  return { toasts, push, error }
}
