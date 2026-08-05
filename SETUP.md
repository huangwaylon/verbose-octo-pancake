# Setup

The app has no backend, so the whole trust relationship is between your browser and
Google: you create a Google Cloud project and tell it which origins may use it, once.
Google is midway through moving these screens from **APIs & Services > OAuth consent
screen** to **Google Auth Platform**; where the two differ, both labels are given.

| Value used throughout | |
| --- | --- |
| GitHub username `huangwaylon` | the Pages origin, `https://huangwaylon.github.io` |
| Repo name `verbose-octo-pancake` | the Pages path; `vite.config.js` sets `base` to `/verbose-octo-pancake/` to match |

## 1. Create a Google Cloud project

At <https://console.cloud.google.com/>, open the project dropdown in the top bar and
click **New project**. Name it `Shared Finances`, leave **Location** as *No
organization*, **Create**, then select it in the dropdown. No billing account and no
card. Every later step assumes this project is the one selected in the top bar —
configuring credentials into the wrong project is the easiest hour to waste here.

## 2. Enable three APIs

| API | Used for |
| --- | --- |
| **Google Sheets API** | reading and writing the spreadsheet, and creating a new one on first run |
| **Google Drive API** | required by the Picker |
| **Google Picker API** | the "choose an existing sheet" dialog |

For each: **APIs & Services > Library**, search the name, **Enable**; confirm all three
under **Enabled APIs & services**. Picker is the one people forget, because nothing fails
until the picker opens. *If a Sheets call later 403s with `has not been used in project …
or it is disabled`, one of these is off.*

## 3. Configure the OAuth consent screen

Go to **APIs & Services > OAuth consent screen**; if redirected to **Google Auth
Platform**, click **Get started**. **App name** `Shared Finances` (it appears on the
sign-in screen), your own address as **User support email** and **Contact
information**, **Audience** / **User type** **External** (*Internal* exists only for
Workspace organisations), accept the policy and **Create**.

**Scopes.** In **Data access** (older console: **Scopes**) click **Add or remove
scopes**. `openid` and `.../auth/userinfo.email` are in the common list; `drive.file`
is not, so paste it into **Manually add scopes**. All three must end up in the table,
then **Add to table > Update > Save**:

```
https://www.googleapis.com/auth/drive.file
openid
https://www.googleapis.com/auth/userinfo.email
```

All three are **non-sensitive**, which is what avoids a Google verification review;
`README.md` covers what each one grants. Omit the last two and the app still works —
you just pick your name by hand once per device instead of being recognised by email.

**Test users.** Under **Audience > Test users > Add users** (older console: step 3 of
the wizard), add both Google addresses exactly as they are used to sign in.

**Stay in Testing.** **Audience** shows **Publishing status: Testing** and a **Publish
app** button — do not click it. Testing means only the listed accounts can sign in and
no review is needed; its 7-day refresh-token limit is irrelevant, since this app gets
short-lived access tokens fresh in the browser and stores no refresh token. The price
is an interstitial the first time each of you signs in — **"Google hasn't verified this
app" > Advanced > Go to Shared Finances (unsafe)**. Warn the other person. *No
**Advanced** link means that account is not in the Test users list.*

## 4. Create the OAuth client ID

**APIs & Services > Credentials** (new console: **Google Auth Platform > Clients**) **>
+ Create credentials > OAuth client ID**. **Application type: Web application**, name
it `Shared Finances web` (an internal label, never shown). Leave **Authorized redirect
URIs** empty — the GIS token flow does not redirect. Under **Authorized JavaScript
origins** add both of these, then **Create** and copy the **Client ID**
(`000000000000-abc….apps.googleusercontent.com`):

```
http://localhost:5173
https://huangwaylon.github.io
```

Get these exactly right — it is the single most common failure. An origin is *scheme +
host + port*, and the repo path is not part of it even though the app is served from
`https://huangwaylon.github.io/verbose-octo-pancake/`:

| | |
| --- | --- |
| Correct | `https://huangwaylon.github.io` |
| Correct | `http://localhost:5173` |
| Wrong — has a path | `https://huangwaylon.github.io/verbose-octo-pancake` |
| Wrong — trailing slash | `https://huangwaylon.github.io/` |
| Wrong — scheme mismatch | `http://huangwaylon.github.io` |
| Wrong — wrong host form | `https://www.huangwaylon.github.io` |
| Wrong — a different origin to Google | `http://127.0.0.1:5173` |

*`origin_mismatch`, `redirect_uri_mismatch` or "The given origin is not allowed for the
given client ID" all mean the page's origin is not in this list.* Read the URL Vite
actually printed — it moves to another port when 5173 is taken — and compare character
by character.

## 5. Create and restrict the API key

**Credentials > + Create credentials > API key**. Copy it (`AIzaSy…`), then **Edit API
key** — an unrestricted key is one anyone can borrow. Name it `Shared Finances browser
key`, and under **Application restrictions** choose **Websites** (older UI: **HTTP
referrers**) and add both patterns:

```
http://localhost:5173/*
https://huangwaylon.github.io/*
```

Referrer patterns are not origins: the trailing `/*` **is** required, because the
browser sends a full URL as the referrer — the opposite convention from step 4. Under
**API restrictions** choose **Restrict key**, tick exactly Google Sheets API, Google
Drive API and Google Picker API, and **Save**. Allow a few minutes for restriction
changes to propagate before debugging anything.

*`API keys with referer restrictions cannot be used with this API` means the key's API
restrictions are missing Picker.* *"The API developer key is invalid", if the picker also
asked you to sign in while the app was already signed in, is the browser rather than the
key* — Brave, Safari and hardened Firefox block the third-party cookies the
`docs.google.com` iframe needs, or strip the `Referer` the key is matched on; lower the
shields for the site, or check in Chrome. **Create a new sheet** uses no picker.

Locally, `cp .env.example .env` and paste both values in, then check before touching
GitHub with `npm install --registry=https://registry.npmjs.org && npm run dev` — the
explicit registry matters if this machine has a private npm mirror, see `README.md` — and
sign in at <http://localhost:5173>.

## 6. GitHub Pages and the two variables

1. **Settings > Pages > Build and deployment > Source: GitHub Actions.** Not "Deploy
   from a branch" — the workflow uploads a Pages artifact, which branch mode ignores.
   *Until this is set the deploy job fails at "Configure Pages" or with a Pages
   permissions error, and a branch-published site 404s on `/src/main.jsx`.*
2. **Settings > Secrets and variables > Actions > Variables** (not Secrets) **> New
   repository variable**, twice: `VITE_GOOGLE_CLIENT_ID` with the client ID from step
   4, and `VITE_GOOGLE_API_KEY` with the API key from step 5. Variables rather than
   secrets on purpose — Vite bakes both into the public bundle, as the Security model
   section of `README.md` explains.
3. Push a commit, or run **Deploy to GitHub Pages** from the **Actions** tab; the
   deploy job prints the live URL. *Variables added after a run need the workflow
   re-run*, since they are read at build time and an earlier build shipped empty
   strings — the app then reports a missing client ID.

## 7. First run

1. Open the deployed URL (or `localhost:5173`), sign in, and work through the
   unverified-app screen.
2. Either **Create a new sheet** — the app creates the spreadsheet and adds the
   `expenses_p1`, `expenses_p2` and `config` tabs with headers and seeded config,
   nothing to do by hand — or **Pick an existing sheet**, where the app reads the
   file's tab list first and refuses anything that does not already have all three:
   the Picker lists every spreadsheet you own, and writing tabs into the wrong one is
   not undoable.
3. In Google Sheets, share the sheet with the other person's account as an **Editor**
   and leave general access **Restricted**. The sheet is the entire database, and link
   access makes it world-readable.
4. In the `config` tab set `person1_name` / `person2_name` and `person1_email` /
   `person2_email` (the two Google addresses, so the app knows who is who), then adjust
   `currency`, `categories`, the two `default_split_*` keys and `note_presets` — all
   tabulated in `README.md`.
5. **Each person must sign in and pick the same sheet through the Picker on their own
   device.** The `drive.file` grant is per-person and per-file, so yours does not carry
   over: until they pick it, their browser has no access even though Google Sheets
   lists them as an Editor. *A second person seeing an empty app has almost always
   skipped this.* *A 403 naming `insufficientPermissions` instead means the token
   predates a consent-screen change — sign out and back in to get a new one.*

First run makes several Sheets calls in sequence to create and seed the tabs, so expect
a few seconds of spinner; later loads are one round trip. The interface language and
accent colour are chosen per device in **Settings**.
