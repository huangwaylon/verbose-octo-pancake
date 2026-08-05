import { useCallback, useEffect, useState } from 'react'
import { getUserEmail, hasToken, onAuthChange, signIn, signOut } from '../lib/googleAuth.js'
import { isConfigured } from '../config.js'

/**
 * Auth state for the UI.
 *
 * There is deliberately no attempt to restore a session on mount. GIS can only
 * issue a token through a popup, and a popup outside a user gesture is blocked,
 * so an automatic attempt is guaranteed to fail and logs an alarming
 * "Failed to open popup window" to the console while doing it. Every visit
 * therefore starts signed-out and needs one click, which is inherent to the
 * token flow — there is no refresh token to restore from.
 */
export function useAuth() {
  const [status, setStatus] = useState(isConfigured() ? 'signed-out' : 'unconfigured')
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
