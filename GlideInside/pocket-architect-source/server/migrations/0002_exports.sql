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
