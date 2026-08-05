import { useCallback, useEffect, useRef, useState } from 'react'
import { getUserEmail, hasToken, onAuthChange, signIn, signOut } from '../lib/googleAuth.js'
import { isConfigured } from '../config.js'
import { t } from '../i18n/index.js'

/**
 * Auth state for the UI.
 *
 * A token cached by a previous visit is trusted on mount, so a refresh does not
 * force another sign-in. There is deliberately no token *request* on mount: GIS
 * can only issue one through a popup, and a popup outside a user gesture is
 * blocked, so an automatic attempt is guaranteed to fail and logs an alarming
 * "Failed to open popup window" while doing it.
 *
 * When the cached token expires (about an hour), status becomes `'expired'`
 * rather than dropping straight back to the sign-in screen — but only if the
 * app was already showing signed-in state this load (`wasAuthed`). The app
 * stays mounted on whatever screen it was on, with whatever data it had
 * already loaded, and a small banner offers one tap to renew. That tap is
 * itself a user gesture, which is what lets the silent reissue succeed without
 * reopening Google's full consent flow. A token that was never valid this
 * load at all (or a deliberate sign-out) still goes to the full sign-in
 * screen, since there is nothing signed-in to preserve.
 */
export function useAuth() {
  const [status, setStatus] = useState(() => {
    if (!isConfigured()) return 'unconfigured'
    return hasToken() ? 'signed-in' : 'signed-out'
  })
  const [email, setEmail] = useState(null)
  const [error, setError] = useState(null)

  /** Distinguishes a deliberate sign-out from a session that fell over. */
  const deliberate = useRef(false)
  /** Whether this load has shown signed-in state at least once. */
  const wasAuthed = useRef(hasToken())
  /** StrictMode re-runs mount effects in development; one email fetch is enough. */
  const fetchedEmail = useRef(false)

  useEffect(
    () =>
      onAuthChange(() => {
        if (hasToken()) {
          wasAuthed.current = true
          setStatus('signed-in')
          setError(null)
          return
        }
        if (deliberate.current) {
          deliberate.current = false
          wasAuthed.current = false
          setStatus('signed-out')
          setEmail(null)
          fetchedEmail.current = false
          setError(null)
          return
        }
        if (wasAuthed.current) {
          // A background reissue failed for want of a gesture — typically an
          // hour in, when the old token expires while the app just sits
          // there. The banner supplies the gesture on the next tap; nothing
          // here needs to unmount.
          setStatus('expired')
          return
        }
        // Reached only if a token request failed before the app ever showed
        // signed-in state this load — nothing to preserve, so fall back to
        // the full sign-in screen.
        setStatus('signed-out')
        setEmail(null)
        fetchedEmail.current = false
        setError(t('error.sessionExpired'))
      }),
    [],
  )

  // Resolve the email for a token restored from storage. A fresh sign-in gets
  // it from start() instead, so this only runs on the rehydrated path.
  useEffect(() => {
    if (!hasToken() || fetchedEmail.current) return
    fetchedEmail.current = true
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
      fetchedEmail.current = true
      setEmail(await getUserEmail())
    } catch (cause) {
      setStatus('signed-out')
      setError(cause.message || t('error.signIn'))
    }
  }, [])

  /**
   * Re-issue a token after expiry without the full consent screen — used by
   * the `'expired'` banner rather than `start`, which forces `prompt:
   * 'consent'` on purpose for a brand-new sign-in. The tap that invokes this
   * is the user gesture the popup needs; onAuthChange picks up the result.
   */
  const reconnect = useCallback(async () => {
    setError(null)
    try {
      await signIn({ silent: true })
    } catch (cause) {
      setError(cause.message || t('error.signIn'))
    }
  }, [])

  const end = useCallback(async () => {
    deliberate.current = true
    await signOut().catch(() => {})
    setEmail(null)
    setError(null)
    setStatus('signed-out')
  }, [])

  return { status, email, error, signIn: start, reconnect, signOut: end }
}
