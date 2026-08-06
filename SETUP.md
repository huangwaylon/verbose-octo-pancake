# Setup

Everything below happens once. The result is an app that never asks anyone to sign
in to Google: a small Apps Script web app, owned by a dedicated account that owns
the ledger, mints short-lived Google tokens for whoever presents a shared key.

You need a **dedicated Google account** for this. Not your own — the token the
script mints carries the `spreadsheets` scope, which reaches every spreadsheet the
owning account can see. An account that owns exactly one file is what keeps that
scope harmless, and that is a permanent condition rather than a setup detail.

There is no OAuth client, no API key, no consent screen for either person, and no
Google Picker. If you are looking for those, they were removed — see the Security
model section of [README.md](README.md).

| Value used throughout | |
| --- | --- |
| GitHub username `huangwaylon` | the Pages origin, `https://huangwaylon.github.io` |
| Repo name `verbose-octo-pancake` | the Pages path; `vite.config.js` sets `base` to `/verbose-octo-pancake/` to match |

## 1. The dedicated account and the sheet

1. Create a new Google account. Unique strong password, 2FA on, used for nothing
   else.
2. Signed in as that account, create one spreadsheet. Do not add tabs — the app
   builds `expenses_p1`, `expenses_p2` and `config` on its first run.
3. Copy the id out of the URL:
   `https://docs.google.com/spreadsheets/d/`**`<this part>`**`/edit`
4. **Share** it with both people's own Google addresses as **Editor**, and leave
   general access **Restricted**. That share is the only thing that lets either of
   you open the sheet by hand; *Anyone with the link* would make the whole ledger
   readable to anybody who saw the URL.

## 2. Generate the app key

```sh
openssl rand -hex 32
```

Keep it where both people can reach it, like a shared password manager. It is the
only credential the app has and the only thing standing in front of a public
endpoint. It is never a build-time value and never goes in the repository.

## 3. Create the script

Signed in as the dedicated account. A separate browser profile is easiest — the
Cloud console silently acts as the wrong account when several are signed in, which
is the easiest hour to waste here.

1. Go to **script.new**. Rename the project **Shared Finances token minter**.
2. Replace the contents of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs).
3. **Project Settings** (gear) → tick **Show `appsscript.json` manifest file in
   editor**.
4. Back in **Editor**, replace `appsscript.json` with
   [`apps-script/appsscript.json`](apps-script/appsscript.json). It pins the scope
   to `spreadsheets` alone and sets the web app to run as the owner with anonymous
   access.
5. **Project Settings** → **Script Properties** → **Add script property**, twice:

   | Property | Value |
   | --- | --- |
   | `SHEET_ID` | the id from step 1 |
   | `APP_KEY` | the key from step 2 |

   Properties rather than literals, so the copy of the script in this repository
   holds no secret and stays diffable.

## 4. Attach a Cloud project

Apps Script's own hidden Cloud project cannot have APIs enabled, so a token it
mints is rejected by the Sheets API with `SERVICE_DISABLED`. A standard project
fixes it. No billing account and no card.

1. **console.cloud.google.com/projectcreate** → name it `shared-finances` →
   **Create**.
2. On the console home page, copy the **Project number** from the *Project info*
   card. Apps Script wants the number, not the id.
3. **console.cloud.google.com/apis/library/sheets.googleapis.com** → confirm the
   project selector says `shared-finances` → **Enable**.
4. Apps Script → **Project Settings** → **Google Cloud Platform (GCP) Project** →
   **Change project** → paste the project number → **Set project**.

## 5. Publish the consent screen

**Do not leave this in Testing.** A script attached to a Cloud project whose
consent screen is in Testing has its authorization expire after **7 days**, so the
token endpoint stops working about a week after setup — and the symptom is
indistinguishable from a quota problem. Publishing removes the expiry.

1. **console.cloud.google.com/auth/overview** (older consoles: **APIs & Services →
   OAuth consent screen**). If offered **Get started**, fill in app name
   `Shared Finances`, the dedicated address for both support and contact, audience
   **External**, then **Create**.
2. **Audience** → **Publishing status** → **Publish app**.

Publishing submits nothing for review. Verification only removes the warning screen
and lifts the 100-user cap; one user with a sensitive scope on an unverified
production app is a supported state. You will still click through **Advanced → Go
to Shared Finances token minter (unsafe)** when authorizing.

Add no scopes here. `ScriptApp.getOAuthToken()` does not route through this screen;
it only has to exist.

## 6. Deploy

1. **Deploy** → **New deployment** → gear → **Web app**.
2. **Execute as: Me**. **Who has access: Anyone** — not "Anyone with a Google
   Account", because the app calls this with no Google login at all.
3. **Deploy**, then authorize: pick the dedicated account, **Advanced** → **Go
   to… (unsafe)** → **Allow**. It asks to see and edit your spreadsheets, which is
   the `spreadsheets` scope from step 3.
4. Copy the **Web app URL**, ending in `/exec`.

The script answers only POSTs, so there is nothing to check in a browser address
bar — that is deliberate. Confirm it this way instead, which also proves the part
most likely to be wrong:

```sh
URL='https://script.google.com/macros/s/…/exec'
KEY='…'
SHEET='…'
TOKEN=$(curl -sSL "$URL" -H 'Content-Type: text/plain;charset=utf-8' \
  --data "{\"key\":\"$KEY\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://sheets.googleapis.com/v4/spreadsheets/$SHEET?fields=sheets(properties(title))"
```

A tab list means it works. `SERVICE_DISABLED` means step 4 did not take.

Note `--data` with no `-X POST`: `/exec` answers with a 302 and the redirect has to
be followed as a GET, which is what a browser does and what forcing the method
breaks.

## 7. Point the app at it

Local development — `.env` is gitignored:

```sh
cp .env.example .env   # paste the /exec URL
npm run dev            # http://localhost:5173/verbose-octo-pancake/
```

For GitHub Pages, **Settings → Secrets and variables → Actions → Variables** must
hold `VITE_SCRIPT_URL`. It is a *variable*, not a secret: Vite inlines it into the
bundle, so it is public either way, and marking it secret would imply a
confidentiality the deployed site cannot provide. **Settings → Pages → Source**
must be **GitHub Actions** — under "Deploy from a branch" Pages publishes the
repository tree verbatim and ignores the artifact, and the tell is a 404 for
`/src/main.jsx`.

## 8. Each device, once

Open the app and paste the app key. It is stored in that device's `localStorage`
and nothing expires, so this happens once per phone rather than once an hour.

Two things worth knowing about iOS. An installed web app has **its own storage,
separate from Safari's**, so entering the key in Safari does not carry over —
install first (**Share → Add to Home Screen**) and enter it there. And iOS can
evict storage from an app left unused for a long stretch; if that happens you
retype the key and the ledger rebuilds from the sheet.

Then pick which of the two people you are. That is a per-device choice and nothing
detects it, because the token belongs to the sheet's owner rather than to either of
you.

## Rotating the app key

The only incident response this design has, and it takes about a minute. Do it if a
phone is lost, if the key gets shared by accident, or on any suspicion at all.

1. `openssl rand -hex 32`
2. Apps Script → **Project Settings** → **Script Properties** → edit `APP_KEY`.
3. Both people open the app and enter the new key.

No redeployment: `APP_KEY` is read inside `doPost`, so a property change takes
effect on the next request. Editing `Code.gs` is the opposite — a deployment is
pinned to a version, so saving the editor changes nothing until **Deploy → Manage
deployments →** pencil → **New version**.

Rotation stops new tokens immediately. A token already issued lives out its hour —
there is no way to revoke one individually, which is the accepted cost of this
design. The endpoint URL does not change and the app does not need rebuilding.
