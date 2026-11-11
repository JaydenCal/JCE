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
