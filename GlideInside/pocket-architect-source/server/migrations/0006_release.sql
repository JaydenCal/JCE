-- 0006 release: what the Glide Inside go-live server needs on top of the live database (0001 to 0005).
-- ADDITIVE ONLY. Nothing is dropped, renamed or rewritten, and every live column, table and row stays as it is, so the previous
-- Worker version keeps running on this database if the deploy is rolled back.
--
-- NOT repeatable: ALTER TABLE ... ADD COLUMN fails if run a second time. Apply with
--   npx wrangler d1 migrations apply pocket-architect --remote
-- which records what it has applied and skips it next time. (The migrations before this one are repeatable.)

-- 1. entitlements: the release code reserves AI credits before the model call (the live code deducted them at once).
--    The Stripe payment intent stays in the live column payment_intent, the release code reads and writes that column.
ALTER TABLE entitlements ADD COLUMN credits_reserved INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_entitlements_payment_intent ON entitlements(payment_intent);

-- 2. AI request log, spend ceilings and rate counters of the release AI (the live ai_usage, ai_daily, ai_rate and ai_reservations
--    tables stay in place and are simply no longer written).
CREATE TABLE IF NOT EXISTS ai_requests (
  id TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_write_tokens INTEGER,
  cache_read_tokens INTEGER,
  cost_usd_micros INTEGER,
  credits INTEGER,
  ops_count INTEGER,
  latency_ms INTEGER,
  status TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_requests_entitlement ON ai_requests(entitlement_id, created_at);

CREATE TABLE IF NOT EXISTS spend (
  period TEXT PRIMARY KEY,         -- 'd:2026-10-14', 'm:2026-10'
  cost_usd_micros INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER,
  count INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,              -- ai_paused | export | org_budget | ai_topup ...
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at);

-- 3. Find my block (lib/site.js): cached lot and address search JSON, with an expiry in epoch milliseconds.
CREATE TABLE IF NOT EXISTS site_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_cache_expiry ON site_cache(expires_at);

-- 4. "Send to JCE for engineering and DA plans" (lib/enquiry.js). A copy of every enquiry, kept even when the email fails.
CREATE TABLE IF NOT EXISTS jce_enquiries (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,   -- GI-XXXXX, shown to the person
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  need TEXT NOT NULL,               -- engineering | da | both
  notes TEXT,
  lot_json TEXT,                    -- { address, lot, dp, lga, zone }
  source TEXT,                      -- public | builder | client
  org_name TEXT,
  project_name TEXT,
  project_json TEXT,                -- the design (underlay removed), null when over 1.8 MB
  pdf_bytes INTEGER,
  consent INTEGER NOT NULL DEFAULT 1,
  email_status TEXT NOT NULL,       -- pending | sent | failed
  email_id TEXT,                    -- Resend message id
  emailed_at TEXT,
  email_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_jce_enquiries_created ON jce_enquiries(created_at);
CREATE INDEX IF NOT EXISTS idx_jce_enquiries_email ON jce_enquiries(email);
