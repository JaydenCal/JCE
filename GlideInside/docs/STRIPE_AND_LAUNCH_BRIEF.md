# Pocket Architect: what to type into Stripe, and go-live steps

Your Stripe dashboard shows "Action required: we need some information for your account". Clear that first (Stripe will not pay out or may pause payments until it is done).

## 1. Stripe product (Product catalogue > Add product)
| Field | Type this |
|---|---|
| Name | Pocket Architect plan (one job) |
| Description | One design job: PDF plan set (one set per job), DXF and 3D model exports, AI assistant credits. Concept design only. |
| Pricing model | Standard pricing |
| Price | 35.00 AUD |
| Type | One-off (not recurring) |
| Tax | Only tick "Include tax in price" if you are GST registered |
Save, then copy the **Price ID** (starts `price_`). Do NOT edit the existing "3D fly-through video" product.

## 2. Webhook (Developers > Webhooks > Add endpoint)
- Endpoint URL: `https://glideinside.com.au/api/stripe/webhook`
- Events: `checkout.session.completed`, `charge.refunded`
- Copy the **Signing secret** (`whsec_...`).

## 3. Receipts
Settings > Emails > turn on "Successful payments". Settings > Business > Public details: set the business name and support email so receipts look right.

## 4. API keys (Developers > API keys)
Use the **secret key** (`sk_live_...`, or `sk_test_...` while testing). Never paste it into chat or into the website. It goes only into the server secrets below.

## 5. Server (Cloudflare Workers + D1 + R2, see server/)
```
cd server && cp wrangler.toml.example wrangler.toml     # edit database_id
npx wrangler d1 create pocket-architect                 # paste the id into wrangler.toml
npx wrangler d1 execute pocket-architect --file=schema.sql --remote
npx wrangler r2 bucket create pocket-architect-files
npx wrangler secret put STRIPE_SECRET_KEY               # sk_test_... first
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put ENTITLEMENT_SECRET              # any long random string
npx wrangler secret put STRIPE_PRICE_ID                 # price_...
npx wrangler deploy
```
Test in Stripe test mode with card 4242 4242 4242 4242 before switching to live keys.

## 6. Site
Upload the contents of `site/` to the web root. Updated app builds: `python3 tools/install_app.py <new plan-studio file>` then re-upload `site/plan-studio/app/index.html`.

## What works now / what does not yet
- Works and tested here: app loads, Unlock shows A$35 and calls /api/checkout; server logic tests pass (webhook signature, idempotency, entitlement, restore, one PDF set per job, refund stops access).
- Not live until you deploy the server with your Stripe secrets.
- PDF/DXF/GLB generation on the server needs the exporter modules from the app package (`src/premium/exporters`). Until installed, the server answers "EXPORT_NOT_CONFIGURED" and does not use up the job's one PDF set.
- AI assistant answers "unavailable" until ANTHROPIC_API_KEY and the AI handler are added.
- Email-based accounts: your checkout email + receipt restores a purchase on any device (no passwords). Zip save/load of projects is an app feature; the current build saves and opens a `.json` project file.
- GST: the app text says "incl. GST" (`gstInclusive`). Turn that off if you are not GST registered.
