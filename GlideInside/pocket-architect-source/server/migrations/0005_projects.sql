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
