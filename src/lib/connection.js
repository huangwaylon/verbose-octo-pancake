/**
 * The app's only credential, and the token it buys.
 *
 * There is no Google sign-in: an Apps Script web app owned by the ledger's owner holds a permanent
 * grant and mints short-lived access tokens for anyone presenting the app key. So there is no
 * popup, redirect or re-consent anywhere, and a token can be re-issued from a plain `fetch`.
 *
 * The key is typed once per device and lives only there. SCRIPT_URL is public, so the key is the
 * sole access control and nothing here may depend on the endpoint being hard to guess.
 */

import { SCRIPT_URL, STORAGE_KEYS, isConfigured, readStored, writeStored } from '../config.js'
import { clearSnapshot } from './snapshot.js'

/**
 * Re-mint this far before expiry, so a request starting near the boundary cannot arrive at Google
 * after it. Generous because phone data is slow: the cost of being early is one silent fetch.
 */
const REFRESH_MARGIN_MS = 5 * 60_000

/**
 * Measured at 3598s on every call, so assumed rather than reported: asking would mean widening the
 * script's grant with `script.external_request` to learn a constant. Correctness does not rest on
 * it — `sheets.js` re-mints on a 401.
 */
const TOKEN_LIFETIME_MS = 3600_000

/** An Apps Script round trip is ~1s, with outliers past 3s. */
const MINT_TIMEOUT_MS = 15_000

let appKey = readStored(STORAGE_KEYS.appKey)
let spreadsheetId = readStored(STORAGE_KEYS.spreadsheetId)
let accessToken = null
let expiresAt = 0

/**
 * True once the endpoint has rejected the stored key, which is deliberately KEPT: `unauthorized`
 * is indistinguishable from a request-shape bug on our side, so deleting it makes someone re-type
 * 64 characters for a failure that may not be theirs. It buys no safety either — the threat is XSS
 * on this origin, which reads the key whether we keep it or not.
 */
let keySuspect = false

/**
 * Bumped whenever the token is deliberately discarded. A mint that began before the bump cannot
 * satisfy a caller that asked afterwards: on a 401 the in-flight mint may be carrying the very
 * token just rejected, and the retry runs with `allowRetry: false`.
 */
let generation = 0

/** The single in-flight mint, so concurrent callers share one round trip. */
let pending = null

const listeners = new Set()

function notify() {
  for (const listener of listeners) listener()
}

function persistToken() {
  writeStored(STORAGE_KEYS.token, accessToken ? JSON.stringify({ accessToken, expiresAt }) : null)
}

function discardToken() {
  accessToken = null
  expiresAt = 0
  persistToken()
}

/**
 * Rehydrate at module load. Anything malformed or past the margin is dropped, so a corrupt entry
 * cannot wedge the app into believing it has a usable token. No network happens here: these
 * modules also load under vitest's `node` environment, and the eager mint belongs in `main.jsx`.
 */
function restoreToken() {
  const raw = readStored(STORAGE_KEYS.token)
  if (!raw) return
  try {
    const saved = JSON.parse(raw)
    if (typeof saved?.accessToken !== 'string' || typeof saved?.expiresAt !== 'number') {
      writeStored(STORAGE_KEYS.token, null)
      return
    }
    if (Date.now() >= saved.expiresAt - REFRESH_MARGIN_MS) {
      writeStored(STORAGE_KEYS.token, null)
      return
    }
    accessToken = saved.accessToken
    expiresAt = saved.expiresAt
  } catch {
    writeStored(STORAGE_KEYS.token, null)
  }
}

restoreToken()

/**
 * Every failure this module can report. Exported so `test/i18n.test.js` can prove each has a
 * translation: these codes are attached to errors rather than passed to `t()`, and the dead-key
 * check exempts the `error.` prefix, so a typo would reach someone as the bare string
 * "scriptUnavailable".
 *
 * `BAD_KEY` is the only terminal one. Everything else is transient, because telling someone their
 * key is wrong when the network merely hiccuped is the worse mistake of the two.
 */
export const CONNECTION_ERROR = {
  BAD_KEY: 'badKey',
  KEY_REQUIRED: 'keyRequired',
  OFFLINE: 'offline',
  SCRIPT_UNAVAILABLE: 'scriptUnavailable',
  SCRIPT_UNAUTHORIZED: 'scriptUnauthorized',
  SCRIPT_MISCONFIGURED: 'scriptMisconfigured',
}

function connectionError(code, message) {
  const error = new Error(message)
  error.i18nKey = `error.${code}`
  return error
}

/** The key was rejected. `badKey` is what makes this the one terminal failure. */
function badKeyError() {
  const error = connectionError(CONNECTION_ERROR.BAD_KEY, 'The app key was rejected.')
  error.badKey = true
  return error
}

/** One POST to the script. Three details here are load-bearing. */
async function mint() {
  // Unreachable through the UI — `useConnection` reports `unconfigured` — so this is a build
  // mistake rather than a state worth translating.
  if (!SCRIPT_URL) throw new Error('Missing VITE_SCRIPT_URL. See SETUP.md.')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MINT_TIMEOUT_MS)

  let response
  try {
    response = await fetch(SCRIPT_URL, {
      method: 'POST',
      // `text/plain` keeps this a CORS simple request: a preflight would be answered with the 302
      // below and die, and the script deliberately has no doOptions. Never application/json.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: appKey }),
      signal: controller.signal,
      // The method is deliberately NOT forced across the redirect: /exec answers 302 to
      // script.googleusercontent.com, and forcing POST through the hop returns "page not found".
    })
  } catch {
    throw connectionError(CONNECTION_ERROR.OFFLINE, 'Could not reach the token endpoint.')
  } finally {
    clearTimeout(timer)
  }

  // No `response.ok` check: ContentService always answers HTTP 200, even for a rejection, so
  // branching on `ok` would report a rotated key as success.
  const body = await response.text().catch(() => '')

  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    // Apps Script serves HTML on an exhausted quota, an outage, and any uncaught throw inside
    // doPost. Transient: treating it as a bad key would be wrong.
    throw connectionError(
      CONNECTION_ERROR.SCRIPT_UNAVAILABLE,
      'The token endpoint did not return JSON.',
    )
  }

  if (payload?.error === 'unauthorized') throw badKeyError()

  // The script's own authorization has lapsed, which is what an unpublished consent screen does
  // after 7 days. Retrying cannot fix it and it is not a bad key either, so it gets its own
  // message.
  if (payload?.error === 'unavailable') {
    throw connectionError(
      CONNECTION_ERROR.SCRIPT_UNAUTHORIZED,
      'The token endpoint could not mint a token.',
    )
  }

  if (typeof payload?.token !== 'string' || !payload.token) {
    throw connectionError(
      CONNECTION_ERROR.SCRIPT_UNAVAILABLE,
      'The token endpoint returned no token.',
    )
  }
  // An unset SHEET_ID script property would otherwise be persisted as the string "null" and every
  // request would go to /spreadsheets/null.
  if (typeof payload?.spreadsheetId !== 'string' || !payload.spreadsheetId) {
    throw connectionError(
      CONNECTION_ERROR.SCRIPT_MISCONFIGURED,
      'The token endpoint returned no sheet id.',
    )
  }

  return { accessToken: payload.token, spreadsheetId: payload.spreadsheetId }
}

function startMint() {
  const started = generation

  const promise = (async () => {
    try {
      const result = await mint()
      // Superseded while in flight: a 401 bumped the generation, so this token may be the dead
      // one. Hand it to whoever is waiting, but do not cache it as current.
      if (started === generation) {
        accessToken = result.accessToken
        expiresAt = Date.now() + TOKEN_LIFETIME_MS
        keySuspect = false
        persistToken()
        if (spreadsheetId !== result.spreadsheetId) {
          spreadsheetId = result.spreadsheetId
          writeStored(STORAGE_KEYS.spreadsheetId, spreadsheetId)
        }
        notify()
      }
      return result.accessToken
    } catch (cause) {
      if (cause.badKey) {
        keySuspect = true
        discardToken()
        notify()
      }
      throw cause
    } finally {
      if (pending?.generation === started) pending = null
    }
  })()

  pending = { promise, generation: started }
  return promise
}

/**
 * Share one mint between concurrent callers, unless the caller needs one newer than the mint
 * already running.
 */
async function tokenAtLeast(minGeneration) {
  while (pending && pending.generation < minGeneration) {
    // Wait it out rather than running two mints at once; the loop exits because the mint clears
    // `pending` before resolving its awaiters.
    await pending.promise.catch(() => {})
  }
  return pending ? pending.promise : startMint()
}

export function hasKey() {
  return Boolean(appKey)
}

export function keyIsSuspect() {
  return keySuspect
}

export function getSpreadsheetId() {
  return spreadsheetId
}

/**
 * Which of the three connection states the app is in. A stored key the endpoint rejected sends the
 * device back to the key screen, which shows why — so `suspect` and "no key at all" are one state
 * here and two sentences there.
 */
export function connectionStatus() {
  if (!isConfigured()) return 'unconfigured'
  if (!appKey || keySuspect) return 'no-key'
  return 'connected'
}

/** @returns {() => void} unsubscribe */
export function onConnectionChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Adopt a key, proving it works before storing it. A key that mints once is good indefinitely, so
 * this is the only place a rejection is worth surfacing as "that key is wrong".
 */
export async function connect(key) {
  const candidate = String(key ?? '').trim()
  if (!candidate) throw connectionError(CONNECTION_ERROR.KEY_REQUIRED, 'No app key was entered.')

  const previousKey = appKey
  const previousSuspect = keySuspect
  appKey = candidate
  keySuspect = false
  generation += 1
  discardToken()

  try {
    await tokenAtLeast(generation)
  } catch (cause) {
    appKey = previousKey
    keySuspect = previousSuspect
    notify()
    throw cause
  }

  writeStored(STORAGE_KEYS.appKey, candidate)
  notify()
}

/** Every Sheets request goes through this. */
export async function getAccessToken() {
  if (accessToken && Date.now() < expiresAt - REFRESH_MARGIN_MS) return accessToken
  return tokenAtLeast(generation)
}

/**
 * Force a token newer than any currently in flight. Called from the 401 retry in `sheets.js`,
 * which is what makes the refresh margin a performance choice rather than a correctness one.
 */
export function refreshToken() {
  generation += 1
  discardToken()
  return tokenAtLeast(generation)
}

/**
 * Drop everything this device knows. The snapshot goes too, or it would paint one person's cached
 * ledger for whoever connects next — through `clearSnapshot` rather than a direct write, because
 * that module also remembers the last payload it wrote and would otherwise never write again.
 */
export function forgetKey() {
  appKey = null
  spreadsheetId = null
  keySuspect = false
  generation += 1
  discardToken()
  writeStored(STORAGE_KEYS.appKey, null)
  writeStored(STORAGE_KEYS.spreadsheetId, null)
  clearSnapshot()
  notify()
}
