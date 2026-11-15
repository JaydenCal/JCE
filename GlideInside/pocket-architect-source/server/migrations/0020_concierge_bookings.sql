-- AI booking concierge: the MINIMAL booking record. No name, email, phone or conversation text is stored here.
-- One row per proposal (id is the public booking reference). It exists to stop duplicate and replayed confirms, to remember the provider's
-- booking id, and to hold a hash of the ownership token for the manage link. Additive and repeatable. 0019 belongs to another branch.
CREATE TABLE IF NOT EXISTS concierge_bookings (
  id TEXT PRIMARY KEY,                    -- public reference, e.g. GI-7K3M2Q (also the proposal id)
  idem_key TEXT NOT NULL,                 -- the browser's idempotency key for the attempt
  type TEXT NOT NULL,                     -- homeowner | builder | developer | agent
  slot_start_ms INTEGER NOT NULL,         -- start of the appointment, UTC milliseconds
  status TEXT NOT NULL,                   -- pending | confirmed | requested | failed | failed_retryable | unknown | cancelled
  provider TEXT NOT NULL,                 -- mock | calcom
  provider_ref TEXT,                      -- the provider's booking id (set only after the provider confirmed)
  owner_hash TEXT,                        -- sha256 of the ownership token (the token itself is shown once and never stored)
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_concierge_idem ON concierge_bookings(idem_key);
CREATE INDEX IF NOT EXISTS idx_concierge_status ON concierge_bookings(status, updated_at);
