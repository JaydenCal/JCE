# Glide Inside go-live pack

Prepared 11/11/2026. Nothing in this pack has been deployed or uploaded. No live key was used and no email was sent.

What goes live: Find my block (live NSW and QLD services), setbacks, the AI helper (A$35 Plan Pack), the redesigned website, and Send to JCE (email through Resend to enquiries@jceinfrastructure.com.au). The builder portal opens with a free 14 day trial (see "Builder portal and free trial" below).

Plain rules for this pack:
- Do the steps in order. Do not skip Step 0.
- Commands are for PowerShell on your PC. Lines starting with `#` are comments, you do not type them.
- Anything in CAPITALS in angle brackets, like `<YOUR EMAIL>`, is yours to fill in.

---

## Step 0. STOP and read this first (the live Worker has code that is not in the repo)

Your live API answers `https://glideinside.com.au/api/health` with `{"ok":true,"sharing":true,...}`. The word `sharing` means the deployed Worker has the save-and-share feature and the R2 bucket `pocket-architect-files`. **That code is not in the repository branch this release was built from** (there is no share route, no R2 binding and no "sharing" in `server/`). If you deploy the Worker from this repo as it stands, the deploy replaces the live Worker and the share links and renders stop working.

So:
1. Do **not** run Steps 4 to 6 (the Worker deploy) until the live server code is merged into the repo. Steps 1 to 3 and the website upload (Step 7) are safe on their own, and the website works with the old Worker for everything except the new features (see "What works without the new Worker" at the end of this step).
2. To merge: copy the folder `Downloads\glideinside-v6\server` (the one you ran `deploy.ps1` from, including its `wrangler.toml`) to a place Claude can read and ask for the share and R2 code to be merged into `GlideInside/pocket-architect-source/server/`. The merge must keep every route the live Worker serves and keep the bindings: D1 `DB`, the R2 bucket, and any others listed in that `wrangler.toml`.
3. Check what the live Worker serves today and keep the result (it is your "before" picture):

```powershell
curl.exe -s https://glideinside.com.au/api/health
curl.exe -s -o NUL -w "%{http_code}`n" https://glideinside.com.au/api/site/health
```

What works without the new Worker: the redesigned pages and the setbacks (they need no API: the rules are static files). Find my block, Send to JCE and the setbacks-aware AI helper need the new Worker (`/api/site/*`, `/api/enquiry/jce`, new AI tools).

The repo `wrangler.toml` has a deliberately invalid name (`REPLACE-WITH-THE-LIVE-WORKER-NAME`) and a `REPLACE-WITH` database id, so a deploy fails until you edit them. That is a safety catch.

---

## 1. Cloudflare account and Wrangler login (already set up, 2 minute check)

You already have the Cloudflare account, the zone glideinside.com.au, the Workers Paid plan, D1 and R2. The Paid plan matters: contour and PDF requests need more than the free plan's 10 ms of CPU.

1. Open PowerShell and go to the server package folder (the one that holds `wrangler.toml`):
   `cd $env:USERPROFILE\Downloads\glideinside-v6\server` (after Step 0 this is the merged `pocket-architect-source` folder instead).
2. `npx wrangler login`. A browser window opens. Click **Allow**.
3. `npx wrangler whoami`. It should list your account and `workers_write` and `d1_write`.
4. Open the Cloudflare dashboard, **Workers and Pages**, and write down the name of the existing Worker (the one on the route `glideinside.com.au/api/*`). Put that name on the `name =` line of `wrangler.toml`. Put the D1 `database_id` from **Storage and databases > D1 > your database** on the `database_id =` line.

## 2. D1: apply the updated schema (additive, safe to repeat)

The new schema adds tables (`site_cache`, `jce_enquiries` and the portal tables). It does not change or delete existing tables.

```powershell
# find the database name if you are not sure
npx wrangler d1 list
# apply (the database is called plan-studio unless the list says otherwise)
npx wrangler d1 execute plan-studio --remote --file server/schema.sql
```

Check: `npx wrangler d1 execute plan-studio --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"` should list `site_cache` and `jce_enquiries`.

## 3. Secrets and variables

Already set, do not touch: `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `ENTITLEMENT_SECRET` (if it is not set the AI and checkout would not work, so it is).

New secrets (each command asks you to paste the value):

```powershell
npx wrangler secret put RESEND_API_KEY      # from Step 4 below (starts with re_)
npx wrangler secret put ADMIN_TOKEN         # any long random string; make one with the next lines
```

Make an ADMIN_TOKEN and keep it in your password manager:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
```

New variables (already in the repo `wrangler.toml` under `[vars]`, so the deploy sets them):

| Name | Value |
|---|---|
| `SITE_URL` | `https://glideinside.com.au` |
| `APP_URL` | `https://glideinside.com.au/plan-studio/app/` |
| `ENQUIRY_TO` | `enquiries@jceinfrastructure.com.au` |
| `ENQUIRY_FROM` | `Glide Inside <plans@glideinside.com.au>` |
| `SELLER_NAME` | `JCE Infrastructure Pty Ltd trading as Glide Inside` |
| `SELLER_ABN` | `29 699 165 663` |
| `PLAN_PACK_PRICE_CENTS` | `3500` (only used if `STRIPE_PRICE_ID` is empty) |
| `PORTAL_ENABLED` | `1` (builder portal open, free trial) |
| `TRIAL_NOTIFY` / `TRIAL_NOTIFY_TO` | `1` / `hello@glideinside.com.au` (owner email about trial requests) |

Important: if `STRIPE_PRICE_ID` is set, the price shown at Stripe checkout comes from that Stripe price, not from the Worker. Open **Stripe (test mode) > Product catalogue > Plan Pack** and check the price is A$35.00. If it is A$30.00, create a new A$35 price, copy its `price_...` id and run `npx wrangler secret put STRIPE_PRICE_ID`.

Stripe stays as it is. The Stripe secrets you set on 15/10/2026 are test mode keys, so the Plan Pack takes **test payments only** until you switch to live keys (see "Later: real payments" at the end). That is your decision, not part of this go-live.

## 4. Resend (email for Send to JCE)

1. Go to https://resend.com and click **Sign up**. Use an email you control. Confirm the email.
2. In the left menu click **Domains**, then **Add Domain**. Type `glideinside.com.au`. Pick the region closest to you (Sydney if offered, otherwise the default). Click **Add**.
3. Resend shows a table of DNS records. These come from the Resend dashboard and are specific to your domain, so copy them from there, do not type them from memory. Expect three kinds: an SPF record (TXT), a DKIM record (TXT, name starting `resend._domainkey`) and a return-path record (MX, on a name like `send`). Resend may also show a DMARC suggestion. It is optional.
4. The DNS for glideinside.com.au is on Cloudflare (not VentraIP). Open the Cloudflare dashboard, click `glideinside.com.au`, then **DNS > Records**. For each row in Resend click **Add record** and copy Type, Name and Content exactly. For every one of these records set **Proxy status** to **DNS only** (grey cloud). Click **Save**.
5. Back in Resend click **Verify DNS Records**. It can take a few minutes, sometimes an hour. Wait until the domain says **Verified**.
6. In Resend click **API Keys**, then **Create API Key**. Name it `glideinside-worker`. Permission: **Sending access**. Domain: `glideinside.com.au`. Click **Add** and copy the key now (it is shown once). Use it for `RESEND_API_KEY` in Step 3.

These Resend records live on the `send` and `resend._domainkey` names. They do not touch your existing mail records on the root domain.

## 5. DNS for the API

Nothing to do. The API stays on the same site at `https://glideinside.com.au/api/*` through the Cloudflare route you already have, so there is no `api.` subdomain, no CORS and cookies stay same-site for the portal later. Check the route is still there: Cloudflare dashboard, **Workers and Pages**, your Worker, **Settings > Domains and Routes**. It should list `glideinside.com.au/api/*`. The repo `wrangler.toml` repeats it, so a deploy keeps it.

## 6. Deploy the Worker (only after Step 0 is cleared)

From the folder that holds `wrangler.toml`:

```powershell
# one command: schema, any missing secrets, deploy (skips secrets that are already set)
powershell -ExecutionPolicy Bypass -File <PATH TO>\golive\deploy-golive.ps1
```

Or by hand: `npx wrangler deploy --keep-vars` (`--keep-vars` keeps any variable you set only in the dashboard).

## 7. Checks on the API (before the website upload)

```powershell
curl.exe -s https://glideinside.com.au/api/health
curl.exe -s https://glideinside.com.au/api/site/health
```

- `/api/health` must still show `"ok":true` and `"sharing":true` (that proves the share feature survived) and `"paymentsConfigured":true`.
- `/api/site/health` lists each government service. `"ok":true` is enough to launch (it means the address and lot services answer). `"allOk":false` with one aerial or elevation service down is a warning, not a stop: the app carries on without that layer. If `"ok":false`, do not upload the website yet; wait and retry in 10 minutes.

## 8. Upload the website (cPanel, VentraIP account `glideins`)

Files: `glideinside-site-upload.zip` (only the 152 changed and new files; the list is in `UPLOAD_FILES.txt`). `glideinside-site-full.zip` is a complete copy for reference. Do not use the full zip over the live site unless you mean to.

Never upload `.htaccess`, `.user.ini` or `contact-config.php` (neither zip contains them).

Do **not** upload `subdivision/` (page, `assets/estate/`, `demo/`). The page put live on 11/11/2026 is newer than the repo copy: **keep the live version.** The new header and footer go on it in Step 9.

1. Log in to cPanel at VentraIP. Click **File Manager**. Click **public_html**. Tick **Show Hidden Files (dotfiles)** in Settings, then Save.
2. **Back up first.** Click **Compress**, tick all of public_html, choose **Zip Archive**, name it `public_html_backup_2026-11-11_golive.zip`, click **Compress Files**. Move that zip out of public_html (select it, **Move**, to `/home/glideins/backups/`) so it is not served.
3. Before overwriting `analytics.js`: right-click the live `analytics.js`, **Download**, and compare it with the one in the zip (a free tool such as Notepad++ Compare, or VS Code **Select for Compare**). The live copy was patched on 11/11/2026 to send a GA4 event for Book a demo clicks. The new copy sends an event named `book_demo` (with `page`, `button` and `link_text`) for every Book a demo and Register interest button. If the live copy has any other change, keep it and add it to the new file before uploading.
4. In File Manager click **Upload**, drag `glideinside-site-upload.zip` into the box, wait for 100%, click **Go Back**.
5. Right-click `glideinside-site-upload.zip` in public_html, click **Extract**, leave the path as `/public_html`, click **Extract File(s)**, then **Close**. Say yes to overwriting.
6. Delete `glideinside-site-upload.zip` from public_html.
7. **Purge Cloudflare cache.** The site is proxied, so old pages are cached. Cloudflare dashboard, `glideinside.com.au`, **Caching > Configuration > Purge Everything**, **Purge Everything**.
8. Open https://glideinside.com.au/ in a private window. The hero must say "Setbacks drawn from council or state code rules". https://glideinside.com.au/plans/ must not say "Free to draw" near the top. The Pricing tab title must not show the price.

The sitemap no longer lists terms and privacy (both are noindex). The portal pages (`/portal/`) and `site.config.js` (`portalLive` true) are part of the portal launch: see "Builder portal and free trial".

## 9. /subdivision/: keep the live page, swap only the header and footer

Do this after Step 8. The script keeps everything else on that page byte for byte.

1. cPanel File Manager, open `public_html/subdivision/`. Right-click `index.html`, **Download**. Keep that file as your backup too.
2. Put the downloaded file in `C:\Users\<YOU>\Downloads\sub\index.html`.
3. In PowerShell, from the repo folder `GlideInside\pocket-architect-source`:

```powershell
node tools/reskin-subdivision.mjs C:\Users\<YOU>\Downloads\sub\index.html C:\Users\<YOU>\Downloads\sub\index.new.html
```

   It prints what it replaced. If it prints a line starting `WARNING other ABN`, that old ABN text is elsewhere in the page body and needs a manual edit (the footer itself is already correct).
4. The page needs the stylesheet `assets/gi-chrome.css`. It is already in the upload zip (Step 8), so check `public_html/assets/gi-chrome.css` exists.
5. In cPanel, upload `index.new.html` into `public_html/subdivision/`, delete nothing, then rename the live `index.html` to `index.html.bak-2026-11-11` and rename `index.new.html` to `index.html`.
6. Purge the Cloudflare cache again (Step 8, point 7) and open https://glideinside.com.au/subdivision/ to check the header, footer and mobile menu. The URL must still work (the JCE site and the ads planned for 16/11/2026 point to it).

## 10. Ten minute live test

Use a laptop and a private window. The Plan Pack is in Stripe test mode, so you can pay with the test card.

1. Open https://glideinside.com.au/plan-studio/launch/ and click **Launch the tool**. Look for **Find my block** in the top bar.
2. **NSW test.** Click **Find my block** and type a real residential street address in Tamworth (an address you know well). Pick it from the list.
   - Check: the lot outline matches the real block; neighbouring lots show lot and DP labels; an aerial image sits under the plan; contour lines show with levels; the credits at the bottom right name NSW Spatial Services and say CC BY 3.0 AU.
3. Click **Confirm frontage** (blue edge is the street side; click an edge to change). In the right panel under **Site**, find **Setbacks (indicative)**.
   - Check: front, side and rear distances appear with a **Basis** line (Council DCP or Codes SEPP Inland Code) and a **Source** line naming the document, and the words **check with council** where flagged. A green dashed envelope shows on the plan. The wording must never say "compliant".
4. Click **3D**. The ground shows the aerial and the lot boundary.
5. **QLD test.** Click **Find my block** again, type a real Townsville address (for example a street in Kirwan or Douglas). Pick it.
   - Check: lot, neighbours, aerial (it may be withheld with a message if no open licence aerial exists, that is correct behaviour), contours, and the credits mention State of Queensland and CC BY-SA.
   - Confirm frontage. Setbacks for QLD use the QDC default and only work for lots up to 450 m2 and when you choose a **Street type**. For a larger lot the panel says it could not work them out and tells you to check the council. That is expected, tell Claude if you want this changed.
6. Place a house: pick a template (for example Single storey house), drag it onto the lot. Use **Assistant** to ask "check my setbacks" once you have paid (next step).
7. Click **Unlock plans, A$35**. Stripe opens in test mode. Pay with card `4242 4242 4242 4242`, any future expiry, any CVC, any postcode. You return to the tool unlocked. If it does not unlock in about 30 seconds, click **Restore purchase** and use the email you paid with.
8. **AI helper.** Open **Assistant** and type "Move the house to the middle of the lot and check the setbacks". It should reply, show a credit counter (500 credits), and the house moves. It must say "inside the indicative setback envelope", never "compliant".
9. **PDF export.** Click **Exports > PDF**. Open the PDF. Check the title block, the Pocket Architect drawing set, and the footer on every sheet naming the data sources and "indicative only". For a QLD lot the footer names the State of Queensland (CC BY-SA).
10. **Send to JCE test (to your own address first).** Before this step, point the enquiry at yourself for the test only:

```powershell
npx wrangler deploy --keep-vars --var ENQUIRY_TO:<YOUR EMAIL>
```

   In the tool click **Exports > Send to JCE** (the wording may read "Send to JCE for engineering and DA plans"). Fill in name, phone, email, tick the consent box, click **Send**. You should get a reference like GI-ABCDE and the email (with the PDF attached) should arrive in your inbox within a minute. Check spam once.
   Then put it back to the real address:

```powershell
npx wrangler deploy --keep-vars
```

   (the repo `wrangler.toml` holds `ENQUIRY_TO = "enquiries@jceinfrastructure.com.au"`). Confirm with one more test send only if you want to; it would email JCE.
11. Check the save-and-share feature you already had still works (make a share link and open it in a second window), because it lives in the same Worker.

If any step fails, go to Section 11 (rollback) and message Claude with the step number and a screenshot.

## 11. Rollback

Website:
1. cPanel File Manager, public_html. Upload the backup zip `public_html_backup_2026-11-11_golive.zip` back into public_html, right-click, **Extract** (say yes to overwrite). That restores every file from before.
2. For `/subdivision/` only: rename `index.html` to `index.html.new` and `index.html.bak-2026-11-11` back to `index.html`.
3. Purge the Cloudflare cache (Caching > Configuration > Purge Everything).

Worker:
1. Cloudflare dashboard, **Workers and Pages**, your Worker, **Deployments** (or **Versions**). Find the version from before today, click **Rollback to this version**. Or from PowerShell: `npx wrangler rollback` and pick the previous version.
2. The database change is additive (new tables only), so nothing needs undoing there.
3. To stop only the new features without a rollback: delete the `RESEND_API_KEY` secret (`npx wrangler secret delete RESEND_API_KEY`). Send to JCE then says it is not configured and nothing else is affected.

---

## Later: real payments (not part of this go-live)

The Plan Pack uses the Stripe test keys you set on 15/10/2026, so customers cannot really pay yet. When you decide to take real money: create the A$35 Plan Pack price in Stripe **live** mode, create the live webhook `https://glideinside.com.au/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `charge.refunded`, then run `npx wrangler secret put STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_ID` with the live values and redeploy. Say the word and Claude will write the click by click steps.

## Builder portal and free trial (switched on 11/11/2026)

The repo now has the portal ON: `PORTAL_ENABLED = "1"` in `wrangler.toml`, `portalLive`, `portalEnabled: true` and `portalMock: false` in `website-live/site.config.js` (REVIEW_BUILD stays false, mocks off). The built app page `plan-studio/app/index.html` now loads `../../site.config.js` so Pocket Architect sees the same switches. Builders ask for a free 14 day trial on `/for-builders/#trial`; you approve each one. Nothing here has been deployed.

Do these in order, after Steps 0 to 7 above:

1. **Schema.** Re-run `server/schema.sql` (Step 2). It adds two tables, `trial_requests` and `org_accounts`, plus the portal tables if they are not there yet. Additive and safe to repeat.
2. **Secrets already needed:** `ADMIN_TOKEN` (Step 3) and `STRIPE_SECRET_KEY` (a TEST key). `RESEND_API_KEY` also sends you the trial request email.
3. **New variables** (in `wrangler.toml`): `TRIAL_NOTIFY = "1"` (set `"0"` to stop the email) and `TRIAL_NOTIFY_TO = "hello@glideinside.com.au"` (your own address; empty means no email). The email goes to you only. The builder is never emailed.
4. **Stripe webhook.** In the Stripe dashboard (test mode) the endpoint `https://glideinside.com.au/api/stripe/webhook` must also receive `checkout.session.completed` for card setup. It is the same event the Plan Pack uses, so if that is already ticked there is nothing to add. Check the `STRIPE_WEBHOOK_SECRET` matches.
5. **Monthly billing cron.** `[triggers] crons = ["0 19 * * *", "0 20 * * *"]` is already in `wrangler.toml`. It runs daily and the code only acts at 06:00 on the 1st, Sydney time (`L` is not valid in a Cloudflare cron). Charges go to a saved card automatically; with no card, Stripe emails an invoice. Test keys only until you give the written go-ahead for live billing.
6. Deploy the Worker (Step 6) and upload the website (Step 8). The new files are `trial-terms.html`, `for-builders/index.html`, `pricing/index.html`, `portal/` (including `portal/admin/`), `site.config.js` and `plan-studio/app/index.html`. Purge the Cloudflare cache.

**The admin page.** Open `https://glideinside.com.au/portal/admin/` (not linked anywhere, noindex). Paste your `ADMIN_TOKEN` once; it is kept in that browser tab only and forgotten when you close it or press Lock. It lists trial requests (pending, approved, declined) and builder accounts (trial, trial ended, active, read only) with client logins issued, AI use and invoices. **Approve** creates the account and shows the username and temporary password once, with Copy: you pass them on yourself. **Decline** keeps a note. **Extend 7 days**, **Convert to paid** (for someone who pays you another way) and **New admin password** are on each account.

**Test it first (test mode):** submit the form with an ABN that passes the checksum, approve it on the admin page, sign in at `/portal/` with the login, try Generate account (refused during the trial), press Add billing details and pay with `4242 4242 4242 4242`, then Generate account works. Rollback: set `PORTAL_ENABLED = "0"` and redeploy; logins close, trial requests and the admin page keep working.

## Files in this folder

- `GO-LIVE.md`: this document.
- `glideinside-site-upload.zip`: the 152 files to upload. `UPLOAD_FILES.txt` lists them.
- `glideinside-site-full.zip`: a complete copy of the site, excluding `subdivision/` and the review screenshots.
- `deploy-golive.ps1`: Worker deploy that skips secrets that are already set.
