-- Security hardening (pre-launch review 15/11/2026). Additive only: two columns with safe defaults and one new table.
-- Apply with:  npx wrangler d1 migrations apply pocket-architect --remote   (before deploying the Worker that reads these columns)

-- M2: a per login epoch that is bumped on logout, password change, disable and delete. AI bearer tokens carry it (claim "se"),
-- so a token issued before the bump is refused with 401 even though its signature and expiry are still valid.
ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;

-- M3: marketing consent given at sign up is UNVERIFIED (no email is sent yet, so nobody has confirmed the address is theirs).
-- 0 = unverified (the default, including every existing row), 1 = confirmed by the address owner (set only by a future double opt in).
-- The marketing CSV leaves unverified contacts out unless the owner chooses to include them.
ALTER TABLE profiles ADD COLUMN marketing_consent_verified INTEGER NOT NULL DEFAULT 0;

-- L6: when a free profile is deleted its consent events are kept in this anonymised archive (salted hash of the address, no name, no email),
-- so the Spam Act 2003 consent and unsubscribe record survives and a deleted person who unsubscribed is not marketed to again.
-- Rows are purged by the scheduled cleanup after CONSENT_ARCHIVE_YEARS (default 3).
CREATE TABLE IF NOT EXISTS consent_archive (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  at TEXT NOT NULL,
  consent INTEGER NOT NULL,
  text_version TEXT,
  source TEXT NOT NULL,
  archived_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consent_archive_hash ON consent_archive(email_hash);
CREATE INDEX IF NOT EXISTS idx_consent_archive_archived ON consent_archive(archived_at);

