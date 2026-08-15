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

**`src/schema.js` is the only file that knows the sheet layout.** Column names,
order, ranges, and row↔entry mapping live there. Never hardcode a range like
`'expenses_p1!A2:K'` or a column index elsewhere — use `columnLetter` /
`columnIndex`.

**`EXPENSE_COLUMNS` is append-only, and capped at 26.** Every range and letter is
derived from array *position*, and `ensureStructure` rewrites a mismatched header row
while never touching data rows — so inserting or reordering a column relabels every
existing row in a live sheet, silently, under the wrong field. The cap is
`columnLetter`'s single-character arithmetic (`65 + index`): column 27 answers `'['`
and every range built from it is rejected. `test/schema.test.js` asserts the length,
which is the only way that limit can be crossed.

**`loadAll`'s ranges are positionally coupled to `PEOPLE`.** It requests
`[p1, p2, config]` and maps `valueRanges[index]` back by the `PEOPLE` index, so
reordering either list attributes every row to the wrong payer: the balance flips
sign and nothing throws.

**`rowToEntry` and `expensesTab` throw rather than guess a person.** Which tab a row
lives in *is* the payer, so a caller that cannot name one has lost track of the tab it
is reading, and every row it touches would be attributed wrongly.

**An id is not unique across the two tabs**, because a payer change leaves a
tombstone behind. Every read goes through `reconcileById`, which says what breaks
without it. Those hidden tombstones are still real rows, so `supersededRows` is added
back to the count the compact button acts on.

**`updateEntry` must be told the row's CURRENT payer**, which is the tab the row
lives in now — `useLedger` passes `previous.payer` from local state, never
`entry.payer`. Both layers refuse rather than guess: `editEntry` throws
`error.entryGone` when the entry is no longer in state, and `updateEntry` throws on
a `previousPayer` that is not a person. Guessing appends a duplicate row and then
tombstones in the wrong tab, leaving two live rows for one entry.

**A pending row always beats the server's copy of it**, whether or not the sheet lists
its id — `mergeLoaded` says why both halves matter. Its corollary: `pending` must never
be left set with no write in flight, so `reverted` strips it. A stuck flag is permanent
and blocks `compact` for the life of the install.

**Only the newest read may apply.** `loadGeneration` in `useLedger` drops any reply that
is not the current one, and a read in flight when the key is forgotten must not
repopulate state for the sheet just left.

**`compact` never runs while a write is in flight**, because deleting rows shifts the
row numbers a pending write already resolved. It reports `busy` rather than
`{removed: 0}` — "Removed 0 rows" is a lie when there are rows to remove.

**Read state through `entriesRef`, never from inside a `setEntries` updater.** An
updater only runs synchronously while React's eager-state bailout applies, which any
other pending update on the component defeats — and `App` sets its own state in the same
handler as a delete. Take `previous` from the ref *before* calling `setEntries`.

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

**`compact` reads the full row range, not just the `deleted_at` column**, because its
row numbers come from position and that column is empty on most rows. Being one row out
in the only hard delete removes somebody else's expense.

**`compact()` is the only hard delete**, and it must issue its `deleteDimension`
requests in **descending** row order within each tab, or earlier deletions shift the
indices of later ones.

**Only `ensureStructure` builds structure, and it refuses a spreadsheet with several
tabs and none of ours** — a fresh one has exactly one. That refusal is the real guard,
because `compact` also calls it for the gids. `looksUninitialized` is what turns a
*failed read* into a build, and it answers true for 400 and 404 alone: a 403 or a 500
must never lead to writing tabs into somebody's spreadsheet.

**Every delete goes through `ConfirmDeleteSheet`**: `App` owns `pendingDelete` and
nothing else calls `removeEntry`. Recovery is the collapsed `DeletedList`, never a toast
action — a toast that has timed out is a delete nobody can undo.

**The deleted list is scoped to the month on screen**, because it sits under the
month switcher; settings' count stays sheet-wide, because that is what `compact`
acts on.

**`minorDigits(currency)` is the only place a currency's exponent is decided**, and
it is a hardcoded ISO 4217 table, never derived from `Intl`: it decides what gets
written to the sheet, so it must be identical on every device forever.

**Every money function takes the currency explicitly; none defaults it.** The string
`"1250"` is ¥1250 or $12.50 depending only on the currency it is decoded with, so a
default is a silent 100x error rather than a convenience. `centsToSheetString` and
`entryToRow` both throw without one, and `validateEntryCodes` reports
`MISSING_CURRENCY`. The display formatters are the deliberate exception — they fall
back to the ISO default and to `decimalString`, never to the sheet encoder, because
a missing currency must not take a render down but must never be written.

**`normalizeCurrency` is the only spelling of a currency code.** Three letters,
upper-cased, and `''` for anything else. `parseConfigRows`, `rowToEntry` and
`makeEntry` all apply it, so an unusable code becomes `''` and `validateEntryCodes`
refuses the entry rather than a scale being invented. `hasMixedCurrencies` compares
two codes with `!==`, so one lowercase config cell would otherwise latch the
mixed-currency warning on over totals that are homogeneous. `minorDigits` still
answers 2 for any three-letter code it does not recognise, so a *typo* in a
well-formed code stays a silent 100x error — that one cannot be guarded here.

**Decode a row's currency BEFORE its amount.** `rowToEntry` takes the sheet's
currency and uses it only when a row's own currency cell is blank or unusable — a
row somebody added by hand. `loadAll` therefore resolves the config *before* mapping
rows. `test/currency.test.js` pins both scales. `entryToRow` writes each row at its
*own* currency's scale, never the config's.

**Anything the sheet holds and the app cannot show is counted and said out loud.**
`loadAll` returns `undecodedRows`, `undatedRows`, `supersededRows` and `configMissing`,
each explained where it is counted, and `noticeKeys` turns them into notices. A ledger
quietly short one expense — or silently running on the default currency — is the exact
failure this codebase exists to avoid. Never repair `configMissing`: re-seeding writes
the DEFAULT currency into a sheet whose real one is unknown.

**`type` and `currency` are both case-folded on read, and the FIRST usable value for a
config key wins.** Each is a 100x-or-worse error from one stray cell.

**A displayed share is not the saved share.** `toSplit` carries the exact `share`
beside the whole-percent `percent`, and `share` is what gets written; `splitAtPercent`
is the only place a slider position becomes one. Saving `percent / 100` moves money on
an edit that never touched the split.

**`parseShare` is the one reading of a share a human typed** — anything above 1 is a
percentage. Both the `payer_share` column and the `default_split_p*` rows go through
it. With two readings, the same `50` means "half" in one place and "the payer covers
all of it" in the other.

**`splitCents` must conserve every unit:** `payerCents + otherCents === cents`. It
and `sumCents` are scale-agnostic and need no currency.

**Nothing written to the sheet is ever localized.** Config defaults, column names,
timestamps, and amount strings are locale-independent by design: two people sharing
a sheet may be reading the UI in different languages, and the stored data must not
depend on whose device seeded it. The two people's names are the one place this cuts
both ways: `SEED_NAMES` in `sheets.js` writes English into a fresh sheet, and
`DEFAULT_CONFIG` deliberately carries no names at all, so that a sheet which says
nothing falls through to `nameOf`'s localized fallback instead of "Person 1".

**Neither per-device preference may ever be written to the sheet.** Neither person
gets to restyle the other's phone.

**Never add an `if (type === 'settlement')` branch to arithmetic** — `payer_share: 0`
already says it — and never count one toward a spend total or a category breakdown.

**Nothing in the UI creates a settlement**, so the balance in `Header` carries no action
and must stay that way unless asked. Everything below the UI still handles the type.

**The default split is per person, keyed on the payer.** `defaultSplitFor(config,
person)` in `src/lib/split.js` is the only place that decides it. The two values are
independent and need not sum to 1 — only the payer's is ever read, so never mirror
one from the other. A new entry carries `payerShare: null` meaning "follow the
payer's default", and `useEntrySplit` re-derives it when the payer control changes;
an entry being edited carries its stored share and must keep it, because a saved row
records a decision someone already made.

**Dates are ISO strings, compared as strings.** Never `new Date('2026-08-05')` —
that parses as UTC midnight and shifts to the previous day in western timezones. Use
the helpers in `src/lib/dates.js`, which build dates from explicit parts. `isMonthKey`
there is the only test of a `'YYYY-MM'` key — a second regex elsewhere disagreed with it
about whether month 13 is a month.

**Config values are not all strings.** `CONFIG_FIELDS` in `src/lib/sheets.js`
carries a kind per key — `text`, `code`, `list` or `fraction` — and each parser in
`PARSERS` answers null for a value it cannot use so the caller's defaults win. An
empty list must never be returned in place of a default, or the category picker ends
up empty. A share must never yield NaN: that reaches `splitCents` and moves money
wrongly. `test/config.test.js` pins these.

**A hook holds effects; the decisions live in `lib/`.** There is no DOM in the test
environment and no renderer for hooks, so anything inside a `use*` file is
unreachable from a test. `useLedger` owns state, effects and call order only. Every
"given this list, what is the list next", every status decision, and every refusal
lives in `lib/` — `ledgerState.js` (list transitions, `reconcileById`,
`looksUninitialized`, `entryFromInput`), `balance.js` (`initialMonthKey` and the
aggregates), `split.js` (`toSplit`, `nextSplit`). Put new logic there, not in the
hook, or it cannot be tested at all.

**Refreshes on focus are throttled to a 30s floor.** Two people share one sheet with
no push channel, so `useLedger` re-reads on `focus` and `visibilitychange`; window
switching is constant and every refresh spends per-user quota. Do not remove it.

**The app key is never a build-time value.** It is typed once per device and lives
only there. `VITE_SCRIPT_URL` ships in the public bundle, so nothing may depend on
the endpoint being hard to guess.

**The token endpoint always answers HTTP 200.** `ContentService` cannot set a status,
so `{"error":"unauthorized"}` arrives as a 200 and the body is the only signal.
Branch on the body, never on `response.ok`. A rotated key and a network blip are
different failures: reporting a blip as a bad key makes someone retype 64 characters,
and reporting a bad key as transient hides it behind retries forever.
`connection.js` treats `unauthorized` as terminal and everything else — non-JSON,
rejection, timeout — as transient, and it **flags a rejected key rather than deleting
it**.

**The mint request is `Content-Type: text/plain`, and the method is never forced
through the redirect.** `text/plain` keeps it a CORS simple request; a preflight
would be answered with the 302 that `/exec` returns and die, which is also why the
script has no `doOptions`. `fetch` downgrades POST to GET across that 302 and Apps
Script serves the computed reply from the echo URL — forcing POST through the hop
returns "page not found".

**`doPost` must be structurally incapable of throwing**, because Google's HTML error
page is classified as transient and retried forever, and it must never read
`e.parameter`, which would log the key. `apps-script/Code.gs` carries the reasoning.

**The refresh margin is performance; the 401 retry is correctness.** Minting needs no
user gesture, so `sheets.js` recovers silently. `refreshToken`'s generation counter is
why: a mint that began *before* the 401 may carry the token Google just rejected, and
the retry runs with `allowRetry: false`.

**A failure that retrying cannot fix must not be reported as transient**, or it hides
behind a 30-second retry loop and a "showing saved data" notice forever. Two of them: a
lost share, and the token endpoint's `{"error":"unavailable"}` (the 7-day consent-screen
expiry). A 403 is *both* — Google also returns it for a tripped quota — so
`isUnreachable` reads the reason rather than the status.

**An entry's id is minted when the draft opens, not per submit**, so a retry after a lost
response is at worst a duplicate row the client reconciles, rather than a second expense
with its own id.

**No raw error text ever reaches the screen.** `i18nError` is the only way to throw
something a person will read. `sheets.js` and `connection.js` keep the API's own
English on `.message` for consoles and bug reports and attach an `i18nKey` instead;
`errorMessage(cause, fallbackKey)` in `i18n/index.js` is the only way a caught error
becomes a sentence, and it never falls back to `.message`. Show `cause.message` and a
Japanese reader gets "The caller does not have permission (HTTP 403)".

**The snapshot is validated per entry, and dropped whole if any row fails.** It is the
one input never decoded through `rowToEntry`, and it paints during the FIRST render
inside a `useMemo`, where a throw is an app that will not launch with no way in to clear
the cache. A partially dropped list would be a wrong balance instead.

**Bump `VERSION` whenever the persisted shape changes**; `v` is a drop marker, never a
migration. Three other things there are easy to break: it silently stops writing past
`MAX_CHARS`, so an over-long history turns the cold-launch paint off with no error
anywhere; it stores the **pre-merge** config, seeded atomically with the entries, or the
balance renders at the wrong scale; and `clearSnapshot` exists because it remembers its
last payload to skip redundant writes.

**The cache is written from the screen, only once nothing is pending.** An effect in
`useLedger` owns that, so an unacknowledged optimistic row can never reach it — and a
write that lands after a refresh started is not lost from it either.

**`setSafeToReload` must stay wired.** `serviceWorker.js` defaults it to `() => true`,
and one effect in `App` narrows it to "no draft open, no write in flight". Break that
effect and an update reloads mid-entry, discarding what someone was typing.

**The service worker never intercepts a cross-origin request**, and that is an explicit
early `return` as the first statement of the `fetch` handler, not a property of scope —
scope decides which *clients* are controlled, not which *requests* are seen. The
generated worker carries the rest of the reasoning.

**Precache from a `dist/` walk, derive the cache name from file CONTENTS, and match
with `ignoreVary: true`.** All three are load-bearing and all three fail silently;
`scripts/build-sw.js` says why at each one, and `test/sw-build.test.js` pins them.

**The base path lives in `base.js`, and both builds read it from there** —
`vite.config.js` for the bundle's asset URLs, `scripts/build-sw.js` for the precache
list. Two copies that disagree means no worker ever activates, with nothing on screen
looking wrong.

**There is no migration code, and no users to need it.** Do not add a
back-compatibility branch, and do not keep one on the grounds that it "keeps an
existing sheet working".

## Conventions

- **Plain modern JavaScript, ESM.** No TypeScript. `.jsx` only for files containing
  JSX.
- **Prettier owns formatting, for `.js`/`.jsx` only.** `npm run format:check` runs in
  CI before the tests. The stylesheets and docs are outside the glob: their layout is
  hand-tuned (grouped selectors, aligned contrast ratios, hand-wrapped prose) and a
  reflow would rewrite every paragraph. Where a literal is a table rather than a list
  — the ISO 4217 sets in `money.js` — use `// prettier-ignore` rather than widening
  `.prettierignore`, which only needs `dist/`. The directive must be a comment whose
  text is *exactly* `prettier-ignore`: append a reason to that line and it is silently
  inert, so put the reason on the line above.
- **No new npm dependencies** without a clear reason. The bundle is React plus
  application code; icons are inline SVG in `src/components/icons.jsx`. A new
  dependency also means a CSP decision.
- **`SettingsIcon`'s path is generated, not drawn.** Every coordinate is `12 + r·cos θ`
  at 45° steps, so the cog's teeth are even by construction; a hand-transcribed gear
  lands one tooth off and reads as an unfinished glyph at 20px. Do not tidy those
  numbers — regenerate them.
- **If you add a Google host, update the CSP** in `index.html`. It is a deliberate
  allowlist, not boilerplate.
- **Never put a real secret in a `VITE_` variable.** Vite inlines them into the
  shipped bundle. Both existing variables are public by design.
- **Comments explain *why*, not *what*.** Match the existing density — the
  non-obvious constraint gets a comment; the obvious line does not. State the standing
  rule, not the incident that produced it: "the sticky aside offsets by this token",
  never "this shipped broken once".
- **One helper, one home.** `readStored`/`writeStored` in `src/config.js` are the only
  `localStorage` touches; `cellText` and `columnIndex` live in `schema.js`; `PEOPLE` is
  the only `[p1, p2]` literal; `normalizeCurrency` is the only currency spelling and
  `parseShare` the only share reading; `usePeopleLabels` is the only place a component
  turns a person into a name; `i18nError` and `errorMessage` in `i18n/index.js` are the
  only ways an error becomes readable text; `UNCATEGORIZED` in `balance.js` is the only
  spelling of that bucket.
- **A control that appears twice is a component.** `Field` (the one place the
  `<label htmlFor>` vs `<span>` decision is made — pointing a label at a group makes a
  screen reader announce the wrong thing), `Segmented` (four call sites, itself built on
  `Field`), `EntryAmount` (the per-row currency resolution), `NoteField` and
  `SplitField`. The two radio groups — `Segmented` and the accent swatches — each
  carry their own `role="radiogroup"`.
- **`LedgerScreen` is the signed-in surface, and THREE things render it**: `App`,
  `scripts/preview.jsx`, and one static render in `test/render.test.jsx`. Written more
  than once, a layout change silently leaves the only visual check screenshotting a tree
  the app no longer has. `App` keeps the gates, the sheets and the state;
  `useLedgerView` holds every derived figure.

### i18n

English and Japanese, no dependency. `src/i18n/` holds the engine (`index.js`), the
two catalogs (`en.js`, `ja.js`), the registry (`catalogs.js`), and the node-returning
variant for strings with inline markup (`nodes.jsx`).

- **Never hardcode a user-facing string in a component.** That includes every
  `aria-label`, `aria-valuetext`, `alt`, `title` and `placeholder`.
  `test/i18n.test.js` scans `src/` and fails on a catalog key nothing references (the
  `error.` and `accent.` prefixes excepted), a referenced key no catalog has, and a
  bare string literal in one of those attributes. The scan matches `t('key')`
  verbatim plus any literal that *is* a catalog key, so a key held in a variable is
  invisible to it — build the array out of `t()` calls, not keys. It cannot see a
  template literal either, which is how an untranslated `aria-label` gets through.
- **A key built at runtime needs its own coverage test.** The scan cannot see
  `` t(`error.${code}`) ``, so each family is asserted against its source list
  instead: `ENTRY_ERROR`, `CONNECTION_ERROR` and `ACCENTS`.
- **It is a module singleton, not a context.** `render.test.jsx` renders components
  bare, and non-React modules (`useLedger`) need the same `t`. A provider would break
  the first and be unreachable from the second.
- **`useT()` uses `useSyncExternalStore` with the third argument.** Omitting
  `getServerSnapshot` throws under `renderToStaticMarkup`, which is how every render
  test runs. `useAccent()` has the same requirement.
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

- **A message a control produced must be reachable from that control.** The form's
  error carries an `id` and the amount input an `aria-describedby`; anything whose
  value changes without a page change carries `role="status"` — the split breakdown,
  the notices, the compact result. A message only positioned near its field says
  nothing to a screen reader.
- **The balance is the deliberate exception, and must not become a live region.** It
  changes on every write, but every one of those writes already speaks through a toast,
  and a second region queues behind it — delaying the sentence that names what actually
  happened. It would also announce a figure on every cold launch, since the snapshot
  paints before the server read replaces it. `Header` says this too; `test/render.test.jsx`
  pins it.
- **The hero figure is named by a sentence, not by its digits.** The `<h1>` holding it
  carries an `aria-label` of the whole fact ("You owe Sam $42.50"), which is why no part
  span is `aria-hidden`: `aria-label` outranks subtree content, so hiding the parts would
  turn a terse heading into an empty one. The visible direction line below it *is*
  `aria-hidden`, because the heading already says it. Never move the name onto the `<p>` —
  `role="paragraph"` prohibits naming, so it would announce nothing at all.
- **Identity is never communicated by colour alone.** The chart legend always carries
  name, value and share; the who-paid meter's second segment carries a hairline.

### Platform: iOS, standalone, small

Every rule here is invisible in a desktop browser and wrong on the actual target.
`test/styles.test.js` pins them, because nothing else can.

- **The sheet lifts clear of the software keyboard.** `position: fixed` and `dvh` both
  track the LAYOUT viewport, which iOS does not shrink for the keyboard, so a
  bottom-anchored panel puts its Save button behind it — and the decimal keypad has no
  Done key to escape with. `BottomSheet` publishes `--keyboard-inset` from
  `window.visualViewport` (`resize` **and** `scroll`) and `.sheet` pads by it;
  `scrollIntoView` cannot do this job, because the footer is a sibling of the scrolling
  body rather than content in it. `lib/viewport.js` holds the arithmetic.
- **Hover is a mouse state, `:active` is the touch one.** iOS applies `:hover` on tap
  and holds it until the next tap elsewhere, so every hover rule sits behind
  `@media (hover: hover)` and every hover-styled control has an `:active` too — the
  platform tap highlight is cleared, so `:active` is the only press feedback there is.
- **`overscroll-behavior-y: none` on `html`.** An installed iOS web app reloads on a
  downward flick from the top, and that reload never consults `setSafeToReload`, so it
  can discard a half-typed entry.
- **`touch-action: manipulation` on anything tappable.** `base.css` sets it on `button`
  only, so the label-based controls, the `<summary>` and the backdrop each need their own
  or they wait 300ms for a double-tap that would only zoom. `.entry__main` carries the
  touch rules on `button.entry__main` alone: the deleted list renders the same class as
  inert text, where a press state promises a tap that does nothing.
- **No control may set the width of the sheet it sits in.** `.sheet` is a row flex
  container, so `.sheet__panel`'s automatic minimum size is its min-content width and
  `width: 100%` cannot override it — one child with a large intrinsic minimum carries
  every field in the sheet off the right of the screen. `min-width: 0` on the panel is
  the guard. The child that does this is `input[type="date"]`: iOS sizes it from the
  locale's date format via the UA shadow DOM, so it also needs its own `min-width: 0`
  and `appearance: none`.
- **Nothing may scroll sideways at 320px.** `.sheet__body` sets `overflow-x: hidden`
  explicitly, because with `overflow-y` set the spec computes a `visible` overflow-x to
  `auto` — one over-wide child would make the panel a horizontal scroller. Anything
  holding config-tab text needs `min-width: 0` (a flex item's automatic minimum is
  min-content) and `overflow-wrap: anywhere` (`break-word` does not reduce min-content
  width). The two `preview-en-stress*` pages are the check: names, categories, notes and
  amounts that no phone has room for.
- **The toast stack takes no pointer events.** It outranks everything but a sheet and it
  overlays the last rows of the ledger, so without that it would swallow a tap on a
  delete control for the toast's whole life. Covering one briefly is accepted; the layout
  deliberately reserves no band for it.
- **A row is a row, not text.** `.entry__main` sets `user-select: none` and
  `-webkit-touch-callout: none`: it is the edit affordance, and a long press should not
  raise the selection magnifier.
- **Safe areas are composed where they are needed, not globally.** `base.css` applies
  the horizontal insets to `body`; the sticky header, the sheet footer and the toast stack
  each add `--safe-top`/`--safe-bottom` themselves, because each has to paint *into* its
  inset while padding its own content.

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
  paint its own colour, with `--accent-ring`/`--accent-shadow` derived by `color-mix`
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
- **Elevations appear in exactly three places** (sheet panel, toast, segmented thumb)
  and never on hover. Cards are a white plane plus one hairline; the temperature step
  from `--bg` to `--surface` is the elevation, and the add button is a flat plane of
  accent rather than a raised one. `box-shadow` is used for three other things that are
  not elevations and do not count against those three: the focus ring, the swatch's
  selection ring, and the meter's segment hairline. It is transitioned in exactly one
  place, the text control's focus ring; `test/styles.test.js` pins that.
- **Contrast budgets live in `tokens.css`, next to the values, with their measured
  ratios.** Do not restate them here; do not "tidy" two tokens together because they
  look similar. The two that catch people are `--line-input` and `--ink-3`, and both
  say why at the value.
- **`--shell-max` has to leave room for `--main-max`.** `.layout` is border-box, so a
  narrower shell makes the `1fr` main track resolve below `--main-max` and that cap
  never binds at any width. The arithmetic is written out at the tokens.
- **`.btn--icon` is not combined with `.btn--ghost`.** They disagree about the border,
  and the icon glyph at `--ink-2` is itself the 3:1 graphic.
- **Never drop a form control below 16px.** Mobile Safari zooms on focus below that
  and will not zoom back out.
- Mobile-first. One column, capped at `--column-max` from `48rem`, two columns at
  `62rem`; the sheet becomes a centred dialog at `48rem` too — there is no third
  breakpoint. Tap targets are `var(--tap-target)` (44px), or `var(--tap-target-sm)`
  (36px) for chips and the segmented thumb.
- **`--header-height` must never understate the header's real height.** The band holds
  two lines now — a 32px figure and a caption — and `.layout__aside`'s sticky offset reads
  the token from outside the header, so a token that is short slides the aside under the
  band with nothing on screen looking wrong. `min-height` has to be the binding
  constraint; `scripts/frames.html` measures it.
- Keep specificity flat: single class selectors, no IDs, no `!important`.

## Testing

Specs live in `test/**/*.test.{js,jsx}`, with shared harnesses under `test/support/`.

`sheets.test.js` runs against a fake Sheets API in `test/support/sheets-api.js` that
records every request, because this layer's failures are writes: the assertions are
about what was *sent*, not what came back.

`connection`, `snapshot`, `sw-build`, `styles`, `preferences` and `viewport` exist
because their failures are invisible in a build and on screen — a misclassified endpoint
reply, a snapshot that renders money at the wrong scale, a precache list that stops any
worker activating, a merged CSS rule that lands on the wrong block, an accent that
writes an attribute CSS has no rule for, a keyboard inset that leaves Save covered.

**A test that cannot fail is worse than no test**, because it reads as coverage. Do
not assert a function against itself, do not assert a property of the platform, and do
not name a test after an invariant it does not exercise. Four specific traps here:
deriving an expected value from the module under test (write the literal `'K'`, not
`columnLetter('deleted_at')`); asserting `not.toContain` against a string that appears
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

**A passing suite does not mean it looks right.** `scripts/preview.jsx` renders the
real `LedgerScreen` to static HTML with the real stylesheets — fifteen pages: each accent
in English, indigo in Japanese, the three overlays (delete dialog, entry form, settings)
in both, the settled balance, and two stress pages whose config tab, notes and amounts
hold everything a 320px phone has no room for.

`scripts/frames.html` is how they are viewed: it loads one page into an `<iframe>` per
width and prints the measurements underneath. **Iframes, not a resized window** — an
iframe gets its own viewport so container and media queries resolve honestly, while
headless Chrome quietly reports a different width than you asked for and every breakpoint
reads wrong. The readout is the assertion, so sideways scroll and header height are
measured rather than eyeballed.

```sh
npx vite-node scripts/preview.jsx     # writes scripts/preview-*.html (gitignored)
python3 -m http.server 8899           # iframes need an origin
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --screenshot=/tmp/shot.png --window-size=1220,1000 \
  'http://127.0.0.1:8899/scripts/frames.html?page=preview-en&w=320,393,430'
```

`page` is any generated file's name without `.html`; `w` is the iframe widths. The ones
worth walking are 320 (the floor), 393 (iPhone 15), 430, 768 and 1440.

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
- **`compact` has to ask for sheet gids, every time.** `values.batchGet` cannot reveal
  them, so `loadAll` never has any: the gids come from `ensureStructure`, which
  `compact` calls itself when `useLedger` holds none. That is the normal path, not an
  edge case, and `compact` skips a tab whose gid is missing — the throw in `useLedger`
  is what stops that being silent.
- **An endpoint that dies about a week after setup is the consent screen**, not a
  quota problem. `SETUP.md` step 5.
- **Nothing detects which person this is.** `IdentityGate` and the `localStorage`
  choice behind it are the only path — not a fallback.
