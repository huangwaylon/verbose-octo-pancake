# CLAUDE.md

Guidance for Claude Code working in this repository. The data model, the security
reasoning and the cost are in `README.md`; the Google Cloud walkthrough is in
`SETUP.md`. Neither is restated here — this file is only the rules that are not
visible from the code, and the reasons they exist.

**The target is one platform: Safari on iOS, installed to the Home Screen, on a
phone.** Not "mobile-first, desktop too" — desktop is a convenience. Every layout
decision is made at 320px first, and a rule that only matters in a standalone web app
is still a rule. See Platform below.

## Commands

| Command | Notes |
| --- | --- |
| `npm run dev` | Vite on 5173 (its default). |
| `npm test` | vitest, single run. Must pass before any commit. |
| `npm run build` | Production bundle into `dist/`, then `scripts/build-sw.js` emits `dist/sw.js`. |
| `npm run preview` | Serve the built bundle. Needed to exercise the service worker. |
| `npm run test:watch` | vitest in watch mode. |
| `npm run format` | Prettier, write. `format:check` is the CI gate. |

## Invariants

These are the rules that prevent silent data corruption. Breaking one does not
throw — it quietly writes the wrong thing to someone's spreadsheet.

**`src/schema.js` is the only file in `src/` that knows the sheet layout.** Column
names, order, ranges, and row↔entry mapping live there. Never hardcode a range like
`'expenses_p1!A2:G'` or a column index elsewhere — use a tab's own `letter` / `index`.
The one exception outside `src/` is `scripts/bank_to_ledger.py`, which cannot import it;
see Testing for the pin that keeps the two in step.

**There are TWO layouts, and every positional lookup hangs off a TAB, never the
module.** `EXPENSE_COLUMNS` and `SETTLEMENT_COLUMNS` put `deleted_at` at different
indexes (6 and 5), so one shared constant is not an optimisation — it is `compact`
reading the settlements tab's `id` column, non-empty on every row, and hard-deleting
every live settlement in the sheet. `dataTab` derives `index`, `letter`, `has`,
`dataRange`, `headerRange`, `rowRange` and `cellRange` per tab from that tab's own list;
`sheets.js` reads cells through `idCell`/`deletedCell`, which take the tab. Never
reintroduce a module-level index, and never compare a header row against one shared
expectation — `ensureStructure` would rewrite the settlements header with the expenses
columns on every call.

**The tab asserts what a row cannot: its type, and — for an expenses tab — its payer.**
`SETTLEMENTS.payer` is null, meaning "read the cell", and that cell is the only place in
the schema a column can disagree with reality. So `rowToEntry` REFUSES a settlement whose
payer names neither person rather than defaulting one, and `loadAll` counts what it
refused as `unattributedRows` — its own count, not folded into `undecodedRows`, because
the cell to go and fix is a different one and the amount usually reads fine. There is no
`type` column at all any more: an expenses tab cannot produce a settlement.

**`tabOf` is the one home of "where does this entry live".** `appendEntry` writes through
it and `updateEntry` finds the row again through it, so the two cannot disagree. It also
settles the settlement case with no branch: `tabOf` answers the same tab whichever payer
a settlement names, so changing that payer overwrites a cell instead of moving the row —
only an EXPENSE's payer moves one.

**Both column lists are append-only from here.** Every range and letter is derived from
array *position*, and `ensureStructure` rewrites a mismatched header row while never
touching data rows — so inserting or reordering a column relabels every existing row in a
live sheet, silently, under the wrong field.

They WERE reordered once, deliberately, to match the bank CSV's 取引日 / 摘要 / 引出額 and
to put `id` last. That was safe only because it shipped alongside a one-time manual column
migration on the single live sheet, in the same change as `scripts/bank_to_ledger.py`.
Append-only resumes: a second reorder gets no such window. `letterAt` carries the
26-column cap, and `test/schema.test.js` is the only guard that can catch it being
crossed.

**`loadAll`'s ranges are positionally coupled to `DATA_TABS`.** It builds
`[…DATA_TABS, config]` and maps `valueRanges[index]` back by the same index, which is
why both come from that one list rather than two literals: a row mapped to the wrong tab
is decoded with the wrong type AND the wrong payer, so the balance flips sign and
nothing throws.

**`loadAll` derives the config's index from `ranges.length`, and its no-config retry
slices from the END of that list.** Neither may become a literal. A data range added
later would otherwise hand ledger rows to `parseConfigRows`, where no key matches and
every config value silently falls back to a default while `configMissing` stays false
because the read *succeeded* — and would drop out of the retry entirely, so the tab it
names is never created and never reported.

**`rowToEntry` and `expensesTab` throw rather than guess a person.** Which tab a row
lives in *is* the payer, so a caller that cannot name one has lost track of the tab it
is reading, and every row it touches would be attributed wrongly.

**An id is not unique across the two tabs, and it is not unique WITHIN one either** —
a payer change appends to the new tab and tombstones the old row, so a payer that has
moved away and back leaves the id in that tab twice. Two rules follow. Every *read*
goes through `reconcileById`, and those hidden tombstones are still real rows, so
`supersededRows` is added back to the count the compact button acts on. Every *write to
an existing row* goes through `resolveRow`, which reads the full row range and prefers
the LAST match — the last live one, or the last dead one when every copy in that tab is
tombstoned. Both functions say what breaks without them, and both failures are silent.
(`appendEntry` is the one write with no existing row to resolve.)

**`updateEntry` and `setDeletedAt` must be told the row's CURRENT payer**, which is the
tab the row lives in now. `useLedger` reads it from local state as `previous.payer`,
never `entry.payer`, in both `editEntry` and `setDeleted`, and every layer refuses
rather than guesses: both of those throw `error.entryGone` when the entry has left
state, and `updateEntry` throws on a `previousPayer` that is not a person. That is why
`removeEntry` and `restoreEntry` take an id alone — a payer parameter is one a caller
could pass wrongly, or one this layer would have to choose between. Guessing appends a
duplicate row and then tombstones in the wrong tab, leaving two live rows for one entry.

**A pending row always beats the server's copy of it**, whether or not the sheet lists
its id — `mergeLoaded` says why both halves matter. Its corollary: `pending` must never
be left set with no write in flight, so `reverted` strips it. A stuck flag is permanent
and blocks `compact` for the life of the install.

**A read that changed nothing returns the array already on screen**, so `setEntries`
bails out instead of re-running every memo, re-rendering the month and re-serializing
the snapshot — the app re-reads on every resume and most reads change nothing. That
rests entirely on `sameEntry` being EXACT: it compares by key rather than against a
field list, because a field it misses is the other person's edit frozen off the screen
with nothing to report it. Entry values are primitives by construction, which is what
makes `===` per key an answer rather than an approximation. `applyLoad` holds the merged
**config**'s identity across such a read for the same reason, through `sameSheetConfig`
— without it a resume that changed nothing still re-renders the whole ledger, because
identity is what every `memo` keyed on the config compares.

**Only the newest read may apply.** `loadGeneration` in `useLedger` drops any reply that
is not the current one, and a read in flight when the key is forgotten must not
repopulate state for the sheet just left.

**`compact` never runs while a write is in flight, and it reports `busy` rather than
`{removed: 0}`** — "Removed 0 rows" is a lie when there are rows to remove.
`compactRefusal` in `ledgerState.js` holds both refusals and what each one prevents.

**Read state through `entriesRef`, never from inside a `setEntries` updater.** Take
`previous` from the ref *before* calling `setEntries`; `useLedger` says at the ref why an
updater cannot be trusted to run when it is needed.

**Never `USER_ENTERED`.** Every write passes `valueInputOption: RAW`, for the
reasons in README's data model.

**Do not add conflict detection, and do not describe the app as if it had any.**
Last-write-wins is the accepted design (README): `updateEntry` overwrites the whole
row, there is no `updated_at` comparison, and every alternative costs a round trip on
every save.

**An entry never carries its row position.** Row positions shift whenever anyone
edits the sheet in the Sheets UI, so `updateEntry` and `setDeletedAt` re-resolve
id → row through `resolveRow` immediately before writing. There is deliberately no
`rowNumber` field to be tempted by.

**`compact` and `missingDataGid` cover `DATA_TABS`, not just the expenses tabs.** Left
at two, every tombstoned settlement stays while `tombstoneCount` goes on counting it — so
`compactRefusal` says there is work to do, `compact` does part of it, and the next one
removes 0 rows and offers the same rows again, which is exactly the "Removed 0 rows is a
lie" case.

**`compact()` is the only hard delete.** It reads the full row range rather than the
`deleted_at` column, it serializes its two tab reads rather than batching them, and it
must issue its `deleteDimension` requests in **descending** row order within each tab.
All three protect the same thing — row numbers derived from position — and being one row
out here removes somebody else's expense. `sheets.js` says why at each one.

**Only `ensureStructure` builds structure, and it refuses a spreadsheet with several
tabs and none of ours** — a fresh one has exactly one, so that is not the ledger we were
pointed at. `looksUninitialized` is what turns a *failed read* into a build, and it
answers true for 400 and 404 alone: a 403 or a 500 must never lead to writing tabs into
somebody's spreadsheet. Nothing else may call it; see Gotchas for why `compact` does not.

**Every delete goes through `ConfirmDeleteSheet`**: `App` owns `pendingDelete` and
nothing else calls `removeEntry`. Recovery is the collapsed `DeletedList`, never a toast
action — a toast that has timed out is a delete nobody can undo.

**The deleted list is scoped to the month on screen**, because it sits under the
month switcher; settings' count stays sheet-wide, because that is what `compact`
acts on.

**The ledger is yen only, and no function takes a currency.** The yen has no sub-unit,
so an amount IS an integer number of yen: there is no exponent to decide, no code to
normalise, and no scale to get wrong. That is why `money.js` is as small as it is, and
why the multi-currency machinery it used to carry — `minorDigits`, `normalizeCurrency`,
the two ISO 4217 tables, `trimZeroCents`, the mixed-currency and defaulted-currency
notices — is gone rather than merely unused. **Do not reintroduce a currency parameter**
to make the app "ready" for another one; a second currency is a schema change, and
adding the argument back without the column is the one shape that IS a silent 100x error.
The one place `JPY` is still spelled is the `Intl` constructor in `money.js`.

**`parseAmountToYen`'s reading of a comma is defined once** at
`decimalSeparatorIndex`: comma-only with exactly three trailing digits is grouping,
anything else is a decimal, so `"1,234"` is 1234 and `"42,10"` is 42. It decides what
lands in the sheet, so it has one documented definition; `test/money.test.js` pins both
readings, and the bank export's `"1400.000000"` alongside them.

**Anything the sheet holds and the app cannot show is counted and said out loud.**
`loadAll` returns four such counts and explains each where it is counted; `noticeKeys`
turns them into notices and owns their precedence. Never repair the `configMissing`
case: re-seeding writes this build's defaults — an even split included — into a sheet
whose real values are unknown, and takes the notice away with them.

**`type` is case-folded on read, and the FIRST usable value for a config key wins.**
A hand-typed `Settlement` read as an expense inflates the month's spend and the category
donut by the whole transfer; a stale duplicate `default_split_p1` moves money on every
expense that person paid for.

**A row carries no `created_at` or `updated_at`, and `makeEntry` reads no clock.**
`deleted_at` is the only timestamp left, which makes it load-bearing twice over: it is
what soft-deletes a row, and it is what `supersedes` compares to break a
tombstone-vs-tombstone tie. That tie-break must never fall back to array order —
`loadAll` decodes all of p1's rows before any of p2's, so "last seen" is tab order, not
recency, and the copy it keeps after a payer-move-then-delete is the stale pre-move one.
Restoring that revives the entry under the wrong payer and flips its sign in the balance,
silently. `updateEntry` stamps the payer-move tombstone from the clock for the same
reason: a bare non-empty marker would leave nothing to compare.

**Within a day, `groupByDate` orders by id.** Arbitrary but stable, and — the point —
independent of which tab a row came from. Leaving the rows in arrival order would sort
every one of p1's expenses above every one of p2's on the same day, and an optimistic row
is appended, so it would sit at the bottom of its day and then visibly jump when the next
refresh returned the sheet's own order.

**A displayed share is not the saved share.** `toSplit` carries the exact `share`
beside the whole-percent `percent`, and `share` is what gets written; `splitAtPercent`
is the only place a slider position becomes one. Saving `percent / 100` moves money on
an edit that never touched the split.

**`parseShare` is the one reading of a share a human typed** — anything above 1 is a
percentage. Both the `payer_share` column and the `default_split_p*` rows go through
it. With two readings, the same `50` means "half" in one place and "the payer covers
all of it" in the other.

**`splitYen` must conserve every yen:** `payerYen + otherYen === yen`.

**Nothing written to the sheet is ever localized.** Config defaults, column names,
timestamps and amount strings are locale-independent by design: two people sharing a
sheet may be reading the UI in different languages, and the stored data must not depend
on whose device seeded it. The two people's names are the one place this cuts both ways
— `SEED_NAMES` writes English into a fresh sheet, while `DEFAULT_CONFIG` deliberately
carries no names at all, so a sheet that says nothing falls through to `nameOf`'s
localized fallback instead of "Person 1".

**Neither the locale nor the accent may ever be written to the sheet.** Neither person
gets to restyle the other's phone. Which of the two people this device is, is the third
per-device value and is likewise never written — nothing in the sheet can name it, and
nothing detects it (see Gotchas).

**Never add an `if (type === 'settlement')` branch to arithmetic** — `payer_share: 0`
already says it — and never count one toward a spend total or a category breakdown.

**Nothing in the UI creates a settlement**, so the balance in `Header` carries no action
and must stay that way unless asked. Everything below the UI still handles the type.

**The default split is per person, keyed on the payer.** `defaultSplitFor(config,
person)` is the only place it is decided. The two values are independent and need not
sum to 1 — only the payer's is ever read, so never mirror one from the other. A new
entry carries `payerShare: null` meaning "follow the payer's default"; an entry being
edited carries its stored share and must keep it, because a saved row records a decision
someone already made. `useEntrySplit` holds that distinction.

**The category `<select>` always offers the entry's stored category**, even when the
config tab no longer lists it. A `<select>` whose value matches no option renders blank
and then silently saves the invisible old value, so editing a row whose category has
since been renamed would quietly rewrite it.

**Dates are ISO strings, compared as strings.** Never `new Date('2026-08-05')` — that
parses as UTC midnight and shifts to the previous day in western timezones. Use the
helpers in `src/lib/dates.js`, which build dates from explicit parts. `isMonthKey` there
is the only test of a `'YYYY-MM'` key — a second one anywhere else is two answers to
whether month 13 is a month — and `monthParts` checks the SHAPE before the numbers,
because `split('-')` alone reads a full ISO day as a valid month and drops every entry
out of it.

**Config values are not all strings.** `CONFIG_FIELDS` in `src/lib/sheetConfig.js` carries a
kind per key, and each parser in `PARSERS` answers null for a value it cannot use so the
caller's defaults win: an empty list must never stand in for a default, or the category
picker ends up empty, and a share must never yield NaN, because that reaches `splitYen`
and moves money wrongly. `test/config.test.js` pins these. `mergeConfig` clones the arrays
it spreads, because the defaults are module-level and one caller's mutation would
otherwise corrupt every later merge in the process.

**A hook holds effects; the decisions live in `lib/`.** There is no DOM in the test
environment and no renderer for hooks, so nothing a `use*.js` file decides for itself is
reachable from a test. `useLedger` owns state, effects and call order only. Every
"given this list, what is the list next", every status decision, and every refusal
lives in `lib/` — `ledgerState.js` (list transitions, `reconcileById`,
`looksUninitialized`, `entryFromInput`, `hasPendingWrite`, `compactRefusal`,
`newDraftEntry`, `shouldRefresh`, `noticeKeys`, `gateFor`), `balance.js`
(`initialMonthKey` and the aggregates), `split.js` (`toSplit`, `nextSplit`). Put new
logic there, not in the hook, or it cannot be tested at all. Hooks themselves are not
confined to `src/state/`: `useEntrySplit` sits in `components/SplitField.jsx`, beside
the one control that holds its state.

**Refreshes on focus are throttled to a 30s floor, and EVERY read counts against it.**
Two people share one sheet with no push channel, so `useLedger` re-reads on `focus` and
`visibilitychange`; window switching is constant and every refresh spends per-user quota.
`load` stamps the clock, not the focus handler, so the launch read and a tap on Refresh
are not followed seconds later by a window switch spending another. Do not remove it.

**The token mint starts before the first React render**, not from the first effect that
wants one. Everything after it is strictly serialized — token, then sheet read, then
fresh data — so asking from an effect adds the whole first render to the wait: measured
at 90ms behind a 120-entry snapshot and 165ms behind 400, at 4x CPU throttle.
`src/main.jsx` carries the rest, including why it is prod-only and guarded on `hasKey()`.

**Display formatters are cached, keyed on everything that decides one.** `money.js` and
`dates.js` each hold a `Map`, because a month's ledger asks for one `Intl` formatter per
amount and per day heading. `money.js`'s key is now the locale ALONE, because the
currency and its zero fraction digits are fixed — but neither cache may key on less than
the full set of options it actually passes, and a `money.js` key of nothing at all would
be that same bug in its worst form.

**The app key is never a build-time value.** It is typed once per device and lives
only there. `VITE_SCRIPT_URL` ships in the public bundle, so nothing may depend on
the endpoint being hard to guess.

**The token endpoint always answers HTTP 200.** `ContentService` cannot set a status, so
`{"error":"unauthorized"}` arrives as a 200 and the body is the only signal: branch on
the body, never on `response.ok`. A rotated key and a network blip are different failures
and must not be conflated in either direction. `connection.js` holds that taxonomy —
`unauthorized` terminal, everything else (non-JSON, rejection, timeout) transient — and
it **flags a rejected key rather than deleting it**.

**The mint request is `Content-Type: text/plain`, and the method is never forced
through the redirect.** `text/plain` keeps it a CORS simple request; a preflight
would be answered with the 302 that `/exec` returns and die, which is also why the
script has no `doOptions`. `fetch` downgrades POST to GET across that 302 and Apps
Script serves the computed reply from the echo URL — forcing POST through the hop
returns "page not found".

**`doPost` must be structurally incapable of throwing**, because Google's HTML error page
is classified as transient — so a bug there hides behind a "showing saved data" notice
instead of being reported — and it must never read `e.parameter`, which would log the key.
`apps-script/Code.gs` carries the reasoning.

**The refresh margin is performance; the 401 retry is correctness.** Minting needs no
user gesture, so `sheets.js` recovers silently. `refreshToken`'s generation counter is
why: a mint that began *before* the 401 may carry the token Google just rejected, and
the retry runs with `allowRetry: false`.

**A failure that retrying cannot fix must not be reported as transient**, or it hides
behind the focus refresh's 30-second floor and a "showing saved data" notice forever.
Two of them: a lost share, and the token endpoint's `{"error":"unavailable"}` (the 7-day
consent-screen expiry). A 403 is *both* — Google also returns it for a tripped quota —
so `isUnreachable` reads the reason rather than the status.

**An entry's id is minted when the draft opens, not per submit**, so a retry after a lost
response is at worst a duplicate row the client reconciles, rather than a second expense
with its own id.

**No raw error text ever reaches the screen.** `i18nError` is the only way to throw
something a person will read. `sheets.js` and `connection.js` keep the API's own
English on `.message` for consoles and bug reports and attach an `i18nKey` instead;
`errorMessage(cause, fallbackKey)` in `i18n/index.js` is the only way a caught error
becomes a sentence, and it never falls back to `.message`. Show `cause.message` and a
Japanese reader gets "The caller does not have permission (HTTP 403)".

**Store the cause, never the sentence.** `useLedger` keeps the thrown error and `App`
calls `errorMessage` at the render; `SettingsSheet` keeps the compact *outcome* and
builds its message the same way. A translated string is frozen in whichever language was
current when it was built, and both of these outlive a language change — a read error
sits on screen for as long as the sheet is unreachable, and the settings panel is where
the language gets changed.

**The snapshot is validated per entry, and dropped whole if any row fails.** It is the
one input never decoded through `rowToEntry`. **Bump `VERSION` whenever the persisted
shape changes**; `v` is a drop marker, never a migration. Five more things in
`snapshot.js` are easy to break and each says so where it lives: what a bad row costs
during the first render, the silent stop past `MAX_CHARS`, storing the **pre-merge**
config, `clearSnapshot` having to reset the remembered payload, and a successful *read*
seeding that payload — without which every cached launch re-serializes and rewrites the
bytes it just restored, on the one frame somebody is waiting for.

**The cache is written from the screen, only once nothing is pending.** An effect in
`useLedger` owns that, so an unacknowledged optimistic row can never reach it — and a
write that lands after a refresh started is not lost from it either.

**`setSafeToReload` must stay wired, and `reconsiderUpdate` with it.** `serviceWorker.js`
defaults the predicate to `() => true`; one effect in `App` narrows it to "no draft open,
no write in flight" and nudges immediately afterwards. Both halves are load-bearing:
without the predicate an update reloads mid-entry and discards what someone was typing,
and without the nudge a worker refused while the form was open is never asked again —
nobody who stays in the app produces a `focus` event. Its own one-hour update floor comes
from the same `shouldRefresh` the sheet read uses.

**Precache from a `dist/` walk, derive the cache name from file CONTENTS, match with
`ignoreVary: true`, and never intercept a cross-origin request.** All four fail silently;
`scripts/build-sw.js` and the worker it generates say why at each, and
`test/sw-build.test.js` pins the first three. The cross-origin `return` is the first
statement of the `fetch` handler rather than a property of scope, which decides which
*clients* are controlled and not which *requests* are seen. **The base path lives in
`base.js`, and both builds read it from there**: two copies that disagree means no worker
ever activates, with nothing on screen looking wrong.

**There is no migration code, and no users to need it.** Do not add a
back-compatibility branch, and do not keep one on the grounds that it "keeps an
existing sheet working".

## Conventions

- **Plain modern JavaScript, ESM.** No TypeScript. `.jsx` only for files containing
  JSX.
- **Prettier owns formatting, for `.js`/`.jsx` only.** `npm run format:check` runs in
  CI before the tests. The stylesheets and docs are outside the glob: their layout is
  hand-tuned (grouped selectors, aligned contrast ratios, hand-wrapped prose) and a
  reflow would rewrite every paragraph. Where a literal is a table rather than a list,
  use `// prettier-ignore` rather than widening `.prettierignore`, which only needs
  `dist/`. The directive must be a comment whose text is *exactly* `prettier-ignore`:
  append a reason to that line and it is silently inert, so put the reason on the line
  above.
- **No new npm dependencies** without a clear reason. The bundle is React plus
  application code; icons are inline SVG in `src/components/icons.jsx`. A new
  dependency also means a CSP decision.
- **`SettingsIcon`'s path is generated, not drawn.** Every point is
  `(12 + r·cos θ, 12 + r·sin θ)` at `θ = 45k° ± 13°` on one of two radii — 9.2 at a
  tooth tip, 6.5 at its root — so the eight teeth are centred on the 45° steps, every
  shoulder is radial, and the whole cog is even by construction. A hand-transcribed gear
  lands one tooth off and reads as an unfinished glyph at 20px. Do not tidy those
  numbers — regenerate them.
- **If you add a Google host, update the CSP** in `index.html`. It is a deliberate
  allowlist, not boilerplate.
- **Never put a real secret in a `VITE_` variable.** Vite inlines every `VITE_`-prefixed
  variable into the shipped bundle, and `VITE_SCRIPT_URL` is the only one that goes
  through Vite at all — it is public by design. `VITE_BASE` is read from `process.env`
  by `base.js` at build time and never inlined, so its name is the misleading part
  rather than a second exposure.
- **Comments explain *why*, not *what*.** Match the existing density — the
  non-obvious constraint gets a comment; the obvious line does not. State the standing
  rule, not the incident that produced it: "the sticky aside offsets by this token",
  never "this shipped broken once".
- **One helper, one home.** `readStored`/`writeStored` in `src/config.js` are the only
  `localStorage` touches; `cellText` and `columnIndex` live in `schema.js`; `PEOPLE` is
  the only `[p1, p2]` literal; `UNCATEGORIZED` in `balance.js` is the only spelling of
  that bucket; `useEntryTitle` is the only place an entry becomes a one-line title, for
  all three surfaces that show one. `usePeopleLabels` is the only place a component turns
  a person into a name, and it has three forms — `name`, the viewer-relative `label`, and
  `possessive`, which exists because English inflects: interpolating `label` into
  `'{name}’s share'` reads "You’s share" for whoever is holding the phone, and which of
  the two possessive strings applies is a catalog decision rather than a rule in JS.
- **A control that appears twice is a component.** `Field` (the one home of the
  `<label htmlFor>` vs `<span>` decision), `Segmented` (four call sites, itself built on
  `Field`), `EntryLine` (both entry lists), `NoteField` and `SplitField`. The two radio
  groups — `Segmented` and the accent swatches — each carry their own
  `role="radiogroup"`. `EntryAmount` used to be on this list; with one currency its whole
  job was gone, so it was inlined into its single caller rather than kept as a wrapper.
- **`LedgerScreen` is the signed-in surface, and THREE things render it**: `App`,
  `scripts/preview.jsx`, and one static render in `test/render.test.jsx`. Written more
  than once, a layout change silently leaves the only visual check screenshotting a tree
  the app no longer has. `App` keeps the gates, the sheets and the state;
  `useLedgerView` holds every derived figure.
- **`EntryList`, `EntryRow` and `SummaryCard` are `memo`, and every handler they take
  must stay stable.** `App` re-renders on each toast, each refresh and each month change,
  and those three are the only subtrees whose cost grows with the ledger — so an inline
  arrow passed to one of them turns the memo into dead weight that still pays for the
  comparison. `editDraft` is in a `useCallback` for exactly that; `setPendingDelete` and
  `setMonthKey` are setters and already stable. Nothing looks wrong when this breaks and
  no test can see it — `renderToStaticMarkup` never re-renders.
- **The entry form's field order is by how often each field is touched**, not by how the
  sheet reads: amount, note, category, who paid, date, split. `EntryFormSheet` says why.
  It is a decision, so `test/ui.test.jsx` asserts the order — nothing else can see it.

### i18n

English and Japanese, no dependency. `src/i18n/` holds the engine (`index.js`), the
two catalogs (`en.js`, `ja.js`), the registry (`catalogs.js`), and the node-returning
variant for strings with inline markup (`nodes.jsx`).

- **Never hardcode a user-facing string in a component**, including every `aria-label`,
  `aria-valuetext`, `alt`, `title` and `placeholder`. `test/i18n.test.js` scans `src/` for
  an unreferenced catalog key (the `error.` and `accent.` prefixes excepted), a referenced
  key no catalog has, and a bare literal in one of those attributes. It documents its own
  blind spots: a key held in a variable is invisible to it, so build arrays out of `t()`
  calls rather than keys, and it cannot see a template literal at all — which is how an
  untranslated `aria-label` gets through.
- **A key built at runtime needs its own coverage test.** The scan cannot see
  `` t(`error.${code}`) ``, so each family is asserted against its source list
  instead: `ENTRY_ERROR`, `CONNECTION_ERROR` and `ACCENTS`.
- **It is a module singleton, not a context.** `render.test.jsx` renders components
  bare, and non-React modules (`useLedger`) need the same `t`. A provider would break
  the first and be unreachable from the second.
- **Every `useSyncExternalStore` needs the third argument and a stable snapshot.**
  Omitting `getServerSnapshot` throws under `renderToStaticMarkup`, which is how every
  render test runs — `useT` and `useAccent` both pass it. `useConnection` folds
  everything a render depends on into ONE primitive string for the same store, because a
  fresh object per call is a new snapshot every time and loops.
- **Plurals go through `Intl.PluralRules`, never a `count === 1` ternary.** A
  pluralised value is an object keyed by CLDR category, and it is the only case where
  a catalog value is not a string. `en` supplies `one`/`other`; `ja` supplies `other`
  alone, because that is what `Intl.PluralRules('ja')` reports.
- **The pure layers stay pure.** `money.js`, `dates.js`, `balance.js`, `schema.js`,
  `split.js` and `identity.js` never read the singleton; locale and localized strings
  arrive as arguments with English defaults.
- **A test that calls `setLocale` must restore it** in `afterEach`, or the state leaks
  into other files.

### Accessibility

- **A message a control produced must be reachable from that control** — and it must be
  *reachable on screen* too. The amount error lives inside its own `Field`, not at the
  foot of the form: `aria-describedby` reaches it from either place, but from the foot it
  renders a screen's worth below the input on a full-screen form, with nothing scrolling
  it into view. A save failure is the deliberate opposite — it sits at the foot, directly
  above the footer, and the **submit button** carries the `aria-describedby` for it, since
  that is the control that produced it. Ids are document-global, so the button being
  outside the `<form>` is no obstacle. Anything whose value changes without a page change
  carries `role="status"`: both errors, the split breakdown, the notices, the compact
  result.
- **A toast carries its own region, one tone per urgency.** The region sits on each toast
  rather than on the stack: a write failure is `role="alert"` with `aria-live="assertive"`
  because it must interrupt, a confirmation is `role="status"` and `polite` because it
  must not. `Toasts.jsx` holds what that choice costs and why the ordering matters.
- **A validation error is derived from the value that was rejected**, never stored as a
  message and never keyed on a bare "has submitted" flag; `amountError` in
  `EntryFormSheet` says what each of those two costs. `saveError` *is* stored, because
  nothing about the form's own values can tell you the network failed, and it is cleared
  **before** the amount is judged: left set, a failure from the previous attempt renders
  beside a fresh field error, describing a write this submit never made.
- **The balance is the deliberate exception, and must not become a live region.** It
  changes on every write, but every one of those writes already speaks through a toast —
  the add and the save included — and a second region would queue behind it. `Header` says
  the rest; `test/render.test.jsx` pins it.
- **The hero figure is named by a sentence, not by its digits.** The `<h1>` carries an
  `aria-label` of the whole fact ("You owe Sam $42.50"), which is why no part span is
  `aria-hidden` and the visible direction line below it is. Never move the name onto the
  `<p>` — `role="paragraph"` prohibits naming, so it would announce nothing at all.
- **`BottomSheet` reads `onClose` through a ref**, so no effect depends on its identity.
  Every caller passes a fresh inline arrow, so a re-render of the screen behind the sheet
  — a focus refresh landing while someone types — would otherwise re-run the open effect
  and yank focus back to the first field.
- **Cancel comes first in the DOM in `ConfirmDeleteSheet`**, because `BottomSheet` puts
  focus on the first control it finds and on a destructive dialog that must be the way out.
- **Identity is never communicated by colour alone.** The chart legend always carries
  name, value and share; the who-paid meter's second segment carries a hairline.

### Platform: iOS, standalone, small

Every rule here is invisible in a desktop browser and wrong on the actual target.
`test/styles.test.js` pins them, because nothing else can.

- **The sheet and the key screen both lift clear of the software keyboard.** iOS does not
  shrink the layout viewport for it, and `position: fixed` and `dvh` both track that
  viewport, so anything reaching the bottom of the screen puts its own Save or Connect
  behind a keypad with no Done key. `useKeyboardInset` is the only publisher of
  `--keyboard-inset` and `lib/viewport.js` the only home of its arithmetic. Exactly three
  selectors read it — `.sheet`, `.sheet__footer` and `.gate` — and neither panel does:
  both cap against **`100%`** of `.sheet`'s already-padded box, so the inset has one
  source of truth rather than a copy per panel. Those five sites and
  `test/styles.test.js` carry the rest, the `48rem` block's restated `padding-bottom`
  included.
- **A page's worth of form takes the whole phone screen; a question does not.** Full
  screen is `.sheet__panel--full`, opt-in through `BottomSheet`'s `full` prop, because it
  is a claim about the CONTENT — the expense form fills a phone, while the delete
  confirmation and a settlement edit (three fields, the note, category and split all
  gone) would become several hundred pixels of white. Three declarations there are
  load-bearing and all three fail quietly; `primitives.css` says what each costs.
- **Hover is a mouse state, `:active` is the touch one.** iOS applies `:hover` on tap and
  holds it until the next tap elsewhere, so every hover rule sits behind
  `@media (hover: hover)` — `::-webkit-scrollbar-thumb:hover` behind `(pointer: fine)` is
  the one equivalent gate — and every hover-styled control has an `:active` too, since
  the platform tap highlight is cleared and `:active` is the only press feedback there is.
  The two carve-outs `test/styles.test.js` exempts are `a` and the scrollbar thumb:
  neither is a control with a press state.
- **`overscroll-behavior-y: none` on `html`.** An installed iOS web app reloads on a
  downward flick from the top, and that reload never consults `setSafeToReload`, so it
  can discard a half-typed entry.
- **`base.css`'s `html` rule declares no `overflow` of its own.** `BottomSheet` sets
  `overflow: hidden` on `html` as well as `body` while a sheet is open and restores
  whatever it found, so a declaration in that rule would become the value it restores to
  and the ledger would stay locked after the sheet closed. Both elements, not just
  `body`: the spec's propagation rule only reaches the viewport while `html` says nothing.
- **`touch-action: manipulation` on anything tappable.** `base.css` sets it on `button`
  only, so `.btn` (also worn by an `<a>`, the link to the sheet in Settings), the
  label-based controls, the `<summary>` and the backdrop each need their own or they wait
  300ms for a double-tap that would only zoom. `button.entry__main`'s copy is inert —
  `base.css` already covers it — and stands so that variant's touch and selection rules
  read as one block. Its `user-select` and `-webkit-touch-callout` are not inert and
  belong to the button alone: the deleted list renders the same class as inert text,
  where a press state promises a tap that does nothing and a note nobody can copy is worse.
- **A full-screen panel covers the backdrop, so a phone has two ways out, not four.**
  The X and the footer's Cancel are those two; the backdrop tap and Escape belong to
  wider screens and to a keyboard. Neither of the two may be removed as a duplicate of
  the other.
- **No control may set the size of the sheet it sits in.** `.sheet` is a row flex
  container and `.sheet__panel` a column one, so `min-width: 0` on the panel and
  `min-height: 0` on the body are the two guards against a flex item's automatic minimum,
  one axis each; `primitives.css` says what each one prevents. The child that provokes
  the first is `input[type="date"]`, which iOS sizes from the locale's date format via
  the UA shadow DOM, so it needs its own `min-width: 0` and `appearance: none`.
- **Nothing may scroll sideways at 320px.** `.sheet__body` sets `overflow-x: hidden`
  explicitly, because with `overflow-y` set the spec computes a `visible` overflow-x to
  `auto`. Anything holding config-tab text needs `min-width: 0` (a flex item's automatic
  minimum is min-content) and `overflow-wrap: anywhere` (`break-word` does not reduce
  min-content width). The two `preview-en-stress*` pages are the check: names, categories,
  notes and amounts that no phone has room for. That `hidden` also CLIPS rather than
  reports, so the harness measures `.sheet__body`'s own scroll width — the document's
  cannot see it.
- **The toast stack takes no pointer events**, or it would swallow a tap on a delete
  control for the toast's whole life. Covering a row briefly is accepted; the layout
  deliberately reserves no band for it.
- **A row is a row, not text.** `button.entry__main` suppresses selection and the
  callout: it is the edit affordance, and a long press should not raise the selection
  magnifier.
- **Safe areas are composed where they are needed, not globally.** `base.css` applies
  only the HORIZONTAL insets, and only to `body`; the top and bottom ones are applied
  nowhere globally, so each element that paints *into* an inset while padding its own
  content composes what it needs. Six do: the sticky header (`--safe-top`), `.layout`,
  the sheet footer and the toast stack (`--safe-bottom`), `.gate` (both), and the
  full-screen sheet panel — which adds the horizontal pair too, because `.sheet` is
  `position: fixed` and its descendants therefore sit outside `body`'s padding
  altogether. That panel is the one place the horizontal insets have to be restated.

### Charts

`DonutChart` is hand-rolled inline SVG — no charting library, and it uses a
`stroke-dasharray` trick rather than arc-path math (r is chosen so the circumference
is exactly 100, making a dash length a percentage).

- **The `--series-N` order is the colorblindness-safety mechanism, not cosmetic.** The
  order is validated against the white card surface as a 6-slot categorical set,
  including the ring's wrap-around pair. Never reorder, never cycle past slot 6 — a
  7th category folds into "Other" via `foldTail`. Accent presets deliberately do not
  touch these.
- **Set the slice stroke inline, never in CSS.** A CSS rule on `.chart__slice` overrides
  the attribute and paints every slice one colour — an invisible chart that passes every
  test. `test/ui.test.jsx` pins it.
- **Two values is not a pie.** The who-paid split is a meter bar, and its second
  segment carries a hairline: the accent wash is 1.04:1 against the track, so without
  it the bar reads as "one person paid everything".

### CSS

Four files, loaded in order by `src/main.jsx`: `tokens.css` (custom properties),
`base.css` (reset, typography), `primitives.css` (generic `.card`, `.btn`, `.input`,
`.sheet`, …), `app.css` (app-specific layout).

- **Light theme only.** There is no dark block and no `--success`/`--warning`: state
  is stated in words, and money direction is never encoded in hue.
- **An accent preset is three custom properties** under `[data-accent]` in
  `tokens.css` — attribute-scoped rather than `:root`-scoped so a settings swatch can
  paint its own colour, with `--accent-ring` and `--danger-ring` derived by `color-mix`
  rather than restated.
- **Use the tokens.** In particular use `var(--transition-fast|base)` rather than a
  hardcoded duration — the tokens collapse to ~0ms under `prefers-reduced-motion`, so
  hardcoding silently opts out of that support.
- **`letter-spacing: 0` and no `text-transform`, anywhere text can be Japanese.**
  Tracking inserts a gap between every kana (「このつき」 becomes 「こ の つ き」) and
  `uppercase` is a no-op on kana. The lone carve-out is `.balance__amount`, which
  renders digits exclusively.
- **No line-height below 1.5** on anything that can hold Japanese; CJK glyphs fill the
  em box. `--lh-flat: 1` is the single carve-out, same element, same reason. There is
  no `--lh-heading`: headings use `--lh-tight`, which *is* 1.5.
- **Nothing below 13px**, `<code>` included. Weights are `400|500|600` only.
- **Elevations appear in exactly three places, and the budget is stated at
  `--shadow-*`** in `tokens.css`. `box-shadow` is used for three other things that are
  not elevations and do not count against it: the focus ring, the swatch's selection
  ring, and the meter's segment hairline. It is transitioned in exactly one place, the
  text control's focus ring; `test/styles.test.js` pins that.
- **Contrast budgets live in `tokens.css`, next to the values, with their measured
  ratios.** Do not restate them here; do not "tidy" two tokens together because they
  look similar. The two that catch people are `--line-input` and `--ink-3`, and both
  say why at the value.
- **`--shell-max` has to leave room for `--main-max`.** `.layout` is border-box, so a
  narrower shell makes the `1fr` main track resolve below `--main-max` and that cap
  never binds at any width. The arithmetic is written out at the tokens.
- **Match the layout's centring with a percentage, never a viewport unit.**
  `.app__header` pads by `50% - …` because `.layout` centres with `margin-inline: auto`
  inside BODY's content box, which `base.css` has already shrunk by the horizontal safe
  insets, while a viewport unit measures past them. A rotated iPhone 15 is 852px wide, so
  it clears `48rem` with 59px insets and the two disagree by exactly that — the hero
  figure visibly out of line with the ledger below it.
- **`.btn--icon` is not combined with `.btn--ghost`.** They disagree about the border,
  and the icon glyph at `--ink-2` is itself the 3:1 graphic.
- **Never drop a form control below 16px.** Mobile Safari zooms on focus below that and
  will not zoom back out. The amount input is the same 16px as every other one: it is
  made primary by being first, focused and given a numeric keypad, not by type size —
  `.tnum` is all it adds, because it is the one field digits are typed into a character
  at a time and proportional figures shift every glyph as the value grows.
- Mobile-first. One column, capped at `--column-max` from `48rem`, two columns at
  `62rem`; **`48rem` is also where a sheet stops being a phone treatment** — full screen
  or bottom sheet below it, centred dialog above — and there is no third breakpoint. Tap
  targets are `var(--tap-target)` (44px), or `var(--tap-target-sm)` (36px) for chips and
  the segmented thumb.
- **A modifier that only holds below `48rem` must be undone inside that media query.**
  `.sheet__panel--full` and `.sheet__panel` are both single-class, so source order alone
  decides between them, and a phone-only declaration left standing reaches the desktop
  dialog. Keep the reset next to the rule it undoes.
- **An animation's distance is a length, not a percentage,** where the element it moves
  can be the whole screen: `sheet-slide-up`'s offset is read against the panel's own
  height, so a percentage tuned on a floating panel becomes a ~50px lurch on an 852px one.
- **`--header-height` must never understate the header's real height.** `.layout__aside`'s
  sticky offset reads the token from outside the header, so a token that is short slides
  the aside under the band with nothing on screen looking wrong. `min-height` has to be the
  binding constraint; `tokens.css` writes out the arithmetic and `scripts/frames.html`
  measures it.
- Keep specificity flat: single class selectors, no IDs, no `!important`.

## Testing

Specs live in `test/**/*.test.{js,jsx}`, with shared harnesses under `test/support/`.

`sheets.test.js` runs against a fake Sheets API in `test/support/sheets-api.js` that
records every request, because this layer's failures are writes: the assertions are
about what was *sent*, not what came back.

`connection`, `snapshot`, `sw-build`, `styles`, `preferences` and `viewport` exist
because their failures are invisible in a build and on screen — a misclassified endpoint
reply, a cached row the balance cannot survive, a precache list that stops any worker
activating, a merged CSS rule that lands on the wrong block, an accent that writes an
attribute CSS has no rule for, a keyboard inset that leaves Save covered.

**`scripts/bank_to_ledger.py` is the one place outside `schema.js` that knows the column
list**, because it is Python and cannot import it. It writes rows for the same tabs, so a
disagreement is silent in the worst way: the script keeps emitting its old order, the rows
paste in looking plausible, and every value lands under the neighbouring field.
`test/schema.test.js` parses the Python literal and compares it to `EXPENSE_COLUMNS` —
change the two together, and never add a third home.

**A test that cannot fail is worse than no test**, because it reads as coverage. Do
not assert a function against itself, do not assert a property of the platform, and do
not name a test after an invariant it does not exercise. Four specific traps here:
deriving an expected value from the module under test (write the literal `'K'`, not
`tab.letter('deleted_at')`); asserting `not.toContain` against a string that appears
in neither the right nor the wrong output; accepting either of two shapes with `??`
when only one is correct; and asserting an attribute that a DIFFERENT element in the
same markup already supplies — check the element, not the document. **Mutate the code
and watch the test fail** before believing it.

`render.test.jsx` and `ui.test.jsx` render components to static markup with
`renderToStaticMarkup` — no DOM, no browser. They catch components that throw on a
real prop shape or silently drop data, which a build cannot. A focus trap, an effect,
or a `scrollIntoView` call cannot be tested this way; do not fake a DOM to try. That
is the reason logic belongs in `lib/`.

`sw-build.test.js` asserts the generated worker compiles (`new Function(source)`), not
only that it contains the right substrings — a typo inside the template literal
satisfies every substring check while producing a worker that never installs.

When fixing a bug, add the regression test. When changing balance or money
arithmetic, the test that matters most is the end-to-end one: a settlement of exactly
the outstanding balance must drive the net to zero, with odd-unit amounts so rounding
is genuinely exercised.

**A passing suite does not mean it looks right.** `scripts/preview.jsx` renders the real
`LedgerScreen` to static HTML with the real stylesheets, seventeen pages of it: every
accent, both languages, the four overlays, the settled balance, and two stress pages
holding everything a 320px phone has no room for. The settlement form earns its own page
because it is the sparsest thing the entry form renders and the only place its two
`!isSettlement` blocks are visible. `scripts/frames.html` views them at several widths at
once with every measurement printed underneath; its header comment carries the harness's
reasoning and what each readout asserts.

```sh
npx vite-node scripts/preview.jsx     # writes scripts/preview-*.html (gitignored)
python3 -m http.server 8899           # iframes need an origin
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --virtual-time-budget=3000 --screenshot=/tmp/shot.png --window-size=1400,1000 \
  'http://127.0.0.1:8899/scripts/frames.html?page=preview-en-form&w=320,393&h=852'
```

`page` is any generated file's name without `.html`. The widths worth walking are 320 (the
floor), 393 (iPhone 15), 430, 768 and 1440; `frames.html` documents `w`, `h` and `keyboard`
and why height matters as much as width.

## Gotchas

- **Never run a bare `npm install` on a machine with a private registry.** It bakes
  that host into every `resolved` URL in `package-lock.json`, which works locally and
  fails on any other machine with `getaddrinfo ENOTFOUND`. A repo `.npmrc` cannot
  prevent it — npm ranks env vars higher — so always regenerate with an explicit
  override, which `test/lockfile.test.js` then verifies:

  ```sh
  rm -rf node_modules package-lock.json
  npm install --registry=https://registry.npmjs.org
  ```
- **`compact` asks for the sheet gids every time, and never through `ensureStructure`.**
  `values.batchGet` cannot reveal a gid, so `loadAll` never has one and `readSheetGids`
  is a round trip `compact` always pays. `ensureStructure` would answer the same question
  and WRITES: on a ledger whose config tab has been deleted it re-creates the tab and
  seeds it with this build's defaults — an even split included — taking away the
  `configMissing` notice and moving money on every later expense whose payer had a
  different default. There is deliberately no cached `sheetIds` state to make
  that shortcut look free. `compact` skips a tab whose gid is missing, and the throw in
  `useLedger` is what stops that being silent.
- **An endpoint that dies about a week after setup is the consent screen**, not a
  quota problem. `SETUP.md` step 5.
- **Nothing detects which person this is.** `IdentityGate` and the `localStorage`
  choice behind it are the only path — not a fallback.
