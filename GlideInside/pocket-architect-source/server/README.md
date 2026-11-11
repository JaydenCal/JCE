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
| `lib/stripe.js` | Checkout Session over REST, webhook signature check, entitlement creation, refunds |
| `lib/entitlement.js` | Signed tokens and the per-request database check |
| `lib/credits.js` | Credit arithmetic, warning levels, spend caps, rate limits |
| `lib/anthropic.js` | One Messages API call per request, prompt caching, tool call checking |
| `lib/config.js` | Reads every variable in docs/SCOPE.md 11.6 with its default |
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
