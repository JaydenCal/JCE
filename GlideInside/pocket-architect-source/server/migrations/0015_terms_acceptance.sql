-- 15. Plan set terms acceptance. One row per (account or entitlement, terms version): who accepted which version of the plan set terms of use
-- (src/legal/plan-terms.js), when (UTC), from which address (hashed with IP_HASH_SALT, never the raw address) and with which browser.
-- Additive only (a new table and two indexes), repeatable. Run once after deploying the Worker: wrangler d1 migrations apply pocket-architect --remote
--   subject_id   'pack:<entitlement id>' | 'csub:<entitlement or trial id>' | 'portal:<user id>'
--   subject_kind 'pack' | 'commercial' | 'portal'
--   context      where the acceptance was given, e.g. 'lot-card-site-pdf', 'export-pdf', 'commercial-plan-set'
CREATE TABLE IF NOT EXISTS terms_acceptance (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  version TEXT NOT NULL,
  context TEXT,
  accepted_at TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_terms_subject_version ON terms_acceptance(subject_id, version);
CREATE INDEX IF NOT EXISTS idx_terms_version ON terms_acceptance(version, accepted_at);
