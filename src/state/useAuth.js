import { useCallback, useEffect, useState } from 'react'
import { getUserEmail, hasToken, onAuthChange, signIn, signOut } from '../lib/googleAuth.js'
import { isConfigured } from '../config.js'

/**
 * Auth state for the UI.
 *
 * On mount it attempts one silent token grab so a returning visitor with a
 * live Google session lands straight in the app. That attempt failing is the
 * normal signed-out path, not an error worth showing.
 */
export function useAuth() {
  const [status, setStatus] = useState(isConfigured() ? 'restoring' : 'unconfigured')
  const [email, setEmail] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => onAuthChange(() => setStatus(hasToken() ? 'signed-in' : 'signed-out')), [])

  useEffect(() => {
    if (!isConfigured()) return
    let cancelled = false

    signIn({ silent: true })
      .then(async () => {
        if (cancelled) return
        setStatus('signed-in')
        setEmail(await getUserEmail())
      })
      .catch(() => {
        if (!cancelled) setStatus('signed-out')
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
