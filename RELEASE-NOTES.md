# Release notes: claude/commercial-release

App source: `GlideInside/pocket-architect-source`. Built bundle: `GlideInside/website-live/plan-studio/app/`. Portal mirror: `GlideInside/website-live/portal/src`.

## 1. What is in this release

Merged into one branch (started from `claude/commercial-catalogue`):

1. **Commercial assistant** (`claude/commercial-assistant`): the AI design assistant uses the commercial catalogue (building model, placement, bays, feasibility), has per mode tools, bills on the commercial model and meters usage.
2. **Commercial billing** (`claude/commercial-billing`): Commercial Developer subscription (A$50 per month incl. GST), commercial trial logins, AI message allowance and top-up packs, billing portal link, admin screen for trial logins and the AI cost report.
3. **Boundary upload** (`claude/boundary-upload`): upload a boundary (KML, KMZ, GeoJSON, shapefile, DXF, CSV, bearings), custom site rules, Mapbox Satellite aerial worldwide.
4. **3 day grace period** for a failed commercial subscription payment (`COMMERCIAL_GRACE_DAYS`, default 3). A banner links to Manage billing. `terms.html` section 10 now says so.
5. **Internal test account** (owner only). An org flagged `internal`:
   - logins are issued at A$0 (labelled "internal test, no charge"); no invoice, no Stripe customer, invoice or setup session; no trial, no pause, no top-ups;
   - AI pool `INTERNAL_AI_MONTHLY` (default 1000);
   - commercial assistant and commercial UI without a subscription (Sonnet commercial model, one message per request, not logged as commercial usage);
   - PDFs carry an "INTERNAL TEST" footer, no TRIAL watermark, and a blank title block with company "INTERNAL TEST";
   - left out of usage, revenue and trial reporting;
   - admin screen: "Create internal test account" form (you type the password, it is hashed, never returned or logged), an INTERNAL badge and a Mark internal / Make ordinary toggle.
6. **Internal designs**: the internal account sees every builder's designs grouped by builder, read only, and can duplicate them into its own library only. Builders and clients get 404 on another org's design. The `org.internal` check is on the server.
7. **Fable review fixes** (section 5).

## 2. Server and Worker files changed (vs `claude/commercial-catalogue`)

Deploy the Worker and apply D1 migration `0014_internal_org.sql` (adds `org_accounts.internal`, `ALTER TABLE ... ADD COLUMN`, not repeatable).

- `server/lib/anthropic.js`
- `server/lib/app.js`
- `server/lib/commercial.js` (new)
- `server/lib/config.js`
- `server/lib/credits.js`
- `server/lib/entitlement.js`
- `server/lib/http.js` (new error code `BILLING_DETAILS_REQUIRED`, 409)
- `server/lib/portal-ai.js`
- `server/lib/portal-billing.js`
- `server/lib/portal-store.js`
- `server/lib/portal.js`
- `server/lib/stripe.js`
- `server/lib/trial.js`
- `server/migrations/0014_internal_org.sql` (new)
- `server/schema.sql`

New routes: `POST /api/portal/admin/internal-orgs`, `POST /api/portal/admin/orgs/:id/internal` (both bearer `ADMIN_TOKEN`).

## 3. Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `COMMERCIAL_GRACE_DAYS` | 3 | Days a commercial subscription keeps working after a failed payment. |
| `INTERNAL_AI_MONTHLY` | 1000 | AI credits per month for the internal test account. No top-ups. |
| `MAPBOX_PUBLIC_TOKEN` | empty | Public Mapbox token (`pk.` only). Build time or Worker env var. Empty: no worldwide aerial. |
| `COMMERCIAL_SUB_PRICE_ID` | empty | Recurring A$50 per month Stripe price id. Empty: Subscribe reads "Coming soon". |
| `COMMERCIAL_SUB_PRICE_AUD` | 50 | Display only. |
| `COMMERCIAL_AI_MONTHLY` | 150 | AI messages per billing period for a subscriber. |
| `COMMERCIAL_AI_TOPUP_PRICE_ID` | empty | One off A$15 Stripe price id for a top-up pack. |
| `COMMERCIAL_AI_TOPUP_QTY` | 100 | Messages credited per pack. |
| `COMMERCIAL_AI_TOPUP_PRICE_AUD` | 15 | Display only, must match the Stripe price. |
| `COMMERCIAL_AI_MODEL` | `claude-sonnet-5-5` | Model for commercial mode. Residential keeps `ANTHROPIC_MODEL`. |
| `COMMERCIAL_AI_PRICE_IN_PER_MTOK_USD` | 2 | Cost report only. |
| `COMMERCIAL_AI_PRICE_OUT_PER_MTOK_USD` | 10 | Cost report only. |
| `COMMERCIAL_AI_PRICE_CACHE_WRITE_PER_MTOK_USD` | 2.5 | Cost report only. |
| `COMMERCIAL_AI_PRICE_CACHE_READ_PER_MTOK_USD` | 0.1 | Cost report only. |
| `COMMERCIAL_TRIAL_AI_TOTAL` | 50 | AI messages for a whole trial login. |
| `COMMERCIAL_TRIAL_WATERMARK` | on | `0` removes the trial watermark. |
| `COMMERCIAL_TRIAL_DAILY_PDFS` | 0 (off) | Optional daily cap on trial PDFs. |
| `COMMERCIAL_TRIAL_KEEP_DAYS` | 30 | Trial designs cleared this many days after the last save. |
| `COMMERCIAL_TRIAL_SESSION_HOURS` | 168 | Trial sign in length. |
| `COMMERCIAL_EXPORT_RATE_PER_HOUR` | 120 | Anti abuse limit per commercial account. |

Full detail: `BILLING-NOTES.md`, `UPLOAD-NOTES.md`.

## 4. Owner steps

1. **Stripe**: create the "Commercial Developer" product with a recurring A$50.00 per month price, tax inclusive, and put its id in `COMMERCIAL_SUB_PRICE_ID`. Create the "Commercial AI messages, 100 pack" product with a one off A$15.00 price, tax inclusive, id in `COMMERCIAL_AI_TOPUP_PRICE_ID`.
2. **Webhook events** to send to the Worker endpoint: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
3. **Stripe billing portal**: allow payment method update and cancellation, so Manage billing and the grace period banner work.
4. **Mapbox**: create a public token (`pk.`), restrict it to the site domains, set `MAPBOX_PUBLIC_TOKEN`. Never use a secret token.
5. **Admin trial login**: sign in to `/portal/admin/` with `ADMIN_TOKEN` and create a commercial trial login for each prospect.
6. **Internal test account**: in the admin screen choose "Create internal test account" and type your own password (at least the minimum length). Nothing is generated or emailed.
7. Apply migration `0014` to D1, then deploy the Worker.

## 5. Fable review fixes

Source: `/home/claude/fable-website-review/REPORT.md`. Tests are in `tests/fable-fixes.test.mjs` unless stated.

- **C1, free PDF is a preview.** Free users now get only a watermarked "PREVIEW, NOT TO SCALE" plan set: every page is stamped, every printed scale ratio becomes "NOT TO SCALE", filename ends `-preview`. The to-scale set needs a Plan Pack, a builder login, a commercial subscription or the internal account. The pricing and Pocket Architect pages say "Preview only, watermarked, not to scale" for Free. **Limitation:** plan sets are drawn in the browser, so this gate is client side. Someone who edits the page code could still produce a full set. Server rendering is needed to enforce it fully (owner decision).
- **H2, internal notes removed.** The "VALUES NOT VERIFIED" and "TO VERIFY" notes are gone from the commercial plan set. One customer line replaces them: "Indicative only. Rates and controls to be confirmed with council and a suitably qualified engineer."
- **H3, roller doors face an apron.** Rows with no bays now get a truck apron strip, so every roller door faces an apron or aisle. The site access driveway and crossover are always drawn (labelled indicative), counted in the developed area and the plan set, with a check that warns when an apron hits a building or the boundary.
- **H4, zone warning.** Residential and environmental zones warn on the card and the plan set: "This zone may not permit industrial or commercial use, check with council". A lot with custom rules switched on suppresses it.
- **H5, feasibility.** End value now capitalises NET rent (gross rent less outgoings, input `outgoingsPct`, default 10 percent, range 5 to 15). The mezzanine is valued at a fraction of the ground floor rate (`mezzFactor`, default 0.5, range 0.4 to 0.7). The build cost default is now 1,500 per m2, the low end of the analyst range, with the references and status shown in the details panel. Unverified values are marked ESTIMATE in the details panel only, not on the plan set. **Owner decision:** confirm the build rate, outgoings and mezzanine assumptions.
- **H6, DEV badge and "Plan Pack could not be verified".** Cause: the portal sign in never fetched the login's AI token (`/portal/ai/token`), so the assistant had none, and the "Dev" badge showed whenever there was no token. Now the portal fetches and renews the token (builder, client, subscriber and internal), the Dev badge needs `?dev` on localhost (impossible on a real domain), and a failed sign in reads "Your sign-in could not be verified. Sign in again to use the AI design assistant." Tests in `tests/internal-account.test.mjs`.
- **H7, billing details before client logins.** An active, non internal builder must have legal name, ABN and billing email (or a card) before generating client logins (409 `BILLING_DETAILS_REQUIRED`, with a plain message). The admin list shows "Month end will skip: billing details missing" per builder and a banner listing them. Existing tests now set billing details first.
- **Mediums.**
  - App tab title is "Pocket Architect".
  - One name, "AI design assistant", in the app, client area, pricing, trial terms, terms and for-builders pages.
  - The A$30 unlock button no longer flashes for a signed in builder client while the sign in check runs.
  - The booking form rejects past dates (`enquiry-form.js`).
  - Embed address search already submits on Enter (checked, no change). Ranking exact numbers such as M11 or M4 is not done.
  - `/portal/admin/` already sends `noindex,nofollow,noarchive` in a meta tag and has no public link (checked, no change). A header version needs the host config.

## 6. Open owner decisions

- Grace period length (3 days) and whether `terms.html` section 10 wording is approved by your adviser.
- C1 is client side only (see above).
- The internal account's commercial UI path should be tried once by you after deploy.
- Build cost, outgoings and mezzanine assumptions (H5).
- Whether to chase exact number ranking in the embed search.
