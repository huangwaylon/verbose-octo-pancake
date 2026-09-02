# Recurring costs — design note

Not implemented. This records the design and the traps, so the work can start from here
rather than from scratch. Rent (220,000/month), gym and similar: the amount and the split
are known in advance, and typing them every month is the only reason they get forgotten.

## The constraint

There is no server. Apps Script mints tokens and nothing else, so a recurring cost can
only become a row when *something* is running, and two phones can be open at once with
last-write-wins and no conflict detection. So the recurrence is stored as a
**declaration**, and a row is written by exactly one of two writers, both idempotent.

## The `recurring` tab

A third tab, authored by hand in the Sheet like `config` is, and **read-only from the
app** in v1. Not in `DATA_TABS` — `compact` and `rowToEntry` both walk that list, and a
template row decoded as an entry has no type and no payer.

```
RECURRING_COLUMNS = [
  'description', 'amount', 'category', 'payer', 'payer_share',
  'months', 'day_of_month', 'active_from', 'active_to', 'id',
]
```

- `amount` blank means recurring-but-variable (utilities): the card lists it with no
  figure and the form opens with amount empty.
- `months` blank means every month; `1,7` covers annual and quarterly through the
  existing `list` parser, with no new cadence concept. Weekly is out — the app is
  month-scoped throughout.
- `active_from`/`active_to` are month keys, so an ended lease stops nagging without
  deleting history. No `deleted_at`: nothing references a template, so deleting the row
  is the retire path, and one way to retire beats two.
- A blank `payer_share` must fall through to `defaultSplitFor(payer)`, **not** to
  `EVEN_SHARE`, or every rent row splits 50/50 on a sheet running 80/20.
- No `match` column. Nothing recurring arrives through `bank_to_ledger.py`, so the
  deterministic id below is the whole of "already recorded".

## The instance id

```
id = `${templateId}#${monthKey}`
```

Every writer derives it the same way, which is what makes them safe to coexist and a
re-run a no-op. Not category + description: both are fields a person edits, so renaming
a note to `Rent (Aug)` posts a second rent, and two templates sharing a category and a
note — one gym membership each — collapse into one.

New pure module `src/lib/recurring.js`: `rowToTemplate`, `templatesDue(templates,
entries, monthKey)`, `entryFromTemplate(template, monthKey)`. Nothing in a hook.

## Phase 1 — the client card

An "expected this month" card in `LedgerScreen`, computed against the month **on
screen**. Tap opens `EntryFormSheet` prefilled; Save is the ordinary optimistic write, so
validation, `splitYen`, `tabOf` and the toasts all apply unchanged. Nothing auto-posts,
so there is no race and no new write path.

Not a notice: `noticeKeys` means "the sheet holds something the app cannot show", and a
missing rent row is not that.

Do this first even if phase 2 lands too. The tab is the input either way, the card is all
testable JS with no deployment step, and it is the only thing that can tell you the
poster in phase 2 has died.

### Touch points

- `loadAll`: the new range goes **before** `CONFIG_RANGE`, so `ranges.length - 1` and
  `slice(0, -1)` keep meaning what they mean. A missing `recurring` tab then 400s the
  batch, the config retry 400s too, and the throw reaches `looksUninitialized` →
  `ensureStructure` → reload. Verify `ensureStructure` adds a missing tab without
  touching a `config` tab that is present.
- `ensureStructure`: add the tab and its header.
- `snapshot.js`: templates belong in it so the card paints on a cold launch. Bump
  `VERSION`.
- `bank_to_ledger.py` is untouched — it knows the two entry column lists, not this one.
- Consider making `rowToEntry` throw on a tab whose `type` is not an `ENTRY_TYPE`, so
  "not a data tab" is enforced rather than documented.

## Phase 2 — the Apps Script poster

A daily time-driven trigger in the existing script project, so rent lands even if nobody
opens the app for a month. `SpreadsheetApp` does not spend the Sheets API per-user quota
the client protects with its 30-second focus floor.

```js
function postRecurring() {
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(10000)) return              // a manual run overlapping the trigger

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  const monthKey = today.slice(0, 7)
  postRecurringFor(monthKey, Number(today.slice(8)))
}

function postRecurringFor(monthKey, dayOfMonth) {
  const ss = SpreadsheetApp.openById(SHEET_ID)
  const templates = readTemplates(ss)           // the recurring tab, one getValues
  const handled = readHandledIds(ss)            // id column of BOTH expense tabs,
                                                // tombstoned rows INCLUDED
  for (const t of templates) {
    if (!activeIn(t, monthKey)) continue         // active_from / active_to / months
    if (t.dayOfMonth > dayOfMonth) continue      // not due yet
    const id = t.id + '#' + monthKey
    if (handled.has(id)) continue
    appendRow(ss, t, id, dateFor(t, monthKey))   // into expenses_<t.payer>
  }
}
```

Three reads and N appends, N normally 0. The split into two functions is so a throwaway
`function testAugust() { postRecurringFor('2026-08', 31) }` can be run from the editor —
a function with parameters gets `undefined` from the Run dropdown.

### Traps

1. **The handled scan must include tombstoned rows.** Soft-delete this month's rent
   because it was double-charged and a scan filtering on `deleted_at` re-posts it
   tomorrow, and the day after. The id being present — live *or* tombstoned — means the
   month is handled. Easy to get backwards, because every other consumer in the codebase
   filters through `isActive`.
2. **Scan both expense tabs.** Change a template's payer and a payer-only scan finds
   nothing, so it posts a second row while the old one stays under the other person.
3. **Whose month is it.** `new Date()` is UTC underneath. On a script defaulting to a US
   zone, a 03:00 JST run on the 1st computes the previous month and files September's
   rent as August's. Pin `"timeZone": "Asia/Tokyo"` in the manifest and derive every date
   through `Utilities.formatDate` — the same reason `dates.js` forbids `new Date(iso)`.
4. **Do not post before it is due.** Posting the 27th's rent on the 1st has the balance
   claiming 110,000 is owed for three weeks before the money moves. Stamp the template's
   day, clamped to the month's length so day 31 lands on the 28th in February.
5. **`setValues` behaves like `USER_ENTERED`, and the schema contract is RAW.**
   `2026-09-01` becomes a date serial that reads back in the spreadsheet's locale as
   `9/1/2026`, which `rowToEntry` rejects and `loadAll` reports as `undatedRows` — the
   exact cause already documented for that counter. A description starting with `=`
   becomes a formula. Set the range's number format to `@` before writing.
6. **It is a third home for `EXPENSE_COLUMNS`,** which CLAUDE.md forbids. Pin it with a
   regex over the `.gs` array literal, the same way `test/schema.test.js` pins the Python
   one — and note that `Code.gs` is pasted into the editor rather than deployed from the
   repo, so drift is otherwise both silent and invisible.
7. **Let a trigger throw.** `exceptionLogging: STACKDRIVER` is on and an uncaught throw
   in a *trigger* mails the owner — free monitoring, and the deliberate opposite of
   `doPost`, which must be structurally incapable of throwing. Comment the asymmetry or
   someone tidies it away.

### Setup

Same script project as the token minter: it already holds `SHEET_ID` and the
`spreadsheets` authorization.

1. Add `"timeZone": "Asia/Tokyo"` to `apps-script/appsscript.json` and to the project.
2. Save `Code.gs`.
3. Editor → clock icon (**Triggers**) → **Add Trigger**: function `postRecurring`,
   deployment **Head**, event source **Time-driven**, **Day timer**, **3am to 4am**,
   failure notification **Notify me immediately**. Authorize when prompted.
4. Run `postRecurring` from the editor once and check **Executions**.

Create the trigger in the UI, not with `ScriptApp.newTrigger` — that needs the
`script.scriptapp` scope added to `oauthScopes`, which pins to `spreadsheets` alone and
is worth keeping there.

Change the failure notification off its **daily** default: that mail is the only channel
that reports the poster stopping, and the app cannot see it.

**Daily, not `onMonthDay(1)`.** Google can delay or skip a scheduled run, and this
trigger's documented failure mode — the consent screen lapsing, `SETUP.md` step 5 — is
silent. A monthly trigger that misses its one run does nothing for 30 days; a daily one
gets 28 more chances, each a no-op after the first. Cost is about 90 seconds of runtime a
month against the free 90 minutes **per day**, which the token minter also draws on.

**Triggers run HEAD; the web app runs the deployment.** Saving `Code.gs` changes tonight's
3am run immediately while the token endpoint keeps serving the version from `SETUP.md`
step 6. So adding the poster needs no new deployment — and a half-finished edit left saved
in the editor runs unattended.

## Open

- Whether the card prefills the form for a confirming Save (recommended), posts on one tap
  with an undo toast, or only lists what is missing.
- Whether templates stay hand-authored in the Sheet (recommended for v1) or get an editing
  surface in `SettingsSheet` — the latter roughly doubles the work: a write path, a
  soft-delete decision, validation codes and i18n for all of it.
- Whether phase 2 is wanted at all, or the card alone is enough.
