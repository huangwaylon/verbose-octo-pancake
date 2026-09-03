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
 */

/** The legitimate body is a 64-character key. Anything larger is not worth parsing. */
var MAX_BODY_CHARS = 1024

/**
 * CRITICAL: any uncaught throw here returns Google's HTML error page instead of
 * JSON, and the client classifies a non-JSON reply as a transient failure and
 * retries. A throw on the reject path is therefore a silent retry loop, so this
 * function must be structurally incapable of throwing.
 *
 * The reply vocabulary is exactly `{token, spreadsheetId}`, `{error:'unauthorized'}`
 * and `{error:'unavailable'}` — never an exception message, never an echo of the
 * request.
 *
 * Never read `e.parameter`. Accepting a key from the query string would write it
 * into Google's request logs; requiring it in the body is what keeps it out.
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
 * notification means an uncaught throw in a TRIGGER mails the owner, and that mail
 * is the only channel by which this stopping is ever reported — the app cannot see
 * it. Do not tidy the asymmetry away.
 *
 * The instance id is `<template id>#<YYYY-MM>`, derived identically here and in
 * `src/lib/recurring.js`, which is the whole of "already recorded" — it is what
 * makes this poster and the app's own Record control safe to coexist.
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
var CONFIG_TAB = 'config'

/** Fallback when the config tab says nothing about a person. Mirrors `EVEN_SHARE`. */
var EVEN_SHARE = 0.5

/** Person -> their own expenses tab. Pinned to `DATA_TABS` by the same test. */
var EXPENSE_TABS = { p1: 'expenses_p1', p2: 'expenses_p2' }

/** Month lengths, so nothing here has to construct a Date at all. */
var MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Largest integer part `readYen` will parse. Mirrors `MAX_INT_DIGITS` in `money.js`. */
var MAX_INT_DIGITS = 13

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
  // Once per run, not per row: three reads total, whatever the tab holds.
  var shares = defaultShares(ss)
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

    var share = template.payerShare
    if (share == null) share = shares[template.payer] != null ? shares[template.payer] : EVEN_SHARE
    if (!appendInstance(ss, template, id, monthKey + '-' + pad2(day), share)) continue

    // Marked inside the loop, not just from `readHandledIds`: two rows sharing an id is
    // the reachable mistake CLAUDE.md names — copy the rent row to add parking, forget to
    // change `id` — and without this both post under `rent#2026-09`. The client keeps the
    // FIRST row per id (`reconcileTemplates`) and the first of two live rows
    // (`reconcileById`), so the second one's money would vanish from the balance while
    // sitting in the sheet. First-wins here too, in both files, for one rule.
    handled[id] = true
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
 * Stricter than the client's `rowToTemplate` in exactly ONE place: a blank amount
 * is recurring-but-variable — a utility bill — and there is no figure to write, so
 * that row belongs to the recurring page where a person types it. Everything else
 * posts itself, which is the whole promise of the feature.
 *
 * A blank SHARE is not a refusal: it means "follow the payer's `default_split`",
 * and `defaultShares` reads it. Refusing it instead put a cliff under the form's
 * own default state — the Split control starts on "Default", which writes blank —
 * so the most likely cost anyone set up would silently never post.
 *
 * A row this cannot use is SKIPPED rather than thrown on, unlike an unexpected
 * failure: one typo in a gym row must not stop rent posting. The client counts and
 * reports the same rows on screen as `warning.undecodedTemplates`.
 */
function toTemplate(row) {
  var id = cellAt(row, 'id')
  var payer = cellAt(row, 'payer').toLowerCase()
  if (!id || !EXPENSE_TABS[payer]) return null

  // Half-up to the yen, through this file's own copy of `parseAmountToYen`: the bank
  // prints amounts as "1400.000000" and people type grouping separators.
  var amount = readYen(cellAt(row, 'amount'))
  if (!(amount > 0)) return null

  // null means "follow the payer's default", resolved at append time by `defaultShares`.
  var shareText = cellAt(row, 'payer_share')
  var share = null
  if (shareText) {
    share = readShare(shareText)
    if (share == null) return null
  }

  var day = Number(cellAt(row, 'day_of_month') || '1')
  // Integer, matching `isDayOfMonth`: a fraction survives every bound below it and reaches
  // `pad2`, which writes it into the date cell verbatim.
  if (!isWholeInRange(day, 1, 31)) return null

  var months = null
  var monthsText = cellAt(row, 'months')
  if (monthsText) {
    months = {}
    var parts = monthsText.split(',')
    for (var i = 0; i < parts.length; i += 1) {
      var month = Number(parts[i].trim())
      // Integer, matching `parseMonths`: a fractional month can equal no month number, so
      // the row would simply never post — the same refusal, arrived at silently.
      if (!isWholeInRange(month, 1, 12)) return null
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

/**
 * Whole yen from a cell, or null — this file's own copy of `parseAmountToYen`.
 *
 * `Number(text.replace(/,/g, ''))` is the tempting one-liner and it is a 100x write: the
 * app reads '42,10' as ¥42, a decimal comma with two digits of cents, where stripping
 * every comma gives ¥4210. It runs the other way too — the app refuses the malformed
 * grouping '2,20,000' and a strip-and-Number posts ¥220,000 — and a '¥' symbol the app
 * strips makes `Number` refuse the row, so the cost silently never posts at all.
 *
 * So the separator rule and the grouping validation are ported here in full rather than
 * approximated. `test/apps-script.test.js` runs this and `parseAmountToYen` over ONE table
 * of inputs, which is the only thing that can see the two drift apart.
 */
function readYen(text) {
  var cleaned = text.replace(/[\s\u00a0\u202f\u2009]/g, '').replace(/[¥￥]/g, '')
  if (!cleaned) return null
  // Amounts are positive magnitudes; the payer carries the direction.
  if (cleaned.charAt(0) === '-' || cleaned.charAt(0) === '\u2212') return null
  var body = cleaned.charAt(0) === '+' ? cleaned.slice(1) : cleaned
  if (!/^[0-9.,]+$/.test(body)) return null

  // Whichever separator comes last is the decimal point — unless it is the only kind
  // present and exactly three digits follow, which reads as grouping.
  var lastDot = body.lastIndexOf('.')
  var lastComma = body.lastIndexOf(',')
  var decIndex = -1
  if (lastDot >= 0 || lastComma >= 0) {
    var last = Math.max(lastDot, lastComma)
    var sep = body.charAt(last)
    var repeated = sep === '.' ? body.indexOf('.') !== lastDot : body.indexOf(',') !== lastComma
    var bothKinds = lastDot >= 0 && lastComma >= 0
    var groupingOnly = !bothKinds && body.length - last - 1 === 3 && (sep === ',' || repeated)
    decIndex = groupingOnly ? -1 : last
  }

  var intPart = decIndex < 0 ? body : body.slice(0, decIndex)
  var fracPart = decIndex < 0 ? '' : body.slice(decIndex + 1)
  if (!/^\d*$/.test(fracPart)) return null

  // First group free-form, every later one exactly three digits.
  var groups = intPart.length ? intPart.split(/[.,]/) : []
  if (groups.length > 1 && groups[0] === '') return null
  for (var i = 0; i < groups.length; i += 1) {
    var ok = i === 0 ? /^\d*$/.test(groups[i]) : /^\d{3}$/.test(groups[i])
    if (!ok) return null
  }

  var digits = groups.join('')
  if (!digits.length && !fracPart.length) return null
  if (digits.replace(/^0+/, '').length > MAX_INT_DIGITS) return null

  // Half-up on the first decimal digit, in digit arithmetic rather than floats.
  var yen = Number(digits || '0')
  if (Number(fracPart.charAt(0) || '0') >= 5) yen += 1
  return yen
}

/**
 * A hand-typed share as a fraction, or null.
 *
 * Above 1 reads as a percentage, exactly as `parseShare` does in the app: a spreadsheet
 * is where people write 80 rather than 0.8. Both places a share can be typed — the
 * `payer_share` column and the two `default_split_p*` config rows — go through this one
 * rule here, for the same reason the app has one: with two readings, the same `50` would
 * mean "half" in one place and "the payer covers all of it" in the other.
 *
 * The WHOLE string has to be a number, and a value above 100 CLAMPS rather than refusing.
 * Both halves are `parseShare`'s, and both used to differ: `Number('80%')` is NaN, which
 * refused the whole template row, so a cost the recurring page listed as due was one the
 * poster skipped every month forever — with no notice anywhere, because the client read
 * the row fine.
 */
function readShare(text) {
  if (!text) return null
  var body = String(text).replace(/%$/, '')
  if (!/^\d*\.?\d+$/.test(body)) return null
  var value = Number(body)
  if (!(value >= 0)) return null
  return value > 1 ? Math.min(1, value / 100) : value
}

/**
 * Each person's default share from the config tab, for the templates that leave
 * `payer_share` blank.
 *
 * The FIRST usable value per key wins, exactly as `parseConfigRows` does in the app: a
 * stale duplicate `default_split_p1` lower down the tab would move money on every
 * expense that person is posted for. A key the tab does not carry falls back to
 * `EVEN_SHARE`, which is what `defaultSplitFor` does.
 */
function defaultShares(ss) {
  var shares = {}
  var sheet = ss.getSheetByName(CONFIG_TAB)
  if (!sheet) return shares
  var last = sheet.getLastRow()
  if (last < 1) return shares

  var rows = sheet.getRange(1, 1, last, 2).getValues()
  for (var i = 0; i < rows.length; i += 1) {
    var key = cellText(rows[i][0]).toLowerCase()
    var person = key === 'default_split_p1' ? 'p1' : key === 'default_split_p2' ? 'p2' : null
    if (!person || shares[person] != null) continue
    var share = readShare(cellText(rows[i][1]))
    if (share != null) shares[person] = share
  }
  return shares
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

/**
 * A whole number inside an inclusive range. Both of `toTemplate`'s schedule cells need it, and
 * the app refuses exactly this much — `isDayOfMonth` and `parseMonths` in `schema.js`.
 */
function isWholeInRange(value, low, high) {
  return Math.floor(value) === value && value >= low && value <= high
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
 *
 * `share` arrives RESOLVED; only `defaultShares` can resolve a blank one.
 *
 * @returns {boolean} whether the row landed. A missing tab is the one false: the count
 *   `postRecurringFor` returns is the only signal a manual run from the editor gives, so
 *   counting a skip as posted would report a write that never happened.
 */
function appendInstance(ss, template, id, date, share) {
  var sheet = ss.getSheetByName(EXPENSE_TABS[template.payer])
  if (!sheet) return false

  var byField = {
    date: date,
    description: template.description,
    amount: String(template.amountYen),
    category: template.category,
    payer_share: String(share),
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
  return true
}
