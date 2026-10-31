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
| `POST /api/export/:type` | Bearer | `pdf`, `dxf`, `glb`, `obj`. Body `{ project, image? }`. Returns the file |

Errors are JSON, `{ error: { code, message, ... }, code, message }`, with the codes in docs/SCOPE.md 11.2 plus
`NOT_FOUND`, `AI_ERROR` (502), `AI_TIMEOUT` (504), `PAYMENTS_UNAVAILABLE` (503), `EXPORT_UNAVAILABLE` (503) and
`SERVER_NOT_CONFIGURED` (500). The server re-checks the database on every authenticated request, so a token alone
grants nothing: a refunded, expired or exhausted Plan Pack is refused at once.

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
