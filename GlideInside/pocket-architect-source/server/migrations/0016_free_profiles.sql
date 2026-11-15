-- Free user profiles (lib/profiles.js). Additive and repeatable (CREATE ... IF NOT EXISTS): no existing table changes.
-- A profile is a visitor's own free account: it keeps saved designs and, if the person ticks the box, is a marketing contact.
-- It is separate from the builder and client portal tables (users, orgs). The password is stored as pbkdf2-sha256$<iterations>$<salt>$<hash>.
-- Times are ISO 8601 UTC text. Nothing in this schema sends email.
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,                     -- lower case, unique
  name TEXT NOT NULL,
  phone TEXT,                              -- optional
  postcode TEXT,                           -- optional, a postcode or a suburb as typed
  role TEXT,                               -- optional "I am a": homeowner | builder | developer | other
  password_hash TEXT NOT NULL,
  terms_version TEXT NOT NULL,             -- the site terms and privacy policy version accepted at sign up
  terms_accepted_at TEXT NOT NULL,
  marketing_consent INTEGER NOT NULL DEFAULT 0,   -- 1 only while the person has opted in (Spam Act 2003)
  marketing_consent_at TEXT,
  marketing_text_version TEXT,             -- version of the exact wording shown beside the tick box when consent was given
  unsubscribed INTEGER NOT NULL DEFAULT 0, -- 1 = never market to this contact (the export leaves them out)
  unsubscribed_at TEXT,
  last_sign_in_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_created ON profiles(created_at);

CREATE TABLE IF NOT EXISTS profile_sessions (
  id_hash TEXT PRIMARY KEY,                -- SHA-256 of the cookie token; the token itself is never stored
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_sessions_profile ON profile_sessions(profile_id);

-- Every change to marketing consent: when, on or off, which wording version and the exact words shown. Deleted with the profile.
CREATE TABLE IF NOT EXISTS profile_consent_events (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  consent INTEGER NOT NULL,
  text_version TEXT,
  text TEXT,
  source TEXT NOT NULL                     -- signup | preferences | admin
);
CREATE INDEX IF NOT EXISTS idx_profile_consent_profile ON profile_consent_events(profile_id, at);

CREATE TABLE IF NOT EXISTS profile_designs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,                -- the design's own id inside the project JSON
  name TEXT NOT NULL,
  address TEXT,
  kind TEXT NOT NULL DEFAULT 'residential',-- residential | commercial
  thumbnail TEXT,                          -- small PNG, JPEG or WebP data URL
  project_json TEXT NOT NULL,              -- capped below the 2 MB D1 row limit (PORTAL_PROJECT_MAX_BYTES)
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_designs_profile ON profile_designs(profile_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_designs_project ON profile_designs(profile_id, project_id);

-- A Plan Pack bought while signed in, linked to the profile so it can be restored on another device.
CREATE TABLE IF NOT EXISTS profile_packs (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entitlement_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, entitlement_id)
);
