# Shared Finances

A static React app for two people to track shared expenses, with a single Google Sheet as
the database. It is built for one place: Safari on iOS, added to the Home Screen, on a
phone. There is no sign-in: a small Apps Script web app, owned by a dedicated
account that owns the sheet, mints short-lived Google tokens for whoever presents a shared
app key, and the browser then talks straight to the Sheets API. The same script holds an
optional daily trigger that posts recurring costs. Google Cloud setup is in
[SETUP.md](SETUP.md); the invariants that fail silently if broken are in
[CLAUDE.md](CLAUDE.md).

## Data model

One spreadsheet, five tabs — `expenses_p1`, `expenses_p2`, `settlements`, `recurring`,
`config` — laid out in exactly one place, `src/schema.js`. Each person has their own expenses
tab, so which tab an expense lives in *is* the payer and no column can disagree with it. Row 1
is the header, data starts at row 2, and editing an expense to change who paid appends it to
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

In memory a settlement is just an entry with a `payer_share` of `0` — the payer is owed all
of it — so the balance is one sum over every row and the arithmetic has no settlement branch.
Settlements never count toward spend totals or category breakdowns. Nothing in the interface
writes one: we settle by wire transfer, which comes back in as ordinary spend, so the balance
converges without a settle-up flow. Rows already there still read, display and edit.

The ledger is **yen only**: the yen has no sub-unit, so an amount is an integer number of yen
and there is no scale to get wrong. Every write is `valueInputOption: RAW`, so a note of
`=SUM(A:A)` stays literal text and dates are never reformatted, and every append names an
explicit `A2:…` range rather than the tab — `values.append` picks its own starting column
otherwise. A row the app cannot fully
read — an unparseable amount, a date the spreadsheet stored in its own locale, a renamed
`config` tab — is counted and reported on screen: a ledger quietly short one expense is worse
than a notice.

A row records no `created_at` or `updated_at`; the transaction date is the fact worth keeping.
The only timestamp is `deleted_at`, which doubles as the tie-break when a payer move has left
two tombstones under one id. Within a day the list orders by id — arbitrary, but stable, and
independent of which tab the rows arrived from.

Both people are full Editors of one sheet, and edits are **last-write-wins**: an entry saved
from two devices at once keeps whichever write landed second, with no conflict prompt.
Deliberate for two people who can ask each other, and the reason every write re-resolves its
row by id first.

Deletes are soft — `deleted_at` is stamped and the row filtered out client-side — because the
Sheets API addresses rows by index, so a hard delete would shift every row below it out from
under the other person's cached positions. Deleting asks for confirmation and is then one cell
write, reversible from the collapsed **Deleted** section at the bottom of the month being
viewed. The manual **compact** action is the only hard delete of an entry, and the only thing
that spans every month at once.

### `recurring` tab

Rent, the gym, a subscription: costs whose amount and split are known in advance, where the
only real failure mode is forgetting to type them. The tab is a **declaration** of what
recurs, not a log of what happened — it holds no date and no `deleted_at`.

**Settings → Recurring costs** is the interface: add, edit, stop or restart, and — behind a
confirmation — delete a cost. Rows can still be authored by hand, and columns F, H and I only
can be: quarterly and annual schedules are rare enough that three more controls would earn
their place on nobody's phone. The form **keeps** them, so editing a quarterly cost does not
silently make it monthly.

| Col | Field | Example | Notes |
| --- | --- | --- | --- |
| A | `description` | `Rent` | What the entry's note will say |
| B | `amount` | `220000` | Blank means recurring but **variable** — a utility bill. The page lists it with no figure and the form opens empty |
| C | `category` | `Rent` | Blank falls through to the first configured category |
| D | `payer` | `p1` | Whose tab the instance lands in; case-folded on read |
| E | `payer_share` | `80` | As in the expense column. Blank means "follow that payer's `default_split`" — **not** an even split |
| F | `months` | `1, 7` | Blank means every month; `1,7` covers annual and quarterly. There is no weekly: the app is month-scoped throughout |
| G | `day_of_month` | `27` | Nothing is offered before its day, and 31 is clamped to the month's last day. Blank means the 1st |
| H | `active_from` | `2026-04` | Month keys, so an ended lease stops nagging without deleting what it cost. Both blank means always |
| I | `active_to` | `2027-03` | as above |
| J | `id` | `rent` | Minted by the app; yours to invent by hand. It has to be stable — see below |

A blank cell takes its default; a cell that was **filled in and cannot be read refuses the
whole row**, and so does a second row carrying an id an earlier row already used. Both are
counted and reported on screen. That is the opposite of the `config` tab, where an unreadable
value quietly falls back, because a default here either moves money or stops a cost being
offered at all.

A month's instance of a template gets the deterministic id `<template id>#<YYYY-MM>` — so
`rent#2026-09`. That id, present in either expenses tab, **live or tombstoned**, is the whole
of "already recorded": deleting a rent that was double-charged marks the month handled rather
than re-offering it. It is derived rather than matched on category and description, both of
which are fields a person edits: renaming a note to `Rent (Aug)` would otherwise post a second
rent, and two templates sharing a category and a note — one gym membership each — would
collapse into one.

Two writers use that id and neither can post a month twice:

- **The app**, on the recurring page: every cost is listed with what the month on screen says
  about it — recorded, due now, not yet due, or not scheduled — and a **Record** button
  wherever there is something to record. A tap prefills the ordinary entry form, so a person
  confirms the figure and Save is the same optimistic write as any other. Nothing auto-posts
  here. The page is scoped to the month the ledger is showing, so a month missed while nobody
  was recording stays recordable.
- **`postRecurring`** in the Apps Script project runs on a daily trigger, so rent lands even if
  nobody opens the app for a month. It is deliberately stricter: it only posts a template that
  spells out **both** its amount and its share, because anything left blank is a figure a
  person should confirm. `SETUP.md` step 9 sets it up.

Daily rather than on the 1st, because Google can delay or skip a scheduled run and every run
after the first is a no-op. The recurring page is also what tells you the poster has died,
since a row it should have written still shows a Record button there.

There are **two ways to stop a cost**, and they differ in what the sheet remembers. Both live on
the cost's own form: stopping in the footer, deleting last in the body behind a confirmation.

**Stopping it** sets `active_to`. The row stays, so its id stays, so every month it has already
posted stays recorded — and it is reversible from the same control. This is the one to use.

**Deleting it** removes the row. The entries it already added stay in your ledger; what is lost
is the sheet's memory of *which months it covered*. Add the same cost back afterwards —
necessarily under a new id — and a month already paid reads as unrecorded, which is enough for
the trigger to post it a second time.

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
the whole point. The trade is real: the credential on each device is *permanent* rather than
hour-limited, the token reaches every spreadsheet the dedicated account can see rather than
one picked file, and there is no remote revocation — in return no third-party script loads on
the page at all. Roughly neutral, and acceptable only because of what follows.

**The dedicated account must own exactly one spreadsheet, forever.** The minted token
carries `spreadsheets`, so confinement is not enforced by the scope — it is enforced by
that account having nothing else to reach. Sharing a second sheet with it silently widens
the blast radius and nothing in this repository will notice.

**The app key is the only access control, and the endpoint URL is not a secret.**
`VITE_SCRIPT_URL` is inlined into the public bundle, so assume the endpoint is known. Brute
force is not a concern — 256 bits against a ~30 requests/second ceiling — but **quota
exhaustion is, and it is unfixable here.** Anonymous traffic bills the owner's Apps Script
quota before any of our code runs, and Apps Script exposes no client IP, so no in-script
throttle can help. The impact is availability only: writes fail, the endpoint returns HTML
instead of JSON, the app falls back to cached data, and it self-heals when the quota resets.
Recorded because the symptom is otherwise indistinguishable from a bug.

**Key rotation is the only incident response, and it is a documented minute.** See the end
of [SETUP.md](SETUP.md). It stops new tokens at once; one already issued lives out its
hour, which cannot be helped without moving the reads and writes into the script itself.

**`localStorage` is scoped to the origin, not the path.** Every other site published from
`huangwaylon.github.io` can read the app key. That is knowingly accepted, and it means
nothing untrusted — in particular nothing loading third-party scripts — may be published
from that GitHub Pages account.

**The CSP is strict enough that no third-party JavaScript runs at all.**
`script-src 'self'`, `frame-src 'none'`, and `connect-src` naming only `'self'`, the Sheets API
and the two Apps Script hosts. `script.googleusercontent.com` looks redundant next to
`script.google.com` and is not: `/exec` answers with a 302 to it. One caveat — a `<meta>` CSP
does not cover a service worker's own execution context, and Pages sends no CSP header, which
is why the service worker never intercepts a cross-origin request.

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

Standalone changes what can go wrong: the keyboard covers a fixed footer without shrinking
the viewport `dvh` reads, `:hover` latches after a tap, a flick from the top reloads the app
out from under a half-typed entry, and safe-area insets are the app's problem because there is
no browser chrome to absorb them. Those rules are in CLAUDE.md's Platform section. Layout is
decided at 320px; `npx vite-node scripts/preview.jsx` writes twenty-six pages for checking it,
four of them deliberately pathological.

### Launch speed

Two caches, and between them a cold launch paints the real ledger before any network reply.

`npm run build` runs `scripts/build-sw.js`, which walks `dist/` and emits a service worker
precaching every file in it — worth having even though the assets are content-hashed,
because Pages serves them with `max-age=600` and cannot be told otherwise.

`src/lib/snapshot.js` keeps the last successful read in `localStorage`, and `useLedger`
paints from it before requesting anything. A launch with no network therefore shows the real
ledger with a "showing saved data" notice rather than an error screen.

The one request that cannot wait is the token, because everything after it is serialized:
token, then the sheet read, then fresh figures. `src/main.jsx` starts it before the first
React render rather than from an effect, which would have added the whole first paint to the
wait — and that paint grows with the cached ledger.

Updates activate by reloading, which `src/lib/serviceWorker.js` only does when no entry is
half-typed and no write is in flight. It also calls `registration.update()` when the app
returns to the foreground: an installed iOS web app resumed from the app switcher never
navigates, so without that a new version could wait unactivated for weeks. An update refused
because a form was open is reconsidered the moment it closes.

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

The scripts are listed in CLAUDE.md. One caveat that is not obvious: the service worker only
exists in a build, so exercising it means `npm run build && npm run preview`, and `preview`
registers a real worker on port 4173 — shared with every other Vite project on the machine.

A green suite says nothing about whether the page looks right. `npx vite-node
scripts/preview.jsx` writes twenty-six static pages with the real stylesheets, and
`scripts/frames.html` renders one at several widths at once with the measurements printed
underneath — including, on a page carrying a sheet, whether Save clears a simulated keyboard.
CLAUDE.md has the invocation.

## Layout

| Path | |
| --- | --- |
| `index.html` | entry HTML, the CSP, the manifest and Home Screen tags |
| `base.js`, `vite.config.js` | the Pages base path, in one place; React plugin and vitest config |
| `apps-script/` | the token endpoint and the recurring-cost poster: `Code.gs` and its manifest, pasted into the editor by hand |
| `src/schema.js` | the sheet contract: columns, ranges, row ↔ entry mapping |
| `src/config.js` | build-time values, storage keys, defaults and their merge, `localStorage` wrappers |
| `src/lib/sheets.js` | every Sheets API call |
| `src/lib/sheetConfig.js` | the `config` tab: the key map, one parser per kind, what a fresh tab is seeded with |
| `src/lib/money.js` | whole yen: parse, format, split, sum |
| `src/lib/balance.js` | who-owes-whom and the month aggregates; pure |
| `src/lib/ledgerState.js` | the optimistic list transitions, the status decisions, duplicate-id reconciliation; pure |
| `src/lib/recurring.js` | the `recurring` tab: what a month owes, retire/restore, what a form refuses; pure |
| `src/lib/split.js` | the payer's default share and the split control's transitions; pure |
| `src/lib/connection.js` | the app key, the minted token, and the failure taxonomy |
| `src/lib/snapshot.js` | the launch cache: last successful read, kept on the device |
| `src/lib/serviceWorker.js` | registration, and when it is safe to activate an update |
| `src/lib/viewport.js` | how much of the layout viewport the software keyboard covers |
| `src/lib/preference.js` | the per-device store the locale and the accent share |
| `src/lib/{identity,dates,theme}.js` | which person this device is; ISO date helpers; accent presets |
| `src/state/` | `useConnection`, `useLedger` (optimistic CRUD, throttled focus refresh), `useLedgerView` (every derived figure), `useToasts`, `useKeyboardInset` |
| `src/components/LedgerScreen.jsx` | the whole signed-in surface; `App`, the visual harness and one render test are its three callers |
| `src/i18n/`, `src/components/`, `src/styles/` | engine and `en`/`ja` catalogs; one file per view with inline-SVG icons and chart; `tokens`/`base`/`primitives`/`app` in that order |
| `test/` | vitest specs; shared harnesses under `test/support/` |
| `scripts/preview.jsx`, `scripts/frames.html` | the static-HTML visual harness, and the viewer that measures it at several widths |
| `scripts/build-sw.js` | walks `dist/` and emits the service worker; importable, so its silent failure modes are tested |
| `scripts/bank_to_ledger.py` | turns a bank CSV into pasteable rows; one of the two places outside `schema.js` that knows a column list |
| `.github/workflows/deploy.yml` | test, build, deploy to Pages |
