-- "Coming soon" features (19/11/2026): the See it on your block website widget, the builder lead inbox with webhooks, builder site cost rate
-- defaults and the engineering order requests saved for the owner. Additive and repeatable (CREATE TABLE IF NOT EXISTS): no existing table changes.
-- Nothing in this schema sends email. Times are ISO 8601 UTC text. Data kept is the minimum the feature needs (see docs/WIDGET_LEADS.md).

-- One row per builder: the website widget switch, the website addresses allowed to show it and the designs it offers.
CREATE TABLE IF NOT EXISTS widget_settings (
  org_id TEXT PRIMARY KEY REFERENCES orgs(id),
  enabled INTEGER NOT NULL DEFAULT 0,
  origins_json TEXT NOT NULL DEFAULT '[]',      -- allowed website origins, e.g. ["https://www.example.com.au"]
  house_ids_json TEXT NOT NULL DEFAULT '[]',    -- the builder's own house ids offered in the widget (empty = all active designs)
  updated_at TEXT NOT NULL
);

-- A person who tried the builder's designs on their block and asked to be contacted. Only the details the person typed, plus the consent record.
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  created_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'widget',        -- widget | manual
  name TEXT NOT NULL,
  email TEXT NOT NULL,                          -- lower case
  phone TEXT,                                   -- optional
  address TEXT,                                 -- the block address the visitor looked up
  lot_label TEXT,
  house_id TEXT,
  house_name TEXT,
  host_origin TEXT,                             -- the website that showed the widget
  consent_at TEXT NOT NULL,                     -- the person ticked the consent box at this time
  consent_text TEXT NOT NULL,                   -- the exact wording shown beside the box
  consent_version TEXT,                         -- the version of that wording (LEAD_CONSENT_VERSION)
  status TEXT NOT NULL DEFAULT 'new',           -- new | contacted | closed
  note TEXT                                     -- the builder's own note
);
CREATE INDEX IF NOT EXISTS idx_leads_org ON leads(org_id, created_at);

-- Webhook setting: one URL per builder and the secret that signs every delivery (HMAC SHA-256).
CREATE TABLE IF NOT EXISTS lead_webhooks (
  org_id TEXT PRIMARY KEY REFERENCES orgs(id),
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- Each delivery of a new lead to the webhook, with its retries (5 attempts, then failed). The signed body is rebuilt from the lead for every attempt.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  lead_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | delivered | failed
  last_status INTEGER,                          -- HTTP status of the last attempt, null for a network error
  last_error TEXT,
  last_attempt_at TEXT,
  next_attempt_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_deliveries_org ON webhook_deliveries(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_due ON webhook_deliveries(status, next_attempt_at);

-- The builder's default site cost rates (the Site costs panel). A design can still carry its own overrides.
CREATE TABLE IF NOT EXISTS site_cost_defaults (
  org_id TEXT PRIMARY KEY REFERENCES orgs(id),
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Engineering order requests (Order engineering from JCE Infrastructure). Saved for the owner to read in the admin portal. Never emailed.
CREATE TABLE IF NOT EXISTS engineering_orders (
  id TEXT PRIMARY KEY,                          -- public reference, e.g. EO-7K3M2Q
  created_at TEXT NOT NULL,
  org_id TEXT,                                  -- the builder, when the request came from a builder or client login
  org_name TEXT,
  services_json TEXT NOT NULL,                  -- the service ids asked for
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  lot_label TEXT,
  design_name TEXT,
  design_link TEXT,                             -- a share link to the design, when the person has one
  notes TEXT,
  consent_at TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  consent_version TEXT,                         -- the version of that wording (ORDER_CONSENT_VERSION)
  status TEXT NOT NULL DEFAULT 'new'            -- new | seen | closed
);
CREATE INDEX IF NOT EXISTS idx_eng_orders_created ON engineering_orders(created_at);
