-- Hardening. Apply after the earlier migrations (also included in schema.sql). Safe to run more than once.
--   wrangler d1 execute pocket-architect --remote --file=migrations/0004_hardening.sql

-- AI credit and daily-cap reservations. settled: 0 open, 1 settled by the request, 2 released by the stale sweeper.
CREATE TABLE IF NOT EXISTS ai_reservations (
  id TEXT PRIMARY KEY, eid TEXT NOT NULL, credits INTEGER NOT NULL DEFAULT 0, weighted INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL, created_at INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_ai_res_open ON ai_reservations(settled, created_at);

-- Per-IP fixed window counters for /entitlement/restore and /checkout. key = scope:SHA-256(IP_HASH_SALT + ip).
CREATE TABLE IF NOT EXISTS ip_rate (key TEXT NOT NULL, win INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, win));
