# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

A static React app for two people to track shared grocery/food expenses. A
single Google Sheet is the database. The browser talks straight to the Sheets
API with a short-lived OAuth token; there is no backend and no secret anywhere.
Deployed to GitHub Pages by `.github/workflows/deploy.yml` on push to `main`.

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

**Money is integer cents.** Parse at the boundary with `parseAmountToCents` and
never do float arithmetic on an amount. `splitCents` must conserve every penny:
`payerCents + otherCents === cents` for all inputs.

**Settlements are not a separate code path.** A settlement is an entry with
`payer_share: 0`, which makes the balance a single sum over every row. It counts
toward the balance but never toward spend totals or category breakdowns. If you
find yourself adding an `if (type === 'settlement')` branch to arithmetic,
reconsider.

**Dates are ISO strings, compared as strings.** Never `new Date('2026-08-05')` —
that parses as UTC midnight and shifts to the previous day in western timezones.
Use the helpers in `src/lib/dates.js`, which build dates from explicit parts.

**The access token stays in memory.** Module-scoped in `src/lib/googleAuth.js`,
never in `localStorage` or `sessionStorage`. A persisted bearer token is
readable by any XSS and outlives the tab; GIS re-issues silently anyway.

**The OAuth scope stays `drive.file`.** Widening it to `spreadsheets` would grant
access to every sheet in the user's Drive. This is why the Google Picker exists.

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

### CSS

Four files, loaded in order by `src/main.jsx`: `tokens.css` (custom properties,
light/dark), `base.css` (reset, typography), `primitives.css` (generic `.card`,
`.btn`, `.input`, `.sheet`, …), `app.css` (app-specific layout).

- **Use the tokens.** In particular, use `var(--transition-fast|base)` rather
  than a hardcoded duration — the tokens collapse to ~0ms under
  `prefers-reduced-motion`, so hardcoding silently opts out of that support.
- **Never drop a form control below 16px.** Mobile Safari zooms on focus below
  that and will not zoom back out.
- Mobile-first. The layout goes two-column at `62rem`. Tap targets are at least
  `var(--tap-target)` (44px).
- Keep specificity flat: single class selectors, no IDs, no `!important`.

## Testing

Specs live in `test/**/*.test.{js,jsx}`. Four suites: `money`, `balance`,
`schema`, and `render`.

`render.test.jsx` renders components to static markup with
`renderToStaticMarkup` — no DOM, no browser. It catches components that throw on
a real prop shape or silently drop data, which a build cannot.

When fixing a bug, add the regression test. When changing balance or money
arithmetic, the test that matters most is the end-to-end one: a settlement of
exactly the outstanding balance must drive the net to zero, with odd-cent
amounts so rounding is genuinely exercised.

## Gotchas

- **CI pins `node-version: 24`, and must not go back to 22.** Node 22 bundles
  npm 10.9.8, which crashes on GitHub-hosted runners with "Exit handler never
  called!" — an npm-internal fault, not a lockfile problem. Node 24 ships
  npm 11.17. Reverting this to the older LTS breaks every deploy.
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
- **`getUserEmail()` fails soft, returning `null`.** The `drive.file` scope does
  not guarantee userinfo access, so identity falls back to a manual choice stored
  in `localStorage`. Treat the manual path as first-class, not an error case.
