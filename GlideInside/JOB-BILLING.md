# Builder per job billing

Branch: `claude/job-billing` (based on `claude/release-6`). Owner decision 18/11/2026. Not deployed.

## What changed

Builders only. Commercial (Solo A$50 a month, AI top-up) is untouched.

1. **A$20 incl. GST per job.** A job is one NEW project that a builder staff login (admin or designer) starts in the portal. The first save of a new project now asks for a confirm that shows the price and what it covers. After the builder confirms, the saved card is charged off session and only then is the project created. Saving or reopening an existing project is free. A client login designing is never charged.
2. **Same Stripe customer and saved card as month end billing.** The job charge is one Stripe invoice (`charge_automatically`, paid off session with the card saved through the existing card setup), with the GST tax rate used by month end invoices. If there is no saved card, the confirm sends the builder to the existing card setup first (Billing page, opens in a new tab). A declined card voids the invoice and creates no project. A retry of the same confirm never charges twice.
3. **Client logins are no longer charged.** No billing row is made at first sign in, and billing details are no longer needed before generating a login. Existing login rows, month end invoices and history are untouched and still total correctly.
4. **Capped monthly plans (not enabled until Stripe prices exist).** Builder Starter A$119 a month (10 jobs), Builder Pro A$219 (20 jobs), Builder Teams A$419 (40 jobs). Jobs over the allowance are A$20 each. The allowance is counted per Sydney calendar month and unused jobs do not roll over. A plan is bought through Stripe Checkout (subscription mode); the webhook starts and ends it.
5. **Safe when not configured.** With no `BUILDER_JOB_PRICE_ID` (or no Stripe key, or a live key without `STRIPE_LIVE_BILLING_APPROVED`), the confirm still shows A$20 and what it covers, the builder is told job billing is not switched on yet, the project is created, the job is recorded as `unbilled` with 0 cents, and nothing is charged. The admin view shows a message naming the missing setting. No amount is ever hard coded into a charge: the amount comes from the Stripe price, which is read first and refused unless it is an active one off A$20 AUD price.
6. **Internal and trial accounts.** Internal accounts are never charged (recorded as `internal`, no Stripe call). During a trial, jobs are free (`trial_free`) and the confirm says what a job costs after the trial.
7. **Admin view.** Each org row in the admin page (`/portal/admin/`) has a "Jobs this month" column (count, amount charged, plan, jobs not charged because the price is not configured), a Job plan button to put an org on a plan by hand, and a banner when job billing is not ready. API: `GET /api/portal/admin/orgs/:id/jobs?month=YYYY-MM`.
8. **Public copy** (pricing, for builders, home, trial terms, FAQ and JSON-LD, concierge answers, framework.js break even calculator, trial and billing text in the portal) now says A$20 per job, no monthly fee, client logins free, and the plans A$119 / A$219 / A$419 with 10 / 20 / 40 jobs marked Coming soon. `wrangler.toml` documentation comments updated (comments only). `golive/` was not touched.

## Environment variables (all optional, none are secrets)

| Variable | What the owner creates in Stripe |
| --- | --- |
| `BUILDER_JOB_PRICE_ID` | A one off price, exactly A$20.00 AUD, GST included (tax behaviour inclusive). Product name for example "Glide Inside builder job". |
| `BUILDER_STARTER_PRICE_ID` | A recurring monthly price, A$119.00 AUD, GST included. Product "Builder Starter". |
| `BUILDER_PRO_PRICE_ID` | A recurring monthly price, A$219.00 AUD, GST included. Product "Builder Pro". |
| `BUILDER_TEAMS_PRICE_ID` | A recurring monthly price, A$419.00 AUD, GST included. Product "Builder Teams". |

Nothing was created in Stripe and no key was touched. The existing gate still applies: a live key (`sk_live_`) is refused for job charges and plans unless `STRIPE_LIVE_BILLING_APPROVED=owner-written-go-ahead` is set.

## Migration

`server/migrations/0023_job_billing.sql` (also in `server/schema.sql`). Additive: a `job_charges` table (unique `request_id`) and three nullable columns on `org_accounts` (`job_plan`, `job_plan_subscription_id`, `job_plan_since`). Apply before the Worker that uses it:

```
npx wrangler d1 migrations apply pocket-architect --remote
```

The in memory test store has the same shape (`createMemoryPortalStore`).

## How to switch it on

1. Apply migration 0023 (above), then deploy the Worker and the website files from this branch.
2. In Stripe (test mode first), create the A$20 one off price. Set `BUILDER_JOB_PRICE_ID` to its price id in the Worker environment. Confirm a job charge end to end with a test card (Billing page, add a card, start a new project, confirm).
3. For live: only when ready, set the live key and `STRIPE_LIVE_BILLING_APPROVED=owner-written-go-ahead`. Until then jobs are recorded as `unbilled` and no one is charged.
4. Plans: create the three recurring prices, set the three `BUILDER_*_PRICE_ID` variables, and the Choose this plan buttons appear in Billing. In the Stripe dashboard add the webhook events `customer.subscription.updated` and `customer.subscription.deleted` if they are not already sent to `/api/stripe/webhook` (the existing `checkout.session.completed` event is already used). The public pages still show the plans as Coming soon: change those badges by hand when you open them.
5. Watch the admin page: the Jobs this month column should show jobs charged, and the banner disappears once the job price is configured.

## Things to know

- Allowance months follow the Sydney calendar month, not the Stripe billing period of the subscription.
- A builder cancels a plan from Billing (ends at period end). The owner can also set or clear a plan by hand on the admin page; that does not create a Stripe subscription.
- The trial terms page and `TERMS_VERSION` were updated to 18/11/2026 because the pricing section changed.
- The first save by staff is where the job is confirmed (work on a new design stays on the device until saved). Client logins autosave and are never asked.
- No emails are sent by this feature.
