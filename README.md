# Shared Finances

A static React app for two people to track shared expenses, with a single Google Sheet as
the database: the browser talks straight to the Sheets API with a short-lived OAuth token,
so there is no backend and no server-side secret. Google Cloud setup is in
[SETUP.md](SETUP.md); the invariants that fail silently if broken are in
[CLAUDE.md](CLAUDE.md).

## Data model

One spreadsheet, three tabs — `expenses_p1`, `expenses_p2`, `config` — laid out in
exactly one place, `src/schema.js`. Each person has their own expenses tab, so which tab
a row lives in *is* the payer and no `payer` column can disagree with it. Row 1 is the
header, data starts at row 2, and editing an entry to change who paid appends it to the
other person's tab and tombstones the original row.

| Col | Field | Example | Notes |
| --- | --- | --- | --- |
| A | `id` | `9f1c…` | UUID generated in the browser |
| B | `type` | `expense` | `expense` or `settlement` |
| C | `date` | `2026-08-05` | ISO `YYYY-MM-DD`, checked for calendar validity — `2026-02-31` reads as unset |
| D | `amount` | `1250` | Decimal string at *this row's* currency scale: `1250` is ¥1250, `42.50` is $42.50 |
| E | `currency` | `JPY` | Decoded before the amount, or the same string means two different sums. Blank means the sheet's configured currency |
| F | `category` | `Groceries` | Required for an `expense` |
| G | `description` | `weekly shop` | Free text, stored literally |
| H | `payer_share` | `0.5` | Fraction of the entry the payer covers themselves, clamped to `0`–`1`; `1` means nobody owes them |
| I | `created_at` | `2026-08-05T18:02:11.004Z` | ISO timestamp |
| J | `updated_at` | `2026-08-05T18:02:11.004Z` | ISO timestamp |
| K | `deleted_at` | *(empty)* | A timestamp here soft-deletes the row |

A settlement is just an entry with `payer_share` of `0` — the payer is owed all of it —
so the balance is one sum over every row and the arithmetic has no settlement branch;
settlements never count toward spend totals or category breakdowns. Amounts are integer
minor units (whole yen for JPY, cents for USD, fils for KWD) and every conversion takes
the currency explicitly, with no default, because `1250` at the wrong scale is a silent
100x error. Every write is `valueInputOption: RAW`, so a note of `=SUM(A:A)` stays
literal text and dates are never reformatted.

Deletes are soft — `deleted_at` is stamped and the row filtered out client-side — because
the Sheets API addresses rows by index, so a hard delete would shift every row below it
out from under the other person's cached positions. Undo is therefore one cell write, and
the manual **compact** action is the only hard delete.

### `config` tab

Key/value pairs in columns A and B under a `key`/`value` header row that the parser
ignores. A missing, blank or unparseable value falls back to the default in
`src/config.js`; the fallback currency is JPY.

| Key | Example | Notes |
| --- | --- | --- |
| `person1_name` / `person2_name` | `Alex` | Display names |
| `person1_email` / `person2_email` | `alex@example.com` | Matched against the signed-in Google address to tell who is using the app |
| `currency` | `JPY` | ISO 4217, per-sheet. Also the scale for any row with a blank currency cell |
| `categories` | `Groceries, Dining, Household` | Comma-separated; an empty list never shadows the default |
| `default_split_p1` / `default_split_p2` | `80` / `20` | The payer's own share on a new expense, as a percentage or a fraction — anything above 1 reads as a percentage |
| `note_presets` | `OK Mart, Ozeki, Life` | Frequent shops, offered as one-tap chips on the note field |

The two split keys are independent and need not sum to 100: only the *payer's* key is
read, so `80`/`20` means person 1 covers 80% of what they paid for and person 2 covers
20% of what they paid for. A missing key means an even split for that person alone.

Currency is per-sheet and lives here. The interface language (English or Japanese) and
the accent colour are per-device, in `localStorage`, never in the sheet — nothing written
to the sheet is localized or device-dependent.

## Security model

**The two build-time values are public, and that is correct.** `VITE_GOOGLE_CLIENT_ID`
and `VITE_GOOGLE_API_KEY` are inlined into the bundle by Vite, and a browser OAuth client
has no secret to hide. The client ID is protected by its **Authorized JavaScript origins**
list, the API key by an HTTP-referrer plus API restriction. They are Actions *variables*,
not secrets, for the same reason.

**The scope grants no general Drive access.** `drive.file` reaches only files the user
picks in the Google Picker plus files the app created, and cannot enumerate your other
spreadsheets; `openid` and `userinfo.email` reveal the signed-in address and nothing else.
All three are non-sensitive, so no verification review is needed. The grant is per-person
*and* per-file, which is why the Picker exists.

**The access token is cached in `localStorage`, deliberately.** A stored bearer token is
readable by any XSS on this origin, accepted because GIS issues tokens only through a
popup and a popup needs a click — not caching means signing in on every page load. The
ceiling is Google's either way: about an hour, no refresh token in the browser flow, and
anything malformed or expired discarded on load.

**Access control is Google's.** Share the sheet with exactly the two accounts as Editors
and leave general access **Restricted**; *Anyone with the link* makes the whole database
readable to anyone who sees the URL. Both are full Editors, so either can edit or delete
the other's entries. Nothing here touches a bank — entries are typed by hand.

**The CSP in `index.html` is an allowlist, not boilerplate.** `default-src` is `'self'`;
`script-src`, `connect-src`, `frame-src` and `img-src` name only Google's auth, API and
Picker hosts, plus `data:`/`blob:` images for the inline favicon; `font-src` is `'self'`;
`base-uri`, `object-src` and `form-action` are `'none'`; `style-src` allows
`'unsafe-inline'`. Adding a Google host means editing that tag.

## Cost

$0/month on permanent free tiers — nothing to cancel, no card on file.

| Thing | Cost |
| --- | --- |
| GitHub Pages, GitHub Actions | Free for public repos |
| Google Cloud project | Free; no billing account required |
| Sheets, Drive and Picker APIs | Not billed. Quotas are rate limits, not charges, and two people entering groceries never approach them |
| Storage | The sheet counts against its owner's Drive quota — a few thousand rows of text is a rounding error |

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`: `npm ci`, `npm test`, build,
upload a Pages artifact, deploy. Two things must be set once in the repo settings.
**Settings > Pages > Source** must be **GitHub Actions** — under "Deploy from a branch"
Pages publishes the repository tree verbatim and ignores the artifact, and the tell is a
404 for `/src/main.jsx`, the dev-only script tag in the source `index.html`. **Settings
> Secrets and variables > Actions > Variables** must hold `VITE_GOOGLE_CLIENT_ID` and
`VITE_GOOGLE_API_KEY`; they are read at build time, so a run predating them ships empty
strings and the app reports a missing client ID.

`vite.config.js` sets `base` to `/verbose-octo-pancake/`, because a project Pages site
serves from `/<repo>/`. Rename the repo without updating it and the page is blank with
console 404s for `/assets/index-*.js` missing that prefix. Build with `VITE_BASE=/` for a
user site or a custom domain.

The app installs to an iOS Home Screen (**Share > Add to Home Screen**):
`public/manifest.webmanifest` declares `display: standalone` and the PNG icons, and
`index.html` carries the `apple-touch-icon` link and the `apple-mobile-web-app-*` meta
tags Safari still reads. There is deliberately no service worker — iOS needs none for
installability, and one would add cache-invalidation risk to each deploy.

## Development

Do the Google Cloud setup first; without it the app cannot do anything.

```sh
git clone https://github.com/huangwaylon/verbose-octo-pancake.git
cd verbose-octo-pancake
npm install --registry=https://registry.npmjs.org
cp .env.example .env   # paste the client ID and API key
npm run dev            # http://localhost:5173
```

The explicit registry is not decoration: a bare `npm install` behind a private mirror
bakes internal hosts into every `resolved` URL in `package-lock.json`, which works
locally and fails on a GitHub runner, and `test/lockfile.test.js` fails the build if it
happens. Port 5173 is Vite's default and is the origin registered with Google, so a
fallback port will not authenticate.

Scripts: `dev` (Vite on 5173), `build` (bundle into `dist/`), `preview` (serve the built
`dist/`), `test` (vitest, single run), `test:watch` (vitest in watch mode).

A green suite says nothing about whether the page looks right — the donut chart once
shipped white-on-white with every test passing. `npx vite-node scripts/preview.jsx`
renders the signed-in surface with the real stylesheets to `scripts/preview-{en,ja}.html`
plus one file per accent preset; load them in `<iframe>`s at phone and desktop widths, so
media queries resolve honestly.

## Layout

| Path | |
| --- | --- |
| `index.html` | entry HTML, the CSP, the manifest and Home Screen tags |
| `vite.config.js` | Pages base path, React plugin, vitest config |
| `public/` | `manifest.webmanifest` and the PNG app icons, copied verbatim into `dist/` |
| `src/schema.js` | the sheet contract: columns, ranges, row ↔ entry mapping |
| `src/config.js` | build-time values, OAuth scope, defaults, `localStorage` wrappers |
| `src/lib/sheets.js` | every Sheets API call, and the config-tab field list |
| `src/lib/money.js` | integer minor units: parse, format, split, ISO 4217 exponents |
| `src/lib/balance.js` | who-owes-whom and the month aggregates; pure |
| `src/lib/{googleAuth,picker}.js` | the GIS token flow and cached token; the Picker and sheet creation |
| `src/lib/{identity,dates,theme}.js` | who is signed in and their default split; ISO date helpers; accent presets |
| `src/state/` | `useAuth`, `useLedger` (optimistic CRUD, throttled focus refresh), `useToasts` |
| `src/i18n/`, `src/components/`, `src/styles/` | engine and `en`/`ja` catalogs; one file per view with inline-SVG icons and chart; `tokens`/`base`/`primitives`/`app` in that order |
| `test/`, `scripts/preview.jsx` | vitest specs; the static-HTML visual harness |
| `.github/workflows/deploy.yml` | test, build, deploy to Pages |
