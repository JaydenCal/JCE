-- =============================================================================
-- 003: planning.requirements  (decision #8: requirements are resolved from governing documents, never hard-coded)
-- One row per (key, applies_to selectors, source). Unresolved/conflict rows carry the prompt shown to the user.
-- Reference rows (project_id NULL) are readable by all; user entries/confirmations are project-scoped.
-- =============================================================================
BEGIN;

CREATE TABLE planning.requirements (
    requirement_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        uuid REFERENCES core.projects (project_id) ON DELETE CASCADE,
    requirement_key   text NOT NULL,                        -- 'rwt.water_target_pct', 'util.clearance_m', ...
    applies_to        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {jurisdiction, authority, lga, zone, service, dia_min_mm, dia_max_mm}
    value_json        jsonb,                                -- number | boolean | string | structured; NULL while unresolved/conflict
    unit              text,
    status            text NOT NULL CHECK (status IN ('resolved','unresolved','user_confirmed','conflict')),
    extraction_method text CHECK (extraction_method IN ('table','regex','llm','user_entered')),
    confidence        numeric(4,3) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
    dcp_document_id  uuid REFERENCES planning.dcp_documents (dcp_document_id),
    doc_title         text,
    authority         text,
    version_label     text,
    effective_date    date,
    page              integer,
    section_ref       text,
    quote             text,
    source_url        text,
    retrieved_at      timestamptz,
    file_sha256       text,                                 -- hex digest of the cited document
    alternatives      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- conflict: competing citations
    prompt            text,                                 -- what to ask the user (unresolved/conflict)
    entered_by        text,
    entered_at        timestamptz,
    verified_by       text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    -- no value without a citation or an explicit user entry
    CHECK (status IN ('unresolved','conflict')
           OR (value_json IS NOT NULL AND ((quote IS NOT NULL AND quote <> '' AND file_sha256 IS NOT NULL)
                                           OR COALESCE(extraction_method = 'user_entered', false)))),
    CHECK (extraction_method IS DISTINCT FROM 'user_entered' OR (entered_by IS NOT NULL AND entered_at IS NOT NULL))
);

CREATE INDEX ix_requirements_key       ON planning.requirements (requirement_key, status);
CREATE INDEX ix_requirements_applies   ON planning.requirements USING gin (applies_to jsonb_path_ops);
CREATE INDEX ix_requirements_sha       ON planning.requirements (file_sha256);
CREATE INDEX ix_requirements_project   ON planning.requirements (project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX ux_requirements_cache ON planning.requirements
    (requirement_key, applies_to, COALESCE(file_sha256, ''), COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE status IN ('resolved','user_confirmed');

ALTER TABLE planning.requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_req_select ON planning.requirements FOR SELECT
    USING (project_id IS NULL OR core.can_access_project(project_id));
CREATE POLICY p_req_write ON planning.requirements FOR ALL
    USING (project_id IS NOT NULL AND core.can_access_project(project_id))
    WITH CHECK (project_id IS NOT NULL AND core.can_access_project(project_id));

COMMIT;
