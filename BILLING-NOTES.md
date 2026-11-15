# Commercial billing notes (branch claude/commercial-billing)

Commercial mode for developers is priced separately from the residential A$30 Plan Pack (residential is unchanged).

* Commercial Developer subscription: A$50 per month including GST. Unlimited commercial plan set PDFs (and the commercial DXF).
* AI assistant (commercial mode only): 150 messages per billing period (resets on renewal), then top-up packs of 100 messages for A$15 including GST. Top-up messages roll over while the subscription stays active. Runs on Sonnet 5.5.
* One shared trial login: full commercial mode, plan sets watermarked "TRIAL, NOT FOR CONSTRUCTION", 50 AI messages in total (owner can reset), no top-ups, no billing, no password change.

Nothing here has been deployed, uploaded or emailed, and no live Stripe call was made. All tests use a fake Stripe.

## Worker and server files changed

Server (Worker code, `GlideInside/pocket-architect-source/server/lib/`)

* `commercial.js` (new): subscription entitlement, webhook handling, billing portal link, AI allowance and top-up pools, trial login, trial saved projects, owner admin routes, AI cost report.
* `app.js`: wires the above in (webhook, `/api/commercial/*`, AI account selection, commercial model, commercial exports, per-message usage record). `/api/health` is deliberately unchanged (a live test locks its body).
* `stripe.js`: subscription Checkout, AI top-up Checkout, subscription lookup, customer portal session.
* `config.js`, `http.js`, `entitlement.js`: new env variables, new error codes, trial token shape.
* `server/worker.js` and `wrangler.toml`: not changed. No new tables, no new migration, no new bindings (the subscription is an entitlement row, the trial login is one value in `portal_settings`).

Client and site

* `src/premium/premium.js`, `api.js`, `credits.js`, `messages.js`, `ui/commercial-billing.js` (new), `ui/assistant.js`, `ui/topbar.js`: commercial gate, account page, restore, trial sign in, assistant meter and buy-more.
* `src/premium/exporters/index.js`, `watermark.js`: the watermark title can be set (used for "TRIAL, NOT FOR CONSTRUCTION").
* `src/portal/admin-api.js`, `src/portal/ui/admin-app.js`: owner admin sections (trial login, AI cost).
* `website-live/terms.html` (new section 10, flagged for your review), `website-live/commercial/index.html` (pricing block).
* The built bundle in `website-live/plan-studio/app/` was NOT rebuilt. Rebuild it and sync the portal copy when you are ready to release (the usual build step), otherwise the live app will not show the new screens.

## Environment variables (Worker secrets and variables)

Secrets (set by you with `wrangler secret put`, never in files): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ENTITLEMENT_SECRET`, `ADMIN_TOKEN`, `ANTHROPIC_API_KEY` (these already exist for the Plan Pack and portal).

New:

| Variable | Default | Meaning |
| --- | --- | --- |
| `COMMERCIAL_SUB_PRICE_ID` | empty | The recurring A$50 per month Stripe price id. Empty: Subscribe reads "Coming soon". |
| `COMMERCIAL_SUB_PRICE_AUD` | 50 | Display only. |
| `COMMERCIAL_AI_MONTHLY` | 150 | AI messages per billing period for a subscriber. |
| `COMMERCIAL_AI_TOPUP_PRICE_ID` | empty | The one-off A$15 Stripe price id for one top-up pack. Empty: "Buy more AI messages, coming soon". |
| `COMMERCIAL_AI_TOPUP_QTY` | 100 | Messages credited per pack. |
| `COMMERCIAL_AI_TOPUP_PRICE_AUD` | 15 | Display only: must match the Stripe price. |
| `COMMERCIAL_AI_MODEL` | `claude-sonnet-5-5` | Model for commercial accounts in commercial mode only. Residential keeps `ANTHROPIC_MODEL`. |
| `COMMERCIAL_AI_PRICE_IN_PER_MTOK_USD` | 3 | USD per million input tokens, used only for the cost report (cache reads count at a tenth). Please check against Anthropic pricing. |
| `COMMERCIAL_AI_PRICE_OUT_PER_MTOK_USD` | 15 | USD per million output tokens, cost report only. |
| `COMMERCIAL_TRIAL_AI_TOTAL` | 50 | AI messages for the whole trial login (reset in the admin screen). |
| `COMMERCIAL_TRIAL_WATERMARK` | on | Set to `0` to remove the "TRIAL, NOT FOR CONSTRUCTION" watermark from trial plan sets. |
| `COMMERCIAL_TRIAL_DAILY_PDFS` | 0 (off) | Optional daily cap on trial plan set PDFs. Off means unlimited. |
| `COMMERCIAL_TRIAL_KEEP_DAYS` | 30 | Trial saved designs are cleared after this many days from the last save. |
| `COMMERCIAL_TRIAL_SESSION_HOURS` | 168 | How long a trial sign in lasts on a device. |
| `COMMERCIAL_EXPORT_RATE_PER_HOUR` | 120 | Anti-abuse limit per commercial account (not a quota). |

Existing variables that also apply: `APP_URL` or `SITE_URL` (Stripe return pages), `LOGIN_MAX_FAILURES` (5) and `LOGIN_IP_MAX_FAILURES` (20) for the trial login rate limit, `CHECKOUT_RATE_MAX`, `AI_DAILY_CAP_USD` and `AI_MONTHLY_CAP_USD` (global spend pause still protects you), `PORTAL_PROJECT_MAX_BYTES`.

Note: `AI_RATE_PER_MIN` (6) and `AI_RATE_PER_DAY` (150 per account key) still apply to every account. 150 a day is above the monthly allowance, so it only matters for top-ups.

## Steps you must do yourself

In Stripe (test mode first)

1. Create a product "Commercial Developer" with a recurring price of A$50.00 per month, tax behaviour inclusive of GST. Copy the price id (`price_...`) into `COMMERCIAL_SUB_PRICE_ID`.
2. Create a product "Commercial AI messages, 100 pack" with a one-time price of A$15.00, tax inclusive. Copy its price id into `COMMERCIAL_AI_TOPUP_PRICE_ID`.
3. Webhook endpoint (the existing one, `/api/stripe/webhook`): make sure these events are selected: `checkout.session.completed` (existing), `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
4. Settings, Billing, Customer portal: turn the portal on, allow "Cancel subscription" and "Update payment method", and set the return link to your app address. Without this "Manage billing" cannot open.
5. Do the live switch only after a test mode run (subscribe, renew, fail a payment with a test card, cancel, buy a top-up).

In the admin screen (`/portal/admin/`, the ADMIN_TOKEN you already use)

1. Open "Commercial trial login", press "Create trial login", type the username and a password yourself (at least 10 characters). The password is hashed on the server, never shown again and never logged. Keep your own note of it.
2. Optional: set an expiry date, disable or enable the login, press "Reset AI messages" to give the trial 50 more, or "Reset username and password" (this signs out everyone on the old login).
3. "Commercial AI cost" shows actual input, cache read and output tokens per account and month with the cost at the prices above.

## How access works (short)

* Subscription is an entitlement row `csub_...` (project `*`, Stripe subscription id kept in the `payment_intent` column, status active, past_due or canceled, `expires_at` is the paid period end). The browser holds a signed token; the database is checked on every request. `past_due` and cancelled block access straight away.
* AI allowance is one pool per billing period (a new period end creates a fresh pool, which is how it resets on renewal) plus one top-up pool that persists. They use the existing reserve, settle and release store operations. One message is charged for each request that reaches the model.
* Commercial accounts are accepted only for commercial layouts (plan set PDF and DXF, and the assistant when the client says it is in commercial mode). The commercial model is used only for those accounts.
* The trial login is a hashed credential stored in `portal_settings`. Sign in is by username (case insensitive), rate limited per username and per IP, and tokens stop working when the owner resets, disables or expires the login.

## Items for owner review or decision

* Terms: new section 10 "Commercial Developer subscription" in `website-live/terms.html` (monthly renewal, cancel anytime, access to the end of the paid period, no part month refund beyond Australian Consumer Law, GST inclusive, failed payment pauses access). Please have it reviewed.
* A failed payment (`past_due`) blocks commercial access at once. Stripe retries the card for a few days, so you may prefer a grace period.
* The A$15 and 100 message figures and the AI cost table prices are config values. The cost report prices are my assumption (US$3 in, US$15 out per million tokens).
* The DXF watermark text still reads "TRIAL NOT FOR CONSTRUCTION OR LODGEMENT" and the PDF footer line reads "Free trial export from Glide Inside. Watermark removed once the account is active." (the existing builder trial wording). Only the PDF title is "TRIAL, NOT FOR CONSTRUCTION".
* The trial account is stored without a new database role: the brief's "commercial_trial role" is the token and account role name (`commercial_trial`), not a row in the `users` table, which has a CHECK constraint that would need a table rebuild migration.
* Subscription restore on another browser needs the checkout email and the receipt reference (`csub_...`) shown on the account page, because this server sends no email.
* A cancelled but still paid subscription keeps access to the period end; the account page shows "Renews on" for active ones and "Access ends on" otherwise. It does not yet say "cancels at the end of the period" (that flag is not stored).
