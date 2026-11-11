# Glide Inside: go-live steps (15/10/2026)

Everything in this bundle is built and tested. These are the steps only you can do, in order.

## 1. Cloudflare (about 20 min, plus DNS wait)
1. glideinside.com.au currently points straight at your cPanel host (110.232.143.108), not Cloudflare. The API lives at `glideinside.com.au/api/*`, so the domain must go through Cloudflare:
   - Cloudflare dashboard > Add a domain > glideinside.com.au (Free plan). Check that the imported DNS records include the A record 110.232.143.108 and your email (MX) records. Set the A record to **Proxied** (orange cloud).
   - At your domain registrar, change the nameservers to the two Cloudflare gives you. This usually takes 15 min to a few hours.
   - Set SSL/TLS mode to **Full**.
2. Workers & Pages > Plans: upgrade to **Workers Paid (US$5 a month)**. Exports need more CPU time than the free plan allows.

## 2. Stripe (test mode first)
Follow `docs/STRIPE_TEST_MODE_CHECKLIST.md`. In short:
- Clear "Action required". Product "Pocket Architect plan (one job)", A$35, one-off, **Include tax in price** ticked. Copy the Price ID.
- Webhook to `https://glideinside.com.au/api/stripe/webhook` with these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Copy the signing secret.
- Settings > Business > Public details: Glide Inside, ABN 11 549 431 925. Turn on receipts.

## 3. Deploy the server (10 min)
On your PC, in the `server` folder: `bash deploy.sh`. It logs you into Cloudflare, creates the database and file storage, and asks for each secret: Stripe secret key (`sk_test_` first), webhook secret, Price ID, Anthropic API key. It generates the two internal secrets itself, only on the first run.
**New: Save and share, job zip and Render image.** If the database already exists (you ran `deploy.sh` before this build), run the new migration once on the remote database, in the `server` folder, before uploading the new app:
`npx wrangler d1 execute pocket-architect --remote --file=migrations/0005_projects.sql`
A brand new install gets it from `schema.sql` automatically. It is safe to run twice. Then redeploy the Worker (`bash deploy.sh` again, or `npx wrangler deploy`), because the share routes (`/api/projects`) are new. No new secrets are needed. The R2 bucket `pocket-architect-files` is reused (shared designs are stored under `projects/`).
Optional variables in `wrangler.toml` `[vars]` (defaults shown, already in `wrangler.toml.example`; copy them into your existing `wrangler.toml` only if you want to change them):
- `PROJECT_MAX_BYTES = "2000000"` largest design that can be saved online.
- `PROJECT_TTL_DAYS = "365"` how long a shared link lasts after the last save (each save extends it).
- `PROJECT_SAVE_RATE_MAX = "20"` saves per hour per visitor address (reads are limited to 600 an hour, `PROJECT_READ_RATE_MAX`).
Check: `https://glideinside.com.au/api/health` should now also show `"sharing":true`. Then in the app press Save and share, copy the link, and open it in a private window.
Emails typed into the Save and share box are only stored in the `projects` table (column `email`) as a lead. Nothing sends them any message. Export them yourself from the D1 console if you want them: `npx wrangler d1 execute pocket-architect --remote --command "SELECT email, name, created_at FROM projects WHERE email IS NOT NULL"`. Mention this in the privacy page.
Optional: `npx wrangler secret put TEST_CODES` with `PA-FRIENDS-4818BD73`.
Check: open https://glideinside.com.au/api/health. It should show `"ok":true` and `"paymentsConfigured":true`.

## 4. Upload the site (10 min)
Upload the contents of `site/` to the cPanel web root and overwrite the old files. This includes `.htaccess`, a hidden file, so turn on "show hidden files" in File Manager. Keep your old `commercial/` folder; the redirects point visitors away from it.

## 5. Test live (15 min)
- Stripe test card 4242 4242 4242 4242: Unlock, pay, come back unlocked with 500 credits, export the PDF, DXF and 3D model, then refund in Stripe and confirm access stops.
- AI helper: on your PC run `ANTHROPIC_API_KEY=... node server/test/ai-live-smoke.mjs` (5 calls, a few cents). Then ask the Assistant in the app for a change.
- Then switch the Stripe keys to live (`npx wrangler secret put STRIPE_SECRET_KEY` and the live webhook secret) and do one real A$35 purchase. Refund it if you want.

## 6. Before running ads
- Set a GA4 ID in `site/site.config.js` (`ga4Id`) and follow `docs/marketing/TRACKING.md`.
- Confirm A$35 is final. The A$15 "both" add-on link and the done-for-you "Order a plan from us" copy still exist: keep or remove them.
- Review the draft terms and privacy pages, including the 14-day refund wording.

## Known limits of tonight's build
- Save and share: the tracing underlay image stays in the browser, so a shared link shows the design without it. Job zips (Download job) include it. Shared links are open to anyone who has the link (no account); the 20 character random id is the only protection. Expired links return a clear message and are removed.
- Render image: the free watermark and the 1600 px limit are applied by the app in the browser (it is a render, not a paid file), so a determined person could remove them. Paid PDF, DXF, GLB and OBJ files are still built only on the server.
The app source builds two files: the public app and the server exporters (`node tools/build-single.mjs`). Install with `python3 tools/install_app.py <public.html> <server-exporters.mjs>`, then re-upload `site/plan-studio/app/index.html` and `server/`.
- Fixed in this build: the public app no longer contains the PDF, DXF, GLB or OBJ exporters, jsPDF or the developer unlock. The free PDF preview is a low resolution watermarked image ("PREVIEW, NOT FOR USE") and never a PDF. Paid files exist only on the server.
- Remaining: the free preview still runs the plan layout code in the browser (it draws sheets onto canvases). That code cannot write a PDF, DXF, GLB or OBJ, but a determined person could read the sheet drawing commands from it. It is a layout, not a file, and the watermark is part of the pixels.
- Remaining: the preview is rendered on the visitor's device, so a very large design on an old phone can take a few seconds.
- Remaining: in feet and inches the PDF and DXF scale bar is labelled in feet (a metric length converted), and DXF geometry stays in millimetres with the note "annotations in feet and inches".
- Remaining: dimension and tag text already on screen when the units are switched updates on the next redraw or mouse move.
- Remaining: the seller ABN is not printed on the PDF title block (the PDF builder does not use it).
- Remaining: a damaged file with a door or window whose wall is missing opens with that opening removed and a notice; other structural damage is still refused with a message.
