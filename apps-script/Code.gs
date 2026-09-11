/**
 * Token minter for the Shared Finances app, and the whole of the Apps Script side.
 *
 * `doPost` must be structurally incapable of throwing, which is the one thing to read
 * before editing it; it says why where it lives.
 *
 * Deployed as a web app from the account that OWNS the ledger spreadsheet, so
 * `ScriptApp.getOAuthToken()` returns a token that can reach that sheet. The browser
 * therefore never authenticates to Google at all — no popup, no redirect, no
 * re-consent anywhere in the app.
 *
 * Access is "anyone, even anonymous", and the `/exec` URL ships in a public bundle,
 * so the shared key is the ONLY access control. Assume the URL is known.
 *
 * Nothing here writes to the spreadsheet. Recurring costs are recorded by a person
 * tapping Record in the app, so there is no trigger, no unattended write, and no
 * second copy of the column lists to keep in step with `src/schema.js`.
 */

/** The legitimate body is a 64-character key. Anything larger is not worth parsing. */
var MAX_BODY_CHARS = 1024

/**
 * CRITICAL: any uncaught throw here returns Google's HTML error page instead of JSON,
 * which the client classifies as transient and retries — so a throw on the reject path
 * is a silent retry loop. This function must be structurally incapable of throwing.
 *
 * The reply vocabulary is exactly `{token, spreadsheetId}`, `{error:'unauthorized'}`
 * and `{error:'unavailable'}` — never an exception message, never an echo of the request.
 *
 * Never read `e.parameter`. A key from the query string lands in Google's request logs;
 * requiring it in the body is what keeps it out.
 */
function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) return unauthorized()
  if (e.postData.contents.length > MAX_BODY_CHARS) return unauthorized()

  var body = null
  try {
    body = JSON.parse(e.postData.contents)
  } catch (_) {
    return unauthorized()
  }
  // `null` parses successfully, so this cannot be folded into the catch above.
  if (!body || typeof body !== 'object') return unauthorized()

  // Both of these can throw, which is the one way this function could still return
  // Google's HTML error page. `getOAuthToken` is the realistic case: the script's
  // authorization lapses if the consent screen is left in Testing (SETUP.md step 5),
  // and an HTML reply reads as transient, so the app would say "busy, try again in a
  // moment" on every refresh forever instead of naming the cause.
  try {
    var props = PropertiesService.getScriptProperties()
    var key = props.getProperty('APP_KEY')
    if (!key || body.key !== key) return unauthorized()

    return json({
      token: ScriptApp.getOAuthToken(),
      spreadsheetId: props.getProperty('SHEET_ID'),
    })
  } catch (_) {
    return json({ error: 'unavailable' })
  }
}

/**
 * There is deliberately no `doGet`. A GET-shaped endpoint that answers anything is a
 * free, crawlable confirmation that a live Apps Script web app is deployed here, and it
 * burns the same execution quota as a real call. Verify a deployment with the POST in
 * SETUP.md instead, which also proves the part that matters.
 */

/** One reply for every rejection: no length, prefix or position is revealed. */
function unauthorized() {
  return json({ error: 'unauthorized' })
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  )
}
