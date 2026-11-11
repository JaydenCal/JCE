-- Plan Studio back end schema (docs/SCOPE.md 11.3). SQLite / Cloudflare D1.
-- Additions to the brief: stripe_payment_intent on entitlements (refund lookup) and the events table
-- (pause and export log for review). Safe to run more than once.

CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  email TEXT,
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  amount_cents INTEGER,
  currency TEXT,
  credits_total INTEGER NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0,
  credits_reserved INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,            -- active | refunded | expired
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_entitlements_project ON entitlements(project_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_payment_intent ON entitlements(stripe_payment_intent);
CREATE INDEX IF NOT EXISTS idx_entitlements_email ON entitlements(email);

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

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT,
  received_at TEXT
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER,
  count INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,              -- ai_paused | export
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at);

-- "Send to JCE for engineering and DA plans" (lib/enquiry.js). A copy of every enquiry, kept even when the email fails.
-- The PDF is not stored (D1 rows are limited to 2 MB); it can be rebuilt from project_json.
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
