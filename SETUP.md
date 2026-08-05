# Setup

This is the part nobody can do for you. The app has no backend, so the entire
trust relationship is between your browser and Google — which means you have to
create a Google Cloud project and tell it which origins are allowed to use it.

It is tedious: roughly 30–45 minutes the first time, most of it clicking through
consoles. It is also a one-time cost. Nothing here needs to be repeated unless
you change domains or add a third person.

One warning about the Google Cloud console: Google has been migrating the OAuth
screens from **APIs & Services > OAuth consent screen** to a newer section
called **Google Auth Platform**. Depending on your account you will land in one
or the other, and old tutorials describe the old one. Where the two differ,
both labels are given below.

**Two values the rest of this document depends on:**

| Value | Used as |
| --- | --- |
| GitHub username `huangwaylon` | Your Pages origin, `https://huangwaylon.github.io` |
| Repo name `verbose-octo-pancake` | The Pages path. `vite.config.js` sets `base` to `/verbose-octo-pancake/` to match, so renaming the repo means updating that too. |

---

## 1. Create a Google Cloud project

No billing account, no credit card. Everything this app uses is free at this
volume.

1. Go to <https://console.cloud.google.com/>.
2. Click the project dropdown in the top bar (it says **Select a project**, or
   shows a project name).
3. Click **New project** in the top right of the dialog.
4. **Project name:** `Shared Finances`. Leave **Location** as *No organization*.
5. Click **Create**, wait for the notification, then use the project dropdown
   again to select the new project.

Everything from here on assumes this project is the one selected in the top bar.
Losing track of which project is selected is the most common way to configure
credentials into the void.

## 2. Enable the three APIs

The app needs exactly three:

| API | Used for |
| --- | --- |
| **Google Sheets API** | reading and writing the spreadsheet |
| **Google Drive API** | creating a new spreadsheet on first run |
| **Google Picker API** | the "choose an existing sheet" dialog |

For each one:

1. In the left nav go to **APIs & Services > Library** (or search "API Library"
   in the top search bar).
2. Type the API name into the search box.
3. Click the result, then click **Enable**.
4. Use your browser's back button and repeat for the next API.

You can confirm all three under **APIs & Services > Enabled APIs & services**.
The Picker API is the one people forget, because nothing fails until the moment
you try to open the picker.

## 3. Configure the OAuth consent screen

1. Go to **APIs & Services > OAuth consent screen**. If you are redirected to
   **Google Auth Platform**, click **Get started**.
2. **App name:** `Shared Finances`. This string is shown on the sign-in screen,
   so make it something you will recognise.
3. **User support email:** pick your own address from the dropdown.
4. **Audience** / **User type:** choose **External**. *Internal* is only
   available to Google Workspace organisations, and even then External is the
   right choice here.
5. **Contact information:** your email address again.
6. Accept the Google API Services User Data Policy and click **Create**.

### Add the scopes

In the new console this is **Google Auth Platform > Data access**; in the old
one it is step 2 of the consent screen wizard, **Scopes**.

1. Click **Add or remove scopes**.
2. `openid` and `.../auth/userinfo.email` are in the common list and can be
   ticked there. `drive.file` is not — paste it into the **Manually add scopes**
   box at the bottom. Either way, all three must end up in the table:
   ```
   https://www.googleapis.com/auth/drive.file
   openid
   https://www.googleapis.com/auth/userinfo.email
   ```
3. Click **Add to table**, then **Update**, then **Save**.

`drive.file` is the one that matters, and it grants per-file access: the app can
read and write files you explicitly pick in the Google Picker, plus files it
creates itself, and nothing else in your Drive. It cannot list your other
spreadsheets. This is deliberate, and it is also why the app has a picker at all.

`openid` and `userinfo.email` reveal only which account is signed in, so the app
can match it against the emails in the sheet's `config` tab and skip asking which
of the two people you are. They grant no file access whatsoever. Omit them and
the app still works — `getUserEmail()` just 401s, and everyone picks their name
by hand once per device.

All three are **non-sensitive** scopes, which is what keeps the next part simple:
no Google verification review.

### Add both of you as Test users

In the new console: **Google Auth Platform > Audience > Test users > Add
users**. In the old one it is step 3 of the wizard.

Add both Google account addresses — yours and the other person's — exactly as
they are used to sign in to Google. Click **Save**.

### Leave the app in Testing mode

Under **Audience** you will see **Publishing status: Testing** and a **Publish
app** button. **Do not click it.**

Testing mode means only the accounts in the Test users list can sign in, and
Google does not require a verification review. Publishing would put you in the
verification queue for no benefit: a 2-person app has no audience to reach.
There is no expiry that matters here — the 7-day refresh-token limit that
Testing mode imposes does not apply, because this app uses short-lived access
tokens obtained fresh in the browser and never stores a refresh token. Leaving
it in Testing indefinitely is the correct end state, not a temporary hack.

### Expect the "unverified app" screen

The trade-off for skipping verification is a scary interstitial the first time
each of you signs in:

> **Google hasn't verified this app**
> The app is requesting access to sensitive info in your Google Account…

This is expected. To get past it:

1. Click **Advanced** (bottom left of the dialog).
2. Click **Go to Shared Finances (unsafe)**.

The "(unsafe)" is Google saying *we have not reviewed who wrote this* — which
is accurate; you wrote it. Tell the other person this in advance, because it
looks alarming and it is the single most likely reason they bounce off.

## 4. Create the OAuth Client ID

1. Go to **APIs & Services > Credentials** (in the new console, **Google Auth
   Platform > Clients**).
2. Click **+ Create credentials > OAuth client ID**.
3. **Application type:** **Web application**.
4. **Name:** `Shared Finances web` — internal label only, never shown to users.
5. Leave **Authorized redirect URIs** completely empty. The app uses the GIS
   token flow, which does not redirect. Adding a redirect URI here does nothing.
6. Under **Authorized JavaScript origins**, click **+ Add URI** twice and add:

   ```
   http://localhost:5173
   https://huangwaylon.github.io
   ```

7. Click **Create**. Copy the **Client ID** from the dialog. It looks like
   `000000000000-abc123….apps.googleusercontent.com`. You can always come back
   and copy it again later.

**Get the origins exactly right.** An origin is *scheme + host + port* and
nothing else:

| | |
| --- | --- |
| Correct | `https://huangwaylon.github.io` |
| Correct | `http://localhost:5173` |
| Wrong — has a path | `https://huangwaylon.github.io/verbose-octo-pancake` |
| Wrong — trailing slash | `https://huangwaylon.github.io/` |
| Wrong — scheme mismatch | `http://huangwaylon.github.io` |
| Wrong — wrong host form | `https://www.huangwaylon.github.io` |
| Wrong — not the same origin | `http://127.0.0.1:5173` |

Note that the repo path is **not** part of the origin: even though the app is
served from `https://huangwaylon.github.io/verbose-octo-pancake/`, the origin Google
checks is just `https://huangwaylon.github.io`. Getting this wrong is the number
one cause of `origin_mismatch` and `redirect_uri_mismatch` errors, and the error
message does not tell you which character is off.

`127.0.0.1` and `localhost` are different origins to Google. Vite prints both
when it starts; use the `localhost` one, or add both here.

## 5. Create and restrict the API key

1. **APIs & Services > Credentials > + Create credentials > API key**.
2. The key appears in a dialog. Copy it (`AIzaSy…`), then click **Edit API key**
   — an unrestricted key is a key anyone can borrow for their own site.
3. **Name:** `Shared Finances browser key`.
4. Under **Application restrictions**, select **Websites** (labelled **HTTP
   referrers (web sites)** in the older UI). Click **Add** and enter:

   ```
   http://localhost:5173/*
   https://huangwaylon.github.io/*
   ```

   Referrer patterns are not origins: here the trailing `/*` **is** required,
   because the browser sends a full URL as the referrer and the pattern has to
   match it. This is the opposite convention from step 4, which is confusing and
   worth double-checking.

5. Under **API restrictions**, select **Restrict key** and tick exactly:
   - Google Sheets API
   - Google Drive API
   - Google Picker API

6. Click **Save**. Restriction changes can take a few minutes to propagate; if
   the picker misbehaves immediately after saving, wait five minutes before
   debugging anything.

You now have both values. Locally:

```sh
cp .env.example .env
```

then paste the client ID and API key into `.env`. Neither is a secret — they
both ship inside the JavaScript bundle — but `.env` is gitignored so you are not
editing a tracked file every time.

Check it works before touching GitHub:

```sh
npm install
npm run dev
```

Open <http://localhost:5173> and sign in.

## 6. GitHub: Pages and variables

The repo already exists at `huangwaylon/verbose-octo-pancake` with the code on
`main`. It is **public**, which is fine — there are no secrets in it, and public
repos get free Actions minutes.

1. Go to **Settings > Pages**. Under **Build and deployment**, set **Source** to
   **GitHub Actions**. Do not pick "Deploy from a branch" — the workflow uploads
   a Pages artifact, which the branch-based mode ignores. Until you do this, the
   deploy job fails at the "Configure Pages" step.
2. Go to **Settings > Secrets and variables > Actions**, click the **Variables**
   tab (not Secrets), then **New repository variable**. Add both:

   | Name | Value |
   | --- | --- |
   | `VITE_GOOGLE_CLIENT_ID` | the client ID from step 4 |
   | `VITE_GOOGLE_API_KEY` | the API key from step 5 |

   Variables rather than secrets on purpose — these are public values that Vite
   bakes into the bundle. See the Security model section of `README.md`.

3. Go to the **Actions** tab and either push a commit or run **Deploy to GitHub
   Pages** manually via **Run workflow**. When it finishes, the deploy job prints
   the live URL.

If you added the variables *after* a run, re-run the workflow. They are read at
build time, so a build without them ships empty strings and the app reports a
missing client ID.

## 7. First run

1. Open the deployed URL (or `localhost:5173`) and click sign in. Work through
   the unverified-app screen from step 3.
2. Choose one of:
   - **Create a new sheet** — the app creates the spreadsheet, writes the
     `expenses` header row, and seeds the `config` tab. Nothing to do by hand.
   - **Pick an existing sheet** — the Google Picker opens; choose your sheet. It
     must already have `expenses` and `config` tabs, or the app declines and
     changes nothing: the picker lists every spreadsheet you own, and adding tabs
     to the wrong one is not undoable. Use **Create a new sheet** for a fresh
     ledger.
3. Open the sheet in Google Sheets and share it with the other person's Google
   account as an **Editor** (**Share** > enter their address > Editor > Send).
   Leave general access as **Restricted**. Never set it to *Anyone with the
   link*: the sheet is the entire database and link access makes it world
   readable.
4. In the `config` tab, set `person1_name` and `person2_name` to your actual
   names, and `person1_email` / `person2_email` to the two Google addresses so
   the app can tell who is using it without asking. `currency` defaults to `JPY`;
   change it and the comma-separated `categories` list while you are there.
   Optionally add two more rows:
   - `default_split` — the payer's share on a new expense, as a percentage (`50`)
     or a fraction (`0.5`). Useful if you never split evenly.
   - `note_presets` — a comma-separated list of the shops you use most, e.g.
     `OK Mart, Ozeki, Life`. They become one-tap chips on the note field.
5. **Have the other person sign in and pick the same sheet themselves.** This
   step is easy to miss. The `drive.file` grant is per-person, per-file — your
   authorisation does not carry over to them. Until they pick the sheet in the
   picker on their own device, their browser has no access to it even though
   Google Sheets shows them as an Editor.

The interface language is chosen per device in **Settings**, not in the sheet, so
the two of you can read the same ledger in different languages.

First run makes several Sheets calls in sequence to create the tabs, seed the
config and read it back, so expect it to sit on a spinner for a few seconds
longer than a normal load. Subsequent loads are one round trip.

---

## Troubleshooting

### "Google hasn't verified this app"

Expected, not a misconfiguration. Click **Advanced**, then **Go to Shared
Finances (unsafe)**. If there is no **Advanced** link, the signed-in account is
not in the Test users list — add it under **Google Auth Platform > Audience >
Test users**.

### `origin_mismatch`, `redirect_uri_mismatch`, or "The given origin is not allowed for the given client ID"

The page's origin is not in the client ID's **Authorized JavaScript origins**
list. Almost always one of:

- A trailing slash or a path was included. Origins are scheme + host + port only.
- You are on `http://127.0.0.1:5173` but registered `http://localhost:5173`.
  Different origins. Change the URL or register both.
- You are on a Vite fallback port because 5173 was taken. Vite says
  `Port 5173 is in use, trying another one…` on startup — read the URL it
  actually printed.
- The GitHub Pages origin was written as `https://huangwaylon.github.io/<repo>`.
  Drop the repo path.
- The build shipped a stale or empty client ID. Open devtools and check that the
  client ID in the request matches the console.

Open devtools > Network, find the `accounts.google.com` request, and read the
origin it sent. Compare it character by character with the console. Changes to
the origins list are usually live within a minute or two, but can take longer;
a hard reload clears cached GIS state.

### 403 from the Sheets API

`sheets.googleapis.com` returning 403 has three distinct causes, and the JSON
error body distinguishes them — read it rather than guessing:

| Message contains | Cause | Fix |
| --- | --- | --- |
| `has not been used in project … or it is disabled` | Sheets API not enabled | Step 2 |
| `insufficientPermissions` / `Request had insufficient authentication scopes` | token lacks `drive.file` | Re-check the scope in step 3, then sign out and back in so a new token is issued |
| `The caller does not have permission` | this account has not picked the file, or is not shared on it | Sign in as that person, pick the sheet in the picker (step 7.5), and confirm they are an Editor on the sheet |

A 401 instead of a 403 means the access token expired and could not be silently
renewed. Sign out and sign in again.

### The API key referrer restriction is rejecting requests

Symptom: `"API keys with referer restrictions cannot be used with this API"`, or
`requests-from-referer-<something>-are-blocked`, or the picker opening and
immediately closing.

- The referrer pattern needs the trailing `/*` (`https://name.github.io/*`),
  unlike the OAuth origin. Check step 5.
- Add the localhost pattern too; forgetting it breaks dev but not production,
  which makes it look like a deploy problem.
- Give restriction changes up to five minutes to propagate.
- If the message says referrer restrictions "cannot be used with this API", the
  key's **API restrictions** list is missing the Picker API.

### 404 for `/src/main.jsx` on the deployed site

The site is serving the **raw repository**, not the built bundle. `index.html` at
the repo root contains `<script src="/src/main.jsx">`, which only works under the
Vite dev server — Vite rewrites it to a hashed `/assets/index-*.js` path at build
time. Seeing `main.jsx` requested at all is the tell.

**Cause:** **Settings > Pages > Source** is set to **Deploy from a branch**, so
Pages publishes the repo tree verbatim and ignores the workflow's artifact
entirely. Set Source to **GitHub Actions** (step 6.1) and re-run the workflow.

To confirm which mode you are in, without guessing:

```sh
curl -s https://huangwaylon.github.io/verbose-octo-pancake/ | grep -o 'src="[^"]*"'
```

`src="/src/main.jsx"` means branch mode. A hashed
`src="/verbose-octo-pancake/assets/index-….js"` means the workflow deployed.

### Blank page after deploy

Almost always the `base` path. Open devtools > Console; if you see 404s for
`/assets/index-*.js` — note the missing `/verbose-octo-pancake/` prefix — then the
built `base` does not match the path Pages serves from.

`vite.config.js` uses `base: process.env.VITE_BASE ?? '/verbose-octo-pancake/'`, so:

- If your repo is named `verbose-octo-pancake`, it already matches. A blank page is
  something else — read the console for a real error.
- If the repo has a different name, the default is wrong. Renaming the repo to
  `verbose-octo-pancake` is the least invasive fix; otherwise change the fallback in
  `vite.config.js` to `/<your-repo>/`.
- For a user/organisation site (`huangwaylon.github.io`) or a custom domain, the
  site is served from the root, so build with `VITE_BASE=/`.

A white page with no console errors and no network requests usually means the
CSP in `index.html` blocked the bundle — the Console tab reports CSP violations
explicitly.

### The picker says "The API developer key is invalid" (Brave, Safari, hardened Firefox)

If it also asked you to **sign in to your Google Account** inside the picker
window while the app itself was already signed in, this is your *browser*, not
your configuration — and the key is fine. Verify by opening the same URL in
Chrome; if the picker lists your spreadsheets there, nothing in Google Cloud
needs changing.

The picker renders in an iframe from `docs.google.com`, which is third-party to
the page. Two common privacy defaults break it:

- **Third-party cookies blocked** — the iframe cannot see your Google session, so
  it asks you to sign in and then cannot authorise the key.
- **The `Referer` header stripped** — the API key is restricted by HTTP referrer
  (step 5). A request that arrives with no referrer is rejected, and Google
  reports that as an invalid key rather than a missing header.

In Brave, lower the Shields for the site (the lion icon in the address bar) or
allow third-party cookies for it. The alternative is to remove the referrer
restriction from the API key, which trades a real if modest protection for
browser compatibility — your call, and worth understanding rather than doing
reflexively.

**Create a new sheet** does not use the picker at all, so it keeps working in
these browsers.

### The picker never opens

The app passes `setAppId` and `setOrigin` (see `src/lib/picker.js`), which is what
a working picker needs on the `drive.file` scope. The picker reports its own
errors, and the app surfaces them on screen and logs the raw payload as
`[picker] error payload:` — read that before guessing. Then:

- **Google Picker API not enabled.** Step 2. Nothing fails until you open the
  picker, which is why it gets missed.
- **The API key's restrictions omit Picker.** Step 5 requires all three of Sheets,
  Drive and Picker. A key allowed for only Sheets and Drive fails here and the
  message blames the key, not the missing entry.
- **Popup blocked.** The picker must be triggered by a real click. If it works on
  the second click, a blocker is involved.
- **Missing API key.** The console will say `Missing VITE_GOOGLE_API_KEY` — the
  build did not receive the variable.
- **CSP.** `frame-src` must include `https://docs.google.com`, where the picker
  iframe is hosted. It does by default; only relevant if you edited `index.html`.

### The other person sees an empty app

They signed in but have not picked the sheet. See step 7.5 — the `drive.file`
grant is per-person, per-file.

### CI fails at "Install dependencies" with "Exit handler never called!"

That message is npm's generic surface for a crash during install; the real error
only lands in `~/.npm/_logs`, never in the step output. The cause is almost
certainly a `package-lock.json` generated against a private registry, whose hosts
do not resolve on a GitHub runner:

```sh
rm -rf node_modules package-lock.json
npm install --registry=https://registry.npmjs.org
grep -c 'apple.com' package-lock.json   # must be 0
```

`test/lockfile.test.js` fails the build if a private-registry URL reappears. Full
reasoning, including why a repo `.npmrc` cannot prevent it, is in `CLAUDE.md`.

**For any other install failure:** the failed run uploads an `npm-debug-log`
artifact at the bottom of the run summary. Read it — the step output alone cannot
diagnose this class of crash.

### The deploy job fails with "Missing environment" or a Pages permissions error

**Settings > Pages > Source** is not set to **GitHub Actions** (step 6.1), or the
run predates that change. Set it, then re-run the workflow.
