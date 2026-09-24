# CLAUDE.md

Rules not visible from the code; the reasoning is at the function each one names. Breaking one does
not throw — it writes the wrong thing to someone's spreadsheet. `README.md` has the data and
security models, `SETUP.md` the Google setup.

**Target: Safari on iOS, added to the Home Screen, on a phone.** Layout is decided at 320px.

`npm run dev` (5173) · `npm test` (must pass before any commit) · `npm run build` (bundle, then
`build-sw.js` emits `dist/sw.js`) · `npm run preview` (the only way to run the worker) ·
`npm run format` / `format:check` (the CI gate). Pushing `main` deploys to GitHub Pages.

## The sheet contract
- **`src/schema.js` is the only file in `src/` that knows the layout.** Use a tab's own `letter`/`index`; never hardcode a range. `bank_to_ledger.py` is the one other file that may.
- **Two entry layouts, so every positional lookup hangs off a TAB, never the module** — `deleted_at` is index 5 for an expense, 4 for a settlement.
- **`DATA_TABS` holds entries; `SHEET_TABS` is that plus `RECURRING`, the data tabs its PREFIX.** `RECURRING.type` is null, so `rowToEntry`/`entryToRow` (`assertDataTab`) refuse it and `compact` can never read its `active_to` as a `deleted_at`. There is no `type` column.
- **Every column list is append-only**: letters come from array position and `ensureStructure` rewrites a mismatched header without touching data. Past 26 columns `letterAt` answers `[`; only `test/schema.test.js` guards it.
- **The tab asserts a row's type and an expenses tab's payer.** `SETTLEMENTS.payer` is null — read the cell.
- **`rowToEntry` and `expenseTab` throw rather than guess a person**; `loadAll` counts those as `unattributedRows`, apart from `undecodedRows`, because the cell to fix differs.
- **`tabOf` is the one home of "where does this entry live"**; only an EXPENSE's payer moves a row.
- **An entry never carries its row position**: `updateEntry`/`setDeletedAt` re-resolve id → row through `resolveRow` immediately before writing.
- **Never `USER_ENTERED`, never `values.append`** — its range only bounds a table SEARCH, and the cells land at the first column of the last table found. `appendRow` uses `appendCells` with a fresh gid, always column A; `stringValue` is RAW.
- **Rows carry no `created_at`/`updated_at`, and `makeEntry` reads no clock.** `deleted_at` breaks tombstone ties in `supersedes`, never array order, so `updateEntry` stamps the payer-move tombstone from the clock.
- **`rowToTemplate`/`templateToRow` are exact inverses; blank is a value in both** (a variable bill; "follow the payer's default"). Never write `'0'` for either — the row is refused and the template vanishes.

## Reads and writes
- **`loadAll`'s ranges are positionally coupled to `SHEET_TABS`** — the list, the `valueRanges[index]` mapping, the config index from `ranges.length`, the no-config retry slicing from the END. None may become a literal; recurring sits BEFORE config.
- **An id is unique in neither tab.** Reads go through `reconcileById`, writes to an existing row through `resolveRow`, and **both must choose the same row**: live over dead, then the FIRST live row, then the LATEST `deleted_at`, and never a row `rowToEntry` refuses. One fixture in `test/sheets.test.js` drives both. Hidden tombstones count as `supersededRows` (for `compact`), hidden live rows as `duplicateRows`.
- **An add whose id is already on screen is an edit** (`addWriteKind`): a failed save can be a lost response to an append that landed. Every Sheets request times out at 30s, and a body cut off by it throws — never reads as empty.
- **`updateEntry`/`setDeletedAt` take the row's CURRENT payer** — `previous.payer`, never `entry.payer`. `entryWriteRefusal` refuses an entry gone from state (`error.entryGone`) or still `pending` (`error.stillSaving`), which is why `removeEntry`/`restoreEntry` take an id alone.
- **Only `ensureStructure` builds structure**; it refuses a spreadsheet holding other tabs and none of ours, `looksUninitialized` is 400 and 404 alone, and only `useLedger`'s first-read retry calls it.
- **`compact()` and `deleteTemplate` are the only hard deletes.** `compact` reads full rows, serializes its tab reads, and deletes in **descending** row order. It takes a row only when the id AND `deleted_at` are filled. It covers `DATA_TABS`, never `RECURRING`.
- **`assertGid` guards every request carrying a gid** — an undefined `sheetId` is dropped by `JSON.stringify` and the request acts on gid 0. **`requireGids` is the one fresh gid read** for every append and both hard deletes, and throws `error.missingTabs` rather than skip a tab. No gid is cached, and none comes from `ensureStructure`, which WRITES.
- **`compact` never runs while any write is in flight** (entry, template, or another compact) and reports `busy`, not `{removed: 0}`. An edit or delete begun during a compact waits for it before resolving its row.
- **No conflict detection (last-write-wins), no migration code, no back-compatibility branches**, and do not describe the app as having any.

## Recurring costs

A tab of DECLARATIONS, edited through `RecurringSheet`/`TemplateFormSheet` and hand-authorable.
**A person is the only writer** — no trigger, no unattended post. Every decision is in `src/lib/recurring.js`.

- **`${templateId}#${monthKey}` is the whole of "already recorded"**: a template id is minted once and never changes. **`isRecurringInstance` reads the entry alone** — never the templates, never the note.
- **Retiring (`active_to`) is the way to stop a cost**: it keeps the id, is reversible, needs no confirmation, not `btn--danger`. `deleteTemplate` ORPHANS every instance posted — say that, not "cannot be undone".
- **`recurringRows` is the ONE derivation of what a month says about a cost** — not scheduled, recorded, and the `draft`. `unpaidRecurring` derives from it over the RAW entry list, since a tombstone means recorded. No second predicate.
- **`day_of_month` gates nothing**; it is the instance's DATE, clamped by `dayInMonth` (31 → 28 in February). A cost is recordable all month; the recurring page names the DECLARED day.
- **"Stopped" refines "not scheduled"**: `active_to` is inclusive, so asked first it contradicts a month the cost still applies to.
- **Both pages are scoped to the month on SCREEN; retiring is dated from TODAY.**
- **`sheets.saveTemplate` is the whole non-destructive write — append OR overwrite by id**, which makes a retried add idempotent. It refuses to write to a duplicate id; `reconcileTemplates` keeps the FIRST per id and counts the rest.
- **A blank cell takes its default; a filled, unreadable cell refuses the whole row** (counted) — the opposite of `config`. A blank `payer_share` stays null so `defaultSplitFor` applies.
- **`templateFormProblem` (in `lib/`) owns which field a submit refuses.** A blank amount is VALID.
- **The template form shows six of ten columns and writes all ten** — the scheduling ones ride the draft untouched. Say so on screen.
- **`recordableEntry` decides one tap vs the form, through `validateEntryCodes`**, resolving a blank share from the PAYER's default. The tick writes through `addEntry`; a draft that needs typing opens `EntryFormSheet` as an ADD. Recording lives on the ledger; the recurring page only declares.

## Optimistic state
- **A pending row always beats the server's copy** (`mergeLoaded`), so `pending` is never left set with no write in flight — `reverted` strips it.
- **A read that changed nothing returns the array on screen, and every unchanged row keeps its object** — resting on `sameEntry` comparing by key. `applyLoad` likewise holds the config's and templates' (`sameTemplates`) identity; every `memo` compares identity.
- **Only the newest read may apply, and none an entry write settled during** — that one is re-read. `createReadGate` owns both, including a read in flight when the key is forgotten.
- **The persist effect watches the CONFIG as well as the list**, or a config-only change never reaches the cache and a stale `default_split_p*` moves money next launch.
- **`writeSnapshot`'s reference guard names the SHEET too, and `useLedger` resets on an id CHANGE**, not just on losing one.
- **Template writes are NOT optimistic**: write, then `refresh()`, as `compact` does — which keeps templates out of the snapshot, `mergeLoaded` and `hasPendingWrite`.
- **`blocksReload` (in `lib/`) decides whether an update may reload**: an open form or one held in a confirmation's `returnTo`, an unacknowledged write, `useLedger`'s `writing` count, or a read in flight (a waiting worker would otherwise throw the launch read away). Never solve it with new overlay kinds or a second "which sheet is open" value.
- **Read state through `entriesRef`, never inside a `setEntries` updater**, and mint an entry's id when the draft OPENS.
- **Focus refreshes have a 30s floor and EVERY read counts** — `load` stamps the clock.
- **A hook holds effects; decisions live in `lib/`** (`ledgerState.js`, `balance.js`, `split.js`, `recurring.js`) — no test can reach a `use*.js`. `useEntrySplit` and `useSheetSave` sit beside the one control holding their state.

## Money, dates and the split
- **Yen only, and no function takes a currency** — an amount IS an integer of yen. `JPY` is spelled once, in `money.js`'s `Intl` call.
- **A comma is read in one place**, `decimalSeparatorIndex`: comma-only with exactly three trailing digits is grouping, else a decimal. **`splitYen` conserves every yen**: `payerYen + otherYen === yen`.
- **`parseShare` is the one reading of a share** — above 1, or anything with a `%`, is a percentage (`'1%'` is 0.01); the WHOLE string must parse, never `parseFloat`.
- **`useEntrySplit`'s `allowDefault` keeps a blank `payer_share` blank**: an entry's null share is unfilled, a template's is a declaration.
- **A displayed share is not the saved share** — `toSplit` carries the exact `share` beside the whole `percent`; `splitAtPercent` is the only slider → share conversion.
- **The default split is per person, keyed on the payer**; the two values need not sum to 1. Never mirror one from the other.
- **No `if (type === 'settlement')` branch in arithmetic** — `payer_share: 0` says it — and a settlement never counts toward spend or categories (`activeExpenses`).
- **`dayLabel` takes `today` as a string** from `LedgerScreen`, so the memoised list re-renders when the date turns over.
- **Within a day, `groupByDate` orders by id.** `descending` is `balance.js`'s one comparator.
- **Dates are ISO strings compared as strings** — never `new Date('2026-08-05')` (UTC midnight). `lib/dates.js` owns every helper; `isIsoDate` needs its UTC round-trip, `monthParts` checks shape first, **`dayInMonth` CLAMPS**.
- **The pure layers stay pure**: `money`, `dates`, `balance`, `schema`, `split`, `identity` never read the i18n singleton or call argless `localeCompare`; locale is an argument with an English default, and formatters are cached.

## The config tab, and what is per-device
- **Config values are not all strings.** `CONFIG_FIELDS` carries a kind; each parser answers null for an unusable value so defaults win — never an empty list for a default, never NaN for a share. `mergeConfig` clones the arrays it spreads.
- **A settlement's payer is case-folded on read; the FIRST usable value per key wins.** The category `<select>` always offers the entry's stored category.
- **Nothing written to the sheet is localized.** `SEED_NAMES` writes English into a fresh sheet; `DEFAULT_CONFIG` carries no names, so `nameOf`'s fallback applies.
- **`bank_to_ledger.py` never translates or rewrites a merchant name**; RULES carry kana and romaji because the bank prints both.
- **Locale, accent, which person this device is, and which summary figure is shown are per-device, and never reach the sheet.**

## Telling the truth on screen
- **Anything the sheet holds and the app cannot show is counted and said** — `loadAll`'s six counts, ordered worst first by `noticeKeys`. A row with an empty id column counts (a row shifted out of column A). Never repair `configMissing` by re-seeding.
- **No raw error text reaches the screen.** `i18nError` is how to throw something a person reads; API English stays on `.message` behind an `i18nKey`, and `errorMessage` never falls back to it.
- **Store the cause, never the sentence** — `useLedger`'s error and the compact outcome outlive a locale change.
- **Every destructive confirmation goes through `ConfirmSheet`** (Cancel first in the DOM, content-sized, not `full`); the caller supplies the BODY. `App`'s `confirmEntry` overlay is the only caller of `removeEntry`. Recovery is `DeletedList`, never a toast action.
- **A sheet cannot be closed while its write is in flight** — `BottomSheet`'s `busy` makes the X, backdrop and Escape inert, or a failure has no form left to show it and a success closes whatever opened next. A non-optimistic confirmation (`deleteTemplate`) returns its promise from `onConfirm` and stays up until it settles. A pending row offers no edit or delete.
- **A confirmation opened from a form carries `returnTo`** — the draft plus its fields AS TYPED (`typed`, the split's `held`); Cancel restores it, and from a row Cancel closes. Never rebuild a form from parsed values: a half-typed amount parses to null, which a template reads as "variable".
- **The ledger's recurring section shows recorded rows, and above them the unrecorded drafts** (`entry--unpaid`, "not recorded yet", a tick). A draft is in no total, chart or balance.
- **A recurring instance appears in the SECTION or its day, never both** (`monthSections`). Month figures come from the month.
- **The deleted list is scoped to the month on screen**; settings' count is sheet-wide, as `compact` is.
- **A tombstoned row says everything its live twin says**, a settlement's direction included.
- **Nothing in the UI creates a settlement**, so `Header`'s balance has no action; everything below the UI still handles the type.

## The token, the cache and the worker
- **The app key is never a build-time value**: `VITE_SCRIPT_URL` ships in the public bundle.
- **The token endpoint always answers HTTP 200** — branch on the body. `connection.js` holds the taxonomy: `unauthorized` terminal, the rest transient; a rejected key is flagged, not deleted.
- **The mint is `Content-Type: text/plain` and its method is never forced through the redirect**, keeping it a CORS simple request — hence no `doOptions`.
- **`doPost` must be incapable of throwing, and is the whole of `Code.gs`** — a throw returns HTML, read as transient forever. The script writes NOTHING: no `SpreadsheetApp`, no trigger.
- **The refresh margin is performance; the 401 retry is correctness.** `refreshToken` counts generations and the retry cannot retry.
- **A failure retrying cannot fix is not transient** (a lost share, `unavailable`); a 403 is both, so `isUnreachable` reads the reason.
- **The launch read starts before the first React render** (`startLaunchRead`, taken once by the first `load` for that sheet; the bare mint when no id is stored), because everything after it is serialized.
- **The snapshot is validated per entry and dropped whole if any row fails** — it skips `rowToEntry` and is restored in a `useState` initializer. **Bump `VERSION` when its shape changes**; `v` is a drop marker, not a migration. No templates in it. An oversized ledger clears it.
- **The cache is written from the screen, only once nothing is pending**, storing the PRE-MERGE config; `clearSnapshot` resets the remembered payload.
- **`setSafeToReload` stays wired, and `reconsiderUpdate` with it**; the one-hour update floor is the same `shouldRefresh` the sheet read uses.
- **The worker: precache from a `dist/` walk, name the cache from file CONTENTS, match with `ignoreVary: true`, never intercept cross-origin (the fetch handler's first statement), sweep only `CACHE_PREFIX` keys.** All fail silently; Pages sites share an origin. **The base path lives in `base.js`.**

## Conventions
- **Plain modern JavaScript, ESM.** No TypeScript; `.jsx` only for files with JSX.
- **Prettier owns `.js`/`.jsx` only**; stylesheets and docs are hand-tuned. For a table literal use `// prettier-ignore` exactly; `.prettierignore` holds `dist/` alone.
- **No new npm dependencies** without a clear reason; icons are inline SVG. **A new Google host means updating the CSP** in `index.html`. **Never put a secret in a `VITE_` variable** — hence `VITE_BASE` is read from `process.env` in `base.js`.
- **`SettingsIcon`'s path is generated** — `(12 + r·cos θ, 12 + r·sin θ)`, `θ = 45k° ± 13°`, r 9.2 or 6.5. Regenerate, don't retouch.
- **Comments explain *why*, once, and describe the code as it is** — the standing rule, not the incident or history behind it. No `@param` retyping a signature.
- **One helper, one home.** `readStored`/`writeStored` (all `localStorage`), `storedPreference` (per-device), `cellText` and `isSettlement` in `schema.js`, dates in `lib/dates.js`, `PEOPLE` (the only `[p1, p2]`), `UNCATEGORIZED`, `useEntryTitle`/`templateTitle` (titles; the latter pure for `App`'s confirmation), `percentOf` in `split.js`, `usePeopleLabels` (names, three forms — `possessive` because English inflects).
- **A control that appears twice is a component**: `Field`, `Segmented`, `EntryLine`, `NoteField`, `SplitField`, `CategoryField`, `AmountField`, `PayerField`, `SheetFormFooter`, `OpenSheetLink`, `BottomSheet`, `ConfirmSheet`. `Field` owns `<label htmlFor>` vs `<span>` and "(optional)"; `Segmented` and the accent swatches each carry `role="radiogroup"` named by `aria-labelledby`. Inline a wrapper with no job.
- **`LedgerScreen` is the signed-in surface, rendered by `App`, `preview.jsx` and `render.test.jsx`.** `App` keeps gates, sheets and state; `useLedgerView` every derived figure.
- **`EntryList`, `EntryRow` and `SummaryCard` are `memo` and every handler they take stays stable** — nothing looks wrong when it breaks, and no test sees it.
- **The entry form's field order is by frequency**: amount, note, category, who paid, date, split — pinned by `test/ui.test.jsx`.

## i18n
- **Never hardcode a user-facing string**, `aria-label`, `aria-valuetext`, `alt`, `title`, `placeholder` included. `test/i18n.test.js` finds dead keys, missing keys and bare literals, but not a key in a variable — build arrays from `t()` calls.
- **A key built at runtime needs a coverage test**: `ENTRY_ERROR`, `CONNECTION_ERROR`, `ACCENTS` are each asserted against their source list.
- **A module singleton, not a context** — render tests render bare, and non-React modules need `t`.
- **Every `useSyncExternalStore` takes the third argument and a stable snapshot**, or `renderToStaticMarkup` throws / it loops.
- **Plurals go through `Intl.PluralRules`**; a pluralised value is an object keyed by CLDR category.
- **Identical, adjacent-on-screen text is one key**, and a Japanese label reduced to a bare verb its English twin qualifies is a bug. **A test that calls `setLocale` restores it.**

## Accessibility
- **A control's message is reachable from it and on screen.** A field error sits in its `Field`; a save failure last in the form above the footer, every control that can produce it carrying `aria-describedby`. Ids are document-global. Changing values carry `role="status"`.
- **A toast carries its own region**: failure `alert`/`assertive`, confirmation `status`/`polite`. **The balance is deliberately not a live region.**
- **A validation error is derived from the rejected value**, never stored or keyed on a "submitted" flag. `saveError` is stored, and cleared first.
- **A busy button keeps its label beside the spinner.**
- **The hero figure is named by a sentence**: the `<h1>` carries the whole fact as `aria-label`, the direction line is `aria-hidden`. Never name the `<p>`.
- **`BottomSheet` reads `onClose` through a ref, and exactly ONE is mounted** — `App`'s single `overlay` makes that structural.
- **Identity is never colour alone**: the legend has name, value and share; the meter's second segment a hairline.

## Platform: iOS, standalone, small

Invisible in a desktop browser; `test/styles.test.js` pins these.

- **Sheets and the key screen lift clear of the software keyboard** — iOS does not shrink the layout viewport. `useKeyboardInset` alone publishes `--keyboard-inset`, `lib/viewport.js` owns its arithmetic, and only `.sheet` (restated at `48rem`), `.sheet__footer` and `.gate` read it — never a panel.
- **Full screen is opt-in through `BottomSheet`'s `full`**: a page's worth of form takes it; a question does not.
- **Hover sits behind `@media (hover: hover)` with an `:active` twin after it** (iOS holds `:hover` on tap). Carve-outs: `a`, the scrollbar thumb.
- **`overscroll-behavior-y: none` on `html`**, which declares no `overflow`: `BottomSheet` sets and restores it on `html` and `body`.
- **`touch-action: manipulation` on anything tappable**; `base.css` covers `button` only.
- **A full-screen panel has two ways out**: the X and the footer's Cancel. Backdrop tap and Escape serve wider screens and keyboards; keep all four.
- **No control sizes its sheet** — `min-width: 0` on the panel, `min-height: 0` on the body; `input[type="date"]` needs `min-width: 0` and `appearance: none`. A radio hidden inside a label needs a positioned label.
- **Nothing scrolls sideways at 320px.** `.sheet__body` sets `overflow-x: hidden`; config-tab text needs `min-width: 0` and `overflow-wrap: anywhere` (not `break-word`), outside sheets too. Both `.layout` tracks carry it. Check the `preview-en-stress*` pages.
- **The toast stack takes no pointer events.**
- **A row is not text**: `button.entry__main` suppresses selection and the callout, element-qualified because `DeletedList` puts the class on a `<span>`.
- **Safe areas are composed where needed**: `body` takes the horizontal insets; the full-screen panel restates them since `.sheet` is fixed.
- **Numeric fields are `type="text"` with `inputMode="numeric"`**, for the number pad.

## Charts and CSS

Four stylesheets, in order: `tokens.css`, `base.css`, `primitives.css`, `app.css`. `DonutChart` is
hand-rolled SVG — `stroke-dasharray` on a circle whose circumference is exactly 100.

- **The `--series-N` order is the colorblind-safety mechanism** — a validated 6-slot set. Never reorder or cycle past 6; a 7th folds into "Other"; accents never touch them. **Two values is a meter bar, not a pie.**
- **Set the slice stroke inline, never in CSS** — a `.chart__slice` rule paints every slice one colour.
- **Light theme only**; no `--success`/`--warning`; state is stated in words and money direction never in hue.
- **An accent preset is three custom properties under `[data-accent]`**, rings via `color-mix`.
- **Use the tokens** — `var(--transition-*)` collapses under reduced motion. The two colours in `index.html` and the manifest are pinned to `tokens.css`.
- **`letter-spacing: 0`, no `text-transform`, and line-height ≥ 1.5 wherever text can be Japanese.** Carve-out: `.balance__amount` (digits, `--lh-flat`). Headings use `--lh-tight` (1.5).
- **Nothing below 13px**; weights `400|500|600` only; **no form control below 16px** (Safari zooms on focus).
- **No `backdrop-filter`**: the sticky header is solid `--bg`, since Safari re-renders a blur every scroll frame.
- **Elevations appear in exactly three places** (`--shadow-*`); focus ring, selection ring and hairline are not elevations. **Contrast budgets live in `tokens.css`.**
- **`--shell-max` leaves room for `--main-max`**, and centring matches `.layout` with a percentage, never a viewport unit.
- **`.btn--icon` is never combined with `.btn--ghost`.**
- **Mobile-first**: one column, capped at `--column-max` from `48rem` (where a sheet stops being a phone treatment), two at `62rem`; no third breakpoint. Tap targets `--tap-target` (44px) or `--tap-target-sm` (36px).
- **A modifier that holds only below `48rem` is undone inside that query**, beside the rule it undoes.
- **Animate distance as a length, not a percentage**, and only `transform`/`opacity`.
- **`--header-height` never understates the header**; `min-height` is the binding constraint.
- **Flat specificity**: no IDs, no `!important`, no deep nesting; each rule in the file whose job it is.

## Testing
- **`sheets.test.js` and `apps-script.test.js` assert what was SENT.** The Apps Script harness `new Function`s `Code.gs`, proving it parses and writes nothing. `test/support/sheets-api.js`'s `stubSheets` keys rows on each tab's own range.
- **`connection`, `snapshot`, `sw-build`, `styles`, `preferences`, `viewport` cover failures invisible in a build.** Where the outcome matters, RUN the code: `sw-build` executes the generated worker's `install`/`fetch`/`activate` and builds it against a non-default base.
- **Render tests are static markup with no DOM; never fake one.** That is why logic belongs in `lib/`.
- **`bank_to_ledger.py` builds its rows from the column list it declares**; `test/schema.test.js` parses it and compares columns and categories, and `bank-import.test.js` runs it (and fails on CI without Python ≥3.11).
- **A test that cannot fail is worse than none.** Never assert a function against itself, a platform property, an attribute another element supplies, an absent-either-way `not.toContain`, or `??` over two shapes; never name a test after an invariant it does not exercise. **Mutate the code and watch it fail**, undoing by editing back, never `git checkout`.
- **When two files must agree, pin them over one shared table of inputs.**
- **A bug fix adds its regression test.** For money, end-to-end: settling exactly the balance drives it to zero, with odd amounts.
- **A passing suite does not mean it looks right.** `scripts/preview.jsx` renders the real `LedgerScreen` with the real CSS to 26 pages, five of them 320px stress pages whose `SIDEWAYS` readout catches overflow. Its recorded recurring instances stay small (rent is left unrecorded so it does not swamp the ring).

```sh
npx vite-node scripts/preview.jsx   # writes scripts/preview-*.html (gitignored)
python3 -m http.server 8899         # frames.html iframes need an origin
# then screenshot frames.html?page=<name>&w=320,393&h=852 headless; `w` walks 320/393/430/768/1440
```

## Gotchas
- **Never run a bare `npm install` on a machine with a private registry** — it bakes that host into `package-lock.json`. Use `npm install --registry=https://registry.npmjs.org`; `test/lockfile.test.js` checks.
- **An endpoint that dies about a week after setup is the consent screen**, not a quota.
- **Nothing detects which person this is**: `IdentityGate` and its `localStorage` choice are the only path.
