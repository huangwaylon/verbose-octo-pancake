# Setup

All of this happens once, and the result is an app nobody signs in to: an Apps Script web app, owned by a
dedicated account that owns the ledger, mints short-lived Google tokens for whoever presents a shared key.
Use a **dedicated Google account**, not your own — the token carries the `spreadsheets` scope, reaching
every spreadsheet that account can see, so an account owning exactly one file is what keeps the scope
harmless, permanently rather than just at setup; [README.md](README.md)'s Security model has the
trade-offs. Throughout: username `huangwaylon`, repo `verbose-octo-pancake`, so the site is
`https://huangwaylon.github.io/verbose-octo-pancake/` and `base.js` matches that path.

## 1. The dedicated account and the sheet

1. Create a new Google account. Unique strong password, 2FA on, used for nothing else.
2. Signed in as that account, create one spreadsheet, and do not add tabs — the app builds
   `expenses_p1`, `expenses_p2`, `settlements`, `recurring` and `config` on its first run.
3. Copy the id out of the URL: `https://docs.google.com/spreadsheets/d/`**`<this part>`**`/edit`
4. **Share** it with both people's Google addresses as **Editor**, general access **Restricted**: that
   share is the only way either of you opens the sheet by hand, and *Anyone with the link* would make the
   whole ledger readable to anybody who saw the URL.

## 2. Generate the app key

`openssl rand -hex 32`, kept in a shared password manager. It is the only credential the app has and
the only thing in front of a public endpoint; never a build-time value, and never in the repository.

## 3. Create the script

1. Signed in as the dedicated account, ideally in its own browser profile (the Cloud console silently
   acts as the wrong account when several are signed in), go to **script.new** and rename the project
   **Shared Finances token minter**.
2. Replace the contents of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs).
3. **Project Settings** (gear) → tick **Show `appsscript.json` manifest file in editor**.
4. Back in **Editor**, replace `appsscript.json` with
   [`apps-script/appsscript.json`](apps-script/appsscript.json): scope pinned to `spreadsheets` alone,
   web app run as owner with anonymous access, timezone pinned to `Asia/Tokyo` — which step 9 needs,
   since `new Date()` is UTC and a 03:00 JST run on the 1st would compute last month.
5. **Project Settings** → **Script Properties** → **Add script property**, twice:

   | Property | Value |
   | --- | --- |
   | `SHEET_ID` | the id from step 1 |
   | `APP_KEY` | the key from step 2 |

## 4. Attach a Cloud project

Apps Script's own hidden Cloud project cannot have APIs enabled, so a token it mints is rejected by
the Sheets API with `SERVICE_DISABLED`. A standard project fixes it — no billing account, no card.

1. **console.cloud.google.com/projectcreate** → name it `shared-finances` → **Create**.
2. Copy the **Project number** from the console home page's *Project info* card — number, not id.
3. **console.cloud.google.com/apis/library/sheets.googleapis.com** → check the selector says
   `shared-finances` → **Enable**.
4. Apps Script → **Project Settings** → **Google Cloud Platform (GCP) Project** → **Change project**
   → paste the number → **Set project**.

## 5. Publish the consent screen

**Do not leave this in Testing**: a script whose Cloud project's consent screen is in Testing has its
authorization expire after **7 days**, so the token endpoint stops working about a week after setup,
with a symptom indistinguishable from a quota problem. Publishing removes the expiry.

1. **console.cloud.google.com/auth/overview** (older consoles: **APIs & Services → OAuth consent
   screen**). If offered **Get started**: app name `Shared Finances`, the dedicated address for both
   support and contact, audience **External**, **Create**.
2. **Audience** → **Publishing status** → **Publish app**.

Publishing submits nothing for review; you still click through **Advanced → Go to … (unsafe)** when
authorizing. Add no scopes — `ScriptApp.getOAuthToken()` does not route through this screen.

## 6. Deploy

1. **Deploy** → **New deployment** → gear → **Web app**.
2. **Execute as: Me**, **Who has access: Anyone**, not "Anyone with a Google Account" — no Google login.
3. **Deploy**, then authorize as the dedicated account: **Advanced** → **Go to… (unsafe)** → **Allow**
   (the spreadsheets prompt is step 3's scope), and copy the **Web app URL**, ending in `/exec`.

Only POSTs are answered, so a browser address bar proves nothing. With `$URL`, `$KEY` and `$SHEET` set:

```sh
TOKEN=$(curl -sSL "$URL" -H 'Content-Type: text/plain;charset=utf-8' \
  --data "{\"key\":\"$KEY\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://sheets.googleapis.com/v4/spreadsheets/$SHEET?fields=sheets(properties(title))"
```

A tab list means it works; `SERVICE_DISABLED` means step 4 did not take. `--data` with no `-X POST`
is deliberate: `/exec` answers with a 302 that has to be followed as a GET.

## 7. Point the app at it

Locally, `cp .env.example .env` (gitignored), paste the `/exec` URL, and `npm run dev` serves
http://localhost:5173/verbose-octo-pancake/. For Pages, **Settings → Secrets and variables → Actions →
Variables** must hold `VITE_SCRIPT_URL` — a *variable*, not a secret, since Vite inlines it into the bundle
and it is public either way — and **Settings → Pages → Source** must be **GitHub Actions**, or Pages
publishes the repository tree verbatim and ignores the artifact, with a 404 for `/src/main.jsx` as the tell.

## 8. Each device, once

Open the app and paste the app key; nothing expires, so this is once per phone, not once an hour. An
installed web app has **its own storage, separate from Safari's**, so install first (**Share → Add to Home
Screen**) and enter the key there; iOS can also evict storage from an app left unused for long, after which
you retype the key and the ledger rebuilds. Then pick which of the two people you are — a per-device choice
nothing detects, because the token belongs to the sheet's owner.

## 9. The recurring-cost trigger (optional)

Only needed if you want rent to land without anyone opening the app; without it, **Settings → Recurring
costs** still lists every cost with a **Record** button wherever the month is missing one
([README.md](README.md#recurring-tab) describes the tab). Set up a cost first, or a run has nothing to do:
one with an **amount** posts itself, one with a blank amount stays tap-to-record, and a cost that ends is
**stopped**, not deleted, since its id is the sheet's only record of the months it covered. Same project as
the minter, which already holds `SHEET_ID`, the authorization and `postRecurring`, from step 3.

1. Confirm the manifest from step 3 carries `"timeZone": "Asia/Tokyo"`.
2. **Editor** → clock icon (**Triggers**) → **Add Trigger**: function `postRecurring`, deployment
   **Head**, event source **Time-driven**, **Day timer**, **3am to 4am**.
3. Set **Failure notification settings** to **Notify me immediately**, not the **daily** default: that
   mail is the only channel reporting this stopping, and the app cannot see it.
4. **Save** and authorize, then run `postRecurring` once from the editor and check **Executions**.

Create the trigger in the UI, not with `ScriptApp.newTrigger`, which would need `script.scriptapp` added to
`oauthScopes`. **Triggers run HEAD; the web app runs the pinned deployment** — saving `Code.gs` changes
tonight's 3am run immediately while the token endpoint keeps serving step 6's version, so adding the poster
needs no new deployment and a half-finished edit left saved in the editor runs unattended. Cost is ~90
seconds of runtime a month against the free 90 minutes **per day**, shared with the minter.

## Rotating the app key

The only incident response this design has, and about a minute. Do it if a phone is lost, if the key is
shared by accident, or on any suspicion at all.

Generate one with `openssl rand -hex 32`, edit `APP_KEY` under Apps Script → **Project Settings** →
**Script Properties**, and have both people open the app and enter it.

No redeployment: `APP_KEY` is read inside `doPost`, so the change takes effect on the next request.
Editing `Code.gs` is the opposite — a deployment is pinned to a version, so saving the editor changes
nothing until **Deploy → Manage deployments →** pencil → **New version**. Rotation stops new tokens at once,
but one already issued lives out its hour, since there is no revoking it individually; the endpoint URL does
not change and the app needs no rebuild.
