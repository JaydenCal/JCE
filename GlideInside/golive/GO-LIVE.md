# Glide Inside go-live pack

Prepared 11/11/2026. Nothing in this pack has been deployed or uploaded. No live key was used and no email was sent.

What goes live: Find my block (live NSW and QLD services), setbacks, the AI helper (A$35 Plan Pack), the redesigned website, and Send to JCE (email through Resend to enquiries@jceinfrastructure.com.au). The builder and client portal stays closed.

Plain rules for this pack:
- Do the steps in order. Do not skip Step 0.
- Commands are for PowerShell on your PC. Lines starting with `#` are comments, you do not type them.
- Anything in CAPITALS in angle brackets, like `<YOUR EMAIL>`, is yours to fill in.

---

## Step 0. The live server code is merged (read this, then do the checks)

The live Worker `pocket-architect-api` (deployed 15/10/2026) had Save and share, R2 file storage and its own D1 tables that were not in this repository. They are now merged into `server/` (branch `claude/glide-server-merge`). Deploying this release **replaces** that Worker. It was built so that nothing live breaks:

- Same Worker name `pocket-architect-api`, same route `glideinside.com.au/api/*`, same D1 database `pocket-architect` (id `fccdf1f7-e48c-4c72-8723-b343b3f2fad4`), same R2 bucket `pocket-architect-files`. All of it is in `wrangler.toml`, so there is no name or id to edit.
- Every live route still answers: `/api/health` (still with `"sharing":true`), `/api/projects` (Save and share, so every share link already handed out keeps working), `/api/checkout`, `/api/stripe/webhook`, `/api/entitlement`, `/api/entitlement/restore`, `/api/credits`, `/api/ai/estimate`, `/api/ai/edit`, `/api/export/pdf|dxf|glb|obj`.
- The database change is additive only (one new column and new tables). No live table, column or row is dropped or rewritten. Existing Plan Pack purchases (test mode so far) keep their credits and PDF set. Tokens already in customers' browsers stay valid as long as `ENTITLEMENT_SECRET` is not changed.
- The live secrets stay as they are. Do NOT change `ENTITLEMENT_SECRET` or `IP_HASH_SALT`. The only secrets you set are in Step 3.

Before you deploy, write down the "before" picture and have ready **one real share link** you already gave out (`https://glideinside.com.au/plan-studio/app/?share=...`). The part after `share=` is the id.

```powershell
curl.exe -s https://glideinside.com.au/api/health
# expect {"ok":true,"sharing":true,"aiPaused":false,"paymentsConfigured":true}
curl.exe -s https://glideinside.com.au/api/projects/<THE SHARE ID>
# expect JSON containing "project"
```

Differences from the live Worker to decide on before you deploy (none breaks a link or a purchase):
1. **The release app has no Save and share button.** The server serves old links, but the release `plan-studio/app/index.html` does not open `?share=` links and cannot create new ones. If you upload the release app, old share links will not open in the browser. Either keep the old app file until the button is added to the release app, or have it added first.
2. **The "interactive HTML" export is gone** (`/api/export/html` answers 400). The release app has no button for it, but the plans pages and the FAQ still list it in the Plan Pack. Change the wording or have it added back.
3. A Checkout session unlocks a pack only if it is a one-off AUD payment of at least A$35 for this app (same rule as live). A price set to A$30 unlocks nothing.
4. The assistant (`/api/ai/*`) uses the release tools and context. An old cached copy of the old app asking the new assistant for an edit may get changes it cannot apply. Upload the website straight after the Worker deploy (Steps 6 to 8), in a quiet period.
5. Assistant spend limits are now the release ones (US$5 a day, US$50 a month, 6 requests a minute) in place of the live `AI_DAILY_TOKEN_CAP`. Change `AI_DAILY_CAP_USD` and `AI_MONTHLY_CAP_USD` in `wrangler.toml` if you want others.
6. One PDF plan set per job is still enforced exactly as live (the set is kept in R2 under `pdf/` and a repeat request returns the same file). `PDF_SET_LIMIT = "0"` turns it off.

## 1. Cloudflare account and Wrangler login (already set up, 2 minute check)

You already have the Cloudflare account, the zone glideinside.com.au, the Workers Paid plan, D1 and R2. The Paid plan matters: contour and PDF requests need more than the free plan's 10 ms of CPU.

1. Open PowerShell and go to the folder that holds `wrangler.toml` and `package.json` (`GlideInside\pocket-architect-source`), then run `npm ci`.
2. `npx wrangler login`. A browser window opens. Click **Allow**.
3. `npx wrangler whoami`. It should list your account and `workers_write` and `d1_write`.
4. Nothing to edit: `wrangler.toml` already has the live Worker name, route, D1 database id and R2 bucket. Check it says `name = "pocket-architect-api"` and `database_id = "fccdf1f7-e48c-4c72-8723-b343b3f2fad4"`.

## 2. D1: apply the migrations (additive, in order)

The database is the live one, `pocket-architect` (not `plan-studio`). Its tables came from the live `schema.sql` and migrations 0002 to 0005. The release adds `server/migrations/0001_base.sql` (the live base, a no-op on the live database), `0006_release.sql` and `0007_portal.sql`. 0006 adds one column to `entitlements` (`credits_reserved`) and new tables. 0007 adds the portal tables (unused while `PORTAL_ENABLED` is 0). Nothing is dropped, renamed or rewritten, so the previous Worker version keeps working on this database if you roll back.

Take a backup first:

```powershell
npx wrangler d1 export pocket-architect --remote --output "$env:USERPROFILE\Downloads\pocket-architect-before-release.sql"
```

List what will run, then apply. Wrangler records what it applied, so a second run does nothing (the 0006 column cannot be added twice, which is why you use this command and not `d1 execute --file`):

```powershell
npx wrangler d1 migrations list pocket-architect --remote
npx wrangler d1 migrations apply pocket-architect --remote
```

On the live database 0001 to 0005 show as not yet recorded, because they were run by hand on 15/10/2026. That is fine: they are repeatable and change nothing there. At the end 0001 to 0007 are all marked done.

Check:

```powershell
npx wrangler d1 execute pocket-architect --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
npx wrangler d1 execute pocket-architect --remote --command "SELECT COUNT(*) AS purchases, SUM(credits_reserved) AS reserved FROM entitlements"
npx wrangler d1 execute pocket-architect --remote --command "SELECT COUNT(*) AS shared_designs FROM projects"
```

The table list must include `ai_requests`, `site_cache`, `jce_enquiries`, and still `projects` and `entitlements`. `reserved` must be 0 and `shared_designs` the same number as before.

Only if an assistant request was running on the old Worker at the moment you deployed: the old code held credits by adding them to `credits_used`. Check for open holds (normally none):

```powershell
npx wrangler d1 execute pocket-architect --remote --command "SELECT id, eid, credits FROM ai_reservations WHERE settled=0"
```

A hold older than a few minutes means a crashed request; give those credits back with `UPDATE entitlements SET credits_used = MAX(0, credits_used - <credits>) WHERE id = '<eid>'`.

## 3. Secrets and variables

Already set on the live Worker, leave them: `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `ENTITLEMENT_SECRET`, `IP_HASH_SALT`, and `TEST_CODES` if you set it. The release reads all of them under the same names. Check with `npx wrangler secret list`.

New secrets (each command asks you to paste the value):

```powershell
npx wrangler secret put RESEND_API_KEY      # from Step 4 below (starts with re_)
npx wrangler secret put ADMIN_TOKEN         # any long random string; make one with the next lines
```

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
```

**Stripe live keys (only when you take real payments, you said you will switch at this launch).** Do this in the Stripe dashboard in LIVE mode, then set the three secrets, then deploy (Step 6):

1. Create the Plan Pack product in live mode: A$35.00, one-off, **Include tax in price** ticked. Copy its `price_...` id.
2. Developers > Webhooks > Add endpoint: `https://glideinside.com.au/api/stripe/webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Copy the signing secret (`whsec_...`) of this live endpoint.
3. Set the three secrets (live values):

```powershell
npx wrangler secret put STRIPE_SECRET_KEY       # sk_live_... (a restricted key with Checkout Sessions write is enough)
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # whsec_... from the LIVE endpoint
npx wrangler secret put STRIPE_PRICE_ID         # price_... of the live A$35 price
```

The live and test webhooks are different endpoints with different secrets. Keep the test endpoint until the live test purchase works, then delete it.

**What happens to test-mode purchases when Stripe goes live:** they stay in the database and keep working (credits, PDF set, Restore purchase), because the server never asks Stripe about them again. A refund or dispute for a test payment will never arrive at the live webhook, so test purchases are never revoked. They expire on their own date (365 days after purchase). If you want them gone before launch: `npx wrangler d1 execute pocket-architect --remote --command "UPDATE entitlements SET status='expired' WHERE stripe_session_id LIKE 'cs_test_%'"` (this is a change to rows, take the backup in Step 2 first). The friends code (`TEST_CODES`) packs are not Stripe payments and are not affected. Test sessions already open in a browser at the switch cannot be paid after the key changes.

Variables already in `wrangler.toml` under `[vars]` (the deploy sets them):

| Name | Value |
|---|---|
| `SITE_URL` | `https://glideinside.com.au` |
| `APP_URL` | `https://glideinside.com.au/plan-studio/app/` |
| `ENQUIRY_TO` | `enquiries@jceinfrastructure.com.au` |
| `ENQUIRY_FROM` | `Glide Inside <plans@glideinside.com.au>` |
| `SELLER_NAME` | `JCE Infrastructure Pty Ltd trading as Glide Inside` |
| `SELLER_ABN` | `29 699 165 663` |
| `PLAN_PACK_PRICE_CENTS` | `3500` (also the least a payment may be worth to unlock a pack) |
| `PORTAL_ENABLED` | `0` (portal stays closed, no billing cron) |
| `PROJECT_MAX_BYTES`, `PROJECT_TTL_DAYS`, `PROJECT_SAVE_RATE_MAX`, `EXPORT_RATE_PER_HOUR`, `PDF_SET_LIMIT` | the live defaults |

The price shown at Stripe checkout comes from `STRIPE_PRICE_ID` (a secret). Never add a `[vars]` line for a secret's name: it would replace the secret on deploy (a test checks this).

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

## 6. Deploy the Worker (after Steps 1 to 4 are done)

From the folder that holds `wrangler.toml`. Do a dry run first (it bundles and lists the bindings, it deploys nothing and calls nothing):

```powershell
npx wrangler deploy --dry-run
# must list env.DB (pocket-architect), env.FILES (pocket-architect-files) and finish with: --dry-run: exiting now.
```

Then the deploy. The script `golive\deploy-golive.ps1` runs the migrations (Step 2), asks only for the new secrets that are missing, and deploys:

```powershell
powershell -ExecutionPolicy Bypass -File <PATH TO>\golive\deploy-golive.ps1
```

By hand: `npx wrangler deploy --keep-vars` (`--keep-vars` keeps any variable you set only in the dashboard). Note the version id it prints, you need it for rollback.

## 7. Smoke test of the API (before the website upload)

```powershell
curl.exe -s https://glideinside.com.au/api/health
curl.exe -s https://glideinside.com.au/api/site/health
curl.exe -s https://glideinside.com.au/api/projects/<THE SHARE ID YOU NOTED IN STEP 0>
curl.exe -s -o NUL -w "%{http_code}`n" https://glideinside.com.au/api/projects/doesnotexist1234567
```

- `/api/health` must be exactly `{"ok":true,"sharing":true,"aiPaused":false,"paymentsConfigured":true}`. `"sharing":true` proves R2 and the share table are bound. `"paymentsConfigured":false` means a Stripe secret is missing: roll back.
- The **existing share link must return its design** (`"project":{...}`). This is the test that matters. If it does not, roll back (Step 11) and tell Claude.
- The made up id must give `404`.
- `/api/site/health`: `"ok":true` is enough to launch. `"ok":false`: wait 10 minutes and retry before uploading the site.
- With the old app still on the site, press Restore purchase with a test purchase email and its `cs_test_...` reference: it must unlock (this proves the old purchases are read).
- Do not run these against a real customer's data beyond reading.

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

The sitemap no longer lists terms and privacy (both are noindex). The portal pages (`/portal/`) are not in this upload on purpose. `site.config.js` is unchanged: `portalLive` stays `false`.

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

Use a laptop and a private window. If you have NOT switched Stripe to live keys (Step 3) the Plan Pack is in test mode and you pay with the test card. If you have, use a real card for A$35 and refund it afterwards in Stripe.

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
11. Save and share: if the app you uploaded has the Save and share button, make a link and open it in a private window, then open the old link from Step 0. If it has no button (see Step 0, point 1), open the old link on the OLD app only, and do not delete the old app file.

If any step fails, go to Section 11 (rollback) and message Claude with the step number and a screenshot.

## 11. Rollback

Website:
1. cPanel File Manager, public_html. Upload the backup zip `public_html_backup_2026-11-11_golive.zip` back into public_html, right-click, **Extract** (say yes to overwrite). That restores every file from before.
2. For `/subdivision/` only: rename `index.html` to `index.html.new` and `index.html.bak-2026-11-11` back to `index.html`.
3. Purge the Cloudflare cache (Caching > Configuration > Purge Everything).

Worker:
1. `npx wrangler rollback` (pick the version that was live before, the one printed before your deploy; `npx wrangler deployments list` shows them), or Cloudflare dashboard, **Workers and Pages**, `pocket-architect-api`, **Deployments**, **Rollback to this version**. The old code runs again on the same route.
2. The database does not need undoing. The migrations only added a column and tables, and the old code ignores them. Entitlements and share links written while the release ran are readable by the old Worker (the release keeps the live column `payment_intent`, the live token format and the live `projects` table and R2 keys). Credits the release had reserved for a request still running at that moment (column `credits_reserved`) are simply ignored by the old code, so nobody loses credits.
3. If the release had taken real Stripe payments before the rollback, the old Worker still needs the live Stripe secrets (they are the same secrets), so nothing else changes.
4. To stop only the new features without a rollback: `npx wrangler secret delete RESEND_API_KEY` (Send to JCE then says it is not configured and nothing else is affected).

---

## Real payments

Covered in Step 3 (Stripe live keys). After setting the live secrets and deploying, do one real A$35 purchase on a private window, check it unlocks and the Stripe invoice arrives, then refund it in Stripe and confirm access stops (the `charge.refunded` event reaches the live webhook).

## When the builder portal launches later

Set `PORTAL_ENABLED = "1"`, `portalLive: true` in `site.config.js`, `portalEnabled` and `REVIEW_BUILD` stay as the config says and rebuild. The portal sign in uses cookies, which work because the API is on the same site (`glideinside.com.au/api`). The portal needs month end invoicing with Stripe test keys only until you give written go-ahead.

## Files in this folder

- `GO-LIVE.md`: this document.
- `glideinside-site-upload.zip`: the 152 files to upload. `UPLOAD_FILES.txt` lists them.
- `glideinside-site-full.zip`: a complete copy of the site, excluding `subdivision/` and the review screenshots.
- `deploy-golive.ps1`: Worker deploy that skips secrets that are already set.
