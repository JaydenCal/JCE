-- 0007 portal: builder and client portal tables (lib/portal*.js, docs/PORTAL_API.md). Repeatable (CREATE ... IF NOT EXISTS).
-- Created now so that switching the portal on later (PORTAL_ENABLED = 1) is a variable change, not a database change.
-- =====================================================================================================================
-- Builder and client portal (docs/PORTAL_API.md, lib/portal*.js). Everything below is CREATE ... IF NOT EXISTS, so the whole
-- file can be re-applied. This is purely additive (no existing table changes) and repeatable.
-- The portal's saved projects are in portal_projects. The name "projects" belongs to the live Save and share table.
-- Nothing in the Plan Pack tables depends on these tables, and the portal stays off while PORTAL_ENABLED is 0.
-- Money is integer cents (A$ incl. GST). Months are Sydney calendar months, 'YYYY-MM'. Times are ISO 8601 UTC text.
-- =====================================================================================================================

CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_code TEXT UNIQUE,            -- used in invoice numbers, GI-<SHORT>-YYYYMM
  display_name TEXT,                 -- name printed on plan title blocks
  logo_data_url TEXT,                -- PNG or JPEG data URL, capped at 400 KB (lib/portal.js)
  allow_client_topups INTEGER NOT NULL DEFAULT 1,
  allow_client_enquiries INTEGER NOT NULL DEFAULT 1,
  show_glide_to_clients INTEGER NOT NULL DEFAULT 1,
  allow_client_cad_exports INTEGER NOT NULL DEFAULT 0,
  ai_monthly_cap INTEGER NOT NULL DEFAULT 300,
  legal_name TEXT,                   -- buyer on tax invoices
  abn TEXT,
  billing_name TEXT,
  billing_email TEXT,
  billing_phone TEXT,
  stripe_customer_id TEXT,           -- created on first billing
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  role TEXT NOT NULL CHECK (role IN ('admin','designer','client')),
  name TEXT NOT NULL,
  email TEXT,                        -- lower case, unique when present
  username TEXT NOT NULL UNIQUE,     -- lower case, unique across the whole system
  password_hash TEXT NOT NULL,       -- pbkdf2-sha256$<iterations>$<salt>$<hash>
  must_change_password INTEGER NOT NULL DEFAULT 1,
  temp_password_expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',   -- active | disabled
  lot_address TEXT,
  house_access TEXT NOT NULL DEFAULT '"all"', -- JSON: "all" or an array of house ids
  first_sign_in_at TEXT,
  last_sign_in_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id, role);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,          -- SHA-256 of the cookie token; the token itself is never stored
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Sign in lockout counters, keyed 'u:<identifier>' and 'ip:<address>' (lib/portal.js).
CREATE TABLE IF NOT EXISTS auth_failures (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER
);

CREATE TABLE IF NOT EXISTS houses (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  description TEXT,
  source_type TEXT,                  -- glide | saved
  source_ref TEXT,                   -- glide:<template> when source_type is glide
  stats_json TEXT,                   -- { bedrooms, bathrooms, garage, floorAreaM2, widthMm, depthMm, storeys }
  thumbnail TEXT,                    -- SVG text
  project_json TEXT,                 -- null for a Glide Inside based house that has not been edited
  archived INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_houses_org ON houses(org_id, archived);

CREATE TABLE IF NOT EXISTS portal_projects (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lot_address TEXT,
  house_names TEXT,                  -- JSON array
  project_json TEXT NOT NULL,        -- capped below the 2 MB D1 row limit (PORTAL_PROJECT_MAX_BYTES)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portal_projects_org ON portal_projects(org_id, owner_id);

-- One row per client login, created at the login's first successful sign in. login_id is the primary key, so the A$20
-- charge can only ever exist once. No foreign key: the row stays (financial record) when the client login is deleted.
CREATE TABLE IF NOT EXISTS login_issues (
  login_id TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  org_id TEXT NOT NULL,
  client_name TEXT,
  issued_at TEXT NOT NULL,           -- the first sign in
  month TEXT NOT NULL,               -- Sydney month of issued_at
  amount_cents INTEGER NOT NULL DEFAULT 2000
);
CREATE INDEX IF NOT EXISTS idx_login_issues_org ON login_issues(org_id, month);

-- AI top-ups are not stored here: the AI branch logs each one as an 'ai_topup' row in events (see server/README.md).

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  month TEXT NOT NULL,
  number TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  logins_count INTEGER NOT NULL DEFAULT 0,
  topups_count INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | due | paid | void | failed
  stripe_invoice_id TEXT,
  stripe_step TEXT,                        -- created | items | finalized | sent
  stripe_hosted_url TEXT,
  error TEXT,
  snapshot_json TEXT NOT NULL,             -- seller, buyer and lines frozen at issue
  UNIQUE (org_id, month)
);

CREATE TABLE IF NOT EXISTS portal_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
