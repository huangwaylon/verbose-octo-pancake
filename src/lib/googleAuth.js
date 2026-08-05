/**
 * Google Identity Services OAuth, browser-only.
 *
 * There is no backend and no client secret, so this uses the implicit token
 * flow: GIS hands us a short-lived access token in memory and we re-acquire it
 * silently when it expires. No refresh token exists to store, and we
 * deliberately never persist the access token (see `accessToken` below).
 */

import { GOOGLE_CLIENT_ID, OAUTH_SCOPE } from '../config.js'

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

/** Re-acquire this far before actual expiry so in-flight requests don't 401. */
const EXPIRY_MARGIN_MS = 60_000

/**
 * The access token lives ONLY here, in module memory. It is never written to
 * localStorage or sessionStorage: a persisted bearer token is readable by any
 * XSS on the origin and outlives the tab, and GIS can silently re-issue one
 * anyway, so persisting it would be pure downside.
 */
let accessToken = null
let expiresAt = 0

let scriptPromise = null
let tokenClient = null
/** Set while a token request is in flight, so concurrent callers share it. */
let pendingRequest = null

const listeners = new Set()

function notify() {
  for (const listener of listeners) listener(hasToken())
}

/** Injects the GIS script at most once; later calls reuse the cached promise. */
function loadGis() {
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve(window.google.accounts.oauth2)
      return
    }

    const existing = document.querySelector(`script[src="${GIS_SRC}"]`)
    const script = existing ?? document.createElement('script')

    const onLoad = () => {
      if (window.google?.accounts?.oauth2) resolve(window.google.accounts.oauth2)
      else reject(new Error('Google Identity Services loaded but oauth2 is unavailable.'))
    }
    const onError = () => {
      scriptPromise = null
      reject(new Error('Could not load Google Identity Services. Check your network connection.'))
    }

    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })

    if (!existing) {
      script.src = GIS_SRC
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
  })

  return scriptPromise
}

async function getTokenClient() {
  const oauth2 = await loadGis()
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('Missing VITE_GOOGLE_CLIENT_ID. See SETUP.md.')
  }
  if (!tokenClient) {
    // callback/error_callback are assigned per-request in requestToken().
    tokenClient = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: OAUTH_SCOPE,
      callback: () => {},
    })
  }
  return tokenClient
}

/**
 * Wraps the GIS token client, which is callback-based rather than
 * promise-based, into a promise. Only one request runs at a time — Google's
 * client ignores overlapping requests, so concurrent callers share the result.
 *
 * @param {string} prompt '' for a silent attempt, 'consent' to show the dialog
 */
function requestToken(prompt) {
  if (pendingRequest) return pendingRequest

  pendingRequest = getTokenClient()
    .then(
      (client) =>
        new Promise((resolve, reject) => {
          client.callback = (response) => {
            if (response?.error) {
              reject(new Error(describeError(response)))
              return
            }
            if (!response?.access_token) {
              reject(new Error('Google did not return an access token.'))
              return
            }
            accessToken = response.access_token
            const lifetimeMs = (Number(response.expires_in) || 3600) * 1000
            expiresAt = Date.now() + lifetimeMs
            notify()
            resolve({ accessToken, expiresAt })
          }
          client.error_callback = (error) => {
            reject(new Error(describeError(error)))
          }
          client.requestAccessToken({ prompt })
        }),
    )
    .finally(() => {
      pendingRequest = null
    })

  return pendingRequest
}

function describeError(error) {
  const type = error?.type ?? error?.error
  const detail = error?.error_description ?? error?.message ?? ''
  if (type === 'popup_closed' || type === 'popup_failed_to_open') {
    return 'The Google sign-in popup was closed or blocked. Allow popups and try again.'
  }
  if (type === 'access_denied') {
    return 'Google access was denied. The app needs permission to open the sheet you pick.'
  }
  return detail ? `${type ?? 'Google sign-in failed'}: ${detail}` : String(type ?? 'Google sign-in failed')
}

/**
 * Acquire an access token.
 *
 * @param {{silent?: boolean}} [options] `silent: true` uses prompt '' so an
 *   already-consenting user is not shown any UI; it rejects rather than
 *   falling back to a popup, which would be blocked outside a user gesture.
 */
export function signIn({ silent = false } = {}) {
  return requestToken(silent ? '' : 'consent')
}

function tokenIsFresh() {
  return Boolean(accessToken) && Date.now() < expiresAt - EXPIRY_MARGIN_MS
}

/**
 * The token accessor every Sheets request goes through: returns the cached
 * token while it has more than a minute of life left, otherwise re-acquires
 * one silently.
 */
export async function getAccessToken() {
  if (tokenIsFresh()) return accessToken
  const result = await requestToken('')
  return result.accessToken
}

export async function signOut() {
  const token = accessToken
  accessToken = null
  expiresAt = 0
  notify()
  if (!token) return
  try {
    const oauth2 = await loadGis()
    await new Promise((resolve) => oauth2.revoke(token, resolve))
  } catch {
    // Revocation is best-effort; the local token is already discarded.
  }
}

export function hasToken() {
  return tokenIsFresh()
}

/** @returns {() => void} unsubscribe */
export function onAuthChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Best-effort account email, used to guess which of the two people is using
 * the app. The `drive.file` scope alone does not include userinfo access, so
 * this fails soft and returns null; the UI falls back to asking manually.
 */
export async function getUserEmail() {
  try {
    const token = await getAccessToken()
    const response = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return null
    const data = await response.json()
    return data?.email ?? null
  } catch {
    return null
  }
}
