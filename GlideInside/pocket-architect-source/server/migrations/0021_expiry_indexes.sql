-- Expiry indexes (pre-launch load test 15/11/2026, finding F3). ADDITIVE and REPEATABLE (CREATE INDEX IF NOT EXISTS only).
-- Apply with:  npx wrangler d1 migrations apply pocket-architect --remote   (safe before or after the Worker that uses bounded purges)
-- The purge that runs on each sign in or sign up deleted expired rows with a full table scan (62 ms and a half million rows read at 500,000 sessions).
-- With these indexes the purge is an index range read. The Worker also bounds each purge (LIMIT per call), so it works with or without them.
-- Numbered 0021 because the concierge branch uses 0020.
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_psessions_expires ON profile_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
