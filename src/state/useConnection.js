import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  connect,
  forgetKey,
  getAccessToken,
  getSpreadsheetId,
  hasKey,
  keyIsSuspect,
  onConnectionChange,
} from '../lib/connection.js'
import { isConfigured } from '../config.js'

/**
 * Connection state for the UI.
 *
 * Nothing here can expire in a way the user has to see: a token is re-minted by a
 * plain `fetch`, so there is no gesture to collect, no popup to survive, and no
 * "your session ended" state to tell apart from a deliberate sign-out.
 *
 * A key the endpoint has rejected is reported as `suspect` and KEPT — see
 * `connection.js` for why that is the better failure mode.
 */

/**
 * One primitive covering everything a render depends on, so the store snapshot is
 * referentially stable and cannot loop.
 */
function snapshot() {
  return `${hasKey() ? 1 : 0}${keyIsSuspect() ? 1 : 0}:${getSpreadsheetId() ?? ''}`
}

export function useConnection() {
  // The third argument is required, not optional: `renderToStaticMarkup` has no
  // client snapshot and omitting it throws, which is how every render test runs.
  useSyncExternalStore(onConnectionChange, snapshot, snapshot)

  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState(null)

  const start = useCallback(async (key) => {
    setConnecting(true)
    setError(null)
    try {
      await connect(key)
      return true
    } catch (cause) {
      setError(cause)
      return false
    } finally {
      setConnecting(false)
    }
  }, [])

  /**
   * Mint once on mount when the sheet id is not already cached.
   *
   * Without this the app deadlocks on a cold start: `useLedger` will not read
   * until it has an id, the id only arrives with a token, and nothing else asks
   * for a token until there is something to read.
   *
   * An effect rather than module scope on purpose — these modules also load under
   * vitest's `node` environment, where a fetch at import time would hit the
   * network from CI.
   */
  const bootstrapped = useRef(false)
  const bootstrap = useCallback(() => {
    if (!hasKey() || getSpreadsheetId()) return
    setError(null)
    getAccessToken().catch(setError)
  }, [])

  useEffect(() => {
    // StrictMode runs mount effects twice in development; one mint is enough.
    if (bootstrapped.current) return
    bootstrapped.current = true
    bootstrap()
  }, [bootstrap])

  const forget = useCallback(() => {
    setError(null)
    bootstrapped.current = false
    forgetKey()
  }, [])

  // A stored key the endpoint rejected sends us back to the key screen, which
  // shows why. The key itself stays on the device either way.
  const status = !isConfigured()
    ? 'unconfigured'
    : !hasKey() || keyIsSuspect()
      ? 'no-key'
      : 'connected'

  return {
    status,
    connecting,
    error,
    suspect: keyIsSuspect(),
    spreadsheetId: getSpreadsheetId(),
    connect: start,
    retry: bootstrap,
    forget,
  }
}
