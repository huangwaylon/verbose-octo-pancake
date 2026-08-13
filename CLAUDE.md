# CLAUDE.md

Guidance for Claude Code working in this repository. For the data model,
security reasoning and cost, see `README.md`; for the Google Cloud walkthrough,
see `SETUP.md`. Do not restate either here.

## Commands

| Command | Notes |
| --- | --- |
| `npm run dev` | Vite on 5173 (its default). |
| `npm test` | vitest, single run. Must pass before any commit. |
| `npm run build` | Production bundle into `dist/`, then `scripts/build-sw.js` emits `dist/sw.js`. |
| `npm run preview` | Serve the built bundle. Needed to exercise the service worker. |
| `npm run test:watch` | vitest in watch mode. |

## Invariants

These are the rules that prevent silent data corruption. Breaking one does not
throw — it quietly writes the wrong thing to someone's spreadsheet.

**`src/schema.js` is the only file that knows the sheet layout.** Column names,
order, ranges, and row↔entry mapping live there. Never hardcode a range like
`'expenses_p1!A2:K'` or a column index elsewhere — use `columnLetter` /
`columnIndex`.

**`EXPENSE_COLUMNS` is append-only.** Every range and letter is derived from
array *position*, and `ensureStructure` rewrites a mismatched header row while
never touching data rows — so inserting or reordering a column relabels every
existing row in a live sheet, silently, under the wrong field. Appending is also
capped: `columnLetter` is single-character arithmetic (`65 + index`), so column
27 would produce `'['` and a range the API rejects.

**`loadAll`'s ranges are positionally coupled to `PEOPLE`.** It requests
`[p1, p2, config]` and maps `valueRanges[index]` back by the `PEOPLE` index, so
reordering either list attributes every row to the wrong payer: the balance
flips sign and nothing throws.

**Each person has their own expenses tab (`expenses_p1`, `expenses_p2`).**
Which tab a row lives in *is* the payer, so there is no `payer` column to keep in
sync: `rowToEntry` takes the person as an argument instead of reading a cell, and
every function that touches expense rows is keyed on a person. Editing an entry
to change who paid must move the row to the other tab — `updateEntry` appends to
the new tab and tombstones the old row, in that order, so a failure between the
two leaves the entry visible rather than gone.

**Every write uses `valueInputOption: RAW`.** Never `USER_ENTERED`. A note of
`=SUM(A:A)` must be stored as literal text, and dates must not be reformatted to
the sheet's locale.

**An entry never carries its row position.** Row positions shift whenever anyone
edits the sheet in the Sheets UI, so `updateEntry` and `setDeletedAt` re-resolve
id → row through `resolveRow` immediately before writing. There is deliberately
no `rowNumber` field to be tempted by: it existed once, was written in five
places, read in none, and its only test asserted the value the rule forbids
anyone to use.

**Only `ensureStructure` builds structure, and it refuses a spreadsheet with
several tabs and none of ours** — a fresh one has exactly one. The reasoning is at
the throw site; the point here is that no other path may adopt a spreadsheet.

**Deletes are soft, confirmed, and reversible.** `setDeletedAt` writes a timestamp and
the client filters, so rows never move and a restore is one cell write. Every delete goes
through `ConfirmDeleteSheet`: `App` owns `pendingDelete` and nothing else calls
`removeEntry`, so the row's trash control and the edit form's land on the same dialog.
Recovery is the collapsed `DeletedList`, never a toast action — a toast that has timed out
is a delete nobody can undo.

**The deleted list is scoped to the month on screen**, because it sits under the month
switcher; settings' count stays sheet-wide, because that is what `compact` acts on.

**`compact()` is the only hard delete**, and it must issue its `deleteDimension` requests
in **descending** row order within each tab, or earlier deletions shift the indices of
later ones.

**Money is integer minor units** — cents for USD, **whole yen for JPY**, fils for
KWD. `minorDigits(currency)` is the only place the exponent is decided, and it is
a hardcoded ISO 4217 table, never derived from `Intl`, because it decides what
gets written to the sheet and must be identical on every device forever.

**Every money function takes the currency explicitly; none defaults it.** The
string `"1250"` is ¥1250 or $12.50 depending only on the currency it is decoded
with, so a default is a silent 100x error rather than a convenience.
`centsToSheetString` and `entryToRow` both throw without one, and
`validateEntryCodes` reports `MISSING_CURRENCY`. The display formatters are the
deliberate exception — they fall back to the ISO default and to
`decimalString`, never to the sheet encoder, because a missing currency must not
take a render down but must never be written. `minorDigits` answers 2 for any
code it does not recognise, so a typo in the config tab's `currency` is a silent
100x error of exactly this kind.

**Decode a row's currency BEFORE its amount.** `rowToEntry` takes the sheet's
currency and uses it only when a row's own currency cell is blank — a row
somebody added by hand. `loadAll` therefore resolves the config *before* mapping
rows. `test/currency.test.js` pins both scales. `entryToRow` writes each row at
its *own* currency's scale, never the config's.

**`splitCents` must conserve every unit:** `payerCents + otherCents === cents`.
It and `sumCents` are scale-agnostic and need no currency.

**Nothing written to the sheet is ever localized.** Config defaults, column
names, timestamps, and amount strings are locale-independent by design: two
people sharing a sheet may be reading the UI in different languages, and the
stored data must not depend on whose device seeded it. The two people's names are
the one place this cuts both ways: `SEED_NAMES` in `sheets.js` writes English
into a fresh sheet, and `DEFAULT_CONFIG` deliberately carries no names at all, so
that a sheet which says nothing falls through to `nameOf`'s localized fallback
instead of "Person 1".

**Per-device vs per-sheet.** The locale and the accent colour live in
`localStorage` (like identity); the currency lives in the sheet's `config` tab
and on every entry row. Neither preference may ever be written to the sheet —
neither person gets to restyle the other's phone.

**Settlements are not a separate code path** (the model is in README). Two rules
follow from that: never add an `if (type === 'settlement')` branch to arithmetic —
`payer_share: 0` already says it — and never count one toward spend totals or a
category breakdown.

**Nothing in the UI creates a settlement.** Settling happens by wire transfer, so
`BalanceCard` carries no action and must stay that way unless asked. Everything
below the UI still handles the type, because sheets hold settlement rows from
before and editing one must keep working.

**Dates are ISO strings, compared as strings.** Never `new Date('2026-08-05')` —
that parses as UTC midnight and shifts to the previous day in western timezones.
Use the helpers in `src/lib/dates.js`, which build dates from explicit parts.

**Config values are not all strings.** `CONFIG_FIELDS` in `src/lib/sheets.js`
carries a kind per key — `text`, `list` or `fraction` — and `parseConfigRows`
omits a key whose value is blank or unparseable so the caller's defaults win. An
empty list must never be returned in place of a default, or the category picker
ends up empty. `default_split_p1` / `default_split_p2` accept a percentage or a
fraction (anything above 1 is a percentage) and must never yield NaN: that
reaches `splitCents` and moves money wrongly. `test/config.test.js` pins these.

**The default split is per person, keyed on the payer.** `defaultSplitFor(config,
person)` in `src/lib/identity.js` is the only place that decides it. The two
values are independent and need not sum to 1 — only the payer's is ever read, so
never mirror one from the other. A new entry carries `payerShare: null` meaning
"follow the payer's default", and `EntryFormSheet` re-derives it when the payer
control changes; an entry being edited carries its stored share and must keep it,
because a saved row records a decision someone already made.

**Refreshes on focus are throttled.** Two people share one sheet with no push
channel, so `useLedger` re-reads on `focus` and `visibilitychange`. Window
switching is constant and every refresh spends per-user quota, hence the 30s
floor — do not remove it.

**The app key is never a build-time value, and the endpoint URL is not a secret.** The key
is typed once per device and lives only there; `VITE_SCRIPT_URL` ships in the public bundle,
so nothing may depend on the endpoint being hard to guess. Two standing conditions the code
cannot enforce — the dedicated account owning exactly one spreadsheet, and nothing untrusted
sharing the Pages origin — are in README's Security model. Both fail silently.

**The token endpoint always answers HTTP 200.** `ContentService` cannot set a status, so
`{"error":"unauthorized"}` arrives as a 200 and the body is the only signal. Branch on the
body, never on `response.ok`. A rotated key and a network blip are different failures:
reporting a blip as a bad key makes someone retype 64 characters, and reporting a bad key
as transient hides it behind retries forever. `connection.js` treats `unauthorized` as
terminal and everything else — non-JSON, rejection, timeout — as transient, and it **flags
a rejected key rather than deleting it**.

**The mint request is `Content-Type: text/plain`, and the method is never forced through
the redirect.** `text/plain` keeps it a CORS simple request; a preflight would be answered
with the 302 that `/exec` returns and die, which is also why the script has no `doOptions`.
`fetch` downgrades POST to GET across that 302 and Apps Script serves the computed reply
from the echo URL — forcing POST through the hop returns "page not found".

**`doPost` must be structurally incapable of throwing**, because Google's HTML
error page is classified as transient and retried forever, and it must never read
`e.parameter`, which would log the key. `apps-script/Code.gs` carries the reasoning
and the incident behind it.

**The refresh margin is performance; the 401 retry is correctness.** Minting needs no user
gesture, so `sheets.js` recovers silently. `refreshToken`'s generation counter is why: a
mint that began *before* the 401 may carry the token Google just rejected, and the retry
runs with `allowRetry: false`.

**Bump the snapshot's `VERSION` whenever the persisted shape changes**, and
remember it silently stops writing past `MAX_CHARS` (~2000 entries): `writeStored`
swallows the quota error, so an over-long history turns the cold-launch paint off
for good with no error anywhere. `writeSnapshot` must also be handed the
server-loaded list, never the merged state — an unacknowledged optimistic row
persisted there comes back next launch looking saved.

**The snapshot's `v` is a drop marker, never a migration.** An unrecognised version is
ignored and re-fetched, which is free — the sheet is the source of truth. The snapshot
stores the **pre-merge** config, because a merged copy freezes the building build's
defaults into every later launch. Config and entries seed atomically, for the same reason
`loadAll` resolves the config before mapping rows: the balance formats at
`config.currency`, so entries restored without their config render at the wrong scale.
`clearSnapshot` exists because that module also remembers the last payload it wrote in
order to skip redundant writes — clearing the key without resetting that leaves the next
load convinced it already saved.

**`setSafeToReload` must stay wired.** `serviceWorker.js` defaults it to
`() => true`, and one effect in `App` narrows it to "no draft open, no write in
flight". Break that effect and an update reloads mid-entry, discarding what
someone was typing.

**The service worker never intercepts a cross-origin request**, and that is an explicit
early `return` as the first statement of the `fetch` handler, not a property of scope —
scope decides which *clients* are controlled, not which *requests* are seen, so the token
endpoint and the Sheets API both arrive there. A `<meta>` CSP does not cover a worker's own
context and Pages sends no CSP header, so a worker responding to those would be an
uncovered proxy in front of a bearer token.

**Precache from a `dist/` walk, and derive the cache name from file contents.**
`.vite/manifest.json` is not emitted without a flag, and when it is, it omits `index.html`
itself and everything copied from `public/`. Hashing names rather than contents would leave
`sw.js` byte-identical after an `index.html`-only change — a CSP edit, for instance — so the
update would never reach the device. `caches.match` needs `ignoreVary: true`: Pages sends
`Vary: Accept-Encoding` and `vite preview` sends `Vary: Origin`, and a mismatch misses and
falls through to the network, which offline means a cache that silently only works online.

**There is no migration code, and no users to need it.** Anything justified only
by "keeps an existing sheet working" has been removed. Do not add a
back-compatibility branch for a shape this app never shipped.

## Conventions

- **Plain modern JavaScript, ESM.** No TypeScript. `.jsx` only for files
  containing JSX.
- **No new npm dependencies** without a clear reason. The bundle is React plus
  application code; icons are inline SVG in `src/components/icons.jsx`. A new
  dependency also means a CSP decision.
- **If you add a Google host, update the CSP** in `index.html`. It is a
  deliberate allowlist, not boilerplate.
- **Never put a real secret in a `VITE_` variable.** Vite inlines them into the
  shipped bundle. Both existing variables are public by design.
- **Comments explain *why*, not *what*.** Match the existing density — the
  non-obvious constraint gets a comment; the obvious line does not. Do not
  narrate the history of a refactor in a comment.
- **One helper, one home.** `readStored`/`writeStored` in `src/config.js` are the
  only `localStorage` touches; `cellText` and `columnIndex` live in `schema.js`;
  `PEOPLE` is the only `[p1, p2]` literal; `usePeopleLabels` is the only place a
  component turns a person into a name; `i18nError` in `i18n/index.js` is the only
  way to throw something a person will read; `UNCATEGORIZED` in `balance.js` is the
  only spelling of that bucket.
- **A control that appears twice is a component.** `Segmented` (four call sites,
  and the only one carrying `role="radiogroup"`), `EntryAmount` (the per-row
  currency resolution), `NoteField` and `SplitField`. `useLedgerView` holds every
  derived figure so `App` stays gates, sheets and layout.

### i18n

English and Japanese, no dependency. `src/i18n/` holds the engine (`index.js`),
the two catalogs (`en.js`, `ja.js`), the registry (`catalogs.js`), and the
node-returning variant for strings with inline markup (`nodes.jsx`).

- **Never hardcode a user-facing string in a component.** That includes every
  `aria-label`, `title` and `placeholder`. `test/i18n.test.js` scans `src/` and
  fails on a catalog key nothing references (the `error.` and `accent.` prefixes
  excepted), a referenced key no catalog has, and a bare string literal in one of
  those three attributes. The scan matches `t('key')` verbatim, so a key held in a
  variable is invisible to it — build the array out of `t()` calls, not keys.
  It cannot see a template literal either, which is how the summary meter's
  `aria-label` stayed untranslated.
- **A key built at runtime needs its own coverage test.** The scan cannot see
  `` t(`error.${code}`) ``, so each family is asserted against its source list
  instead: `ENTRY_ERROR`, `CONNECTION_ERROR` and `ACCENTS`.
- **It is a module singleton, not a context.** `render.test.jsx` renders
  components bare, and non-React modules (`useLedger`) need the same `t`. A
  provider would break the first and be unreachable from the second.
- **`useT()` uses `useSyncExternalStore` with the third argument.** Omitting
  `getServerSnapshot` throws under `renderToStaticMarkup`, which is how every
  render test runs. `useAccent()` has the same requirement.
- **Plurals go through `Intl.PluralRules`, never a `count === 1` ternary.** A
  pluralised value is an object keyed by CLDR category, and it is the only case
  where a catalog value is not a string. `en` supplies `one`/`other`; `ja`
  supplies `other` alone, because that is what `Intl.PluralRules('ja')` reports.
- **The pure layers stay pure.** `money.js`, `dates.js`, `balance.js`,
  `schema.js` and `identity.js` never read the singleton; locale and localized
  strings arrive as arguments with English defaults.
- **A test that calls `setLocale` must restore it** in `afterEach`, or the state
  leaks into other files.

### Charts

`DonutChart` is hand-rolled inline SVG — no charting library, and it uses a
`stroke-dasharray` trick rather than arc-path math (r is chosen so the
circumference is exactly 100, making a dash length a percentage).

- **The `--series-N` order is the colorblindness-safety mechanism, not
  cosmetic.** It was validated with the dataviz palette validator against the
  white card surface, including the ring's wrap-around pair. Never reorder, never
  cycle past slot 6 — a 7th category folds into "Other" via `foldTail`. Accent
  presets deliberately do not touch these.
- **Set the slice stroke inline, never in CSS.** `var()` is invalid in an SVG
  presentation attribute, and a CSS rule on `.chart__slice` overrides the
  attribute and paints every slice one color. This shipped once as an invisible
  chart; `test/ui.test.jsx` now pins it.
- **The legend always carries name, value and share.** Three series colors sit
  below 3:1 against white, so text is the required relief — identity must never
  be communicated by color alone.
- **Two values is not a pie.** The who-paid split is a meter bar, and its second
  segment carries a hairline: the accent wash is 1.04:1 against the track, so
  without it the bar reads as "one person paid everything".

### CSS

Four files, loaded in order by `src/main.jsx`: `tokens.css` (custom properties),
`base.css` (reset, typography), `primitives.css` (generic `.card`, `.btn`,
`.input`, `.sheet`, …), `app.css` (app-specific layout).

- **Light theme only.** There is no dark block and no `--success`/`--warning`:
  state is stated in words, and money direction is never encoded in hue.
- **An accent preset is three custom properties** under `[data-accent]` in
  `tokens.css` — attribute-scoped rather than `:root`-scoped so a settings swatch
  can paint its own colour, with `--accent-ring`/`--accent-shadow` derived by
  `color-mix` rather than restated.
- **Use the tokens.** In particular use `var(--transition-fast|base)` rather than
  a hardcoded duration — the tokens collapse to ~0ms under
  `prefers-reduced-motion`, so hardcoding silently opts out of that support.
- **`letter-spacing: 0` and no `text-transform`, anywhere text can be Japanese.**
  Tracking inserts a gap between every kana (「このつき」 becomes 「こ の つ き」) and
  `uppercase` is a no-op on kana. The lone carve-out is `.balance__amount`, which
  renders digits exclusively.
- **No line-height below 1.5** on anything that can hold Japanese; CJK glyphs
  fill the em box. `--lh-flat: 1` is the single carve-out, same element, same
  reason. There is no `--lh-heading`: headings use `--lh-tight`, which *is* 1.5.
- **Nothing below 13px**, `<code>` included. Weights are `400|500|600` only.
- **Elevations appear in exactly four places** (sheet panel, toast, FAB,
  segmented thumb) and never on hover. Cards are a white plane plus one hairline;
  the temperature step from `--bg` to `--surface` is the elevation. `box-shadow`
  is used for three other things that are not elevations and do not count against
  those four: the focus ring, the swatch's selection ring, and the meter's
  segment hairline. It is transitioned in exactly one place, the text control's
  focus ring; `test/styles.test.js` pins that.
- **Contrast budgets live in `tokens.css`, next to the values, with their
  measured ratios.** Do not restate them here; do not "tidy" two tokens together
  because they look similar. The two that catch people: `--line-input` is darker
  than `--line` because a control boundary needs 3:1 and `--line` gives 1.34:1,
  and `--ink-3` may not sit on `--accent-wash` or `--sunken`.
- **`.btn--icon` is not combined with `.btn--ghost`.** They disagree about the
  border, and the icon glyph at `--ink-2` is itself the 3:1 graphic.
- **Never drop a form control below 16px.** Mobile Safari zooms on focus below
  that and will not zoom back out.
- Mobile-first. One column, capped at `--column-max` from `48rem`, two columns at
  `62rem`; the sheet becomes a centred dialog at `48rem` too — there is no third
  breakpoint. Tap targets are `var(--tap-target)` (44px), or
  `var(--tap-target-sm)` (36px) for chips and the segmented thumb.
- **Every layout keeps `--fab-size` of clearance below its content**, at every
  width — the FAB has landed on the last row's delete button before.
- Keep specificity flat: single class selectors, no IDs, no `!important`.

## Testing

Specs live in `test/**/*.test.{js,jsx}`, with shared harnesses under
`test/support/`. Fourteen files: `money`, `currency`, `balance`, `schema`, `dates`,
`config`, `connection`, `snapshot`, `sw-build`, `i18n`, `render`, `ui`, `styles`
and `lockfile`.

`connection`, `snapshot`, `sw-build` and `styles` exist because their failures are
invisible in a build and on screen — a misclassified endpoint reply, a snapshot
that renders money at the wrong scale, a precache list that stops any worker
activating, a merged CSS rule that lands on the wrong block.

**A test that cannot fail is worse than no test**, because it reads as coverage.
Do not assert a function against itself, do not assert a property of the platform,
and do not name a test after an invariant it does not exercise: all three shipped
here, and one of them stood in for the `disabled` rule on the month switcher.

`render.test.jsx` and `ui.test.jsx` render components to static markup with
`renderToStaticMarkup` — no DOM, no browser. They catch components that throw on
a real prop shape or silently drop data, which a build cannot. A focus trap or a
`scrollIntoView` call cannot be tested this way; do not fake a DOM to try.

When fixing a bug, add the regression test. When changing balance or money
arithmetic, the test that matters most is the end-to-end one: a settlement of
exactly the outstanding balance must drive the net to zero, with odd-unit
amounts so rounding is genuinely exercised.

**A passing suite does not mean it looks right.** `scripts/preview.jsx` renders
the signed-in surface to static HTML: every accent in English, indigo in
Japanese, and the confirm dialog in each — eight files, with the real
stylesheets:

```sh
npx vite-node scripts/preview.jsx     # writes scripts/preview-*.html (gitignored)
```

Load those in `<iframe>`s at 320/390/430/768/1440 and screenshot. **Use iframes,
not a resized window** — an iframe gets its own viewport so container and media
queries resolve honestly, while headless Chrome quietly reports a different width
than you asked for and every breakpoint reads wrong. The whole suite passed green
while the donut chart rendered white-on-white and invisible.

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
- **`vite.config.js` defaults `base` to `/verbose-octo-pancake/`** to match the
  repo name, because project Pages sites serve from `/<repo>/`. Renaming the repo
  without updating it produces a blank page. Build with `VITE_BASE=/` for a
  custom domain.
- **`compact` has to ask for sheet gids, every time.** `values.batchGet` cannot
  reveal them, so `loadAll` never has any: the gids come from `ensureStructure`,
  which `compact` calls itself when `useLedger` holds none. That is the normal
  path, not an edge case, and `compact` skips a tab whose gid is missing — the
  throw in `useLedger` is what stops that being silent.
- **The consent screen must stay published**, or the script's authorization
  expires after 7 days and the endpoint dies a week later, looking exactly like a
  quota problem. `SETUP.md` step 5.
- **Nothing detects which person this is.** The token belongs to the account that
  owns the sheet, not to either of them, so `IdentityGate` and the `localStorage`
  choice behind it are the only path — not a fallback.
