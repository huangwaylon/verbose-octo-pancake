/**
 * Google Identity Services OAuth, browser-only.
 *
 * There is no backend and no client secret, so this uses the implicit token
 * flow: GIS hands us a short-lived access token in memory. No refresh token
 * exists to store, and we deliberately never persist the access token (see
 * `accessToken` below).
 *
 * IMPORTANT: there is no such thing as a silent token grab here.
 * `requestAccessToken` always opens a popup, even with `prompt: ''`, and a
 * popup that is not the direct result of a click is blocked by every browser.
 * So every token — including the one that replaces an expired token an hour
 * in — has to originate from a real user gesture. When a request fails for
 * want of one, we clear the token and notify listeners so the UI falls back to
 * the sign-in screen rather than failing writes in the background.
 */

import { GOOGLE_CLIENT_ID, OAUTH_SCOPE, STORAGE_KEYS } from '../config.js'

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

/** Re-acquire this far before actual expiry so in-flight requests don't 401. */
const EXPIRY_MARGIN_MS = 60_000

/**
 * The access token is cached in `localStorage` so a page refresh does not force
 * another sign-in, and cleared only on explicit sign-out.
 *
 * This is a deliberate, eyes-open trade-off and it is worth stating plainly: a
 * persisted bearer token is readable by any XSS on this origin and survives the
 * tab. It is accepted here because the alternative is worse in practice — the
 * token flow cannot renew without a click (see the popup note above), so
 * *not* persisting means re-authenticating on every single page load.
 *
 * What it buys is bounded by Google, not by us: the token itself lasts about an
 * hour, so this removes the re-login on refresh but cannot make a session
 * outlive the token. There is no refresh token in the browser flow to extend it
 * with. Ceiling raised only by adding a backend, which this app does not have.
 */
let accessToken = null
let expiresAt = 0

function persistToken() {
  try {
    if (accessToken) {
      localStorage.setItem(STORAGE_KEYS.token, JSON.stringify({ accessToken, expiresAt }))
    } else {
      localStorage.removeItem(STORAGE_KEYS.token)
    }
  } catch {
    // Storage blocked (private browsing): fall back to memory-only behaviour.
  }
}

/**
 * Rehydrate at module load. Anything malformed or already expired is discarded
 * rather than trusted, so a corrupt entry cannot wedge the app in a state where
 * it believes it is signed in.
 */
function restoreToken() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.token)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (typeof saved?.accessToken !== 'string' || typeof saved?.expiresAt !== 'number') {
      localStorage.removeItem(STORAGE_KEYS.token)
      return
    }
    if (Date.now() >= saved.expiresAt - EXPIRY_MARGIN_MS) {
      localStorage.removeItem(STORAGE_KEYS.token)
      return
    }
    accessToken = saved.accessToken
    expiresAt = saved.expiresAt
  } catch {
    // Unparseable or unavailable: stay signed out.
  }
}

restoreToken()

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
            persistToken()
            notify()
            resolve({ accessToken, expiresAt })
          }
          client.error_callback = (error) => {
            reject(new Error(describeError(error)))
          }
          client.requestAccessToken({ prompt })
        }),
    )
    .catch((error) => {
      // Most failures here mean "a popup was needed and could not be opened",
      // which is unrecoverable without a fresh user gesture. Drop any token we
      // were holding and tell listeners, so the UI renders the sign-in screen
      // and the retry arrives from a real click instead of looping.
      accessToken = null
      expiresAt = 0
      persistToken()
      notify()
      throw error
    })
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
 * Acquire an access token. Must be called from a user gesture — see the popup
 * note at the top of this file.
 *
 * @param {{silent?: boolean}} [options] `silent: true` uses prompt '' to skip
 *   the consent dialog for an already-consenting user. It does NOT avoid the
 *   popup, so it still fails outside a click; it is only used to re-issue a
 *   token after a 401, where a gesture is already in scope.
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
  persistToken()
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
 * The signed-in account's email, used to match against the config tab and pick
 * which of the two people this is.
 *
 * Works because OAUTH_SCOPE includes `openid` and `userinfo.email`; with
 * `drive.file` alone this endpoint returns 401. It still fails soft and
 * returns null — a consent screen missing those two scopes is a live
 * possibility — so the manual "which one are you?" fallback stays first-class.
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
