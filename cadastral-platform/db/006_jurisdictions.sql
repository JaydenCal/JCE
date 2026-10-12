-- =============================================================================
-- 006: core.jurisdiction_profiles  (custom municipality / overseas support)
-- A profile holds units, CRS, locale, cited standards, vehicle slots, legal pack key and data-source config.
-- It holds NO planning rules: those live in planning.requirements, tagged with the profile.
-- Owner = user and/or organisation. Rows are visible to the owner user, to members of the owning organisation,
-- and (via core.projects.jurisdiction_profile_id) to project members.
-- =============================================================================
ALTER TYPE core.jurisdiction ADD VALUE IF NOT EXISTS 'CUSTOM';

BEGIN;

CREATE TABLE core.jurisdiction_profiles (
    profile_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_org_id      uuid REFERENCES core.organisations (organisation_id),
    owner_user_id     uuid REFERENCES core.users (user_id),
    name              text NOT NULL CHECK (btrim(name) <> ''),
    country           text NOT NULL DEFAULT '',
    region            text NOT NULL DEFAULT '',            -- state / province
    municipality      text NOT NULL DEFAULT '',            -- council / municipality / county
    languages         text[] NOT NULL DEFAULT ARRAY['en'],
    unit_system       text NOT NULL DEFAULT 'metric' CHECK (unit_system IN ('metric','imperial_us','imperial_uk')),
    horizontal_epsg   integer NOT NULL,                    -- CRS of the user's documents (validated with pyproj in the app)
    working_epsg      integer NOT NULL,                    -- metric PROJECTED CRS used for geometry (never geographic)
    vertical_datum    text NOT NULL DEFAULT '',
    legal_pack_key    text NOT NULL DEFAULT 'generic_international',
    cadastre_kind     text NOT NULL DEFAULT 'custom' CHECK (cadastre_kind IN ('nsw','qld','custom')),
    paper_size        text NOT NULL DEFAULT 'A3' CHECK (paper_size IN ('A3','ARCH_D','ANSI_B')),
    config            jsonb NOT NULL,                      -- the full JurisdictionProfile document (units, locale, vehicles, imagery, ...)
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CHECK (owner_org_id IS NOT NULL OR owner_user_id IS NOT NULL),
    CHECK (jsonb_typeof(config) = 'object')
);
CREATE INDEX ix_jprofiles_owner_user ON core.jurisdiction_profiles (owner_user_id);
CREATE INDEX ix_jprofiles_owner_org  ON core.jurisdiction_profiles (owner_org_id);
CREATE TRIGGER trg_jprofiles_updated BEFORE UPDATE ON core.jurisdiction_profiles
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE OR REPLACE FUNCTION core.can_access_profile(p_profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = core, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM core.jurisdiction_profiles jp
        WHERE jp.profile_id = p_profile_id
          AND (jp.owner_user_id = core.current_user_id()
               OR jp.owner_org_id IN (SELECT u.organisation_id FROM core.users u
                                      WHERE u.user_id = core.current_user_id() AND u.organisation_id IS NOT NULL)))
$$;

ALTER TABLE core.jurisdiction_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_jprofile_select ON core.jurisdiction_profiles FOR SELECT
    USING (core.can_access_profile(profile_id)
           OR EXISTS (SELECT 1 FROM core.projects p
                      WHERE p.jurisdiction_profile_id = profile_id AND core.can_access_project(p.project_id)));
CREATE POLICY p_jprofile_insert ON core.jurisdiction_profiles FOR INSERT
    WITH CHECK (owner_user_id = core.current_user_id()
                OR owner_org_id IN (SELECT u.organisation_id FROM core.users u WHERE u.user_id = core.current_user_id()));
CREATE POLICY p_jprofile_update ON core.jurisdiction_profiles FOR UPDATE
    USING (core.can_access_profile(profile_id)) WITH CHECK (core.can_access_profile(profile_id));
CREATE POLICY p_jprofile_delete ON core.jurisdiction_profiles FOR DELETE
    USING (core.can_access_profile(profile_id));

ALTER TABLE core.projects ADD COLUMN jurisdiction_profile_id uuid REFERENCES core.jurisdiction_profiles (profile_id);

-- Requirements: keep the entry as typed, and the ORIGINAL-language quote with a flagged machine-translated gloss.
-- The existing "quote" column stays the original-language text (the citation validator checks only that).
ALTER TABLE planning.requirements
    ADD COLUMN profile_id                   uuid REFERENCES core.jurisdiction_profiles (profile_id),
    ADD COLUMN entered_value                double precision,
    ADD COLUMN entered_unit                 text,
    ADD COLUMN quote_language               text,
    ADD COLUMN quote_en                     text,
    ADD COLUMN quote_en_machine_translated  boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT ck_req_gloss_flag CHECK (quote_en IS NULL OR quote_en_machine_translated OR COALESCE(quote_language, 'en') = 'en');
CREATE INDEX ix_requirements_profile ON planning.requirements (profile_id) WHERE profile_id IS NOT NULL;

ALTER TABLE planning.dcp_documents
    ADD COLUMN profile_id uuid REFERENCES core.jurisdiction_profiles (profile_id),
    ADD COLUMN language   text NOT NULL DEFAULT 'en';

COMMIT;
