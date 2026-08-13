# Shared Finances

A static React app for two people to track shared expenses, with a single Google Sheet as
the database. There is no sign-in: a ~25-line Apps Script web app, owned by a dedicated
account that owns the sheet, mints short-lived Google tokens for whoever presents a shared
app key, and the browser then talks straight to the Sheets API. Google Cloud setup is in
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
settlements never count toward spend totals or category breakdowns. Nothing in the
interface writes one: we settle by wire transfer, which lands on a card statement and
comes back in as ordinary spend, so the balance converges without a settle-up flow. Rows
already carrying the type still read, display and edit correctly. Amounts are integer
minor units (whole yen for JPY, cents for USD, fils for KWD) and every conversion takes
the currency explicitly, with no default, because `1250` at the wrong scale is a silent
100x error. Every write is `valueInputOption: RAW`, so a note of `=SUM(A:A)` stays
literal text and dates are never reformatted.

Both people are full Editors of one sheet, and edits are **last-write-wins**: an
entry saved from two devices at once keeps whichever write landed second, with no
conflict prompt. Deliberate for two people who can just ask each other, and the
reason every write re-resolves its row by id first.

Deletes are soft — `deleted_at` is stamped and the row filtered out client-side — because
the Sheets API addresses rows by index, so a hard delete would shift every row below it
out from under the other person's cached positions. Deleting therefore asks for
confirmation first and is then one cell write, reversible from the collapsed **Deleted**
section at the bottom of the month being viewed; the manual **compact** action is the only
hard delete, and the only thing that spans every month at once.

### `config` tab

Key/value pairs in columns A and B under a `key`/`value` header row that the parser
ignores. A missing, blank or unparseable value falls back to the default in
`src/config.js`; the fallback currency is JPY.

| Key | Example | Notes |
| --- | --- | --- |
| `person1_name` / `person2_name` | `Alex` | Display names |
| `currency` | `JPY` | ISO 4217, per-sheet. Also the scale for any row with a blank currency cell |
| `categories` | `Groceries, Dining, Household` | Comma-separated; an empty list never shadows the default |
| `default_split_p1` / `default_split_p2` | `80` / `20` | The payer's own share on a new expense, as a percentage or a fraction — anything above 1 reads as a percentage |
| `note_presets` | `OK Mart, Ozeki, Life` | Frequent shops, offered as one-tap chips on the note field |

The two split keys are independent and need not sum to 100: only the *payer's* key is
read, so `80`/`20` means person 1 covers 80% of what they paid for and person 2 covers
20% of what they paid for. A missing key means an even split for that person alone.

Currency is per-sheet and lives here. The interface language (English or Japanese), the
accent colour, and which of the two people this device belongs to are all per-device, in
`localStorage`, never in the sheet — nothing written to the sheet is localized or
device-dependent. Nothing detects who is using the app, because the access token belongs
to the account that owns the sheet rather than to either person.

## Security model

Replacing browser OAuth with a shared app key made the session never expire, which was
the whole point. It also made the credential on each device *permanent* rather than
hour-limited, widened the token's reach from one picked file to every spreadsheet the
dedicated account can see, and removed remote revocation. In exchange it deleted every
third-party script from the page. Roughly neutral, and acceptable only under the four
conditions below.

**The dedicated account must own exactly one spreadsheet, forever.** The minted token
carries `spreadsheets`, so confinement is not enforced by the scope — it is enforced by
that account having nothing else to reach. Sharing a second sheet with it silently widens
the blast radius and nothing in this repository will notice.

**The app key is the only access control, and the endpoint URL is not a secret.**
`VITE_SCRIPT_URL` is inlined into the public bundle, so assume the endpoint is known.
Brute force is not a concern — 256 bits against a ~30 requests/second ceiling — but
**quota exhaustion is, and it is unfixable here.** Anonymous traffic bills the owner's
Apps Script quota before any of our code runs, and Apps Script exposes no client IP, so no
in-script throttle can help. The impact is availability only: writes fail, the endpoint
returns HTML instead of JSON, the app falls back to cached data, and it self-heals when the
quota resets. Accepted rather than engineered against; recorded because the symptom is
otherwise indistinguishable from a bug.

**Key rotation is the only incident response, and it is a documented minute.** See the end
of [SETUP.md](SETUP.md). It stops new tokens at once; one already issued lives out its
hour, which cannot be helped without moving the reads and writes into the script itself.

**`localStorage` is scoped to the origin, not the path.** Every other site published from
`huangwaylon.github.io` can read the app key. That is knowingly accepted, and it means
nothing untrusted — in particular nothing loading third-party scripts — may be published
from that GitHub Pages account.

**The CSP is now strict enough that no third-party JavaScript runs at all.**
`script-src 'self'`, `frame-src 'none'`, and `connect-src` naming only `'self'`, the
Sheets API and the two Apps Script hosts. `script.googleusercontent.com` looks redundant next to
`script.google.com` and is not: `/exec` answers with a 302 to it. One caveat worth knowing
— a `<meta>` CSP does not cover a service worker's own execution context, and Pages sends
no CSP header, which is exactly why the service worker never intercepts a cross-origin
request.

**Access control on the sheet is Google's.** Owned by the dedicated account, shared
with the two people as Editors, general access **Restricted**.

## Cost

$0/month, nothing to cancel and no card on file. Pages and Actions are free for public
repos; the Cloud project needs no billing account and exists only to enable the Sheets
API; neither Apps Script nor the Sheets API is billed, and their quotas are rate limits
two people entering groceries never approach. The sheet counts against the dedicated
account's Drive quota, which a few thousand rows of text does not trouble.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`: `npm ci`, `npm test`, build,
upload a Pages artifact, deploy. Two repo settings have to be right for any of it to land —
the Pages source and the `VITE_SCRIPT_URL` variable — both in **SETUP.md** step 7, with the
symptoms each wrong setting produces.

`vite.config.js` sets `base` to `/verbose-octo-pancake/`, because a project Pages site
serves from `/<repo>/`. Rename the repo without updating it and the page is blank with
console 404s for `/assets/index-*.js` missing that prefix. Build with `VITE_BASE=/` for a
user site or a custom domain — `scripts/build-sw.js` reads the same variable, so the
service worker's scope follows.

The app installs to an iOS Home Screen (**Share > Add to Home Screen**):
`public/manifest.webmanifest` declares `display: standalone` and the PNG icons, and
`index.html` carries the `apple-touch-icon` link and the `apple-mobile-web-app-*` meta
tags Safari still reads.

### Launch speed

Two caches, and between them a cold launch does no network work at all.

`npm run build` runs `scripts/build-sw.js`, which walks `dist/` and emits a service
worker precaching every file in it — worth having even though the assets are
content-hashed, because Pages serves them with `max-age=600` and cannot be told otherwise.
Why it walks the tree and hashes contents rather than names is a rule for future edits, so
it lives in CLAUDE.md.

`src/lib/snapshot.js` keeps the last successful read in `localStorage`, and `useLedger`
paints from it before requesting anything. A launch with no network therefore shows the
real ledger with a "showing saved data" notice rather than an error screen — with data on
screen before any network call, offline included.

Updates activate by reloading, which `src/lib/serviceWorker.js` only does when no entry is
half-typed and no write is in flight. It also calls `registration.update()` when the app
returns to the foreground: an installed iOS web app resumed from the app switcher never
navigates, so without that a new version could wait unactivated for weeks.

## Development

Do the Google setup first; without it the app cannot do anything.

```sh
git clone https://github.com/huangwaylon/verbose-octo-pancake.git
cd verbose-octo-pancake
npm install --registry=https://registry.npmjs.org
cp .env.example .env   # paste the /exec URL of your token endpoint
npm run dev            # http://localhost:5173/verbose-octo-pancake/
```

The explicit registry is required — a bare `npm install` behind a private mirror bakes
internal hosts into `package-lock.json` and fails on a GitHub runner. CLAUDE.md has the
regeneration recipe; `test/lockfile.test.js` fails the build if it happens.

The scripts are listed in CLAUDE.md. One caveat that is not obvious: the service worker
only exists in a build, so exercising it means `npm run build && npm run preview`, and
`preview` registers a real worker on port 4173 — shared with every other Vite project on
the machine.

A green suite says nothing about whether the page looks right; `npx vite-node
scripts/preview.jsx` writes eight static pages with the real stylesheets, and CLAUDE.md
says how to view them.

## Layout

| Path | |
| --- | --- |
| `index.html` | entry HTML, the CSP, the manifest and Home Screen tags |
| `vite.config.js` | Pages base path, React plugin, vitest config |
| `apps-script/` | the token endpoint: `Code.gs` and its manifest, deployed by hand |
| `public/` | `manifest.webmanifest` and the PNG app icons, copied verbatim into `dist/` |
| `src/schema.js` | the sheet contract: columns, ranges, row ↔ entry mapping |
| `src/config.js` | build-time values, storage keys, defaults and their merge, `localStorage` wrappers |
| `src/lib/sheets.js` | every Sheets API call, and the config-tab field list |
| `src/lib/money.js` | integer minor units: parse, format, split, ISO 4217 exponents |
| `src/lib/balance.js` | who-owes-whom and the month aggregates; pure |
| `src/lib/connection.js` | the app key, the minted token, and the failure taxonomy |
| `src/lib/snapshot.js` | the launch cache: last successful read, kept on the device |
| `src/lib/serviceWorker.js` | registration, and when it is safe to activate an update |
| `src/lib/{identity,dates,theme}.js` | which person this device is, and their default split; ISO date helpers; accent presets |
| `src/state/` | `useConnection`, `useLedger` (optimistic CRUD, throttled focus refresh), `useToasts` |
| `src/i18n/`, `src/components/`, `src/styles/` | engine and `en`/`ja` catalogs; one file per view with inline-SVG icons and chart; `tokens`/`base`/`primitives`/`app` in that order |
| `test/`, `scripts/preview.jsx` | vitest specs; the static-HTML visual harness |
| `scripts/build-sw.js` | walks `dist/` and emits the service worker; importable, so its two silent failure modes are tested |
| `.github/workflows/deploy.yml` | test, build, deploy to Pages |
