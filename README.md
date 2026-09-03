# Shared Finances

A static React app for two people to track shared expenses, with one Google Sheet as the database; the
target is Safari on iOS, added to the Home Screen, on a phone. Nobody signs in: an Apps Script web app,
owned by a dedicated account that owns the sheet, mints short-lived Google tokens for whoever presents a
shared app key, the browser talks straight to the Sheets API, and an optional daily trigger in the same
script posts recurring costs. [SETUP.md](SETUP.md) has the Google setup, [CLAUDE.md](CLAUDE.md) the
invariants that fail silently.

## Data model

Five tabs — `expenses_p1`, `expenses_p2`, `settlements`, `recurring`, `config` — laid out in one place,
`src/schema.js`. Each person has their own expenses tab, so which tab an expense lives in *is* the payer,
and both match the bank's CSV export (取引日 / 摘要 / 引出額) column for column:

| Col | Field | Example | Notes |
| --- | --- | --- | --- |
| A | `date` | `2026-08-05` | ISO `YYYY-MM-DD`, checked for calendar validity — `2026-02-31` reads as unset |
| B | `description` | `weekly shop` | Free text, stored literally |
| C | `amount` | `1250` | Whole yen, digits only. A typed decimal is rounded half-up, so the bank export's `1400.000000` reads as ¥1400 |
| D | `category` | `Groceries` | Required for an expense |
| E | `payer_share` | `0.5` | Share of the entry the payer covers themselves; `1` means nobody owes them. Read like the `default_split` keys, so anything above 1 is a percentage |
| F | `deleted_at` | *(empty)* | A timestamp here soft-deletes the row. The only timestamp a row carries |
| G | `id` | `9f1c…` | UUID, from the browser or from `scripts/bank_to_ledger.py`. Last, because it is bookkeeping rather than anything to read |

`settlements` gets one tab, not two — there are few, none typed by the app — and it is narrower, because a
transfer needs no category and its share is 0 by definition.

| Col | Field | Example | Notes |
| --- | --- | --- | --- |
| A | `date` | `2026-08-05` | as above |
| B | `description` | `Rent` | as above |
| C | `amount` | `85000` | as above |
| D | `payer` | `p1` | Who sent the money. The schema's only `payer` column, because one tab cannot say it; case-folded on read, and a value naming neither person is reported rather than guessed |
| E | `deleted_at` | *(empty)* | as above |
| F | `id` | `4ee5…` | as above |

- **A payer change appends to the other tab, then tombstones the original** — both rows carry one id until a
  compact — while a settlement's payer is a cell, so changing it overwrites rather than moves the row.
- **A settlement is an entry with `payer_share` of `0`**: the balance is one sum with no settlement branch,
  settlements never count toward spend or category totals, and nothing in the interface writes one — we
  settle by wire transfer, which comes back in as ordinary spend.
- **Yen only** (an amount is an integer number of yen), **last-write-wins** with no prompt, and any row the
  app cannot fully read is counted and reported on screen. **Deletes are soft**, because the API addresses
  rows by index: one cell write, reversible from the month's collapsed **Deleted** section; **compact** is
  the only hard delete.

### `recurring` tab

Rent, the gym, a subscription: costs known in advance, where the only failure mode is forgetting to type
them. The tab **declares** what recurs rather than logging it — no date, no `deleted_at`.

| Col | Field | Example | Notes |
| --- | --- | --- | --- |
| A | `description` | `Rent` | What the entry's note will say |
| B | `amount` | `220000` | Blank means recurring but **variable** — a utility bill. The page lists it with no figure and the form opens empty |
| C | `category` | `Rent` | Blank falls through to the first configured category |
| D | `payer` | `p1` | Whose tab the instance lands in; case-folded on read |
| E | `payer_share` | `80` | As in the expense column. Blank means "follow that payer's `default_split`" — **not** an even split |
| F | `months` | `1, 7` | Blank means every month; `1,7` covers annual and quarterly. There is no weekly: the app is month-scoped throughout |
| G | `day_of_month` | `27` | Nothing is recorded before its day unless somebody asks for it, and 31 is clamped to the month's last day. Blank means the 1st |
| H | `active_from` | `2026-04` | Month keys, so an ended lease stops nagging without deleting what it cost. Both blank means always |
| I | `active_to` | `2027-03` | as above |
| J | `id` | `rent` | Minted by the app; yours to invent by hand. It has to be stable — see below |

- **Settings → Recurring costs** adds, edits, stops, restarts and — behind a confirmation — deletes a cost;
  rows stay hand-authorable. F, H and I get no field but the form **keeps** all three. A blank cell takes
  its default; a filled-in cell that cannot be read, or a duplicate id, refuses the row and is counted.
- **A month's instance gets the id `<template id>#<YYYY-MM>`** (`rent#2026-09`), and that id in either
  expenses tab, **live or tombstoned**, is the whole of "already recorded" — so a template's id must never
  change, and deleting a double-charged rent marks the month handled.
- **Two writers, neither able to post a month twice.** The app lists every cost as recorded, due now, not
  yet due or not scheduled; **Record** prefills the ordinary entry form, early payments included, nothing
  auto-posts, and the page is scoped to the month on screen, so a missed month stays recordable and a row
  still offering Record tells you the poster has died. **`postRecurring`** runs on a daily trigger
  (`SETUP.md` step 9 — daily, since a run can be skipped and later ones are no-ops), posts only a template
  with an **amount**, resolves a blank share from the payer's `default_split`, and never runs early. The
  **ledger** reads the same id to lift the month's instances into a **Recurring costs** section, with its
  own total, above the days.
- **Two ways to stop a cost**: **stopping** (footer) sets `active_to`, keeping the row, its id and the
  record of which months it covered — reversible, and the one to use. **Deleting** (body, behind a
  confirmation) removes the row: the entries stay, that record does not, so the cost re-added under a new
  id reads a paid month as unrecorded and posts again.

### `config` tab

Key/value pairs in columns A and B under a `key`/`value` header row the parser ignores. A missing,
blank or unparseable value falls back to the default in `src/config.js`.

| Key | Example | Notes |
| --- | --- | --- |
| `person1_name` / `person2_name` | `Alex` | Display names |
| `categories` | `Groceries, Dining, Household` | Comma-separated; an empty list never shadows the default |
| `default_split_p1` / `default_split_p2` | `80` / `20` | The payer's own share on a new expense, as a percentage or a fraction — anything above 1 reads as a percentage |
| `note_presets` | `OK Mart, Ozeki, Life` | Frequent shops, offered as one-tap chips on the note field |

The two split keys are independent and need not sum to 100: only the *payer's* key is read, and a missing
key is an even split for that person alone. The language, the accent and which person this device is are
per-device, in `localStorage`, never in the sheet — nothing detects the person, because the token belongs
to the sheet's owner.

## Security model

A shared app key instead of browser OAuth is what makes the session never expire. The trade is real: the
credential on each device is *permanent* rather than hour-limited, the token reaches every spreadsheet the
dedicated account can see rather than one picked file, and there is no remote revocation — in return, no
third-party script loads on the page at all.

- **The dedicated account must own exactly one spreadsheet, forever.** The token carries `spreadsheets`, so
  confinement comes from that account having nothing else to reach, not from the scope.
- **The app key is the only access control, and the endpoint URL is not a secret** — `VITE_SCRIPT_URL` is
  inlined into the public bundle. Brute force is not a concern (256 bits against a ~30 requests/second
  ceiling), but **quota exhaustion is, and it is unfixable here**: anonymous traffic bills the owner's Apps
  Script quota before our code runs, and Apps Script exposes no client IP. The impact is availability only
  — writes fail, the endpoint returns HTML instead of JSON, the app falls back to cached data, and it
  self-heals when the quota resets.
- **Key rotation is the only incident response, and it is a documented minute** (end of
  [SETUP.md](SETUP.md)). It stops new tokens at once; one already issued lives out its hour.
- **`localStorage` is scoped to the origin, not the path**, so every other site published from
  `huangwaylon.github.io` can read the app key: nothing untrusted may be published from that account.
- **The CSP is strict enough that no third-party JavaScript runs**: `script-src 'self'`, `frame-src 'none'`,
  `connect-src` naming only `'self'`, the Sheets API and the two Apps Script hosts —
  `script.googleusercontent.com` is not redundant, because `/exec` answers with a 302 to it.

## Cost

$0/month, nothing to cancel, no card on file: Pages and Actions are free for public repos, the Cloud project
needs no billing account and exists only to enable the Sheets API, and neither Apps Script nor the Sheets
API is billed — their quotas are rate limits two people never approach. The sheet counts against the
dedicated account's Drive quota.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`: `npm ci`, `npm run format:check`, `npm test`, build,
upload a Pages artifact, deploy. Two repo settings have to be right for any of it to land — the Pages
source and the `VITE_SCRIPT_URL` variable — both in **SETUP.md** step 7, with the symptom of each wrong
setting. `base.js` sets the base path to `/verbose-octo-pancake/`, because a project Pages site serves from
`/<repo>/`, and `vite.config.js` and `scripts/build-sw.js` both read it from there; rename the repo without
updating that line and the page is blank with 404s for `/assets/index-*.js`.

### On a phone

Install with **Share → Add to Home Screen**: `public/manifest.webmanifest` declares `display: standalone`,
and `index.html` carries `viewport-fit=cover`, the `apple-touch-icon` link and the `apple-mobile-web-app-*`
meta tags Safari still reads. Standalone breaks the keyboard, `:hover`, pull-to-reload and the safe areas in
ways no desktop browser shows; CLAUDE.md's Platform section has those rules, all decided at 320px.

### Launch speed

Two caches: `scripts/build-sw.js`, run by `npm run build`, walks `dist/` and emits a service worker
precaching it, because Pages serves those files `max-age=600`; `src/lib/snapshot.js` keeps the last read in
`localStorage` for `useLedger` to paint first, so an offline launch shows the ledger, not an error screen.

## Development

```sh
git clone https://github.com/huangwaylon/verbose-octo-pancake.git && cd verbose-octo-pancake
npm install --registry=https://registry.npmjs.org
cp .env.example .env   # paste the /exec URL of your token endpoint
npm run dev            # http://localhost:5173/verbose-octo-pancake/
```

Do the Google setup first; without it the app cannot do anything. The explicit registry is required — a bare
`npm install` behind a private mirror bakes internal hosts into `package-lock.json` and fails on a GitHub
runner, which `test/lockfile.test.js` catches. CLAUDE.md has the regeneration recipe, the scripts, and the
static-HTML visual harness that is the only check on whether the page looks right.

## Layout

| Path | |
| --- | --- |
| `index.html`, `base.js`, `vite.config.js`, `apps-script/` | entry HTML with the CSP, the manifest and Home Screen tags; the Pages base path in one place; React plugin and vitest config; the token endpoint and the recurring-cost poster — `Code.gs` and its manifest, pasted into the editor by hand |
| `src/schema.js`, `src/config.js` | the sheet contract (columns, ranges, row ↔ entry mapping); build-time values, storage keys, defaults and their merge, `localStorage` wrappers |
| `src/lib/{sheets,sheetConfig,connection}.js` | every Sheets API call; the `config` tab's key map, one parser per kind and what a fresh tab is seeded with; the app key, the minted token and the failure taxonomy |
| `src/lib/{money,split,balance}.js` | whole yen: parse, format, split, sum; the payer's default share and the split control's transitions; who-owes-whom, the month aggregates and the list's two sections; pure |
| `src/lib/{ledgerState,recurring}.js` | the optimistic list transitions, the status decisions, duplicate-id reconciliation; what a month owes, retire/restore, what a form refuses, and what makes a ledger row a fixed cost; pure |
| `src/lib/{snapshot,serviceWorker,viewport,preference}.js` | the launch cache: last successful read, kept on the device; registration, and when it is safe to activate an update; how much of the layout viewport the keyboard covers; the per-device store the locale, the accent and the summary view share; which person this device is, ISO date helpers, accent presets (`{identity,dates,theme}.js`) |
| `src/state/`, `src/components/`, `src/i18n/`, `src/styles/` | `useConnection`, `useLedger` (optimistic CRUD, throttled focus refresh), `useLedgerView` (every derived figure), `useToasts`, `useKeyboardInset`; `LedgerScreen.jsx` is the whole signed-in surface, with `App`, the visual harness and one render test its three callers; one file per view, with inline-SVG icons and chart; the i18n engine and `en`/`ja` catalogs; `tokens`/`base`/`primitives`/`app` in that order |
| `test/`, `scripts/`, `.github/workflows/deploy.yml` | vitest specs, shared harnesses under `test/support/`; `preview.jsx` and `frames.html` the visual harness and the viewer that measures it at several widths; `build-sw.js` walking `dist/` to emit the worker, importable so its silent failure modes are tested; `bank_to_ledger.py` turning a bank CSV into pasteable rows, one of the two places outside `schema.js` that knows a column list; the workflow that tests, builds and deploys to Pages |
