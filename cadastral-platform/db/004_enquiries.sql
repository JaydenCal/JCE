-- =============================================================================
-- 004: core.enquiries  ("Talk to a civil engineer" referral enquiries to the industry partner)
-- Anonymous visitors (marketing site) and signed-in users can submit. Submitters can read their own rows;
-- members of role enquiry_partner (and enquiry_service) can read all. Delivery bookkeeping runs through
-- SECURITY DEFINER functions so the API role never needs blanket UPDATE on the table.
-- Run after 001_schema.sql.
-- =============================================================================
BEGIN;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enquiry_partner') THEN CREATE ROLE enquiry_partner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enquiry_service') THEN CREATE ROLE enquiry_service NOLOGIN; END IF;
END $$;

CREATE TABLE core.enquiries (
    enquiry_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reference         text NOT NULL UNIQUE,                         -- shown to the submitter, e.g. ENQ-20261012-7K2QF9
    created_at        timestamptz NOT NULL DEFAULT now(),
    status            text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
    submitter_user_id uuid REFERENCES core.users (user_id) ON DELETE SET NULL,   -- NULL for anonymous visitors
    name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    email             text NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
    phone             text CHECK (length(phone) <= 40),
    company           text CHECK (length(company) <= 200),
    role              text NOT NULL DEFAULT 'other' CHECK (role IN ('homeowner', 'builder', 'designer', 'developer', 'other')),
    preferred_contact text NOT NULL DEFAULT 'email' CHECK (preferred_contact IN ('email', 'phone', 'either')),
    timeframe         text CHECK (length(timeframe) <= 100),
    enquiry_types     text[] NOT NULL DEFAULT '{}',
    message           text NOT NULL CHECK (length(message) <= 5000),
    address           text CHECK (length(address) <= 500),
    lot_plan          text CHECK (length(lot_plan) <= 100),
    project_id        uuid REFERENCES core.projects (project_id) ON DELETE SET NULL,
    share_context     boolean NOT NULL DEFAULT false,
    context_json      jsonb,                                         -- project summary; only populated when share_context
    attachments       jsonb NOT NULL DEFAULT '[]'::jsonb,            -- [{filename, content_type, byte_size, sha256, storage_path}]
    consent_version   text NOT NULL,
    consent_at        timestamptz NOT NULL,
    ip                inet,
    user_agent        text CHECK (length(user_agent) <= 500),
    referral_partner  text NOT NULL DEFAULT 'JCE Infrastructure',
    notified_at       timestamptz,                                   -- partner notification delivered
    notify_error      text,                                          -- last delivery error, NULL when fine
    notify_attempts   integer NOT NULL DEFAULT 0,
    acknowledged_at   timestamptz,                                   -- auto-acknowledgement sent to submitter
    CHECK (share_context OR context_json IS NULL)
);
CREATE INDEX ix_enquiries_created ON core.enquiries (created_at DESC);
CREATE INDEX ix_enquiries_ip_created ON core.enquiries (ip, created_at);
CREATE INDEX ix_enquiries_unnotified ON core.enquiries (created_at) WHERE notified_at IS NULL;
CREATE INDEX ix_enquiries_submitter ON core.enquiries (submitter_user_id);

ALTER TABLE core.enquiries ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION core.is_enquiry_partner() RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT pg_has_role(current_user, 'enquiry_partner', 'member') OR pg_has_role(current_user, 'enquiry_service', 'member');
$$;

-- anyone (incl. anonymous) may insert, but may not claim another user's identity
CREATE POLICY p_enq_insert ON core.enquiries FOR INSERT
    WITH CHECK (submitter_user_id IS NOT DISTINCT FROM core.current_user_id());
CREATE POLICY p_enq_select_own ON core.enquiries FOR SELECT
    USING (submitter_user_id IS NOT NULL AND submitter_user_id = core.current_user_id());
CREATE POLICY p_enq_select_partner ON core.enquiries FOR SELECT USING (core.is_enquiry_partner());
CREATE POLICY p_enq_update_partner ON core.enquiries FOR UPDATE
    USING (core.is_enquiry_partner()) WITH CHECK (core.is_enquiry_partner());

-- ---- SECURITY DEFINER helpers for the API (rate limit + delivery bookkeeping) ----
CREATE OR REPLACE FUNCTION core.enquiry_recent_count(p_ip inet, p_window interval) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = core, pg_temp AS $$
    SELECT count(*)::int FROM core.enquiries WHERE ip = p_ip AND created_at > now() - p_window;
$$;

CREATE OR REPLACE FUNCTION core.enquiry_load(p_id uuid) RETURNS SETOF core.enquiries
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = core, pg_temp AS $$
    SELECT * FROM core.enquiries WHERE enquiry_id = p_id;
$$;

CREATE OR REPLACE FUNCTION core.enquiry_pending(p_max_attempts integer, p_limit integer) RETURNS SETOF core.enquiries
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = core, pg_temp AS $$
    SELECT * FROM core.enquiries
     WHERE (notified_at IS NULL OR acknowledged_at IS NULL) AND notify_attempts < p_max_attempts
     ORDER BY created_at LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION core.enquiry_record_delivery(p_id uuid, p_notified boolean, p_acked boolean, p_error text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = core, pg_temp AS $$
    UPDATE core.enquiries SET
        notified_at     = CASE WHEN p_notified AND notified_at IS NULL THEN now() ELSE notified_at END,
        acknowledged_at = CASE WHEN p_acked AND acknowledged_at IS NULL THEN now() ELSE acknowledged_at END,
        notify_error    = left(p_error, 2000),
        notify_attempts = notify_attempts + 1
     WHERE enquiry_id = p_id;
$$;

REVOKE ALL ON FUNCTION core.enquiry_recent_count(inet, interval), core.enquiry_load(uuid),
    core.enquiry_pending(integer, integer), core.enquiry_record_delivery(uuid, boolean, boolean, text) FROM PUBLIC;
COMMIT;

-- After loading, grant the API's login role (not done here: role names are deployment-specific):
--   GRANT INSERT ON core.enquiries TO <api_role>;  GRANT SELECT ON core.enquiries TO <api_role>;
--   GRANT EXECUTE ON FUNCTION core.enquiry_recent_count, core.enquiry_load, core.enquiry_pending, core.enquiry_record_delivery TO <api_role>;
--   GRANT enquiry_partner TO <partner_reader_role>;
