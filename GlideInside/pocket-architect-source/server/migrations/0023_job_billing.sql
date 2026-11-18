-- Builder per job billing (owner decision 18/11/2026). ADDITIVE. Apply with:  npx wrangler d1 migrations apply pocket-architect --remote
-- Apply BEFORE the Worker that uses it. Nothing here changes an existing row, invoice or login charge.
-- 1. job_charges: one row per NEW project a builder staff login starts (the unit builders are charged for, A$20 incl. GST, or counted against a
--    capped monthly plan, or free during a trial or for an internal test account). request_id is unique so a retried confirm never charges twice.
--    amount_cents is what was actually charged (0 for plan included, trial, internal and "unbilled" jobs). kind:
--    charged | plan_included | plan_extra | trial_free | internal | unbilled (the Stripe price was not configured, so nothing was charged).
-- 2. Three optional columns on org_accounts for the capped monthly plans (Builder Starter, Pro, Teams). All NULL until a plan is bought.
CREATE TABLE IF NOT EXISTS job_charges (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  org_id TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  project_id TEXT,
  project_name TEXT,
  month TEXT NOT NULL,                       -- Sydney month of created_at, YYYY-MM
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  plan TEXT,                                 -- starter | pro | teams when the org was on a plan
  stripe_invoice_id TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_charges_org ON job_charges(org_id, month);
ALTER TABLE org_accounts ADD COLUMN job_plan TEXT;
ALTER TABLE org_accounts ADD COLUMN job_plan_subscription_id TEXT;
ALTER TABLE org_accounts ADD COLUMN job_plan_since TEXT;
