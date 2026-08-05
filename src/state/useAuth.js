import { useCallback, useEffect, useState } from 'react'
import { getUserEmail, hasToken, onAuthChange, signIn, signOut } from '../lib/googleAuth.js'
import { isConfigured } from '../config.js'

/**
 * Auth state for the UI.
 *
 * A token cached by a previous visit is trusted on mount, so a refresh does not
 * force another sign-in. There is deliberately no token *request* on mount: GIS
 * can only issue one through a popup, and a popup outside a user gesture is
 * blocked, so an automatic attempt is guaranteed to fail and logs an alarming
 * "Failed to open popup window" while doing it. When the cached token expires
 * (about an hour) the next request drops back to the sign-in screen, which is
 * inherent to the token flow — there is no refresh token to renew from.
 */
export function useAuth() {
  const [status, setStatus] = useState(() => {
    if (!isConfigured()) return 'unconfigured'
    return hasToken() ? 'signed-in' : 'signed-out'
  })
  const [email, setEmail] = useState(null)
  const [error, setError] = useState(null)

  useEffect(
    () =>
      onAuthChange(() => {
        if (hasToken()) {
          setStatus('signed-in')
          return
        }
        // Reached when a token request failed for want of a gesture (typically
        // an hour in, when the old token expires mid-session) or the grant was
        // revoked. Falling back to the sign-in screen makes the next attempt a
        // real click instead of a background failure.
        setStatus('signed-out')
        setEmail(null)
      }),
    [],
  )

  // Resolve the email for a token restored from storage. A fresh sign-in gets
  // it from start() instead, so this only runs on the rehydrated path.
  useEffect(() => {
    if (!hasToken()) return
    let cancelled = false
    getUserEmail().then((value) => {
      if (!cancelled) setEmail(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setStatus('signing-in')
    try {
      await signIn({ silent: false })
      setStatus('signed-in')
      setEmail(await getUserEmail())
    } catch (cause) {
      setStatus('signed-out')
      setError(cause.message || 'Sign-in failed.')
    }
  }, [])

  const end = useCallback(async () => {
    await signOut().catch(() => {})
    setEmail(null)
    setStatus('signed-out')
  }, [])

  return { status, email, error, signIn: start, signOut: end }
}
