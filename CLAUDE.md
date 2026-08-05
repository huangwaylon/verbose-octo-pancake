# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

A static React app for two people to track shared grocery/food expenses. A
single Google Sheet is the database. The browser talks straight to the Sheets
API with a short-lived OAuth token; there is no backend and no secret anywhere.
The interface is English or Japanese, and the default currency is JPY — both of
which shape the type system and the money layer, so read the i18n and money
invariants before touching either. Deployed to GitHub Pages by
`.github/workflows/deploy.yml` on push to `main`.

For the data model, security reasoning, and cost breakdown, see `README.md`.
For the Google Cloud walkthrough, see `SETUP.md`. Do not restate either here.

## Commands

| Command | Notes |
| --- | --- |
| `npm run dev` | Vite on port 5173. The port is registered with Google — do not change it. |
| `npm test` | vitest, single run. Must pass before any commit. |
| `npm run build` | Production bundle into `dist/`. |
| `npm run preview` | Serve the built bundle. |

## Invariants

These are the rules that prevent silent data corruption. Breaking one does not
throw — it quietly writes the wrong thing to someone's spreadsheet.

**`src/schema.js` is the only file that knows the sheet layout.** Column names,
order, ranges, and row↔entry mapping live there and nowhere else. Never hardcode
a range like `'expenses!A2:L'` or a column index in another file.

**Every write uses `valueInputOption: RAW`.** Never `USER_ENTERED`. A note of
`=SUM(A:A)` must be stored as literal text, and dates must not be reformatted to
the sheet's locale.

**Never trust a cached `rowNumber`.** Row positions shift whenever anyone edits
the sheet directly in the Sheets UI. `updateEntry` and `softDeleteEntry` must
re-resolve id → row via `findRowNumber` immediately before writing. The
`rowNumber` on an entry is advisory only.

**Deletes are soft.** Write a `deleted_at` timestamp and filter client-side, so
rows never change position. `compact()` is the only hard delete; it must issue
its `deleteDimension` requests in **descending** row order, or earlier deletions
shift the indices of later ones.

**Money is integer minor units.** One integer per amount, in that currency's
smallest unit — cents for USD, **whole yen for JPY**, fils for KWD.
`minorDigits(currency)` is the only place the exponent is decided, and it is a
hardcoded ISO 4217 table, never derived from `Intl`, because it decides what gets
written to the sheet and must be identical on every device forever. Parse at the
boundary with `parseAmountToCents(input, currency)` and never do float arithmetic
on an amount. `splitCents` and `sumCents` are scale-agnostic and need no currency;
`splitCents` must conserve every unit: `payerCents + otherCents === cents`.

**Decode a row's currency BEFORE its amount.** The stored string `"1250"` is
¥1250 or $12.50 depending entirely on that row's `currency` cell. Getting the
order wrong in `rowToEntry` is a silent 100x corruption, and
`test/currency.test.js` pins it. A blank currency cell means USD — that fallback
is what migrates every pre-existing sheet for free, so never point it at
`DEFAULT_CONFIG.currency`. `entryToRow` writes each row at its *own* scale, never
the config's.

**Nothing written to the sheet is ever localized.** Config defaults, column
names, timestamps, and amount strings are locale-independent by design: two
people sharing a sheet may be reading the UI in different languages, and the
stored data must not depend on whose device seeded it.

**The locale is per-device, the currency is per-sheet.** Locale lives in
`localStorage` (like identity); currency lives in the sheet's `config` tab and on
every entry row.

**Settlements are not a separate code path.** A settlement is an entry with
`payer_share: 0`, which makes the balance a single sum over every row. It counts
toward the balance but never toward spend totals or category breakdowns. If you
find yourself adding an `if (type === 'settlement')` branch to arithmetic,
reconsider.

**Dates are ISO strings, compared as strings.** Never `new Date('2026-08-05')` —
that parses as UTC midnight and shifts to the previous day in western timezones.
Use the helpers in `src/lib/dates.js`, which build dates from explicit parts.

**The access token is cached in `localStorage`, and cleared only on explicit
sign-out.** Anything malformed or expired is discarded on load rather than
trusted. This is a deliberate trade-off against XSS, not an oversight — the
reasoning is in `README.md`, and the ceiling is Google's: the token lasts about an
hour and the browser flow issues no refresh token, so no cache can make a session
outlive it.

**Never request a token outside a user gesture.** `requestAccessToken` always
opens a popup, even with `prompt: ''`, and a popup with no click behind it is
blocked. `requestToken` therefore clears the token and notifies listeners on
failure, so the UI drops back to the sign-in screen instead of failing writes in
the background. `useAuth` distinguishes that collapse from a deliberate sign-out
and explains itself; a silent bounce to the sign-in screen is indistinguishable
from the app logging you out at random.

**The OAuth scope grants no file access beyond `drive.file`.** The other two,
`openid` and `userinfo.email`, only identify which of the two people is signed in.
Never widen the Drive scope to `spreadsheets` — that would expose every sheet in
the account. This is why the Picker exists.

**The Picker needs `setAppId` and `setOrigin`.** `setAppId` (the Cloud project
number, derived from the client ID prefix) is what makes Drive grant the picked
file to this app under `drive.file`. `setOrigin` is required because Pages serves
the app from a sub-path and the Picker otherwise infers the wrong origin. Omitting
either produces an opaque "invalid API key". Both live in `src/lib/picker.js`.

**Refreshes on focus are throttled.** Two people share one sheet with no push
channel, so `useLedger` re-reads on `focus` and `visibilitychange`. Window
switching is constant and every refresh spends per-user quota, hence the 30s
floor — do not remove it.

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
  non-obvious constraint gets a comment; the obvious line does not.

### i18n

English and Japanese, no dependency. `src/i18n/` holds the engine (`index.js`),
the two catalogs (`en.js`, `ja.js`), the registry (`catalogs.js`), and the
node-returning variant for strings with inline markup (`nodes.jsx`).

- **Never hardcode a user-facing string in a component.** That includes every
  `aria-label`, `title`, and `placeholder`. `test/i18n.test.js` statically scans
  `src/` and fails on a catalog key that nothing references *and* on a referenced
  key that no catalog has.
- **It is a module singleton, not a context.** `render.test.jsx` renders
  components bare, and non-React modules (`useLedger`) need the same `t`. A
  provider would break the first and be unreachable from the second.
- **`useT()` uses `useSyncExternalStore` with the third argument.** Omitting
  `getServerSnapshot` throws under `renderToStaticMarkup`, which is how every
  render test runs.
- **Plurals go through `Intl.PluralRules`, never a `count === 1` ternary.** A
  pluralised value is an object keyed by CLDR category, and it is the only case
  where a catalog value is not a string. `en` supplies `one`/`other`; `ja`
  supplies `other` alone, because that is what `Intl.PluralRules('ja')` reports —
  a test asserts the catalogs match the engine exactly.
- **The pure layers stay pure.** `money.js`, `dates.js`, `balance.js`,
  `schema.js`, and `identity.js` never read the singleton; locale and localized
  strings arrive as arguments with English defaults. That is what keeps their
  single-argument behaviour, and their tests, unchanged.
- **A test that calls `setLocale` must restore it** in `afterEach`, or the state
  leaks into other files.

### Charts

`DonutChart` is hand-rolled inline SVG — no charting library, and it uses a
`stroke-dasharray` trick rather than arc-path math (r is chosen so the
circumference is exactly 100, making a dash length a percentage).

- **The `--series-N` order is the colorblindness-safety mechanism, not
  cosmetic.** It was validated with the dataviz palette validator against the
  white card surface, including the ring's wrap-around pair. Never reorder, never
  cycle past slot 6 — a 7th category folds into "Other" via `foldTail`.
- **Set the slice stroke inline, never in CSS.** `var()` is invalid in an SVG
  presentation attribute, and a CSS rule on `.chart__slice` overrides the
  attribute and paints every slice one color. This shipped once as an invisible
  chart; `test/ui.test.jsx` now pins it.
- **The legend always carries name, value and share.** Three series colors sit
  below 3:1 against white, so text is the required relief — identity must never
  be communicated by color alone.
- **Two values is not a pie.** The who-paid split is a meter bar. A two-slice pie
  is the canonical chart anti-pattern.

### CSS

Four files, loaded in order by `src/main.jsx`: `tokens.css` (custom properties),
`base.css` (reset, typography), `primitives.css` (generic `.card`, `.btn`,
`.input`, `.sheet`, …), `app.css` (app-specific layout).

- **Light theme only.** There is no dark block and no `--success`/`--warning`:
  state is stated in words, and money direction is never encoded in hue.
- **Use the tokens.** In particular, use `var(--transition-fast|base)` rather
  than a hardcoded duration — the tokens collapse to ~0ms under
  `prefers-reduced-motion`, so hardcoding silently opts out of that support.
- **`letter-spacing: 0` and no `text-transform`, anywhere text can be Japanese.**
  Tracking inserts a gap between every kana (「このつき」 becomes 「こ の つ き」) and
  `uppercase` is a no-op on kana. The lone carve-out is `.balance__amount`, which
  renders digits exclusively.
- **No line-height below 1.5** on anything that can hold Japanese; CJK glyphs
  fill the em box. Same carve-out, same reason.
- **Nothing below 13px**, and weights are `400|500|600|700` only — `550` is
  unreliable outside SF Pro and Hiragino ships W3/W6 with nothing between.
- **Shadows appear in exactly four places** (sheet panel, toast, FAB, segmented
  thumb) and never on hover. Cards are a white plane plus one hairline; the
  temperature step from `--bg` to `--surface` is the elevation.
- **`--line-input` is deliberately darker than `--line`.** WCAG 1.4.11 wants 3:1
  for the boundary identifying a control; `--line` on white is 1.34:1 and fails.
  Do not "tidy" the two together.
- **Never drop a form control below 16px.** Mobile Safari zooms on focus below
  that and will not zoom back out.
- Mobile-first. One column, capped at `--column-max` from `48rem`, two columns at
  `62rem`. Tap targets are at least `var(--tap-target)` (44px).
- Keep specificity flat: single class selectors, no IDs, no `!important`.

## Testing

Specs live in `test/**/*.test.{js,jsx}`. Eight files: `money`, `currency`,
`balance`, `schema`, `i18n`, `render`, `ui`, and `lockfile`.

`render.test.jsx` and `ui.test.jsx` render components to static markup with
`renderToStaticMarkup` — no DOM, no browser. They catch components that throw on
a real prop shape or silently drop data, which a build cannot.

When fixing a bug, add the regression test. When changing balance or money
arithmetic, the test that matters most is the end-to-end one: a settlement of
exactly the outstanding balance must drive the net to zero, with odd-unit
amounts so rounding is genuinely exercised.

**A passing suite does not mean it looks right.** `scripts/preview.jsx` renders
the signed-in surface to static HTML in both locales with the real stylesheets:

```sh
npx vite-node scripts/preview.jsx     # writes scripts/preview-{en,ja}.html
```

Open those, or load them in `<iframe>`s at 390/768/1440 and screenshot — an
iframe gets its own viewport, so media queries resolve honestly, which
`--window-size` on headless Chrome does not reliably do. The whole suite passed
green while the donut chart rendered white-on-white and invisible.

## Gotchas

- **Never run a bare `npm install` on a machine with a private registry.** This
  repo is developed where `NPM_CONFIG_REGISTRY` points at an internal Apple
  mirror, and `npm install` bakes that host into all 149 `resolved` URLs in
  `package-lock.json`. The result works locally and fails everywhere else with
  `getaddrinfo ENOTFOUND`, which npm reports only as the useless "Exit handler
  never called!". Always regenerate with an explicit override:

  ```sh
  rm -rf node_modules package-lock.json
  npm install --registry=https://registry.npmjs.org
  ```

  A repo `.npmrc` cannot prevent this — npm ranks env vars above project
  `.npmrc`. `test/lockfile.test.js` fails the build if it happens again.
- **Docker on this machine is not a valid stand-in for CI.** Containers inherit
  the host's DNS, so internal Apple hosts resolve inside them. To reproduce a
  GitHub runner, blackhole them:
  `docker run --add-host npm.apple.com:127.0.0.1 --add-host artifacts.apple.com:127.0.0.1 …`
- **`vite.config.js` hardcodes `base: '/verbose-octo-pancake/'`** to match the
  repo name, because project Pages sites serve from `/<repo>/`. Renaming the
  repo without updating this produces a blank page. Build with `VITE_BASE=/` for
  a custom domain.
- **`loadAll` returns `sheetIds` only if `ensureStructure` ran this session.**
  `values.batchGet` cannot reveal sheet gids. `compact` needs a gid, so it falls
  back to calling `ensureStructure` itself.
- **`drive.file` is a per-person, per-file grant.** Sharing the sheet in Google
  Sheets is not enough — each person must pick it through the Picker on their own
  device. This is the most common "it's broken for them" report.
- **`getUserEmail()` fails soft, returning `null`.** It needs `openid` and
  `userinfo.email` on the consent screen; with `drive.file` alone the endpoint
  401s. Since a mismatched consent screen is always possible, identity still falls
  back to a manual choice in `localStorage`. Treat the manual path as
  first-class, not an error case.
