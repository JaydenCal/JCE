-- Glide Inside / Plan Studio API: the whole database in its FINAL shape, for a FRESH database (and for the tests).
--
-- *** An existing database (the live "pocket-architect" D1) is changed by the migrations, not by this file: ***
--       npx wrangler d1 migrations apply pocket-architect --remote
--     The migrations in migrations/ build exactly this shape on top of the live tables (a test checks that they match).
--     This file is repeatable (CREATE ... IF NOT EXISTS) but it cannot add a column to a table that already exists.
--
-- Tables kept from the live Worker (15/10/2026): entitlements, webhook_events, export_log, ai_usage, ai_daily, ai_rate, ai_reservations,
-- ip_rate, projects (Save and share). The release code uses entitlements, webhook_events and projects; export_log, ai_usage, ai_daily,
-- ai_rate, ai_reservations and ip_rate are no longer written but stay, so nothing is dropped and a rollback to the live Worker works.
-- Rollback of the new tables means ignoring them: no live table depends on them.

-- ===== Plan Pack (live 0001, plus credits_reserved from 0006) =====
CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, email TEXT, stripe_session_id TEXT UNIQUE, payment_intent TEXT,
  amount_cents INTEGER, currency TEXT, credits_total INTEGER NOT NULL, credits_used INTEGER NOT NULL DEFAULT 0,
  credits_reserved INTEGER NOT NULL DEFAULT 0,
  pdf_used INTEGER NOT NULL DEFAULT 0, pdf_allowed INTEGER NOT NULL DEFAULT 1, pdf_file TEXT,
  status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT);
CREATE INDEX IF NOT EXISTS idx_ent_project ON entitlements(project_id);
CREATE INDEX IF NOT EXISTS idx_ent_email ON entitlements(email);
CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, type TEXT, received_at TEXT);

-- ===== live 0002_exports.sql =====
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

-- ===== live 0003_ai.sql =====
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

-- ===== live 0004_hardening.sql =====
-- Hardening. Apply after the earlier migrations (also included in schema.sql). Safe to run more than once.
--   wrangler d1 execute pocket-architect --remote --file=migrations/0004_hardening.sql

-- AI credit and daily-cap reservations. settled: 0 open, 1 settled by the request, 2 released by the stale sweeper.
CREATE TABLE IF NOT EXISTS ai_reservations (
  id TEXT PRIMARY KEY, eid TEXT NOT NULL, credits INTEGER NOT NULL DEFAULT 0, weighted INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL, created_at INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_ai_res_open ON ai_reservations(settled, created_at);

-- Per-IP fixed window counters for /entitlement/restore and /checkout. key = scope:SHA-256(IP_HASH_SALT + ip).
CREATE TABLE IF NOT EXISTS ip_rate (key TEXT NOT NULL, win INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, win));

-- ===== live 0005_projects.sql =====
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

-- ===== release 0006 (the credits_reserved column is in the entitlements table above) =====
-- 0006 release: what the Glide Inside go-live server needs on top of the live database (0001 to 0005).
-- ADDITIVE ONLY. Nothing is dropped, renamed or rewritten, and every live column, table and row stays as it is, so the previous
-- Worker version keeps running on this database if the deploy is rolled back.
--
-- NOT repeatable: ALTER TABLE ... ADD COLUMN fails if run a second time. Apply with
--   npx wrangler d1 migrations apply pocket-architect --remote
-- which records what it has applied and skips it next time. (The migrations before this one are repeatable.)

-- 1. entitlements: the release code reserves AI credits before the model call (the live code deducted them at once).
--    The Stripe payment intent stays in the live column payment_intent, the release code reads and writes that column.
CREATE INDEX IF NOT EXISTS idx_entitlements_payment_intent ON entitlements(payment_intent);

-- 2. AI request log, spend ceilings and rate counters of the release AI (the live ai_usage, ai_daily, ai_rate and ai_reservations
--    tables stay in place and are simply no longer written).
CREATE TABLE IF NOT EXISTS ai_requests (
  id TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_write_tokens INTEGER,
  cache_read_tokens INTEGER,
  cost_usd_micros INTEGER,
  credits INTEGER,
  ops_count INTEGER,
  latency_ms INTEGER,
  status TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_requests_entitlement ON ai_requests(entitlement_id, created_at);

CREATE TABLE IF NOT EXISTS spend (
  period TEXT PRIMARY KEY,         -- 'd:2026-10-14', 'm:2026-10'
  cost_usd_micros INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER,
  count INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,              -- ai_paused | export | org_budget | ai_topup ...
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at);

-- 3. Find my block (lib/site.js): cached lot and address search JSON, with an expiry in epoch milliseconds.
CREATE TABLE IF NOT EXISTS site_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_cache_expiry ON site_cache(expires_at);

-- 4. "Send to JCE for engineering and DA plans" (lib/enquiry.js). A copy of every enquiry, kept even when the email fails.
CREATE TABLE IF NOT EXISTS jce_enquiries (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,   -- GI-XXXXX, shown to the person
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  need TEXT NOT NULL,               -- engineering | da | both
  notes TEXT,
  lot_json TEXT,                    -- { address, lot, dp, lga, zone }
  source TEXT,                      -- public | builder | client
  org_name TEXT,
  project_name TEXT,
  project_json TEXT,                -- the design (underlay removed), null when over 1.8 MB
  pdf_bytes INTEGER,
  consent INTEGER NOT NULL DEFAULT 1,
  email_status TEXT NOT NULL,       -- pending | sent | failed
  email_id TEXT,                    -- Resend message id
  emailed_at TEXT,
  email_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_jce_enquiries_created ON jce_enquiries(created_at);
CREATE INDEX IF NOT EXISTS idx_jce_enquiries_email ON jce_enquiries(email);

-- ===== release 0007 =====
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
  created_at TEXT NOT NULL,
  custom_login_cents INTEGER,        -- owner's per-login price for this org (NULL = volume tiers), migration 0008
  brand_primary TEXT,                -- builder colour scheme, #rrggbb or NULL (migration 0010)
  brand_accent TEXT,
  brand_dark_ink TEXT,
  brand_dark_bg TEXT,
  slug TEXT                          -- public builder slug for the home page picker, unique when set (migration 0011)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_slug ON orgs(slug);

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
  updated_at TEXT NOT NULL,
  edited_by_id TEXT,                 -- set when staff saved the project (Open as client view); null when the owner saved it
  edited_by_name TEXT,
  edited_by_staff_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_portal_projects_org ON portal_projects(org_id, owner_id);

-- One row per client login, created at the login's first successful sign in. login_id is the primary key, so the per login
-- charge can only ever exist once. No foreign key: the row stays (financial record) when the client login is deleted.
CREATE TABLE IF NOT EXISTS login_issues (
  login_id TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  org_id TEXT NOT NULL,
  client_name TEXT,
  issued_at TEXT NOT NULL,           -- the first sign in
  month TEXT NOT NULL,               -- Sydney month of issued_at
  amount_cents INTEGER NOT NULL DEFAULT 3500 -- legacy default, never relied on: the code always writes the tiered price (priceForNthLoginThisMonth), now A$30 then A$25
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

-- =====================================================================================================================
-- Free builder trial (docs/PORTAL_API.md 14, lib/trial.js). Purely additive: two new tables, no existing table changes.
-- An org with no org_accounts row is a legacy active org (no trial). Apply again after deploying: re-run this whole file.
-- =====================================================================================================================

-- A builder's request for a free trial. The owner approves or declines each one; approval creates the org.
CREATE TABLE IF NOT EXISTS trial_requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | declined (deciding while an approval is being made)
  company_legal_name TEXT NOT NULL,
  abn TEXT NOT NULL,                         -- 'XX XXX XXX XXX', checksum validated
  trading_name TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  mobile TEXT NOT NULL,
  region TEXT NOT NULL,
  homes_per_year INTEGER,
  how_heard TEXT,
  consent_at TEXT NOT NULL,                  -- the trial terms tickbox
  terms_version TEXT,
  ip_hash TEXT,                              -- SHA-256 of the IP address, for abuse checks only
  notify_status TEXT,                        -- sent | skipped | failed (the email to the owner)
  decided_at TEXT,
  decision_note TEXT,
  org_id TEXT                                -- set on approval
);
CREATE INDEX IF NOT EXISTS idx_trial_requests_status ON trial_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_trial_requests_abn ON trial_requests(abn);

-- Trial and card state per org. status: trial | trial_ended | active | read_only. 'trial' past trial_ends_at is treated as
-- trial_ended by the server (no cron needed). Times are ISO 8601 UTC text.
CREATE TABLE IF NOT EXISTS org_accounts (
  org_id TEXT PRIMARY KEY REFERENCES orgs(id),
  status TEXT NOT NULL DEFAULT 'active',
  trial_started_at TEXT,
  trial_ends_at TEXT,                        -- 00:00 Sydney, 14 days after the approval date
  trial_extended_days INTEGER NOT NULL DEFAULT 0,
  request_id TEXT,
  converted_at TEXT,
  converted_how TEXT,                        -- card | manual
  payment_method_id TEXT,                    -- Stripe pm_..., the customer's default payment method
  card_brand TEXT,
  card_last4 TEXT,
  card_added_at TEXT,
  owner_note TEXT
);
