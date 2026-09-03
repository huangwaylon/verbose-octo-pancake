/**
 * A fake Sheets API for `src/lib/sheets.js`. Every request is recorded, because this
 * module's failures are WRITES: a row sent to the wrong tab or the wrong row is silent,
 * so the assertions are about what was sent rather than what came back.
 */
import { vi } from 'vitest'

export const SHEET = 'sheet-under-test'
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

/** What `values.get` and `values.batchGet` hand back for a range. */
export const values = (rows) => ({ values: rows })

/**
 * `handler` returns the JSON payload for a call, or undefined for `{}`. `{ __status: 400 }`
 * answers with an error instead, optionally with `{ __reason: 'rateLimitExceeded' }` — the
 * field that decides whether a 403 means "lost access" or "try again".
 */
export function installSheets(handler) {
  const calls = []

  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method ?? 'GET'
    // Decoded so a test can match on `expenses_p1!A2:K` rather than %-escapes.
    const decoded = decodeURIComponent(String(url))
    const body = init.body ? JSON.parse(init.body) : null
    const call = {
      method,
      url: decoded,
      path: decoded.slice(BASE.length),
      body,
      headers: init.headers ?? {},
    }
    calls.push(call)

    const payload = handler(call) ?? {}
    if (payload.__status) {
      return {
        ok: false,
        status: payload.__status,
        statusText: 'Error',
        json: async () => ({
          error: {
            message: 'stub failure',
            ...(payload.__reason ? { errors: [{ reason: payload.__reason }] } : {}),
          },
        }),
      }
    }
    return { ok: true, json: async () => payload }
  })

  return calls
}

export function removeSheets() {
  delete globalThis.fetch
}

/** Calls that changed something, in the order they were made. */
export const writes = (calls) => calls.filter((call) => call.method !== 'GET')

/** The `ranges` a batchGet asked for, in order. */
export function rangesOf(call) {
  const query = call.url.slice(call.url.indexOf('?') + 1)
  return query
    .split('&')
    .filter((pair) => pair.startsWith('ranges='))
    .map((pair) => pair.slice('ranges='.length))
}
