# CLAUDE.md

Rules not visible from the code; the reasoning is at the function each one names. Breaking one does
not throw — it writes the wrong thing to someone's spreadsheet. `README.md` has the data and
security models, `SETUP.md` the Google setup.

**Target: Safari on iOS, added to the Home Screen, on a phone.** Layout is decided at 320px.

`npm run dev` (5173) · `npm test` (must pass before any commit) · `npm run build` (bundle, then
`build-sw.js` emits `dist/sw.js`) · `npm run preview` (the only way to run the worker) ·
`npm run format` / `format:check` (the CI gate).

## The sheet contract
- **`src/schema.js` is the only file in `src/` that knows the layout.** Use a tab's own `letter`/`index`; never hardcode a range. `bank_to_ledger.py` and `Code.gs` are the exceptions.
- **TWO entry layouts, so every positional lookup hangs off a TAB, never the module** — `deleted_at` is index 5 for an expense, 4 for a settlement.
- **`DATA_TABS` holds entries; `SHEET_TABS` is that plus `RECURRING`, and the data tabs are its PREFIX.** `RECURRING` in `DATA_TABS` lets `compact` hard-delete a template.
- **Every column list is append-only**, since letters come from array position and `ensureStructure` rewrites a mismatched header without touching data rows. 26 columns max.
- **The tab asserts what a row cannot: its type, and an expenses tab's payer.** `SETTLEMENTS.payer` is null — read the cell, the one place a column can disagree with reality.
- **`rowToEntry` and `expenseTab` throw rather than guess a person**; `loadAll` counts the drops as `unattributedRows`, separate from `undecodedRows` because the cell to fix differs.
- **`tabOf` is the one home of "where does this entry live"**, and only an EXPENSE's payer moves a row.
- **An entry never carries its row position**: `updateEntry`/`setDeletedAt` re-resolve id → row through `resolveRow` immediately before writing. There is no `rowNumber` field.
- **Never `USER_ENTERED`; every `:append` range is A-ANCHORED, `tab.dataRange`.** `append` searches for a table, so a bare tab name lets Google choose the starting column.
- **A row carries no `created_at`/`updated_at`, and `makeEntry` reads no clock.** `deleted_at` also breaks a tombstone-vs-tombstone tie in `supersedes`, which must never fall back to array order.
- **`rowToTemplate`/`templateToRow` are exact inverses**, and blank is a value in both: a variable bill, and "follow the payer's default".

## Reads and writes
- **`loadAll`'s ranges are positionally coupled to `SHEET_TABS`** — the list, the `valueRanges[index]` mapping, the config's index from `ranges.length`, the no-config retry slicing from the END. None may become a literal; recurring sits BEFORE config so the retry drops the right one.
- **An id is unique in neither tab.** Every read goes through `reconcileById` (its hidden tombstones are added back to `compact`'s count); every write to an existing row through `resolveRow`, which prefers the LAST match. Both failures are silent.
- **`updateEntry`/`setDeletedAt` must be told the row's CURRENT payer** — `previous.payer`, never `entry.payer`. That is why `removeEntry`/`restoreEntry` take an id alone.
- **Only `ensureStructure` builds structure**, it refuses a spreadsheet holding other tabs and none of ours, `looksUninitialized` is 400 and 404 alone, and nothing else may call it.
- **`compact()` and `deleteTemplate` are the only hard deletes.** `compact` reads full rows rather than the `deleted_at` column, serializes its tab reads, and deletes in **descending** row order — all three protect row numbers derived from position. It covers `DATA_TABS`, never `RECURRING`.
- **`deleteRowRequest` asserts its gid**: `JSON.stringify` drops an undefined `sheetId` and a `GridRange` without one means gid 0, so a lost gid silently deletes from the first tab. **`compact` never runs while a write is in flight, and reports `busy` rather than `{removed: 0}`.**
- **No conflict detection (last-write-wins), no migration code, no back-compatibility branches**, and do not describe the app as if it had any of them.

## Recurring costs

A tab of DECLARATIONS, editable through `RecurringSheet`/`TemplateFormSheet` and still
hand-authorable. Every decision the page makes is in `src/lib/recurring.js`.

- **`${templateId}#${monthKey}` is the whole of "already recorded", derived in two files that cannot import each other**, so a template's id is minted once and NEVER changes. **`isRecurringInstance` reads the ENTRY ALONE**: never the templates, never the note.
- **Two ways to stop a cost, and retiring is the one to reach for.** `active_to` keeps the row, so the id, so which months are handled, and it is reversible — no confirmation, not `btn--danger`. `deleteTemplate` ORPHANS every instance it posted: say that, not "cannot be undone".
- **`recurringRows` is the ONE derivation of "due" and its four fields say four things**: not scheduled, not yet due, due, recorded. Never add a second predicate beside it.
- **Due is ONE comparison, `date <= today`, against the instance's own date**, and it takes the RAW entry list — a tombstone means recorded.
- **`draft` gates the Record control, not `due`**, which only chooses Record or Record now. The day binds one writer, `postRecurring`.
- **"Stopped" is a refinement of "not scheduled"**: `active_to` is inclusive, so asked first it contradicts its own Record button.
- **A status naming a day takes it from the INSTANCE, which is clamped** — day 31 is the 28th in February.
- **The page is scoped to the month on SCREEN; retiring is dated from TODAY.**
- **`sheets.saveTemplate` is the whole non-destructive write surface — append OR overwrite by id, retiring included.** One function is what makes a retried add idempotent.
- **A blank cell takes its default; a cell FILLED IN and unreadable refuses the whole row**, counted by `loadAll` — the opposite of `config`. A blank `payer_share` stays null so `defaultSplitFor` applies.
- **`reconcileTemplates` keeps the FIRST template per id and counts the rest**, and `saveTemplate` refuses to write to a duplicate at all.
- **`postRecurring` posts anything with an AMOUNT and resolves a blank share itself.** It imports nothing, so `readYen`/`readShare` are FULL ports: approximating is a 100x write, `'42,10'` being ¥42 to one reading and ¥4210 to a comma strip.
- **The poster's handled set grows as rows land**, or two rows under one id both post.
- **`templateFormProblem` owns which field a submit refuses, in `lib/`** because a static-markup render cannot submit a form. A blank amount is VALID.
- **The template form shows six of ten columns and writes all ten**: the three scheduling ones ride the draft untouched. Say so on screen.
- **Nothing on the recurring page auto-posts**: Record prefills `EntryFormSheet` as an ADD, so validation, `splitYen`, `tabOf` and the toasts all apply unchanged.

## Optimistic state
- **A pending row always beats the server's copy** (`mergeLoaded`), so `pending` must never be left set with no write in flight — `reverted` strips it.
- **A read that changed nothing returns the array already on screen**, so `setEntries` bails; that rests on `sameEntry` comparing by key. `applyLoad` holds the merged config's identity across such a read, because identity is what every `memo` compares.
- **The persist effect watches the CONFIG as well as the list**, or a read where only the config changed never reaches the cache and a stale `default_split_p*` moves money on the next launch.
- **`writeSnapshot`'s reference guard names the SHEET too, and `useLedger` resets on an id CHANGE**, not just on losing one: a rejected key leaves the old id in storage.
- **Only the newest read may apply** (`loadGeneration`), including one in flight when the key is forgotten.
- **Template writes are NOT optimistic**: write, then `refresh()`, as `compact` does. That is what keeps templates out of the snapshot, `mergeLoaded` and `hasPendingWrite`.
- **`blocksReload` decides whether an update may reload, and it is in `lib/`.** Three inputs because `pending` covers none of the last: an open form, an unacknowledged write, and `useLedger`'s `writing` count. Never add overlay kinds or a second "which sheet is open" value.
- **Read state through `entriesRef`, never inside a `setEntries` updater**, and mint an entry's id when the draft OPENS, not per submit.
- **Focus refreshes are throttled to a 30s floor and EVERY read counts** — `load` stamps the clock, not the focus handler.
- **A hook holds effects; the decisions live in `lib/`.** With no DOM and no hook renderer in the tests, nothing a `use*.js` decides for itself is reachable — see `ledgerState.js`, `balance.js`, `split.js`, `recurring.js`. `useEntrySplit` sits beside the one control holding its state.

## Money, dates and the split
- **Yen only, and no function takes a currency** — an amount IS an integer number of yen, and re-adding the argument without the column is the one shape that IS a silent 100x error.
- **A comma is read in one place**, `decimalSeparatorIndex`: comma-only with exactly three trailing digits is grouping, anything else a decimal. **`splitYen` must conserve every yen:** `payerYen + otherYen === yen`.
- **`parseShare` is the one reading of a typed share** — above 1 is a percentage, `%` is fine, and the WHOLE string must parse; not `parseFloat`, which reads `'0,5'` as 0.
- **`useEntrySplit`'s `allowDefault` exists so a blank `payer_share` stays blank**: an entry's null share is unfilled, a template's is a durable declaration.
- **A displayed share is not the saved share** — `toSplit` carries the exact `share` beside the whole-percent `percent`, and `splitAtPercent` is the only place a slider position becomes one.
- **The default split is per person, keyed on the payer.** The two values are independent and need not sum to 1; never mirror one from the other.
- **Never add an `if (type === 'settlement')` branch to arithmetic** — `payer_share: 0` says it — and never count one toward a spend total or a category breakdown.
- **Within a day, `groupByDate` orders by id**: arbitrary, stable, tab-independent. `descending` is `balance.js`'s one comparator.
- **Dates are ISO strings, compared as strings** — never `new Date('2026-08-05')`, which is UTC midnight. `lib/dates.js` owns every helper; `monthParts` checks SHAPE before numbers and **`dayInMonth` CLAMPS**.
- **The pure layers stay pure**: `money`, `dates`, `balance`, `schema`, `split`, `identity` never read the i18n singleton and never call argless `localeCompare`. Display formatters are cached, keyed on everything that decides one.

## The config tab, and what is per-device
- **Config values are not all strings.** `CONFIG_FIELDS` carries a kind and each parser answers null for a value it cannot use, so the caller's defaults win: an empty list must never stand in for a default, and a share must never yield NaN. `mergeConfig` clones the arrays it spreads.
- **A settlement's payer is case-folded on read, and the FIRST usable value per key wins.**
- **The category `<select>` always offers the entry's stored category**, or it renders blank and saves the invisible old value.
- **Nothing written to the sheet is localized.** `SEED_NAMES` writes English into a fresh sheet; `DEFAULT_CONFIG` carries no names, so silence falls through to `nameOf`'s fallback.
- **`bank_to_ledger.py` never translates or rewrites a merchant name**, so every row is findable in the statement. Kana and romaji both appear in RULES because the bank prints a shop both ways.
- **The locale, the accent, which person this device is, and which summary figure is on screen are the four per-device values, and none may reach the sheet.**

## Telling the truth on screen
- **Anything the sheet holds and the app cannot show is counted and said out loud** — `loadAll` returns five counts and `noticeKeys` owns their precedence, worst first. Never repair `configMissing`: re-seeding writes this build's defaults into an unknown sheet.
- **No raw error text reaches the screen.** `i18nError` is the only way to throw something a person reads; the API's English stays on `.message` behind an `i18nKey`, and `errorMessage` never falls back to it.
- **Store the cause, never the sentence** — a translated string is frozen in the language that built it, and both `useLedger`'s error and the compact outcome outlive a change.
- **Every destructive confirmation goes through `ConfirmSheet`**, the one home of "Cancel first in the DOM" and of being content-sized. The caller supplies the BODY, because only the caller knows whether the thing can be recovered. Recovery is `DeletedList`, never a toast action.
- **The ledger shows recurring costs it has RECORDED, never one it has not.** No "rent is not in yet" on that screen; reminders live on the recurring page.
- **A recurring instance appears in the SECTION or in its day, never both** (`monthSections` partitions). A day's total is that day's remaining rows; the month's figures come from the month.
- **The deleted list is scoped to the month on screen**, while settings' count stays sheet-wide because that is what `compact` acts on.
- **A tombstoned row says everything its live twin says** — a settlement without its direction reads as an expense.
- **Nothing in the UI creates a settlement**, so `Header`'s balance carries no action. Everything below the UI still handles the type.

## The token, the cache and the worker
- **The app key is never a build-time value**: `VITE_SCRIPT_URL` ships in the public bundle.
- **The token endpoint always answers HTTP 200**, so branch on the body, never `response.ok`. `connection.js` holds the taxonomy — `unauthorized` terminal, the rest transient — and it flags a rejected key rather than deleting it.
- **The mint is `Content-Type: text/plain` and the method is never forced through the redirect**, which keeps it a CORS simple request — hence no `doOptions` in the script.
- **`doPost` must be incapable of throwing; `postRecurring` must be allowed to.** A throw in the web app returns HTML, read as transient; an uncaught throw in a TRIGGER mails the owner, and that mail is the only channel reporting the poster stopping.
- **`setValues` coerces like `USER_ENTERED`**, so `Code.gs` sets the number format to `@` BEFORE writing and every date goes through `Utilities.formatDate` in the pinned zone.
- **The refresh margin is performance; the 401 retry is correctness.** A mint begun before the 401 may carry the rejected token, so `refreshToken` counts generations and the retry cannot retry.
- **A failure retrying cannot fix must not be reported as transient**, or it hides behind the 30s floor forever: a lost share, and `unavailable`. A 403 is both, so `isUnreachable` reads the reason, not the status.
- **The token mint starts before the first React render**, because everything after it is serialized.
- **The snapshot is validated per entry and dropped whole if any row fails.** It is the one input never decoded through `rowToEntry` and it is restored in a `useState` initializer, so a bad row white-screens the first render. **Bump `VERSION` whenever the shape changes**; `v` is a drop marker, never a migration. Templates are deliberately not in it.
- **The cache is written from the screen, only once nothing is pending**, and **`setSafeToReload` must stay wired with `reconsiderUpdate`** — without the nudge a worker refused while a form was open is never asked again.
- **Precache from a `dist/` walk, name the cache from file CONTENTS, match with `ignoreVary: true`, never intercept a cross-origin request, and sweep only `CACHE_PREFIX` keys.** All five fail silently; `caches.keys()` is origin-wide and Pages sites share an origin. The cross-origin `return` is the fetch handler's first statement, because scope decides which *clients* are controlled, not which *requests* are seen. **The base path lives in `base.js`.**

## Conventions
- **Plain modern JavaScript, ESM.** No TypeScript; `.jsx` only for files containing JSX.
- **Prettier owns formatting, `.js`/`.jsx` only** — stylesheets and docs are hand-tuned and outside the glob. For a literal that is a table use `// prettier-ignore`, whose text must be exactly that or it is silently inert.
- **No new npm dependencies** without a clear reason; icons are inline SVG. One is also a CSP decision, and **adding a Google host means updating the CSP** in `index.html`.
- **Never put a real secret in a `VITE_` variable**: Vite inlines every one into the bundle.
- **`SettingsIcon`'s path is generated, not drawn** — `(12 + r·cos θ, 12 + r·sin θ)` at `θ = 45k° ± 13°`, r 9.2 or 6.5. Regenerate rather than retouch.
- **Comments explain *why*, not *what*, and say it once.** State the standing rule, not the incident behind it. A module header does not need restating per function, and a `@param` that retypes the signature is noise.
- **One helper, one home.** `readStored`/`writeStored` are the only `localStorage` touches; `storedPreference` the only per-device store; `cellText` in `schema.js`; every date helper in `lib/dates.js`; `PEOPLE` the only `[p1, p2]` literal; `UNCATEGORIZED` the only spelling of it; `useEntryTitle` the only place an entry becomes a title; `usePeopleLabels` the only place a component names a person, in three forms — `possessive` exists because English inflects.
- **A control that appears twice is a component**: `Field`, `Segmented`, `EntryLine`, `NoteField`, `SplitField`, `CategoryField`, `AmountField`, `SheetFormFooter`, `OpenSheetLink`. A wrapper with no job of its own is not on the list; inline it.
- **`LedgerScreen` is the signed-in surface and THREE things render it**: `App`, `preview.jsx`, one static render in `render.test.jsx`. `App` keeps gates, sheets and state; `useLedgerView` every derived figure.
- **`EntryList`, `EntryRow` and `SummaryCard` are `memo` and every handler they take must stay stable** — they are the only subtrees whose cost grows with the ledger, nothing looks wrong when it breaks, and no test can see it.
- **The entry form's field order is by how often a field is touched**: amount, note, category, who paid, date, split. A decision, so `test/ui.test.jsx` pins it.

## i18n
- **Never hardcode a user-facing string in a component**, `aria-label`, `aria-valuetext`, `alt`, `title` and `placeholder` included. `test/i18n.test.js` scans for dead keys, missing keys and bare literals in those attributes; it cannot see a key held in a variable or a template literal, so build arrays out of `t()` calls, not keys.
- **A key built at runtime needs its own coverage test**: `ENTRY_ERROR`, `CONNECTION_ERROR` and `ACCENTS` are each asserted against their source list.
- **It is a module singleton, not a context** — render tests render components bare, and non-React modules need the same `t`.
- **Every `useSyncExternalStore` needs the third argument and a stable snapshot.** Omitting `getServerSnapshot` throws under `renderToStaticMarkup`; a fresh object per call loops.
- **Plurals go through `Intl.PluralRules`**, never a `count === 1` ternary. A pluralised value is an object keyed by CLDR category — the only catalog value that is not a string.
- **Two keys with identical text are one key**, and a Japanese label collapsing to a bare verb its English twin qualifies is a bug parity tests cannot see. **A test that calls `setLocale` must restore it.**

## Accessibility
- **A message a control produced must be reachable from that control — and on screen.** A field error lives inside its own `Field`; a save failure is the opposite, last in the form directly above the footer, with every control that can produce it carrying `aria-describedby`. Ids are document-global. Anything whose value changes without a page change carries `role="status"`.
- **A toast carries its own region, one tone per urgency**: a write failure is `alert`/`assertive`, a confirmation `status`/`polite`. **The balance is the deliberate exception and must not become a live region** — every write that moves it already speaks through a toast.
- **A validation error is derived from the value that was rejected**, never stored as a message, never keyed on a bare "has submitted" flag. `saveError` *is* stored, and is cleared first.
- **The hero figure is named by a sentence, not its digits.** The `<h1>` carries an `aria-label` of the whole fact, so no part span is `aria-hidden` and the direction line is. Never move the name onto the `<p>`: `role="paragraph"` prohibits naming.
- **`BottomSheet` reads `onClose` through a ref**, so no effect depends on its identity, and **exactly ONE is mounted at a time** — `App`'s single `overlay` makes that structural. Two means two keydown handlers, two focus traps, and one cleanup clearing `--keyboard-inset` with the keyboard still up.
- **Identity is never communicated by colour alone**: the legend carries name, value and share, and the meter's second segment a hairline.

## Platform: iOS, standalone, small

Invisible in a desktop browser and wrong on the target. `test/styles.test.js` pins these.

- **The sheet and the key screen lift clear of the software keyboard** — iOS does not shrink the layout viewport, which `fixed` and `dvh` both track. `useKeyboardInset` is the only publisher of `--keyboard-inset`, `lib/viewport.js` the only home of its arithmetic, and exactly three selectors read it: `.sheet`, `.sheet__footer`, `.gate`.
- **A page's worth of form takes the whole screen; a question does not.** Full screen is opt-in through `BottomSheet`'s `full`, because it is a claim about the CONTENT.
- **Hover is a mouse state, `:active` is the touch one.** iOS applies `:hover` on tap and holds it, so every hover rule sits behind `@media (hover: hover)` and has an `:active` twin declared after it. The carve-outs are `a` and the scrollbar thumb.
- **`overscroll-behavior-y: none` on `html`**, or a flick from the top reloads without consulting `setSafeToReload`. **That rule declares no `overflow`**: `BottomSheet` sets and restores it on both `html` and `body`, so a declaration there becomes the value it restores to.
- **`touch-action: manipulation` on anything tappable.** `base.css` covers `button` only, so `.btn`, the label-based controls, the `<summary>` and the backdrop each need their own or they wait 300ms for a double-tap.
- **A full-screen panel covers the backdrop, so a phone has two ways out**: the X and the footer's Cancel. The backdrop tap and Escape belong to wider screens and to a keyboard; neither pair may be removed as a duplicate of the other.
- **No control may set the size of the sheet it sits in** — `min-width: 0` on the panel, `min-height: 0` on the body, one axis each; `input[type="date"]` needs its own `min-width: 0` and `appearance: none`, since iOS sizes it from the locale's date format.
- **Nothing may scroll sideways at 320px.** `.sheet__body` sets `overflow-x: hidden` explicitly; anything holding config-tab text needs `min-width: 0` and `overflow-wrap: anywhere`, including outside a sheet, where nothing clips it and the whole PAGE scrolls. Both `.layout` tracks carry the guard. The `preview-en-stress*` pages are the check.
- **The toast stack takes no pointer events**, or it swallows a tap on a delete control, and **a row is a row, not text**: `button.entry__main` suppresses selection and the callout.
- **Safe areas are composed where needed, not globally** — `base.css` applies the horizontal insets to `body` alone, six elements compose what they need, and the full-screen panel restates the horizontal pair because `.sheet` is fixed.

## Charts and CSS

Four stylesheets, in order: `tokens.css`, `base.css`, `primitives.css`, `app.css`. `DonutChart` is
hand-rolled inline SVG — a `stroke-dasharray` trick, r chosen so the circumference is exactly 100.

- **The `--series-N` order is the colorblindness-safety mechanism, not cosmetic** — a validated 6-slot categorical set including the ring's wrap-around pair. Never reorder, never cycle past slot 6; a 7th category folds into "Other". **Two values is not a pie**: the who-paid split is a meter bar with a hairline.
- **Set the slice stroke inline, never in CSS.** A rule on `.chart__slice` overrides the attribute and paints every slice one colour — an invisible chart that passes every test.
- **Light theme only** — no dark block, no `--success`/`--warning`: state is stated in words, and money direction is never encoded in hue.
- **An accent preset is three custom properties** under `[data-accent]`, attribute-scoped so a swatch can paint its own colour, rings derived by `color-mix`.
- **Use the tokens** — `var(--transition-*)` rather than a duration, which is what collapses under `prefers-reduced-motion`. A token copied into `index.html` or the manifest is pinned by a test.
- **`letter-spacing: 0` and no `text-transform` anywhere text can be Japanese**, since tracking inserts a gap between every kana. The carve-out is `.balance__amount`, digits only.
- **No line-height below 1.5** on anything that can hold Japanese; `--lh-flat: 1` is the single carve-out, same element. Headings use `--lh-tight`, which IS 1.5.
- **Nothing below 13px**, `<code>` included; weights are `400|500|600` only.
- **Elevations appear in exactly three places, budgeted at `--shadow-*`** — the focus ring, the selection ring and the meter's hairline are not elevations. **Contrast budgets live in `tokens.css`** next to the values with measured ratios; do not restate them here, do not tidy two together.
- **`--shell-max` has to leave room for `--main-max`**: `.layout` is border-box, so a narrower shell makes the `1fr` track resolve below the cap and it never binds.
- **Match the layout's centring with a percentage, never a viewport unit** — `.layout` centres inside BODY's content box, already shrunk by the horizontal insets.
- **`.btn--icon` is not combined with `.btn--ghost`**: they disagree about the border.
- **Never drop a form control below 16px** — Mobile Safari zooms on focus and will not zoom back out. The amount input is primary by being first, focused and given a numeric keypad.
- **Mobile-first**: one column, capped at `--column-max` from `48rem`, two at `62rem`. `48rem` is also where a sheet stops being a phone treatment, and there is no third breakpoint. Tap targets are `--tap-target` (44px), or `--tap-target-sm` (36px) for chips and the segmented thumb.
- **A modifier that only holds below `48rem` must be undone inside that query**, next to the rule it undoes: both `.sheet__panel` rules are single-class, so source order alone decides.
- **An animation's distance is a length, not a percentage**, where the element can be the screen.
- **`--header-height` must never understate the header's height** — `.layout__aside` reads it from outside, so a short token slides the aside under the band.
- **Keep specificity flat**: single class selectors, no IDs, no `!important`.

## Testing
- **`sheets.test.js` and `apps-script.test.js` assert what was SENT, not what came back.** The Apps Script harness `new Function`s `Code.gs`, so it also proves the file PARSES — which nothing else does, since it is pasted into an editor rather than built.
- **`connection`, `snapshot`, `sw-build`, `styles`, `preferences` and `viewport` exist because their failures are invisible in a build and on screen.** Where the interesting half is an outcome rather than a string — which cache keys survive an `activate` — RUN the code.
- **`bank_to_ledger.py` and `Code.gs` are the two places outside `schema.js` that know a column list.** `test/schema.test.js` parses both out of source and compares them, with the tab titles, the defaults, the instance-id join and the format-before-write ordering. Never add a third home.
- **A test that cannot fail is worse than no test.** Do not assert a function against itself, a property of the platform, or an attribute a different element in the same markup supplies — write the literal `'F'`, not `tab.letter('deleted_at')`. **Mutate the code and watch the test fail** before believing it, undoing the mutation by editing the file back, never `git checkout`.
- **When two files must agree, pin them over one shared table of inputs**, not over the cases where they happen to agree.
- **When fixing a bug, add the regression test.** For money arithmetic the one that matters is end-to-end: a settlement of exactly the outstanding balance drives the net to zero, with odd-unit amounts.
- **A passing suite does not mean it looks right.** `scripts/preview.jsx` renders the real `LedgerScreen` to static HTML with the real stylesheets, twenty-six pages, four of them 320px stress pages whose `SIDEWAYS` readout catches an overflow no assertion can see.

```sh
npx vite-node scripts/preview.jsx   # writes scripts/preview-*.html (gitignored)
python3 -m http.server 8899         # frames.html iframes need an origin
# then screenshot frames.html?page=<name>&w=320,393&h=852 headless; `w` walks 320/393/430/768/1440
```

## Gotchas
- **Never run a bare `npm install` on a machine with a private registry.** It bakes that host into every `resolved` URL in `package-lock.json`, works locally and fails elsewhere; a repo `.npmrc` cannot prevent it, because npm ranks env vars higher. `test/lockfile.test.js` verifies the fix: `rm -rf node_modules package-lock.json && npm install --registry=https://registry.npmjs.org`.
- **`compact` asks for the sheet gids every time, and never through `ensureStructure`.** `values.batchGet` cannot reveal a gid, and `ensureStructure` WRITES: on a ledger whose config tab was deleted it re-seeds this build's defaults and takes the `configMissing` notice with them. There is deliberately no cached gid state to make that shortcut look free.
- **An endpoint that dies about a week after setup is the consent screen**, not a quota problem.
- **Nothing detects which person this is**: `IdentityGate` and the `localStorage` choice behind it are the only path, not a fallback.
