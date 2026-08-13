import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The token endpoint's failure modes, which are the whole reliability story.
 *
 * Two mistakes are possible and both are silent. Reporting a network blip as a
 * bad key makes someone re-type 64 characters for a failure that was not theirs;
 * reporting a rotated key as transient hides it behind retries forever. The
 * endpoint always answers HTTP 200, so only the body can tell them apart.
 *
 * Every test imports the module fresh, because the token, the key and the
 * generation counter are module state by design.
 */

import { installStorage, removeStorage } from './support/storage.js'

const URL_STUB = 'https://script.google.com/macros/s/TEST/exec'
const SHEET_ID = '1YtlEVCcCFxy929_7GewjZew3VF0sSgBiLspTFNZeeUw'


/** Whatever ContentService would have sent: always HTTP 200, body is the signal. */
const reply = (payload) => ({ text: async () => JSON.stringify(payload) })
const htmlReply = () => ({ text: async () => '<!DOCTYPE html><html>Service invoked too many times' })

const ok = () => reply({ token: 'ya29.token', spreadsheetId: SHEET_ID })

async function load(seed) {
  installStorage(seed)
  vi.resetModules()
  vi.stubEnv('VITE_SCRIPT_URL', URL_STUB)
  return import('../src/lib/connection.js')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
  removeStorage()
})

describe('minting a token', () => {
  it('returns the token and adopts the sheet id from the reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)

    const c = await load({ 'sf.appKey': 'k' })
    expect(await c.getAccessToken()).toBe('ya29.token')
    expect(c.getSpreadsheetId()).toBe(SHEET_ID)
  })

  it('posts the key as text/plain, so the request stays preflight-free', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)

    const c = await load({ 'sf.appKey': 'secret' })
    await c.getAccessToken()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(URL_STUB)
    expect(init.method).toBe('POST')
    // A preflight does not survive the 302 the endpoint answers with.
    expect(init.headers['Content-Type']).toBe('text/plain;charset=utf-8')
    expect(JSON.parse(init.body)).toEqual({ key: 'secret' })
  })

  it('reuses a cached token instead of minting again', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)

    const c = await load({ 'sf.appKey': 'k' })
    await c.getAccessToken()
    await c.getAccessToken()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shares one round trip between concurrent callers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)

    const c = await load({ 'sf.appKey': 'k' })
    const [a, b, d] = await Promise.all([
      c.getAccessToken(),
      c.getAccessToken(),
      c.getAccessToken(),
    ])
    expect([a, b, d]).toEqual(['ya29.token', 'ya29.token', 'ya29.token'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('telling a bad key from a bad connection', () => {
  it('treats {error:"unauthorized"} at HTTP 200 as terminal, and KEEPS the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ error: 'unauthorized' })))

    const c = await load({ 'sf.appKey': 'wrong' })
    await expect(c.getAccessToken()).rejects.toMatchObject({ badKey: true })
    // Kept deliberately: re-typing a 256-bit key on a phone is the worse outcome,
    // and deleting it buys no safety against the threat that matters (XSS).
    expect(c.hasKey()).toBe(true)
    expect(c.keyIsSuspect()).toBe(true)
  })

  it('treats an HTML error page as transient, not as a bad key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlReply()))

    const c = await load({ 'sf.appKey': 'k' })
    const error = await c.getAccessToken().then(
      () => null,
      (cause) => cause,
    )
    expect(error.badKey).toBeUndefined()
    expect(error.i18nKey).toBe('error.scriptUnavailable')
    expect(c.keyIsSuspect()).toBe(false)
  })

  it('treats a rejected fetch as transient', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')))

    const c = await load({ 'sf.appKey': 'k' })
    await expect(c.getAccessToken()).rejects.toMatchObject({ i18nKey: 'error.offline' })
    expect(c.keyIsSuspect()).toBe(false)
  })

  it('treats the abort timeout as transient', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      ),
    )

    const c = await load({ 'sf.appKey': 'k' })
    const attempt = c.getAccessToken()
    const settled = attempt.then(
      () => null,
      (cause) => cause,
    )
    await vi.advanceTimersByTimeAsync(15_000)
    const error = await settled
    expect(error.i18nKey).toBe('error.offline')
    expect(c.keyIsSuspect()).toBe(false)
  })

  it('rejects a reply with no usable sheet id rather than persisting "null"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ token: 'ya29.x', spreadsheetId: null })))

    const c = await load({ 'sf.appKey': 'k' })
    await expect(c.getAccessToken()).rejects.toMatchObject({
      i18nKey: 'error.scriptMisconfigured',
    })
    expect(c.getSpreadsheetId()).toBe(null)
  })
})

describe('the 401 retry path', () => {
  it('does not hand the retry a token minted before the 401', async () => {
    // The bug this pins: joining an in-flight mint that started BEFORE the 401
    // returns the very token Google just rejected, and the retry runs with
    // allowRetry:false, so a recoverable blip becomes a hard failure.
    let release
    const first = new Promise((resolve) => {
      release = () => resolve(reply({ token: 'stale', spreadsheetId: SHEET_ID }))
    })
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue(reply({ token: 'fresh', spreadsheetId: SHEET_ID }))
    vi.stubGlobal('fetch', fetchMock)

    const c = await load({ 'sf.appKey': 'k' })

    const inFlight = c.getAccessToken()
    const refreshed = c.refreshToken()
    release()

    await inFlight
    expect(await refreshed).toBe('fresh')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caches the refreshed token for subsequent callers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ token: 'one', spreadsheetId: SHEET_ID }))
      .mockResolvedValueOnce(reply({ token: 'two', spreadsheetId: SHEET_ID }))
    vi.stubGlobal('fetch', fetchMock)

    const c = await load({ 'sf.appKey': 'k' })
    expect(await c.getAccessToken()).toBe('one')
    expect(await c.refreshToken()).toBe('two')
    expect(await c.getAccessToken()).toBe('two')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('the persisted token', () => {
  it('is reused across a reload while it has life left', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)

    const c = await load({
      'sf.appKey': 'k',
      'sf.token': JSON.stringify({
        accessToken: 'from-storage',
        expiresAt: Date.now() + 3600_000,
      }),
    })
    expect(await c.getAccessToken()).toBe('from-storage')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is discarded when it is inside the refresh margin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)

    const c = await load({
      'sf.appKey': 'k',
      // Four minutes left, inside the five-minute margin: a request starting now
      // could still arrive after expiry.
      'sf.token': JSON.stringify({ accessToken: 'nearly-dead', expiresAt: Date.now() + 4 * 60_000 }),
    })
    expect(await c.getAccessToken()).toBe('ya29.token')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('is discarded when malformed, rather than wedging the app', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)

    const c = await load({ 'sf.appKey': 'k', 'sf.token': '{not json' })
    expect(await c.getAccessToken()).toBe('ya29.token')
  })
})

describe('connect and forget', () => {
  it('stores the key only after it has minted once', async () => {
    const store = installStorage()
    vi.resetModules()
    vi.stubEnv('VITE_SCRIPT_URL', URL_STUB)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ error: 'unauthorized' })))
    const c = await import('../src/lib/connection.js')

    await expect(c.connect('nope')).rejects.toMatchObject({ badKey: true })
    expect(store.has('sf.appKey')).toBe(false)
    expect(c.hasKey()).toBe(false)
  })

  it('keeps a previously working key when a new one is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(ok()).mockResolvedValue(reply({ error: 'unauthorized' })),
    )

    const c = await load({ 'sf.appKey': 'good' })
    await c.getAccessToken()
    await expect(c.connect('bad')).rejects.toMatchObject({ badKey: true })
    expect(c.hasKey()).toBe(true)
  })

  it('refuses a blank key without a round trip', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const c = await load()
    await expect(c.connect('   ')).rejects.toMatchObject({ i18nKey: 'error.keyRequired' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears the key, the token, the sheet id and the snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))

    const store = installStorage({ 'sf.appKey': 'k', 'sf.snapshot': '{"v":1}' })
    vi.resetModules()
    vi.stubEnv('VITE_SCRIPT_URL', URL_STUB)
    const c = await import('../src/lib/connection.js')

    await c.getAccessToken()
    c.forgetKey()

    expect(c.hasKey()).toBe(false)
    expect(c.getSpreadsheetId()).toBe(null)
    // The snapshot goes too: it would otherwise paint one person's cached ledger
    // for whoever connects next.
    for (const key of ['sf.appKey', 'sf.token', 'sf.spreadsheetId', 'sf.snapshot']) {
      expect(store.has(key)).toBe(false)
    }
  })

  it('notifies listeners when the connection changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))

    const c = await load()
    const seen = vi.fn()
    const stop = c.onConnectionChange(seen)
    await c.connect('k')
    expect(seen).toHaveBeenCalled()
    stop()
    c.forgetKey()
    expect(seen).toHaveBeenCalledTimes(2)
  })
})
