# Shared Finances

A static React app for two people to track shared expenses, with a single Google Sheet as
the database. It is built for one place: Safari on iOS, added to the Home Screen, on a
phone. There is no sign-in: a small Apps Script web app, owned by a dedicated
account that owns the sheet, mints short-lived Google tokens for whoever presents a shared
app key, and the browser then talks straight to the Sheets API. Google Cloud setup is in
[SETUP.md](SETUP.md); the invariants that fail silently if broken are in
[CLAUDE.md](CLAUDE.md).

## Data model

One spreadsheet, four tabs — `expenses_p1`, `expenses_p2`, `settlements`, `config` —
laid out in exactly one place, `src/schema.js`. Each person has their own expenses tab, so
which tab an expense lives in *is* the payer and no column can disagree with it. Row 1 is
the header, data starts at row 2, and editing an expense to change who paid appends it to
the other person's tab and tombstones the original row — in that order, so a failure
between the two leaves the entry visible rather than gone. Both rows then carry the same
id until a compact runs, and the client keeps the live one.

Settlements get one tab rather than two, because there are few of them and none are
typed by the app. That tab cannot say who paid the way an expenses tab does, so it has
the schema's only `payer` column — and its own narrower layout, since a transfer needs
no category and its share is 0 by definition. A settlement's payer being a cell has one
pleasant consequence: changing it overwrites that cell instead of moving the row.

`expenses_p1` and `expenses_p2`, ordered to match the bank's own CSV export
(取引日 / 摘要 / 引出額) so a pasted statement lands under the right headings:

| Col | Field | Example | Notes |
| --- | --- | --- | --- |
| A | `date` | `2026-08-05` | ISO `YYYY-MM-DD`, checked for calendar validity — `2026-02-31` reads as unset |
| B | `description` | `weekly shop` | Free text, stored literally |
| C | `amount` | `1250` | Whole yen, digits only. A typed decimal is rounded half-up, so the bank export's `1400.000000` reads as ¥1400 |
| D | `category` | `Groceries` | Required for an expense |
| E | `payer_share` | `0.5` | Share of the entry the payer covers themselves; `1` means nobody owes them. Read like the `default_split` keys, so anything above 1 is a percentage |
| F | `deleted_at` | *(empty)* | A timestamp here soft-deletes the row. The only timestamp a row carries |
| G | `id` | `9f1c…` | UUID, from the browser or from `scripts/bank_to_ledger.py`. Last, because it is bookkeeping rather than anything to read |

`settlements` is narrower — a transfer needs no category, and its share is 0 by
definition:

| Col | Field | Example | Notes |
| --- | --- | --- | --- |
| A | `date` | `2026-08-05` | as above |
| B | `description` | `Rent` | as above |
| C | `amount` | `85000` | as above |
| D | `payer` | `p1` | Who sent the money. The schema's only `payer` column, because one tab cannot say it; case-folded on read, and a value naming neither person is reported rather than guessed |
| E | `deleted_at` | *(empty)* | as above |
| F | `id` | `4ee5…` | as above |

In memory a settlement is still just an entry with a `payer_share` of `0` — the payer is
owed all of it — so the balance is one sum over every row and the arithmetic has no
settlement branch; settlements never count toward spend totals or category breakdowns.
Nothing in the interface writes one: we settle by wire transfer, which lands on a card
statement and comes back in as ordinary spend, so the balance converges without a
settle-up flow. Rows already there still read, display and edit correctly. The ledger is
**yen only**: the yen has no sub-unit, so an amount is simply an integer number of yen
and there is no scale anywhere to get wrong. Every write is `valueInputOption: RAW`, so a
note of `=SUM(A:A)` stays literal text and dates are never reformatted. A row the app
cannot fully read — an unparseable amount, a date the spreadsheet stored in its own
locale, a renamed `config` tab — is counted and reported on screen, because a ledger
quietly short one expense is worse than a notice.

A row records no `created_at` or `updated_at`. The transaction date is the fact worth
keeping, and neither stamp was ever displayed — so the only timestamp left is
`deleted_at`, which doubles as the tie-break when a payer move has left two tombstones
under one id. Within a day the list orders by id: arbitrary, but stable, and independent
of which tab the rows arrived from.

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
`src/config.js`.

| Key | Example | Notes |
| --- | --- | --- |
| `person1_name` / `person2_name` | `Alex` | Display names |
| `categories` | `Groceries, Dining, Household` | Comma-separated; an empty list never shadows the default |
| `default_split_p1` / `default_split_p2` | `80` / `20` | The payer's own share on a new expense, as a percentage or a fraction — anything above 1 reads as a percentage |
| `note_presets` | `OK Mart, Ozeki, Life` | Frequent shops, offered as one-tap chips on the note field |

The two split keys are independent and need not sum to 100: only the *payer's* key is
read, so `80`/`20` means person 1 covers 80% of what they paid for and person 2 covers
20% of what they paid for. A missing key means an even split for that person alone.

The interface language (English or Japanese), the accent colour, and which of the two
people this device belongs to are all per-device, in `localStorage`, never in the sheet —
nothing written to the sheet is localized or device-dependent. Nothing detects who is
using the app, because the access token belongs to the account that owns the sheet rather
than to either person.

## Security model

A shared app key instead of browser OAuth is what makes the session never expire, which is
the whole point. The trade is real: the credential on each device is *permanent* rather
than hour-limited, the token reaches every spreadsheet the dedicated account can see rather
than one picked file, there is no remote revocation, and in return no third-party script
loads on the page at all. Roughly neutral, and acceptable only because of what follows —
three standing conditions, one accepted risk, and the properties of the build that make
them survivable.

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

**The CSP is strict enough that no third-party JavaScript runs at all.**
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

Pushing to `main` runs `.github/workflows/deploy.yml`: `npm ci`, `npm run format:check`,
`npm test`, build, upload a Pages artifact, deploy. Two repo settings have to be right for
any of it to land — the Pages source and the `VITE_SCRIPT_URL` variable — both in
**SETUP.md** step 7, with the symptoms each wrong setting produces.

`base.js` sets the base path to `/verbose-octo-pancake/`, because a project Pages site
serves from `/<repo>/`. Both `vite.config.js` and `scripts/build-sw.js` read it from there,
so the bundle's asset URLs and the service worker's precache list cannot disagree. Rename
the repo without updating that one line and the page is blank with console 404s for
`/assets/index-*.js` missing the prefix. Build with `VITE_BASE=/` for a user site or a
custom domain.

### On a phone

The only target. The install is **Share → Add to Home Screen**:
`public/manifest.webmanifest` declares `display: standalone`, and `index.html` carries
`viewport-fit=cover`, the `apple-touch-icon` link and the `apple-mobile-web-app-*` meta
tags Safari still reads.

Standalone changes what can go wrong, and the rules that follow from it are in
CLAUDE.md's Platform section: the keyboard covers a fixed footer without shrinking the
viewport `dvh` reads, `:hover` latches after a tap, a flick from the top reloads the app
out from under a half-typed entry, and safe-area insets are the app's problem because
there is no browser chrome to absorb them. The entry form takes the whole screen there,
which makes that last one its problem too. Layout is decided at 320px; `npx vite-node
scripts/preview.jsx` writes seventeen pages for checking it, two of them deliberately
pathological.

### Launch speed

Two caches, and between them a cold launch paints the real ledger before any network
reply.

`npm run build` runs `scripts/build-sw.js`, which walks `dist/` and emits a service
worker precaching every file in it — worth having even though the assets are
content-hashed, because Pages serves them with `max-age=600` and cannot be told otherwise.
Why it walks the tree and hashes contents rather than names is a rule for future edits, so
it lives in CLAUDE.md.

`src/lib/snapshot.js` keeps the last successful read in `localStorage`, and `useLedger`
paints from it before requesting anything. A launch with no network therefore shows the
real ledger with a "showing saved data" notice rather than an error screen — with data on
screen before any network call, offline included.

The one request that cannot wait is the token, because everything after it is serialized:
token, then the sheet read, then fresh figures. `src/main.jsx` starts it before the first
React render rather than from an effect, which would have added the whole first paint to
the wait — and that paint grows with the cached ledger.

Updates activate by reloading, which `src/lib/serviceWorker.js` only does when no entry is
half-typed and no write is in flight. It also calls `registration.update()` when the app
returns to the foreground: an installed iOS web app resumed from the app switcher never
navigates, so without that a new version could wait unactivated for weeks. An update
refused because a form was open is reconsidered the moment that form closes, since
somebody who never leaves the app produces no foreground event to ask again.

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
scripts/preview.jsx` writes seventeen static pages with the real stylesheets, and
`scripts/frames.html` renders a page at several widths at once with the measurements
printed underneath — including, on a page carrying a sheet, whether Save still clears a
simulated keyboard. CLAUDE.md has the invocation.

## Layout

| Path | |
| --- | --- |
| `index.html` | entry HTML, the CSP, the manifest and Home Screen tags |
| `base.js`, `vite.config.js` | the Pages base path, in one place; React plugin and vitest config |
| `src/components/LedgerScreen.jsx` | the whole signed-in surface; `App`, the visual harness and one render test are its three callers |
| `src/lib/viewport.js` | how much of the layout viewport the software keyboard covers |
| `apps-script/` | the token endpoint: `Code.gs` and its manifest, deployed by hand |
| `public/` | `manifest.webmanifest` and the PNG app icons, copied verbatim into `dist/` |
| `src/schema.js` | the sheet contract: columns, ranges, row ↔ entry mapping |
| `src/config.js` | build-time values, storage keys, defaults and their merge, `localStorage` wrappers |
| `src/lib/sheets.js` | every Sheets API call |
| `src/lib/sheetConfig.js` | the `config` tab: the key map, one parser per kind, and what a fresh tab is seeded with |
| `src/lib/money.js` | whole yen: parse, format, split, sum |
| `src/lib/balance.js` | who-owes-whom and the month aggregates; pure |
| `src/lib/connection.js` | the app key, the minted token, and the failure taxonomy |
| `src/lib/snapshot.js` | the launch cache: last successful read, kept on the device |
| `src/lib/serviceWorker.js` | registration, and when it is safe to activate an update |
| `src/lib/ledgerState.js` | the optimistic list transitions, the status decisions, and duplicate-id reconciliation; pure |
| `src/lib/split.js` | the payer's default share and the split control's transitions; pure |
| `src/lib/{identity,dates,theme}.js` | which person this device is; ISO date helpers; accent presets |
| `src/state/` | `useConnection`, `useLedger` (optimistic CRUD, throttled focus refresh), `useLedgerView` (every derived figure), `useToasts`, `useKeyboardInset` |
| `src/i18n/`, `src/components/`, `src/styles/` | engine and `en`/`ja` catalogs; one file per view with inline-SVG icons and chart; `tokens`/`base`/`primitives`/`app` in that order |
| `test/`, `scripts/preview.jsx` | vitest specs; the static-HTML visual harness |
| `scripts/frames.html` | views a preview page at several widths and heights, measuring each rather than eyeballing it |
| `scripts/build-sw.js` | walks `dist/` and emits the service worker; importable, so its silent failure modes are tested |
| `.github/workflows/deploy.yml` | test, build, deploy to Pages |
