# Pocket Architect: Stripe test mode checklist (do this after deploying)

Time needed: about 20 minutes. You need the deployed Worker, the site uploaded, and a Stripe account in **Test mode** (toggle top right of the dashboard). No real money moves in test mode.

## 0. Before you start: server secrets (test values)
Run in `server/` (see `STRIPE_AND_LAUNCH_BRIEF.md` sections 1, 2 and 5):
```
npx wrangler secret put STRIPE_SECRET_KEY        # sk_test_...   (Developers > API keys, Test mode)
npx wrangler secret put STRIPE_WEBHOOK_SECRET    # whsec_...     (from the test mode webhook below)
npx wrangler secret put ENTITLEMENT_SECRET       # any long random string
npx wrangler secret put STRIPE_PRICE_ID          # optional: price_... of the A$35 test mode price
npx wrangler secret put TEST_CODES               # optional: PA-FRIENDS-XXXXXXXX
npx wrangler deploy
```
Vars in `wrangler.toml` that matter for payments: `SITE_URL`, `APP_URL` (must end with `/plan-studio/app/`), `PLAN_PRICE_CENTS` (3500; **must equal the Stripe price**, because the webhook ignores a payment below this amount), `PLAN_PACK_CREDITS` (500), `ENTITLEMENT_DAYS` (365). Optional: `TEST_CODE_MAX_USES`, `TEST_CODE_PDF_SETS`. `STRIPE_API_BASE` is only for local testing; leave it unset in production.

Create the **test mode** webhook now: Developers > Webhooks > Add endpoint. URL `https://glideinside.com.au/api/stripe/webhook`. Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`. Test mode and live mode have separate endpoints, keys and secrets.

## 1. Health check
1. Open `https://glideinside.com.au/api/health` in a browser.
2. You should see `"ok":true` and `"paymentsConfigured":true`. If `paymentsConfigured` is false, one of the three secrets is missing.

## 2. Buy it (card 4242)
1. Open `https://glideinside.com.au/plan-studio/app/`. Skip the tour if it appears.
2. Click **Unlock plans, A$35** (top right). The panel shows **A$35 incl. GST, one payment for this project**.
3. Click **Continue to secure checkout**. You land on a Stripe page (it shows a TEST MODE banner) showing A$35.00 and the product name "Pocket Architect plan (one job)".
4. Email: use your own address. Card `4242 4242 4242 4242`, any future expiry, any CVC, any name and postcode. Click **Pay**.
5. You return to the app. A panel says **Confirming your payment**, then within about 5 seconds **Plan Pack unlocked**, showing **AI credits 500 of 500 left**, **Exports until** (today plus one year, DD/MM/YYYY) and a **Receipt reference** starting `ent_`. Write the receipt reference down.
6. Close the panel. The top right button no longer says Unlock. Reload the page: it must stay unlocked.

If the panel stops at **Still confirming your payment**, the webhook did not arrive. Go to section 3.

## 3. Check the webhook delivered
1. Stripe dashboard (Test mode) > Developers > Webhooks > your endpoint > **Event deliveries** (or Workbench > Webhooks).
2. `checkout.session.completed` should show **200**. Click it to see the response body `{"ok":true}`.
3. If it shows 400: wrong signing secret (re-copy the `whsec_` for the test mode endpoint, `wrangler secret put STRIPE_WEBHOOK_SECRET`, redeploy). If 503: `STRIPE_WEBHOOK_SECRET` is not set. If 500: use **Resend**; Stripe also retries on its own and the server is built so a retry is safe.
4. A 200 with the payment but no unlock means the amount or currency did not match. Confirm the Stripe price is exactly A$35.00 and `PLAN_PRICE_CENTS` is 3500.

## 4. Check the invoice and receipt
1. Payments > click the A$35 payment. There should be a linked **Invoice** (created automatically) and a receipt link.
2. Open the invoice PDF. It should show Glide Inside, **ABN 11 549 431 925**, A$35.00 including GST of A$3.18, and the word "Tax invoice" if your invoice settings use it (see section 8).
3. Customer email: with receipts on you should receive "Your receipt from Glide Inside" at the address you used.

## 5. Restore on another device
1. Open a private window (or another browser) and go to the app. Open the same design file if you have saved one, or note that restore unlocks the design it was bought for.
2. Click **Unlock plans, A$35**, then **Restore purchase**.
3. Email: the one used at checkout. Reference: the `ent_...` receipt reference from step 2.5 (the `pi_...` payment ID or `cs_...` checkout session ID also work).
4. Expected: **Plan Pack restored**, with 500 credits. A wrong email or reference shows "We could not find a Plan Pack with those details".

## 6. Cancel
1. Start another checkout from a different design, then click the back arrow on the Stripe page.
2. Expected: you return to the app with a message "Checkout cancelled. You have not been charged." and the design stays locked.

## 7. Refund test
1. Payments > the A$35 payment > **Refund** > refund a **partial** amount (A$10). Access must stay (reload the app: still unlocked). The webhook `charge.refunded` shows 200.
2. Refund the remaining A$25. Reload the app: it must say your Plan Pack could not be verified and the design is locked again. Restore purchase must now fail.
3. Friends code (optional): Restore purchase with your email and `PA-FRIENDS-XXXXXXXX` in the reference box. Expected: unlocked for 30 days with 500 credits. Note: this only works once the app sends the open project id on the restore call (a small patch to the generated app, pending in `tools/install_app.py`). A code stops working for new people after `TEST_CODE_MAX_USES` people (default 25).

## 8. Stripe dashboard settings (set once, in both Test and Live mode)
- **Product**: "Pocket Architect plan (one job)", one-off price **35.00 AUD**, tick **Include tax in price** (GST inclusive). Put its `price_...` into `STRIPE_PRICE_ID`, or leave `STRIPE_PRICE_ID` unset and the Worker sends A$35.00 tax inclusive itself.
- **Business public details** (Settings > Business > Public details): business name Glide Inside, support email and phone, website, statement descriptor.
- **Tax invoice**: Settings > Business > Invoice template (or Billing > Invoices): add **ABN 11 549 431 925** to the account tax IDs (Settings > Business > Tax IDs, type Australian ABN), set the business address, and set the invoice document title to "Tax invoice". The GST registered business must show its ABN and the words "Tax invoice" on invoices over A$82.50 (under that, a receipt with ABN, date, description and GST amount is enough). Confirm with your accountant.
- **Customer emails** (Settings > Business > Customer emails): turn on **Successful payments** (receipts). If you want the invoice emailed as well, turn on invoice emails in Billing > Invoices.
- **Payment Links for add-ons** (Product catalogue > create a product for each, then Payment Links > New): A$5 fly-through add-on, A$10 renders add-on, A$15 both. Tick **Include tax in price**, collect email, one-off. Paste the three `https://buy.stripe.com/...` URLs into `site/site.config.js` (`stripeFlyThrough`, `stripeRenders`, `stripeBoth`). These do not unlock the app: the webhook deliberately ignores any payment that is not an A$35 plan checkout from the app (no project reference, or an amount below A$35).
- **Fraud and disputes**: leave Radar defaults on. A dispute does not revoke access automatically; handle it in the dashboard.
- Do not enable promotion codes or other currencies on this product: the webhook requires AUD and at least A$35.00.

## 9. Switch to live
1. Complete Stripe's "Action required" account details first.
2. Repeat section 8 in **Live mode** (product, price, business details, ABN, receipts, add-on Payment Links).
3. Create a **live mode** webhook endpoint (same URL and events). Copy its new `whsec_`.
4. `wrangler secret put STRIPE_SECRET_KEY` with the **live** `sk_live_...`, `STRIPE_WEBHOOK_SECRET` with the live `whsec_...`, and `STRIPE_PRICE_ID` with the live `price_...` if you use one. Redeploy.
5. Do one real A$35 purchase with your own card, check the webhook shows 200 in live mode, check the invoice, then refund it fully from the dashboard.
6. Remove or rotate `TEST_CODES` if you do not want friends codes live.

## What each result means (quick reference)
| You see | Meaning |
|---|---|
| "Payments are not available right now" in the app | Stripe unreachable or a wrong secret key. Check `/api/health` and the key. |
| "Still confirming your payment" for over 30 s | Webhook not delivered or rejected. See section 3. Customer can use Restore with the checkout `cs_...` shown in the panel. |
| Webhook 400 | Signing secret mismatch or the request is older than 5 minutes (Stripe clock). |
| Webhook 200 but app stays locked | Amount below `PLAN_PRICE_CENTS`, not AUD, or the session did not come from the app. |
