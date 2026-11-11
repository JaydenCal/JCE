-- 0008: free builder trial tables (previously only in schema.sql) and the per-org custom client login price.
-- Additive only. The two trial tables are CREATE IF NOT EXISTS, so a database that already ran schema.sql keeps them.
-- The ALTER adds one nullable column and is applied once, with "wrangler d1 migrations apply" (like 0006).
-- orgs.custom_login_cents: the owner's own price per new client login for that builder, in cents incl. GST. NULL = standard volume pricing
-- (logins 1 to 15 in a Sydney month A$35, 16 to 50 A$25). Set from the owner admin page. When set it applies to every login that month.
ALTER TABLE orgs ADD COLUMN custom_login_cents INTEGER;

-- =====================================================================================================================
-- Free builder trial (docs/PORTAL_API.md 14, lib/trial.js). Purely additive: two new tables, no existing table changes.
-- An org with no org_accounts row is a legacy active org (no trial). Apply again after deploying: re-run this whole file.
-- =====================================================================================================================

-- A builder's request for a free trial. The owner approves or declines each one; approval creates the org.
CREATE TABLE IF NOT EXISTS trial_requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | declined (deciding while an approval is being made)
  company_legal_name TEXT NOT NULL,
  abn TEXT NOT NULL,                         -- 'XX XXX XXX XXX', checksum validated
  trading_name TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  mobile TEXT NOT NULL,
  region TEXT NOT NULL,
  homes_per_year INTEGER,
  how_heard TEXT,
  consent_at TEXT NOT NULL,                  -- the trial terms tickbox
  terms_version TEXT,
  ip_hash TEXT,                              -- SHA-256 of the IP address, for abuse checks only
  notify_status TEXT,                        -- sent | skipped | failed (the email to the owner)
  decided_at TEXT,
  decision_note TEXT,
  org_id TEXT                                -- set on approval
);
CREATE INDEX IF NOT EXISTS idx_trial_requests_status ON trial_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_trial_requests_abn ON trial_requests(abn);

-- Trial and card state per org. status: trial | trial_ended | active | read_only. 'trial' past trial_ends_at is treated as
-- trial_ended by the server (no cron needed). Times are ISO 8601 UTC text.
CREATE TABLE IF NOT EXISTS org_accounts (
  org_id TEXT PRIMARY KEY REFERENCES orgs(id),
  status TEXT NOT NULL DEFAULT 'active',
  trial_started_at TEXT,
  trial_ends_at TEXT,                        -- 00:00 Sydney, 14 days after the approval date
  trial_extended_days INTEGER NOT NULL DEFAULT 0,
  request_id TEXT,
  converted_at TEXT,
  converted_how TEXT,                        -- card | manual
  payment_method_id TEXT,                    -- Stripe pm_..., the customer's default payment method
  card_brand TEXT,
  card_last4 TEXT,
  card_added_at TEXT,
  owner_note TEXT
);
