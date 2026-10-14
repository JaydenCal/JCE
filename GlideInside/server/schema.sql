CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, email TEXT, stripe_session_id TEXT UNIQUE, payment_intent TEXT,
  amount_cents INTEGER, currency TEXT, credits_total INTEGER NOT NULL, credits_used INTEGER NOT NULL DEFAULT 0,
  pdf_used INTEGER NOT NULL DEFAULT 0, pdf_allowed INTEGER NOT NULL DEFAULT 1, pdf_file TEXT,
  status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT);
CREATE INDEX IF NOT EXISTS idx_ent_project ON entitlements(project_id);
CREATE INDEX IF NOT EXISTS idx_ent_email ON entitlements(email);
CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, type TEXT, received_at TEXT);
