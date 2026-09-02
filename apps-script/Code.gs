/**
 * Token minter for the Shared Finances app, and the recurring-cost poster.
 *
 * Two entry points with opposite rules about throwing, which is the one thing to
 * read before editing either: `doPost` must be structurally incapable of throwing,
 * `postRecurring` must be allowed to. Each says why where it lives.
 *
 * Deployed as a web app from the account that OWNS the ledger spreadsheet, so
 * `ScriptApp.getOAuthToken()` returns a token that can reach that sheet. The
 * browser therefore never authenticates to Google at all — which is the whole
 * point: no popup, no redirect, and no hourly re-consent anywhere in the app.
 *
 * Access is "anyone, even anonymous", and the `/exec` URL ships in a public
 * bundle, so the shared key is the ONLY access control. It is not protected by
 * the URL being hard to guess; assume the URL is known.
 *
 * CRITICAL: any uncaught throw in `doPost` returns Google's HTML error page
 * instead of JSON, and the client classifies a non-JSON reply as a transient
 * failure and retries. A throw on the reject path therefore becomes a silent
 * retry loop, so this function must be structurally incapable of throwing.
 * Note that a body of `null` parses fine, so the try/catch below does not fire
 * and `body.key` would dereference null — hence the explicit check.
 *
 * The reply vocabulary is exactly `{token, spreadsheetId}`,
 * `{error:'unauthorized'}` and `{error:'unavailable'}` — never an exception
 * message, never an echo of the request.
 *
 * Never read `e.parameter`. Accepting a key from the query string would write it
 * into Google's request logs; requiring it in the body is what keeps it out.
 */

/** The legitimate body is a 64-character key. Anything larger is not worth parsing. */
var MAX_BODY_CHARS = 1024

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
  // and an HTML reply is classified as transient, so the app would say "busy, try
  // again in a moment" on every refresh forever instead of naming the cause.
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
 * There is deliberately no `doGet`. A GET-shaped endpoint that answers anything is
 * a free, crawlable confirmation that a live Apps Script web app is deployed here,
 * and it burns the same execution quota as a real call. Verify a deployment with
 * the POST in SETUP.md instead, which also proves the part that actually matters.
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

/**
 * ===========================================================================
 * The recurring-cost poster
 * ===========================================================================
 *
 * A daily time-driven trigger, so rent lands even if nobody opens the app for a
 * month. `SpreadsheetApp` reaches the sheet directly and spends none of the
 * per-user Sheets API quota the client protects with its 30-second focus floor.
 *
 * CRITICAL, and the deliberate opposite of `doPost` above: this MUST be allowed
 * to throw. `exceptionLogging: STACKDRIVER` plus the trigger's own failure
 * notification means an uncaught throw in a TRIGGER mails the owner, and that
 * mail is the only channel by which this stopping is ever reported — the app
 * cannot see it. `doPost` must be incapable of throwing because a throw there
 * returns Google's HTML error page, which the client reads as transient. Do not
 * tidy the asymmetry away.
 *
 * The instance id is `<template id>#<YYYY-MM>`, derived identically here and in
 * `src/lib/recurring.js`, which is the whole of "already recorded" — it is what
 * makes this poster and the app's own card safe to coexist, and a re-run a no-op.
 *
 * TRIGGERS RUN HEAD; the web app runs the pinned deployment. Saving this file
 * changes tonight's run immediately while the token endpoint keeps serving the
 * version from SETUP.md step 6 — so adding the poster needs no new deployment,
 * and a half-finished edit left saved in the editor runs unattended.
 */

/**
 * The two column lists this file cannot import, being Python's problem's twin:
 * `test/schema.test.js` parses them out of this source and compares them to
 * `EXPENSE_COLUMNS` and `RECURRING_COLUMNS` in `src/schema.js`. Change them
 * together. A disagreement is silent in the worst way — the rows land looking
 * plausible with every value under the neighbouring field — and worse here than
 * in the Python script, because this file is PASTED into the editor rather than
 * deployed from the repo, so nothing in a build ever sees what is running.
 */
var EXPENSE_COLUMNS = [
  'date',
  'description',
  'amount',
  'category',
  'payer_share',
  'deleted_at',
  'id',
]

var RECURRING_COLUMNS = [
  'description',
  'amount',
  'category',
  'payer',
  'payer_share',
  'months',
  'day_of_month',
  'active_from',
  'active_to',
  'id',
]

var RECURRING_TAB = 'recurring'

/** Person -> their own expenses tab. Pinned to `DATA_TABS` by the same test. */
var EXPENSE_TABS = { p1: 'expenses_p1', p2: 'expenses_p2' }

/** Month lengths, so nothing here has to construct a Date at all. */
var MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * The trigger's entry point. Runs daily rather than on the 1st: Google can delay
 * or skip a scheduled run, and this trigger's documented failure mode — the
 * consent screen lapsing, SETUP.md step 5 — is silent. A monthly trigger that
 * misses its one run does nothing for 30 days; a daily one gets 28 more chances,
 * each a no-op after the first.
 */
function postRecurring() {
  var lock = LockService.getScriptLock()
  // A manual run from the editor overlapping the trigger is the case: both would
  // read the same "handled" set and both would post.
  if (!lock.tryLock(10000)) return
  try {
    // Through `Utilities.formatDate` in the script's own zone, never
    // `new Date().getMonth()`: `new Date()` is UTC underneath, so on a script
    // defaulting to a US zone a 03:00 JST run on the 1st computes the PREVIOUS
    // month and files September's rent as August's. The manifest pins the zone.
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
    postRecurringFor(today.slice(0, 7), Number(today.slice(8, 10)))
  } finally {
    lock.releaseLock()
  }
}

/**
 * Split out so a throwaway `function testAugust() { postRecurringFor('2026-08', 31) }`
 * can be run from the editor: a function with parameters gets `undefined` from the
 * Run dropdown.
 *
 * @param {string} monthKey 'YYYY-MM'
 * @param {number} dayOfMonth the day already reached, so nothing posts early
 * @returns {number} rows appended
 */
function postRecurringFor(monthKey, dayOfMonth) {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'))
  var handled = readHandledIds(ss)
  var templates = readTemplates(ss)
  var posted = 0

  for (var i = 0; i < templates.length; i += 1) {
    var template = templates[i]
    if (!activeIn(template, monthKey)) continue

    // CLAMPED before the comparison, not just before the date is stamped. A
    // template that says 31 would otherwise never satisfy `31 > 28` in February
    // and would silently skip that month every year.
    var day = clampDay(template.dayOfMonth, monthKey)
    if (day > dayOfMonth) continue

    var id = template.id + '#' + monthKey
    if (handled[id]) continue

    appendInstance(ss, template, id, monthKey + '-' + pad2(day))
    posted += 1
  }
  return posted
}

/**
 * Every id in BOTH expense tabs, TOMBSTONED ROWS INCLUDED.
 *
 * The tombstones are the half that is easy to get backwards, because every
 * consumer in the client filters through `isActive`: soft-delete this month's rent
 * because it was double-charged, and a scan that skipped tombstones re-posts it
 * tomorrow, and the day after. The id being present at all — live or dead — means
 * the month is handled.
 *
 * Both tabs, because editing an instance's payer MOVES the row: a payer-only scan
 * finds nothing and posts a second copy while the first sits under the other
 * person. The settlements tab is deliberately absent — an instance is only ever
 * appended to an expenses tab, and nothing in the app can change an entry's type.
 */
function readHandledIds(ss) {
  var handled = {}
  var column = EXPENSE_COLUMNS.indexOf('id') + 1
  for (var person in EXPENSE_TABS) {
    var sheet = ss.getSheetByName(EXPENSE_TABS[person])
    if (!sheet) continue
    var last = sheet.getLastRow()
    if (last < 2) continue
    var values = sheet.getRange(2, column, last - 1, 1).getValues()
    for (var i = 0; i < values.length; i += 1) {
      var id = cellText(values[i][0])
      if (id) handled[id] = true
    }
  }
  return handled
}

function readTemplates(ss) {
  var sheet = ss.getSheetByName(RECURRING_TAB)
  if (!sheet) return []
  var last = sheet.getLastRow()
  if (last < 2) return []

  var rows = sheet.getRange(2, 1, last - 1, RECURRING_COLUMNS.length).getValues()
  var templates = []
  for (var i = 0; i < rows.length; i += 1) {
    var template = toTemplate(rows[i])
    if (template) templates.push(template)
  }
  return templates
}

function cellText(value) {
  return value == null ? '' : String(value).trim()
}

function cellAt(row, field) {
  return cellText(row[RECURRING_COLUMNS.indexOf(field)])
}

/**
 * A `recurring` row -> what this poster needs, or null for a row it must not post.
 *
 * Stricter than the client's `rowToTemplate` in exactly two places, and both are
 * one rule: **the poster only writes a template that spells out BOTH its amount
 * and its share.** A blank amount is recurring-but-variable — a utility bill — and
 * there is nothing to write. A blank share means "follow the payer's default",
 * which lives in the config tab; resolving it here would put a fourth copy of the
 * percentage-versus-fraction rule in this repo, and getting it wrong splits every
 * rent 50/50 on a household running 80/20. Anything left blank is the card's job,
 * where a person confirms the figure before it is written.
 *
 * A row this cannot use is SKIPPED rather than thrown on, unlike an unexpected
 * failure: one typo in a gym row must not stop rent posting. The client counts and
 * reports the same rows on screen as `warning.undecodedTemplates`.
 */
function toTemplate(row) {
  var id = cellAt(row, 'id')
  var payer = cellAt(row, 'payer').toLowerCase()
  if (!id || !EXPENSE_TABS[payer]) return null

  // Half-up to the yen, matching `parseAmountToYen`: the bank prints amounts as
  // "1400.000000" and people type grouping separators.
  var amount = Math.round(Number(cellAt(row, 'amount').replace(/[\s,]/g, '')))
  if (!(amount > 0)) return null

  var shareText = cellAt(row, 'payer_share')
  if (!shareText) return null
  var share = Number(shareText)
  if (!(share >= 0 && share <= 100)) return null
  // Above 1 reads as a percentage, exactly as `parseShare` reads it: a spreadsheet
  // is where people write 80 rather than 0.8.
  if (share > 1) share = share / 100

  var day = Number(cellAt(row, 'day_of_month') || '1')
  if (!(day >= 1 && day <= 31)) return null

  var months = null
  var monthsText = cellAt(row, 'months')
  if (monthsText) {
    months = {}
    var parts = monthsText.split(',')
    for (var i = 0; i < parts.length; i += 1) {
      var month = Number(parts[i].trim())
      if (!(month >= 1 && month <= 12)) return null
      months[month] = true
    }
  }

  var activeFrom = cellAt(row, 'active_from')
  var activeTo = cellAt(row, 'active_to')
  if (activeFrom && !isMonthKey(activeFrom)) return null
  if (activeTo && !isMonthKey(activeTo)) return null

  return {
    id: id,
    payer: payer,
    description: cellAt(row, 'description'),
    category: cellAt(row, 'category'),
    amountYen: amount,
    payerShare: share,
    dayOfMonth: day,
    months: months,
    activeFrom: activeFrom,
    activeTo: activeTo,
  }
}

/** Month keys compare as strings, which is what makes the window two comparisons. */
function activeIn(template, monthKey) {
  if (template.activeFrom && monthKey < template.activeFrom) return false
  if (template.activeTo && monthKey > template.activeTo) return false
  if (template.months && !template.months[Number(monthKey.slice(5, 7))]) return false
  return true
}

function isMonthKey(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) return false
  var month = Number(value.slice(5, 7))
  return month >= 1 && month <= 12
}

function clampDay(day, monthKey) {
  var year = Number(monthKey.slice(0, 4))
  var month = Number(monthKey.slice(5, 7))
  var length = MONTH_LENGTHS[month - 1]
  if (month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) length = 29
  return day > length ? length : day
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value)
}

/**
 * Append one instance to the payer's own expenses tab.
 *
 * The number format is set to plain text FIRST, because `setValues` behaves like
 * the `USER_ENTERED` the schema contract forbids: '2026-09-01' becomes a date
 * serial that reads back in the spreadsheet's own locale as '9/1/2026', which
 * `rowToEntry` rejects and `loadAll` reports as `undatedRows` — the exact cause
 * already documented for that counter. A description starting with '=' becomes a
 * formula. Text format is how RAW is spelled in `SpreadsheetApp`.
 *
 * The row number comes from `getLastRow()` immediately before the write. A client
 * `values.append` landing in the same instant would resolve the same row, which is
 * last-write-wins — the accepted design, and vanishingly unlikely at 3am.
 */
function appendInstance(ss, template, id, date) {
  var sheet = ss.getSheetByName(EXPENSE_TABS[template.payer])
  if (!sheet) return

  var byField = {
    date: date,
    description: template.description,
    amount: String(template.amountYen),
    category: template.category,
    payer_share: String(template.payerShare),
    deleted_at: '',
    id: id,
  }
  var row = []
  for (var i = 0; i < EXPENSE_COLUMNS.length; i += 1) {
    row.push(byField[EXPENSE_COLUMNS[i]])
  }

  var target = sheet.getRange(sheet.getLastRow() + 1, 1, 1, EXPENSE_COLUMNS.length)
  target.setNumberFormat('@')
  target.setValues([row])
}
