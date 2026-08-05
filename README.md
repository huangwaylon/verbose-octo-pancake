# Shared Finances

A shared-expense tracker for exactly two people, backed by a single Google
Sheet. Two people log what they paid for, mark how much of each item was
actually theirs, and the app keeps a running answer to "who owes whom, and how
much". It is a static site: React runs entirely in the browser, talks straight
to the Google Sheets API with an OAuth token the user grants, and is served from
GitHub Pages. There is no backend, no database, and no server-side secret
anywhere in the design — the spreadsheet *is* the database.

## Why a Google Sheet

The two people this was built for were already tracking expenses in a
spreadsheet. Keeping the sheet as the store of record means:

- **No server, no bill, no maintenance.** No database to back up, no host to
  patch, no credentials to rotate. The failure mode of an abandoned side project
  is "the site stops loading", not "the data is gone".
- **A familiar escape hatch.** Anything the app cannot do, you can do by hand in
  Google Sheets: fix a typo, sort, pivot, add a chart, export CSV for taxes. The
  app is a nicer front end for data you can always reach without it.
- **Free revision history.** Google Sheets keeps per-cell version history and
  restore points for free. Building that yourself is real work.
- **Sharing is already solved.** Google's own sharing model decides who can read
  and write. There are no app accounts, no password reset flow, no user table.

The trade-offs are real and worth stating: the Sheets API is slower than a real
database, has quotas, and offers no transactions. The data model below is shaped
around that last point rather than pretending otherwise.

## Architecture

```
  ┌─────────────────────────────────────────────────────────────┐
  │                        Your browser                         │
  │                                                             │
  │   React app (static JS/CSS)                                 │
  │        │                    │                               │
  │        │ 1. sign in         │ 3. read/write rows            │
  │        ▼                    │    Authorization: Bearer …    │
  │   Google Identity           │                               │
  │   Services (GIS)            │                               │
  │   token flow                │                               │
  │        │                    │                               │
  │        │ 2. access token    │                               │
  │        │    (in memory,     │                               │
  │        │     ~1 hour)       │                               │
  │        └───────────────►────┘                               │
  └─────────┬───────────────────────────┬───────────────────────┘
            │                           │
            │ static files              │ HTTPS
            │ (HTML/JS/CSS)             │
            ▼                           ▼
  ┌───────────────────┐      ┌──────────────────────────────┐
  │   GitHub Pages    │      │      sheets.googleapis.com   │
  │  (static hosting, │      │                              │
  │   built by CI)    │      │   ┌──────────────────────┐   │
  └───────────────────┘      │   │  ONE spreadsheet     │   │
                             │   │   ├─ expenses tab    │   │
                             │   │   └─ config tab      │   │
                             │   └──────────────────────┘   │
                             └──────────────────────────────┘

  scope: drive.file only ──► the app can touch the one sheet you pick
                             in the Google Picker (or that it created),
                             and nothing else in your Drive.
```

Every arrow is browser-to-Google. GitHub Pages only ever serves files; it never
sees your data, and it never sees a token.

## Data model

One spreadsheet, two tabs.

### `expenses` tab

Row 1 is the header. Data starts at row 2. Columns, in order:

| Col | Field | Example | Notes |
| --- | --- | --- | --- |
| A | `id` | `9f1c…` | UUID generated in the browser |
| B | `type` | `expense` | `expense` or `settlement` |
| C | `date` | `2026-08-05` | ISO `YYYY-MM-DD`, validated as a real calendar day — `2026-02-31` is treated as unset |
| D | `payer` | `p1` | `p1` or `p2`, resolved to names via the `config` tab |
| E | `amount` | `42.50` | Written as a plain decimal string, parsed to integer cents in the app |
| F | `currency` | `USD` | |
| G | `category` | `Groceries` | Must be non-empty for an `expense` |
| H | `description` | `weekly shop` | Free text, always stored literally |
| I | `payer_share` | `0.5` | Fraction of this entry the payer owes themselves |
| J | `created_at` | `2026-08-05T18:02:11.004Z` | ISO timestamp |
| K | `updated_at` | `2026-08-05T18:02:11.004Z` | ISO timestamp |
| L | `deleted_at` | *(empty)* | Set to a timestamp to soft-delete |

### `config` tab

Plain key/value pairs in columns A and B — no header row:

| Key | Example |
| --- | --- |
| `person1_name` | `Alex` |
| `person2_name` | `Sam` |
| `person1_email` | `alex@example.com` |
| `person2_email` | `sam@example.com` |
| `currency` | `USD` |
| `categories` | `Groceries, Dining, Household, Other` |

The emails let the app guess which of the two people is signed in. Missing keys
fall back to the defaults in `src/config.js`.

### `payer_share`, and why settlements need no special case

`payer_share` is the fraction of an entry that the payer owes *themselves* —
the part that is not a debt to the other person:

| `payer_share` | Meaning |
| --- | --- |
| `0.5` | Even split. The default. |
| `1` | The payer bought it purely for themselves; nobody owes anything. |
| `0` | Fully the other person's; they owe the whole amount. |
| `0.25` | The payer is covering a quarter of it; the other person owes 75%. |

A settlement — "I sent you $200" — is just an entry with `payer_share` of `0`:
the payer is owed the full amount, which is exactly what paying someone back
means. There is no separate settlement code path to keep in sync with the
expense one, and the balance calculation is a single sum over every row.

### Soft deletes

Deleting an entry writes a timestamp into `deleted_at`. The row stays exactly
where it is and is filtered out client-side.

This is not squeamishness about losing data — it is concurrency control. The
Sheets API addresses rows by index, so a hard delete shifts every row below it
up by one. If both people have the sheet open and one of them deletes row 5,
the other person's in-memory row numbers are now off by one, and their next
edit writes to the wrong entry. Because rows never move, that cannot happen:
the worst case is showing a stale row until the next refresh.

Tombstones do accumulate, so there is an occasional explicit **compact** action
that hard-deletes them. It is deliberately manual and deliberately rare — it is
the one operation that renumbers rows, so it should happen when one person is
looking at it, not automatically behind everyone's back.

### Everything is written as RAW

Writes use `valueInputOption=RAW`, so Google stores exactly the string it is
given. A description of `=SUM(A:A)` stays the literal text `=SUM(A:A)` instead
of becoming a formula, `+1 pizza` is not read as arithmetic, and dates are not
silently reformatted into whatever the sheet's locale prefers.

### Money is integer cents

Amounts are integers in the app — `4250`, not `42.50` — and only converted to a
decimal string when written to the sheet and when displayed. Splitting `0.1` in
floating point is how you end up a cent adrift after a hundred entries.

## Features

- Add, edit, and delete expenses: date, payer, amount, category, note.
- Per-entry split — even, all-mine, all-theirs, or any fraction — with a live
  breakdown of what each person ends up covering.
- A running balance: one number saying who owes whom, all-time rather than
  per-month, because a debt does not reset in January.
- Settle up, pre-filled with the outstanding amount and the person who owes it.
- Month-by-month view: entries grouped by day, spend total, what each person
  paid, and a category breakdown.
- Delete offers **Undo** instead of a confirmation dialog, which is what soft
  deletes buy you. An explicit compact action reclaims tombstoned rows.
- First run creates the spreadsheet for you — header row and `config` tab
  included — or connects one you already have via the Google Picker.
- Names, currency, and categories live in the sheet's `config` tab, so changing
  them needs no redeploy.
- Google sign-in with a single narrow scope. No app accounts, no passwords.
- Built for a phone and usable on a monitor: one column that becomes two at
  `62rem`, light and dark themes, 44px tap targets, reduced-motion support.

## Quick start

You need the Google Cloud setup before the app will do anything —
see **[SETUP.md](SETUP.md)**. Then:

```sh
git clone https://github.com/huangwaylon/verbose-octo-pancake.git
cd verbose-octo-pancake
npm install
cp .env.example .env   # paste your client ID and API key
npm run dev            # http://localhost:5173
```

| Script | Does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 |
| `npm run build` | production bundle into `dist/` |
| `npm run preview` | serve the built `dist/` locally |
| `npm test` | vitest, single run |

Deployment is automatic: pushing to `main` runs
`.github/workflows/deploy.yml`, which tests, builds, and publishes to GitHub
Pages.

## Security model

The honest version, because this design looks alarming if you assume every key
is a secret.

**The two build-time variables are public, and that is correct.**
`VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_API_KEY` are inlined into the
JavaScript bundle by Vite, so anyone can read them from the deployed site.
An OAuth *web* client ID and a browser API key are designed to be public — the
OAuth flow for a browser app has no client secret at all, because there would be
nowhere to hide one. What protects them is not obscurity:

| Credential | Protected by |
| --- | --- |
| OAuth client ID | The **Authorized JavaScript origins** list. Google refuses to issue a token to a page served from any other origin, so a copied client ID is useless on someone else's site. |
| Browser API key | An **HTTP referrer** restriction plus an API restriction limiting it to the Sheets, Drive, and Picker APIs. |

They are stored as GitHub Actions repository *variables*, not secrets, for the
same reason: marking a value secret when the build publishes it to the world
implies a confidentiality that does not exist.

**The scope is one line and it is the important line.** The app requests only
`https://www.googleapis.com/auth/drive.file`. That grants access to files the
user explicitly picks in the Google Picker plus files the app itself created —
not "read your Google Drive". The app cannot enumerate your other spreadsheets.
This is also why each person has to pick the sheet themselves once: the grant is
per-person, per-file.

**Tokens are held in memory only.** The access token lives in a module-scoped
variable in `src/lib/googleAuth.js` and is never written to `localStorage` or
`sessionStorage`. A persisted bearer token is readable by any XSS on the origin
and outlives the tab; GIS can silently re-issue a token anyway, so persisting it
would be pure downside. There is no refresh token, because the browser flow does
not issue one. Closing the tab discards the credential.

**There is no bank connection anywhere in this design.** No Plaid, no Open
Banking, no institution credentials, no account or card numbers, no read-only
brokerage tokens. Entries are typed in by hand. The worst case for a full
compromise of this app is that someone learns you spent $42.50 on groceries — it
cannot move money and it has no path to a financial institution.

**Access control is Google's, and depends on you.** The sheet should be shared
with exactly the two named Google accounts, as Editors, with general access left
at **Restricted**. Never set it to *Anyone with the link*: that makes the entire
database world-readable to anyone who ever sees the URL, and no amount of
client-side care compensates for it. Both people are full Editors — there are no
roles, and either can edit or delete the other's entries. For two people who
share money, that is the intended level of trust.

**The CSP is tight.** `index.html` sets a Content-Security-Policy that is a
deliberate allowlist of Google's hosts, not boilerplate:

| Directive | Allowed |
| --- | --- |
| `default-src` | `'self'` |
| `script-src` | `'self'`, Google's auth/API/static hosts |
| `connect-src` | `'self'`, Google's Sheets/API/auth hosts |
| `frame-src` | Google's auth and Docs/Drive hosts, for the sign-in and picker frames |
| `object-src`, `base-uri`, `form-action` | `'none'` |

No third-party CDNs, no analytics, no trackers, no web fonts. It does allow
`style-src 'unsafe-inline'`, which is a real if minor loosening. Adding a Google
host to the app means updating this list.

**What is not protected.** Anyone can load the deployed site and click sign in —
the page is public. They just cannot get anywhere: Google will only issue a
token to an account on the Test users list, and even then that account has
access only to sheets it can already reach. The app has no rate limiting of its
own beyond Google's quotas. It is not multi-tenant, has no audit log of its own
beyond Sheets' revision history, and makes no attempt to defend one of the two
people from the other.

## Project layout

```
.
├── .github/workflows/deploy.yml   test + build + deploy to Pages
├── .env.example                   the two public build-time variables
├── CLAUDE.md                      invariants and conventions for contributors
├── SETUP.md                       Google Cloud + GitHub walkthrough
├── index.html                     entry HTML, and the Content-Security-Policy
├── vite.config.js                 Pages base path, React plugin, vitest config
├── src
│   ├── main.jsx                   mounts App, imports the four stylesheets
│   ├── App.jsx                    gates, derived data, and the page layout
│   ├── config.js                  build-time config, OAuth scope, defaults
│   ├── schema.js                  the sheet contract: columns, ranges, row <-> entry
│   ├── lib
│   │   ├── googleAuth.js          GIS token flow; token never leaves memory
│   │   ├── picker.js              Google Picker, plus spreadsheet creation
│   │   ├── sheets.js              all Sheets API calls (the CRUD)
│   │   ├── money.js               integer-cent parsing, formatting, splitting
│   │   ├── balance.js             who-owes-whom and the month aggregates
│   │   ├── dates.js               timezone-safe ISO date helpers
│   │   └── identity.js            which of the two people is signed in
│   ├── state                      useAuth, useLedger (optimistic CRUD), useToasts
│   ├── components                 one file per view; icons.jsx is inline SVG
│   └── styles                     tokens, base, primitives, app
└── test                           vitest specs, test/**/*.test.{js,jsx}
```

Two files are worth reading first. **`src/schema.js`** is the sheet contract:
every column name, range, and row-to-object mapping is defined there and nowhere
else, so the layout has exactly one source of truth. **`src/state/useLedger.js`**
owns the spreadsheet connection and applies every mutation optimistically before
reconciling it against the sheet.

`CLAUDE.md` lists the invariants that must not be broken — the ones that fail
silently rather than throwing.

## Cost

$0/month, on permanent free tiers rather than a trial.

| Thing | Cost |
| --- | --- |
| GitHub Pages | Free for public repos. |
| GitHub Actions | Free and unmetered for public repos. |
| Google Cloud project | Free. No billing account required. |
| Google Sheets API | No billing for this API. Quotas (300 requests/minute/project, 60/minute/user) are limits, not charges, and two people entering groceries never approach them. |
| Google Drive / Picker API | Same — quota-limited, not billed. |
| Storage | The sheet counts against the owner's Google Drive quota. A few thousand rows of text is a rounding error against the free 15 GB. |

There is nothing to cancel and no card on file. The only way this starts costing
money is if you attach a custom domain and pay for the domain.
