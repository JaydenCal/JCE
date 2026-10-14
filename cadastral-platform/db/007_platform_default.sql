-- =============================================================================
-- 007: platform default profile + lga_code for planning.requirements  (stage 2B, owner decision D3, 14/10/2026)
--
-- * status 'platform_default': a value that applies only until an LGA's own cited rule is loaded. It carries no quote or
--   file hash. Instead the citation CHECK requires a non-empty profile name (default_profile) and the stamp
--   (default_stamp, which must start 'PLATFORM DEFAULT'; the application writes 'PLATFORM DEFAULT, LGA RULE NOT LOADED' for a
--   profile row; a resolved result may carry 'LGA VALUE NOT FOUND' or 'LGA VALUE UNRESOLVED' in memory, which are not stored).
--   Platform default rows are reference rows (project_id NULL) and use extraction_method 'platform_default'.
-- * lga_code: the normalised LGA code '<state>-<slug>' (e.g. 'nsw-gunnedah'; rules in app/agents/requirements/lgacode.py).
--   NULL for state-wide rows and for platform defaults. It is a column (not an applies_to key) so that it can be indexed
--   and so that applies_to keeps the shape of the Selectors model. applies_to.lga keeps the LGA name as cited.
-- * Resolution order for a value (application side, RequirementSet.get_requirement): project user_confirmed, then the
--   LGA rule, then the state-wide rule, then the platform default, then UNRESOLVED.
-- lga_code is NOT backfilled here: SQL normalises names differently from the application (status words, brackets). The loader
-- backend/scripts/load_requirements.py sets lga_code with app/agents/requirements/lgacode.py on every run.
-- This file is re-runnable: columns and indexes use IF NOT EXISTS, constraints are dropped (by name, and by definition for the
-- unnamed 003 checks) and added again.
-- Existing rows already satisfy the relaxed checks. The existing constraints are found by definition, not by name,
-- because the table-level CHECKs of 003 were created without names.
-- =============================================================================
BEGIN;

ALTER TABLE planning.requirements
    ADD COLUMN IF NOT EXISTS lga_code        text,
    ADD COLUMN IF NOT EXISTS default_profile text,
    ADD COLUMN IF NOT EXISTS default_stamp   text;

COMMENT ON COLUMN planning.requirements.lga_code IS
    'Normalised LGA code <state>-<slug>, e.g. nsw-gunnedah, set by backend/scripts/load_requirements.py; NULL for state-wide rows and platform defaults. Also names knowledge/<lga_code>/.';
COMMENT ON COLUMN planning.requirements.default_profile IS
    'platform_default rows only: name of the default profile the value belongs to (e.g. JCESITE platform default profile).';
COMMENT ON COLUMN planning.requirements.default_stamp IS
    'platform_default rows only: the stamp printed beside the value, starting PLATFORM DEFAULT (e.g. PLATFORM DEFAULT, LGA RULE NOT LOADED).';

-- guarded drops: the constraints this file adds (present after a first run) ...
ALTER TABLE planning.requirements
    DROP CONSTRAINT IF EXISTS requirements_status_check,
    DROP CONSTRAINT IF EXISTS requirements_extraction_method_check,
    DROP CONSTRAINT IF EXISTS requirements_citation_check,
    DROP CONSTRAINT IF EXISTS requirements_platform_default_shape_check;

-- ... and the unnamed table-level checks of 003 (found by definition)
DO $$
DECLARE c record;
BEGIN
    FOR c IN
        SELECT conname, pg_get_constraintdef(oid) AS def
          FROM pg_constraint
         WHERE conrelid = 'planning.requirements'::regclass AND contype = 'c'
    LOOP
        IF c.def LIKE '%value_json%' THEN                                     -- no value without a citation or user entry
            EXECUTE format('ALTER TABLE planning.requirements DROP CONSTRAINT %I', c.conname);
        ELSIF c.def LIKE '%user_confirmed%' THEN                              -- status list
            EXECUTE format('ALTER TABLE planning.requirements DROP CONSTRAINT %I', c.conname);
        ELSIF c.def LIKE '%regex%' AND c.def LIKE '%table%' THEN              -- extraction_method list
            EXECUTE format('ALTER TABLE planning.requirements DROP CONSTRAINT %I', c.conname);
        END IF;
    END LOOP;
END $$;

ALTER TABLE planning.requirements
    ADD CONSTRAINT requirements_status_check
        CHECK (status IN ('resolved','unresolved','user_confirmed','conflict','platform_default')),
    ADD CONSTRAINT requirements_extraction_method_check
        CHECK (extraction_method IN ('table','regex','llm','user_entered','platform_default')),
    ADD CONSTRAINT requirements_citation_check
        CHECK (status IN ('unresolved','conflict')
               OR (value_json IS NOT NULL
                   AND ((quote IS NOT NULL AND quote <> '' AND file_sha256 IS NOT NULL)
                        OR COALESCE(extraction_method = 'user_entered', false)
                        OR (status = 'platform_default'
                            AND extraction_method = 'platform_default'
                            AND COALESCE(btrim(default_profile), '') <> ''
                            AND COALESCE(default_stamp, '') LIKE 'PLATFORM DEFAULT%')))),
    ADD CONSTRAINT requirements_platform_default_shape_check
        CHECK ((status = 'platform_default') = (extraction_method IS NOT DISTINCT FROM 'platform_default')
               AND (status <> 'platform_default' OR project_id IS NULL));

CREATE INDEX IF NOT EXISTS ix_requirements_lga_code ON planning.requirements (lga_code, requirement_key) WHERE lga_code IS NOT NULL;

-- one platform default per key, selectors and profile (upsert target of backend/scripts/load_requirements.py)
CREATE UNIQUE INDEX IF NOT EXISTS ux_requirements_platform_default ON planning.requirements
    (requirement_key, applies_to, default_profile) WHERE status = 'platform_default';

COMMIT;
