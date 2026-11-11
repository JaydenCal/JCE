# Plan Studio API

The back end for the Plan Pack (docs/SCOPE.md section 11): Stripe Checkout, entitlement tokens, the AI proxy with
credits, and the paid exports (PDF, DXF, GLB, OBJ). It is written as Web-standard handlers (`Request` in,
`Response` out) with `fetch` and WebCrypto only, so there are no vendor SDKs and no npm packages beyond the ones the
app already uses (three.js and jsPDF, for the exports).

The reference deployment is a Cloudflare Worker with D1 (SQLite). Other hosts are covered below.

## Files

| File | Purpose |
|---|---|
| `worker.js` | Cloudflare Worker entry. Builds the app with the D1 store and the catalogue |
| `lib/app.js` | `createApp({ store, env, fetchImpl, now, catalogue })` returns `{ fetch }`. All endpoints |
| `lib/store.js` | `createD1Store(db)` and `createMemoryStore()` (the same async interface) |
| `lib/enquiry.js` | The JCE enquiry endpoint: validation, rate limit, D1 copy, email through Resend |
| `lib/stripe.js` | Checkout Session over REST, webhook signature check, entitlement creation, refunds |
| `lib/entitlement.js` | Signed tokens and the per-request database check |
| `lib/credits.js` | Credit arithmetic, warning levels, spend caps, rate limits |
| `lib/anthropic.js` | One Messages API call per request, prompt caching, tool call checking |
| `lib/config.js` | Reads every variable in docs/SCOPE.md 11.6 with its default |
| `lib/portal.js` | Builder and client portal routes (`/api/portal/*`): sessions, houses, clients, projects, billing, AI credits, team, branding |
| `lib/portal-store.js` | Portal storage: `createD1PortalStore(db)` and `createMemoryPortalStore()` |
| `lib/portal-billing.js` | Month usage, tax invoice snapshots, Stripe invoices for the previous month, the cron time check |
| `lib/portal-ai.js` | Org AI pools (monthly 300 per login, top-up with 12 month carry over), `issueOrgToken` wiring |
| `lib/password.js` | PBKDF2-SHA-256 hashing (100,000 iterations), session tokens, constant-time compare |
| `schema.sql` | D1 tables. Safe to run more than once |
| `wrangler.toml.example` | Worker configuration to copy and edit |
| `dev-entitlement.mjs` | Local testing without Stripe (prints SQL and a token) |

The server imports the same modules as the browser: `src/model/*`, `src/premium/ai/*` (prompt, tools, context
limits), `src/premium/exporters/*` and `src/viewer3d/build.js`. Deploy the whole repository, not just `server/`.

## Endpoints

| Method and path | Auth | Notes |
|---|---|---|
| `GET /api/health` | none | `{ ok, aiPaused }` |
| `POST /api/checkout` | none | `{ projectId, projectName }` returns `{ url }` (Stripe Checkout) |
| `POST /api/stripe/webhook` | Stripe signature | `checkout.session.completed` creates the entitlement, `charge.refunded` ends it |
| `GET /api/entitlement?session_id=&project=` | none | `{ token, credits, ... }` once paid. `404` with `pending: true` while unconfirmed |
| `POST /api/entitlement/restore` | none, rate limited | `{ email, sessionOrReceipt }` returns a token |
| `GET /api/credits?project=` | Bearer | `{ total, used, remaining, warnLevel, reserved }` |
| `POST /api/ai/estimate` | Bearer | No model call. `{ estimatedCredits, remaining, requiresConfirm }` |
| `POST /api/ai/edit` | Bearer | `{ reply, ops, rejected, credits, warning }` |
| `GET /api/site/search?q=` | none, rate limited | `{ results: [{ label, state, lon, lat }] }`, max 8. NSW from NSW_Property layers 1 to 4 (`address`), QLD from PlanningCadastre LandParcelPropertyFramework layer 0 (Addresses) |
| `GET /api/site/lot?lon=&lat=&state=` | none, rate limited | Parcel at the point and neighbours within about 60 m in GDA2020 MGA (7854/7855/7856), LGA, NSW zoning, road lines, origin. Cached in D1 `site_cache` |
| `GET /api/site/aerial?state=&srid=&bbox=` | none, rate limited | Image bytes, georeference in the `x-site-meta` header (URL encoded JSON, includes attribution and capture date) |
| `GET /api/site/contours?state=&srid=&bbox=&buffer=&origin=` | none, rate limited | Elevation grid, contour lines (minor 0.5 m, major 2.5 m) and provenance |
| `GET /api/site/health` | none | Probes each upstream service. `ok` needs the cadastre and address services, `allOk` needs every one |
| `POST /api/enquiry/jce` | none, rate limited | "Send to JCE for engineering and DA plans". Body `{ name, phone, email, need, notes, consent: true, lot, project, pdfBase64, source }`. Emails JCE through Resend with the PDF attached, keeps a copy in `jce_enquiries`, returns `{ ok, reference }`. `503 ENQUIRY_NOT_CONFIGURED` until `RESEND_API_KEY` is set |
| `POST /api/export/:type` | Bearer | `pdf`, `dxf`, `glb`, `obj`. Body `{ project, image? }`. Returns the file |

Builder and client logins use the same AI endpoints plus two more (see "Builder and client logins" below).

Errors are JSON, `{ error: { code, message, ... }, code, message }`, with the codes in docs/SCOPE.md 11.2 plus
`NOT_FOUND`, `AI_ERROR` (502), `AI_TIMEOUT` (504), `PAYMENTS_UNAVAILABLE` (503), `EXPORT_UNAVAILABLE` (503) and
`SERVER_NOT_CONFIGURED` (500). The server re-checks the database on every authenticated request, so a token alone
grants nothing: a refunded, expired or exhausted Plan Pack is refused at once.

## Builder and client logins (org credit pools, top-ups, budgets)

Builder and client logins have the AI included. They are off until `PORTAL_ENABLED=1` (public launch first); with the
switch off an org token is refused with `NOT_ENTITLED`. The Plan Pack flow (A$35 pack, 500 credits, entitlement token)
is untouched and its token is still the only one accepted for exports.

**Token.** The login system signs the person in, then calls `issueOrgToken({ orgId, loginId, role, cap? }, config, nowMs)`
from `lib/entitlement.js`. The payload is `{ oid, lid, role: 'builder'|'client', cap?, exp }` (HMAC signed with
`ENTITLEMENT_SECRET`, 8 hours by default). `cap` overrides the monthly credits for that login.

**Credit pools.** Each login has two pools, both stored as ordinary entitlement rows so reserve, settle and release keep
their single guarded write (no schema change):

| Pool | Row id | Size | Resets |
|---|---|---|---|
| Monthly | `org:<orgId>:<loginId>:<YYYY-MM>` | `ORG_MONTHLY_CREDITS` (default 300) or the token `cap` | At the start of each calendar month in Australia/Sydney (the row is created lazily, so a new month is a new row) |
| Top-up | `orgtop:<orgId>:<loginId>` | grows by `TOPUP_CREDITS` per top-up | Never; carries over until used |

Requests are paid from the monthly pool first, then the top-up pool (`planSpend`). The estimate is reserved across both
pools and the actual charge is settled monthly first (`splitCharge`). The 50, 80 and 95% warnings count the monthly pool
only. The hard stop (`402 CREDITS_EXHAUSTED`) happens when monthly plus top-up credits cannot cover the estimate; its
body carries `topUp: { allowed, credits, amountCents, gstInclusive, currency }` and `monthResetsOn` (`YYYY-MM-DD`, the
first day of next month in Sydney) so the panel can show the reset date and the top-up button.

`GET /api/credits` and the `credits` object of `POST /api/ai/edit` return, for an org token:
`{ kind: 'org', total, used, remaining, reserved, warnLevel, topUpRemaining, available, monthResetsOn, topUp }`.
Plan Pack replies keep their original shape.

**Top-ups.** `POST /api/ai/topup` (org token) adds `TOPUP_CREDITS` (default 300) at once and charges nothing by card. The
charge, `TOPUP_AMOUNT_CENTS` (default 1000, A$10 including GST), goes on the builder's end-of-month invoice. Each top-up is
logged as a billable event so billing can invoice it: `store.listEvents('ai_topup')` returns rows whose `detail` is

```
{ orgId, loginId, credits: 300, amountCents: 1000, currency: 'aud', gstInclusive: true, createdAt, role }
```

Invoice by summing `amountCents` per `orgId` for the month. Top-ups are limited to 10 per login per hour
(`429 RATE_LIMITED`). Builders always may top up. Clients may unless the builder turned client top-ups off for the
organisation (default on): `POST /api/ai/topup-setting` `{ enabled }` (builder token only) logs an `org_topup_setting`
event, the latest per `orgId` wins, and a refused client top-up answers `403 TOPUP_DISABLED`. Plan Pack tokens cannot top up.

**Spend budgets.** The global caps no longer let one busy organisation pause the AI for everyone. An org request is checked in
this order: the organisation's own daily and monthly US$ budget (`ORG_DAILY_CAP_USD`, default 1, and `ORG_MONTHLY_CAP_USD`,
default 10, per organisation; override per org with `ORG_BUDGETS='{"<orgId>":{"dailyUsd":2,"monthlyUsd":20}}'`), then the
share of the global caps that all organisations together may use (global cap times `1 - PUBLIC_RESERVE_SHARE`, default
0.3 reserved), then the global caps. Public Plan Pack requests only see the global caps, so the reserved share always
remains for them. Org spend is recorded under `od:`, `om:` (per org) and `oall:` (all orgs) periods using the day and month of
Sydney; stopped requests answer `503 AI_PAUSED` and log an `org_budget` event. Day and month budgets use the Sydney calendar.

Assistant replies are filtered by `scrubClaims` so the word "compliant" never reaches the person; a design is described as
"inside the indicative setback envelope".

Store contract addition: `addCredits(id, n)` (D1, memory and Upstash implement it).

## Builder and client portal (docs/PORTAL_API.md)

Routes: `/api/portal/*` (cookie session) and `POST /api/billing/run-month` (bearer `ADMIN_TOKEN`). The browser side is
`src/portal/api.js` (`CONFIG.portalMock` false). Closed until `PORTAL_ENABLED=1` (except the admin job that creates an organisation).
The portal needs D1 (`createD1PortalStore`); on Upstash or other hosts it answers 503 `PORTAL_NOT_CONFIGURED`.

**Secrets and variables** (`wrangler secret put NAME` for the secrets):

| Name | Kind | Purpose |
|---|---|---|
| `ADMIN_TOKEN` | secret | Long random string. Creates organisations and runs month end invoicing. Without it those endpoints answer 503 |
| `ENTITLEMENT_SECRET` | secret | Already needed. Also signs the org tokens the AI endpoints accept |
| `STRIPE_SECRET_KEY` | secret | **Test key only** (`sk_test_...`) until the owner gives written go-ahead for live billing |
| `PORTAL_ENABLED` | var | `1` opens builder and client logins. Default off |
| `SELLER_NAME`, `SELLER_ABN` | var | Seller on tax invoices. Defaults: `JCE Infrastructure Pty Ltd trading as Glide Inside`, `29 699 165 663` |
| `ORG_MONTHLY_CREDITS`, `TOPUP_CREDITS`, `TOPUP_AMOUNT_CENTS` | var | 300 credits per login per month, 300 credits for A$10 (1000 cents) incl. GST |
| `STRIPE_GST_TAX_RATE_ID` | var, optional | An existing inclusive 10% GST tax rate. If empty one is created on first use and remembered in `portal_settings` |
| `STRIPE_LIVE_BILLING_APPROVED` | var | Leave unset. A live Stripe key (`sk_live_`, `rk_live_`) is refused unless this is exactly `owner-written-go-ahead` |
| `PORTAL_PROJECT_MAX_BYTES`, `PORTAL_LOGO_MAX_BYTES` | var | 1,800,000 (D1 rows are limited to 2 MB) and 400,000 |
| `LOGIN_MAX_FAILURES`, `LOGIN_IP_MAX_FAILURES`, `SESSION_DAYS` | var | 5 per username, 20 per IP (both then locked 15 minutes), 30 day sliding session |

**First deploy, in order** (nothing here deploys itself; run these yourself when ready):

```
cp server/wrangler.toml.example wrangler.toml        # edit SITE_URL, route, database_id; the [triggers] block holds the cron
wrangler d1 execute plan-studio --remote --file server/schema.sql    # adds the portal tables, safe to re-run
wrangler secret put ADMIN_TOKEN
wrangler secret put STRIPE_SECRET_KEY                # sk_test_... only
wrangler deploy
# create the first builder organisation (prints the admin's temporary login once):
curl -sS -X POST https://YOUR-SITE/api/portal/admin/orgs -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Sample Homes Pty Ltd","adminFirstName":"Priya","adminEmail":"priya@samplehomes.example"}'
# when launching: set PORTAL_ENABLED = "1" in [vars], deploy again, and set GI_CONFIG.portalEnabled = true / portalMock = false on the site
```

**Month end invoicing.** The cron (`0 19 * * *` and `0 20 * * *` UTC) fires twice a day; the handler acts only when the Sydney clock reads 06:00
on the 1st (so exactly once a month, in AEDT and AEST) and invoices the previous Sydney month for every organisation. By hand, for any finished month
(also the way to retry a failed or skipped org):

```
curl -sS -X POST https://YOUR-SITE/api/billing/run-month -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"month":"2026-10","orgId":"org_..."}'
```

Per organisation: needs billing contact (legal name, valid ABN, email), otherwise `skipped: billing_contact_incomplete`; no charges gives `skipped: no_charges`.
It creates the Stripe customer on first billing, then a `send_invoice` invoice (14 days, AUD, inclusive 10% GST tax rate on each item), adds one item for
logins (A$20 each) and one for top-ups (A$10 each), finalises and sends it. **Stripe sends the invoice email; this server sends none.**
One row per organisation and month in `invoices` (unique), Stripe idempotency keys on every write, and the steps are recorded so a failed run resumes
without a second Stripe invoice. `GET /api/portal/billing/invoices` shows only issued invoices.

**Live mode needs the owner's written go-ahead.** Until then use test keys. To go live the owner must say so in writing; only then set a live key and
`STRIPE_LIVE_BILLING_APPROVED=owner-written-go-ahead`.

**AI credits.** Portal logins use the org pools from `claude/glide-ai` (`org:<orgId>:<loginId>:<YYYY-MM>` and `orgtop:<orgId>:<loginId>`).
`POST /api/portal/ai/token` returns the org token (`issueOrgToken`, role `builder` for staff, `client` for clients, `cap` from the org setting) that the
AI endpoints accept as a bearer token. Each top-up is logged as an `ai_topup` event with `{ orgId, loginId, credits, amountCents, ... }`, which is what billing reads.
Top-up credits expire 12 months after purchase (unused part, oldest purchase first), applied when the balance is read.
When merging with `claude/glide-ai`: `issueOrgToken` and `addCredits` are copied from that branch unchanged; `config.js`, `http.js` and the stores have
identical hunks there. Keep either copy. `claude/glide-ai` keeps top-ups forever; the 12 month expiry lives in `lib/portal-ai.js` (`reconcileTopUps`) and runs whenever the portal reads a login's balance (`/portal/ai`, `/portal/me`, `/portal/ai/token`, top-up), which the app does at each sign in and before each AI session. A login that keeps using an old org token can spend an expired top-up until the token (8 hours) is renewed.

**Cloudflare plan.** PBKDF2 at 100,000 iterations uses real CPU time (tens of milliseconds). Run the Worker on the Workers Paid plan (or Standard usage model);
the free plan's 10 ms CPU limit may cut sign in requests short. Test this on the first deploy.


## Deploy on Cloudflare

You need a Cloudflare account, Node 20 or later, a Stripe account (test mode first) and an Anthropic API key.

1. Install Wrangler and sign in: `npm i -g wrangler && wrangler login`.
2. Install the dependencies: `npm install` (three.js and jsPDF are needed by the exporters).
3. Create the database and note its id: `wrangler d1 create plan-studio`.
4. Copy `server/wrangler.toml.example` to `wrangler.toml` in the project root. Set `SITE_URL`, `APP_URL`, the
   `database_id`, and (optionally) the route so `/api/*` is served from the same site as the app.
5. Apply the schema: `wrangler d1 execute plan-studio --remote --file server/schema.sql`.
6. Set the secrets (each command asks for the value; none of them go in the repository or the browser):
   ```
   wrangler secret put ANTHROPIC_API_KEY
   wrangler secret put STRIPE_SECRET_KEY        # sk_test_... until you approve live mode in writing
   wrangler secret put STRIPE_WEBHOOK_SECRET    # whsec_..., from step 8
   wrangler secret put ENTITLEMENT_SECRET       # 32 random bytes, for example: openssl rand -hex 32
   ```
7. Deploy: `wrangler deploy`.
8. In the Stripe dashboard (test mode) add a webhook endpoint `https://<your site>/api/stripe/webhook` for the events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `charge.refunded`. Copy its signing
   secret into `STRIPE_WEBHOOK_SECRET` (step 6) and deploy again.
9. In Stripe, turn on customer emails for successful payments (Settings, Emails). Receipts come from Stripe only.
   This server never sends email.
10. In the app, set `CONFIG.apiBase` to `/api` (same site) or the Worker address, and `CONFIG.premiumEnabled = true`.

Live mode needs the live Stripe key, the live webhook secret and written approval from the owner.

### Send to JCE enquiries (Resend email)

The "Send to JCE for engineering and DA plans" button posts to `POST /api/enquiry/jce`. The Worker emails
`ENQUIRY_TO` (default enquiries@jceinfrastructure.com.au) with the PDF plan set and the design file attached, using the
Resend REST API. Nothing is sent until the person clicks Send and ticks the consent box. A copy of each enquiry is kept in
the `jce_enquiries` table, so nothing is lost if the email fails (the PDF itself is not stored; it can be rebuilt from the
saved design). Until the key is set, the endpoint answers `503` and the app says the service is not set up yet.

1. Create a Resend account at resend.com (the free tier is enough to start).
2. In Resend, Domains, add `glideinside.com.au`. Add the DNS records Resend shows (SPF and DKIM TXT or CNAME records, and the
   optional DMARC record) at the domain's DNS host, then press Verify. Sending works only from a verified domain.
3. In Resend, API Keys, create a key with "Sending access" limited to that domain.
4. Store it as a secret, never in the repository: `wrangler secret put RESEND_API_KEY`.
5. Check the plain variables in `wrangler.toml` `[vars]`: `ENQUIRY_TO` (recipient) and `ENQUIRY_FROM`
   (for example `Glide Inside <plans@glideinside.com.au>`; the address must be on the verified domain).
6. Apply the schema again to add the table: `wrangler d1 execute plan-studio --remote --file server/schema.sql`, then `wrangler deploy`.
7. Test with a real address you control, then read the saved copies: `wrangler d1 execute plan-studio --remote --command "SELECT reference, email_status, email_error FROM jce_enquiries ORDER BY created_at DESC LIMIT 10"`.

Limits: 5 sends per IP per hour and 3 per email address per day (`429 RATE_LIMITED`). The PDF can be up to `ENQUIRY_MAX_PDF_BYTES`
(default 6,000,000). If Resend refuses the message the enquiry is still saved and the reply is `502 EMAIL_FAILED` with the
`reference`, so JCE can follow up from the table.

### Settings

Every variable in docs/SCOPE.md 11.6 is read in `lib/config.js` and listed in `wrangler.toml.example`. Plain values
go under `[vars]`, secrets with `wrangler secret put`. Two extras: `AI_TIMEOUT_MS` (default 30000) and `DISCLAIMER` (printed on every drawing sheet; it defaults to `src/config.js`). Drawings carry no
company name: the title block is filled from the project's own title block fields.

At the default prices a request is estimated at about 2 credits and never above about 6, even at the 40,000 token
context cap, so the "may use about N credits" confirmation only appears if `LARGE_REQUEST_CREDITS` is lowered or
the model prices rise. The check is in place for that case.

## Test locally

```
cp wrangler.toml.example wrangler.toml          # or use the file you made for deploy
wrangler d1 execute plan-studio --local --file server/schema.sql
# .dev.vars in the project root (never commit it):
#   SITE_URL=http://localhost:8100
#   APP_URL=http://localhost:8100/index.html
#   ENTITLEMENT_SECRET=anything-long-and-random
#   ANTHROPIC_API_KEY=sk-ant-...
#   STRIPE_SECRET_KEY=sk_test_...
#   STRIPE_WEBHOOK_SECRET=whsec_...
wrangler dev --port 8787
npm run serve                                    # the app, http://localhost:8100
```

The app and the API are on different ports, so tell the app where the API is. In the browser console on the app
page, or in `src/config.js` for local work: `apiBase: 'http://localhost:8787/api'`. CORS is allowed for `SITE_URL`.

**With Stripe (full flow).** Forward webhooks to the local Worker with the Stripe CLI:
`stripe listen --forward-to localhost:8787/api/stripe/webhook`, use the `whsec_` it prints as
`STRIPE_WEBHOOK_SECRET`, set `premiumEnabled: true`, click Unlock and pay with the test card `4242 4242 4242 4242`.

**Without Stripe.** Find the project id (`__ps.store.project.id` in the browser console), then:

```
ENTITLEMENT_SECRET=<the same secret> node server/dev-entitlement.mjs --project <project id> --credits 20
```

It prints a `wrangler d1 execute ... --local` command and a `localStorage.setItem(...)` line. Run the first, paste
the second into the console, reload. Use `--credits 20` to see the 50%, 80% and 95% warnings quickly.

**Developer unlock.** `?dev` on `localhost` unlocks the exports and builds them in the browser (nothing is sent to
the server). The assistant is different: it always needs this server and an entitlement, so with `?dev` alone the
panel explains that the server must be running. Strip `?dev` and the local export path from production builds: do
not ship `src/premium/exporters/` with the static site (only the Worker needs it). The client also ignores the flag
anywhere except `localhost`.

## Other platforms

`createApp` needs a `store` (the interface below), the environment, and optionally `fetchImpl`, `now` and
`catalogue`. It returns `{ fetch(request) }`.

```js
// Node 20+ (or Deno, Bun): any store; createMemoryStore() is for tests only
import { createApp } from './server/lib/app.js';
const app = createApp({ store: myStore, env: process.env, catalogue: () => import('./src/catalogue/index.js').then((m) => m.catalogue) });

// Vercel (Edge or Node 20 functions), api/[...path].js
export const config = { runtime: 'edge' };
export default (request) => app.fetch(request);

// Netlify Functions v2, netlify/functions/api.js
export default (request) => app.fetch(request);
export const config = { path: '/api/*' };
```

The webhook handler reads the raw body, so do not let the platform parse it first.

**The store interface** (`lib/store.js` has the D1 and in-memory versions; `tests/server.test.mjs` runs one contract
test against both, so a new store can reuse it). All methods are async:

`createEntitlement`, `getEntitlement`, `getEntitlementBySession`, `getEntitlementByPaymentIntent`, `findForRestore`,
`setEntitlementStatus`, `reserveCredits`, `settleCredits`, `releaseCredits`, `logAiRequest`, `listAiRequests`,
`addSpend`, `getSpend`, `claimWebhookEvent`, `releaseWebhookEvent`, `hitRate`, `logEvent`, `listEvents`.

`reserveCredits` must be one atomic guarded update (`credits_used + credits_reserved + n <= credits_total`, status
active, not expired). That is what stops parallel requests overspending.

## Operations

- **AI spend.** `SELECT period, cost_usd_micros / 1e6 AS usd FROM spend ORDER BY period DESC LIMIT 14;`
- **Pauses.** `SELECT created_at, detail FROM events WHERE type = 'ai_paused' ORDER BY created_at DESC;`
  The global caps `AI_DAILY_CAP_USD` and `AI_MONTHLY_CAP_USD` pause AI for everyone (HTTP 503, `AI_PAUSED`). The
  pause lifts when the next UTC day or month starts, or raise the cap and redeploy.
- **Retention.** Plan content is never stored. Request logs hold token counts, cost and status only. Delete old rows
  from a scheduled Worker or by hand:
  `DELETE FROM ai_requests WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days');`
  `DELETE FROM events WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days');`
  `DELETE FROM webhook_events WHERE received_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days');`
  Keep `entitlements` for tax records.
- **Backups.** `wrangler d1 export plan-studio --remote --output backup.sql` daily.
- **Refunds.** Refund in the Stripe dashboard. The `charge.refunded` webhook marks the entitlement `refunded` and
  exports and the assistant stop. Partial refunds keep access.
- **Logs.** The Worker logs one JSON line per webhook, model error and export failure. No card data and no plan
  content are logged.

## Tests

`node --test tests/server.test.mjs` runs the server against an in-memory store, a SQLite shim of D1 (`node:sqlite`,
Node 22), a fake Stripe and a fake Anthropic. It covers the acceptance tests in docs/SCOPE.md 16 numbered 7, 8, 11,
12, 13, 14 and 15, plus restore, rate limits, reservation under parallel requests, CORS and size limits.
`node --test tests/portal-server.test.mjs` covers the portal (memory store and the D1 shim): password hashing, lockout, sessions, CSRF and Origin,
roles, every route group, tenant isolation, Sydney month boundaries, top-up expiry and Stripe invoicing with a mocked `fetch`. Run the whole suite with
`node --test tests/*.test.mjs` (not `tests/`).

## Known limits

- The Worker has been exercised in Node with Web-standard `Request` and `Response`, not on Cloudflare's runtime.
  Deploy to a test Worker and download all four export types before going live. PDF and 3D export use jsPDF and
  three.js, which need `nodejs_compat` (set in the example).
- Textures are left out of GLB files built on the server (they need a canvas). Colours are kept. OBJ files carry
  colours only.
- Exports are capped at `EXPORT_MAX_PROJECT_BYTES` (2 MB). Tracing underlay images are not sent.

## Next.js (Vercel) on the owner's site

`server/sync-to-site.mjs <frontend dir>` copies `server/lib/*` and every `src/` module they import into
`frontend/src/lib/plan-studio-server/` (as `.ts` files starting with `// @ts-nocheck`, imports without `.js`).
The route handlers in `frontend/src/app/api/**/route.ts` call `handlePlanStudio(request)` in the hand-written
`runtime.ts`, which builds the app with one of two stores:

| File | Store |
|---|---|
| `lib/store-upstash.js` | Upstash Redis over REST (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`). Credit reserve, settle, release, entitlement creation and rate counters are Lua `EVAL` scripts, so they are atomic |
| `lib/store-file.js` | JSON file (`frontend/.data/plan-studio.json`) for local testing. Node only |

Extras for that host: `createApp({ devGrant: true })` enables `GET /api/entitlement?dev=1&project=<id>` (the site
turns it on only in `next dev` with `PLAN_STUDIO_DEV_GRANT=1`) and adds `devGrant: true` to `/api/health`;
`createApp({ loadJsPDF })` supplies jsPDF so no host bundle is forced to include it. Without `ANTHROPIC_API_KEY` the AI
endpoints answer 503 `AI_NOT_CONFIGURED` ("AI not configured"); without Stripe keys checkout answers 503
`PAYMENTS_UNAVAILABLE` ("Payments not configured"). The store contract test also runs the Upstash store against a real
`redis-server` when one is installed. See the site's `docs/11-plan-studio-paid.md` for setup.
