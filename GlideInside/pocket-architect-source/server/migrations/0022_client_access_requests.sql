-- Local builder finder and client access requests (live review item 13, 15/11/2026). ADDITIVE and REPEATABLE where SQLite allows.
-- Apply with:  npx wrangler d1 migrations apply pocket-architect --remote   (apply BEFORE the Worker that uses it)
-- 1. Two opt-in columns on orgs. A builder is listed in the public "Have a local builder in mind?" search only when directory_listed = 1
--    (default 0, so nobody is listed until the builder turns it on in Clients > Client settings). directory_region is the free text region
--    shown beside the name and logo.
-- 2. client_access_requests: a visitor asks one listed builder for a client login. The request goes to THAT builder's queue only. Nothing is
--    emailed to anyone. The builder approves (which issues the client login through the normal flow) or declines.
ALTER TABLE orgs ADD COLUMN directory_listed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orgs ADD COLUMN directory_region TEXT;

CREATE TABLE IF NOT EXISTS client_access_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approving | approved | declined
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  lot_address TEXT,
  design_id TEXT,                           -- the home the visitor had chosen, when any (free text, never trusted)
  design_name TEXT,
  consent_at TEXT NOT NULL,                 -- the visitor ticked the box that passes these details to this builder
  ip_hash TEXT,
  decided_at TEXT,
  decision_note TEXT,
  client_id TEXT                            -- the client login issued on approval
);
CREATE INDEX IF NOT EXISTS idx_car_org ON client_access_requests(org_id, status, created_at);
