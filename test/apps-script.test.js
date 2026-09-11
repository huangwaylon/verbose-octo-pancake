import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { loadScript } from './support/apps-script.js'

/**
 * `doPost` in `apps-script/Code.gs` — the token endpoint, and the one function in the repo that must
 * be structurally incapable of throwing: a throw returns Google's HTML error page, which
 * `connection.js` classifies as TRANSIENT, so the app says "busy, try again" on every refresh forever
 * instead of naming the cause. Its reply vocabulary is exactly three shapes, and nothing may be
 * echoed back — this is a public, anonymous endpoint whose only access control is the key in the
 * request.
 *
 * The source is `new Function`'d, so a syntax error fails every case here. Nothing else in the repo
 * sees this file at all: it is pasted into the Apps Script editor rather than deployed from a build.
 */
describe('the token endpoint', () => {
  const KEY = 'a'.repeat(64)
  const endpoint = (over = {}) => loadScript({ appKey: KEY, ...over })
  const reply = (app, event) => JSON.parse(app.doPost(event).text)
  const post = (body) => ({ postData: { contents: body } })

  it('answers the key with a token and the spreadsheet id, and nothing else', () => {
    const app = endpoint()

    expect(reply(app, post(JSON.stringify({ key: KEY })))).toEqual({
      token: 'ya29.stub',
      spreadsheetId: 'sheet-under-test',
    })
  })

  it('answers every rejection with the same three words, revealing nothing about the key', () => {
    const app = endpoint()
    const refused = [
      undefined,
      {},
      { postData: {} },
      post(''),
      post('{not json'),
      post('null'),
      post('"a string"'),
      post(JSON.stringify({ key: '' })),
      post(JSON.stringify({ key: null })),
      post(JSON.stringify({ key: `${KEY}x` })),
      post(JSON.stringify({ key: KEY.slice(0, 63) })),
      // Past MAX_BODY_CHARS with the RIGHT key in it: the length guard has to refuse it before the
      // key is ever compared, which is the only way this case differs from a wrong key.
      post(JSON.stringify({ key: KEY, padding: 'x'.repeat(2000) })),
    ]

    for (const event of refused) {
      // `toEqual` on the whole object, not a property: the failure that matters is a reply that
      // carries the expected key, the length it wanted, or an exception message alongside.
      expect(reply(app, event), JSON.stringify(event)).toEqual({ error: 'unauthorized' })
    }
  })

  it('says unavailable, rather than throwing, when its authorization has lapsed', () => {
    // SETUP.md step 5: a consent screen left in Testing expires after 7 days, and this is the one
    // way that failure can be told apart from a quota problem.
    const app = endpoint({ tokenThrows: true })

    expect(reply(app, post(JSON.stringify({ key: KEY })))).toEqual({ error: 'unavailable' })
  })

  it('never reads the query string, which would put the key in Google’s request logs', () => {
    const app = endpoint()
    // Both paths: reading it only when the body's key does not match is still reading it, and the
    // reject path is the one a key in the query string would be there to rescue.
    const trap = (body) => {
      const event = post(body)
      Object.defineProperty(event, 'parameter', {
        get() {
          throw new Error('doPost read e.parameter')
        },
      })
      return event
    }

    expect(reply(app, trap(JSON.stringify({ key: KEY })))).toMatchObject({ token: 'ya29.stub' })
    expect(reply(app, trap(JSON.stringify({ key: 'wrong' })))).toEqual({ error: 'unauthorized' })
  })

  it('refuses when no key is configured, rather than letting a null one match', () => {
    // `getProperty` answers null for a property that was never set, and `null !== null` is false:
    // without the `!key` guard this body mints a live, spreadsheets-scoped token for anyone.
    const app = loadScript({ appKey: null })

    for (const body of [{ key: null }, { key: '' }, {}]) {
      expect(reply(app, post(JSON.stringify(body))), JSON.stringify(body)).toEqual({
        error: 'unauthorized',
      })
    }
  })

  it('writes nothing to the spreadsheet, and holds no copy of the column lists', () => {
    // The poster that once lived here is gone — recording a recurring cost is a tap in the app, so
    // nothing runs unattended and `src/schema.js` has one fewer copy of the layout to keep in step
    // with. This is the guard on that: the file is pasted into an editor, where no build sees it,
    // and a write added back would need a column order nothing here could check.
    const source = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8')
    for (const name of [
      'SpreadsheetApp',
      'getRange',
      'setValues',
      'LockService',
      'EXPENSE_COLUMNS',
      'RECURRING_COLUMNS',
      'day_of_month',
      'payer_share',
    ]) {
      expect(source, name).not.toContain(name)
    }
  })
})
