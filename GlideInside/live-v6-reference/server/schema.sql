CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, email TEXT, stripe_session_id TEXT UNIQUE, payment_intent TEXT,
  amount_cents INTEGER, currency TEXT, credits_total INTEGER NOT NULL, credits_used INTEGER NOT NULL DEFAULT 0,
  pdf_used INTEGER NOT NULL DEFAULT 0, pdf_allowed INTEGER NOT NULL DEFAULT 1, pdf_file TEXT,
  status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT);
CREATE INDEX IF NOT EXISTS idx_ent_project ON entitlements(project_id);
CREATE INDEX IF NOT EXISTS idx_ent_email ON entitlements(email);
CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, type TEXT, received_at TEXT);
-- Export log and rate limiting. Apply after schema.sql:
--   wrangler d1 execute pocket-architect --remote --file=migrations/0002_exports.sql
-- Safe to run more than once.

-- One row per export request that passed authentication and the rate limit check.
-- ip_hash = SHA-256 hex of (IP_HASH_SALT + cf-connecting-ip); the raw address is never stored.
CREATE TABLE IF NOT EXISTS export_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entitlement_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ip_hash TEXT);
CREATE INDEX IF NOT EXISTS idx_export_log_ent ON export_log(entitlement_id, created_at);
-- AI assistant tables. Apply after schema.sql:
--   wrangler d1 execute pocket-architect --remote --file=migrations/0003_ai.sql
-- Safe to run more than once.

-- One row per upstream attempt. credits = what the customer was charged (0 on failure).
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entitlement_id TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,        -- uncached input tokens
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,  -- cache_creation_input_tokens
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,   -- cache_read_input_tokens
  credits INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',              -- ok | error:<code>
  created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ent ON ai_usage(entitlement_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_day ON ai_usage(created_at);

-- Global daily spend ceiling in weighted tokens (see AI_DAILY_TOKEN_CAP). One row per UTC day.
CREATE TABLE IF NOT EXISTS ai_daily (day TEXT PRIMARY KEY, weighted INTEGER NOT NULL DEFAULT 0);

-- Per entitlement fixed one minute window request counter (see AI_RATE_PER_MIN).
CREATE TABLE IF NOT EXISTS ai_rate (eid TEXT NOT NULL, win INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (eid, win));

-- AI credit and daily-cap reservations. settled: 0 open, 1 settled by the request, 2 released by the stale sweeper.
CREATE TABLE IF NOT EXISTS ai_reservations (
  id TEXT PRIMARY KEY, eid TEXT NOT NULL, credits INTEGER NOT NULL DEFAULT 0, weighted INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL, created_at INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_ai_res_open ON ai_reservations(settled, created_at);

-- Per-IP fixed window counters for /entitlement/restore and /checkout. key = scope:SHA-256(IP_HASH_SALT + ip).
CREATE TABLE IF NOT EXISTS ip_rate (key TEXT NOT NULL, win INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, win));

-- Save and share. Apply after the earlier migrations (also included in schema.sql). Safe to run more than once.
--   wrangler d1 execute pocket-architect --remote --file=migrations/0005_projects.sql
-- The design itself lives in R2 under projects/<id>.json. This table holds the lookup, the hashed edit key and the expiry.
-- email is an optional lead the visitor typed. It is stored only. Nothing sends email.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  edit_key_hash TEXT NOT NULL,       -- SHA-256 hex of the edit key; the key itself is never stored
  name TEXT,
  email TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,          -- extended each time the owner saves (PROJECT_TTL_DAYS)
  ip_hash TEXT);
CREATE INDEX IF NOT EXISTS idx_projects_expires ON projects(expires_at);
