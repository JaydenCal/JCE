-- =============================================================================
-- Autonomous Cadastral & Civil Site Planning Platform
-- Phase 1: PostgreSQL 16 + PostGIS 3.4+ + pgvector 0.7+ schema
-- Jurisdictions: New South Wales (NSW) and Queensland (QLD), Australia
--
-- Coordinate reference conventions
--   * Canonical storage CRS ........ EPSG:7844 (GDA2020 geographic, lon/lat)
--   * Working / metric CRS ......... GDA2020 MGA2020 zones
--         EPSG:7854 = MGA Zone 54  (far-west NSW, western QLD)
--         EPSG:7855 = MGA Zone 55  (most of eastern NSW, south-east QLD)
--         EPSG:7856 = MGA Zone 56  (eastern NSW coast, QLD east of ~150E)
--   * Heights ...................... metres AHD (EPSG:5711) unless stated
--   * Paper / PDF space ............ PDF user-space points (1 pt = 1/72 in)
--
-- All metric geometry (distances, areas, bearings, buffers, cut/fill) is
-- computed in the lot's MGA zone, never in EPSG:7844 or EPSG:3857.
--
-- Schemas
--   core         identities, organisations, projects
--   legal        Terms versions, acceptances, per-project acknowledgements
--   cadastre     lots, boundary segments, roads, easements, source provenance
--   planning     zones, lot zoning, DCP documents, RAG chunks, setback rules
--   terrain      contours, TIN surfaces, cut/fill runs, retaining walls, crossovers
--   utilities    DBYD enquiries, service assets, exclusion buffers, RWT sizing
--   plans        architectural PDF uploads, vector overlays, affine alignment
--   annotations  CAD text labels and DXF layer/style registry
--   agents       orchestrator runs, sub-agent invocations, payload store, tokens
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS legal;
CREATE SCHEMA IF NOT EXISTS cadastre;
CREATE SCHEMA IF NOT EXISTS planning;
CREATE SCHEMA IF NOT EXISTS terrain;
CREATE SCHEMA IF NOT EXISTS utilities;
CREATE SCHEMA IF NOT EXISTS plans;
CREATE SCHEMA IF NOT EXISTS annotations;
CREATE SCHEMA IF NOT EXISTS agents;

-- -----------------------------------------------------------------------------
-- 0. Shared types and helpers
-- -----------------------------------------------------------------------------

CREATE TYPE core.jurisdiction AS ENUM ('NSW', 'QLD');

CREATE TYPE core.verification_status AS ENUM (
    'unverified',          -- machine output, nobody has checked it
    'user_reviewed',       -- user ticked that they reviewed it
    'professional_verified', -- signed off by a named registered professional
    'rejected'
);

-- Maps an MGA zone SRID to a human label and valid bounds check.
CREATE TABLE core.mga_zones (
    srid        integer PRIMARY KEY CHECK (srid IN (7854, 7855, 7856)),
    zone_number smallint NOT NULL UNIQUE CHECK (zone_number IN (54, 55, 56)),
    central_meridian_deg numeric(6,2) NOT NULL,
    label       text NOT NULL
);

INSERT INTO core.mga_zones (srid, zone_number, central_meridian_deg, label) VALUES
    (7854, 54, 141.00, 'GDA2020 / MGA zone 54'),
    (7855, 55, 147.00, 'GDA2020 / MGA zone 55'),
    (7856, 56, 153.00, 'GDA2020 / MGA zone 56');

CREATE OR REPLACE FUNCTION core.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Picks the MGA2020 zone for a lon/lat point (EPSG:7844 degrees).
-- Zone 54: 138E-144E, Zone 55: 144E-150E, Zone 56: 150E-156E.
CREATE OR REPLACE FUNCTION core.mga_srid_for_lonlat(lon double precision)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN lon <  144.0 THEN 7854
        WHEN lon <  150.0 THEN 7855
        ELSE 7856
    END;
$$;

-- Blocks UPDATE and DELETE on append-only evidence tables.
CREATE OR REPLACE FUNCTION core.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Table %.% is append-only; % is not permitted',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. core: users, organisations, projects
-- -----------------------------------------------------------------------------

CREATE TABLE core.organisations (
    organisation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_name      text NOT NULL,
    abn             char(11) CHECK (abn ~ '^[0-9]{11}$'),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_org_updated BEFORE UPDATE ON core.organisations
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TYPE core.professional_registration AS ENUM (
    'none',
    'registered_surveyor_nsw',      -- Surveying and Spatial Information Act 2002 (NSW)
    'registered_surveyor_qld',      -- Surveyors Act 2003 (Qld)
    'rpeq',                         -- Registered Professional Engineer of Queensland
    'cpeng_ner',                    -- Chartered / National Engineering Register
    'nsw_registered_engineer',      -- Professional Engineers Act 2022 (NSW) registration
    'licensed_plumber',
    'town_planner_pia'
);

CREATE TABLE core.users (
    user_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id uuid REFERENCES core.organisations (organisation_id),
    email           citext NOT NULL UNIQUE,
    display_name    text NOT NULL,
    role            text NOT NULL DEFAULT 'member'
                    CHECK (role IN ('member', 'org_admin', 'platform_admin')),
    registration    core.professional_registration NOT NULL DEFAULT 'none',
    registration_number text,
    registration_verified_at timestamptz,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (registration = 'none' OR registration_number IS NOT NULL)
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON core.users
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TABLE core.projects (
    project_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id uuid REFERENCES core.organisations (organisation_id),
    owner_user_id   uuid NOT NULL REFERENCES core.users (user_id),
    name            text NOT NULL,
    jurisdiction    core.jurisdiction NOT NULL,
    primary_lot_id  uuid,   -- FK added after cadastre.lots exists
    status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'processing', 'ready', 'archived')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_projects_owner ON core.projects (owner_user_id);
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON core.projects
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TABLE core.project_members (
    project_id uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES core.users (user_id) ON DELETE CASCADE,
    access     text NOT NULL CHECK (access IN ('viewer', 'editor')),
    PRIMARY KEY (project_id, user_id)
);

-- -----------------------------------------------------------------------------
-- 2. legal: versioned Terms, acceptance evidence, risk acknowledgements
-- -----------------------------------------------------------------------------

CREATE TABLE legal.terms_versions (
    terms_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_label    text NOT NULL UNIQUE,             -- e.g. '1.0.0'
    effective_from   timestamptz NOT NULL,
    body_markdown    text NOT NULL,
    body_sha256      bytea NOT NULL,                   -- digest of body_markdown (UTF-8)
    is_current       boolean NOT NULL DEFAULT false,
    requires_reacceptance boolean NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (octet_length(body_sha256) = 32)
);
-- Exactly one current version.
CREATE UNIQUE INDEX ux_terms_single_current ON legal.terms_versions (is_current)
    WHERE is_current;
CREATE TRIGGER trg_terms_immutable_body BEFORE DELETE ON legal.terms_versions
    FOR EACH ROW EXECUTE FUNCTION core.forbid_mutation();

CREATE OR REPLACE FUNCTION legal.terms_body_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.body_markdown IS DISTINCT FROM OLD.body_markdown
       OR NEW.body_sha256 IS DISTINCT FROM OLD.body_sha256
       OR NEW.version_label IS DISTINCT FROM OLD.version_label THEN
        RAISE EXCEPTION 'Published Terms text is immutable; publish a new version'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_terms_body_guard BEFORE UPDATE ON legal.terms_versions
    FOR EACH ROW EXECUTE FUNCTION legal.terms_body_guard();

-- Append-only evidence of each click-wrap acceptance.
CREATE TABLE legal.terms_acceptances (
    acceptance_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES core.users (user_id),
    terms_version_id uuid NOT NULL REFERENCES legal.terms_versions (terms_version_id),
    accepted_at      timestamptz NOT NULL DEFAULT now(),
    ip_address       inet,
    user_agent       text,
    scrolled_to_end  boolean NOT NULL,
    body_sha256_seen bytea NOT NULL,                   -- must equal the version's digest
    acting_for_organisation_id uuid REFERENCES core.organisations (organisation_id),
    UNIQUE (user_id, terms_version_id),
    CHECK (scrolled_to_end)
);
CREATE TRIGGER trg_acceptances_append_only
    BEFORE UPDATE OR DELETE ON legal.terms_acceptances
    FOR EACH ROW EXECUTE FUNCTION core.forbid_mutation();

CREATE OR REPLACE FUNCTION legal.acceptance_digest_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    expected bytea;
BEGIN
    SELECT body_sha256 INTO expected
    FROM legal.terms_versions WHERE terms_version_id = NEW.terms_version_id;
    IF expected IS DISTINCT FROM NEW.body_sha256_seen THEN
        RAISE EXCEPTION 'Acceptance digest does not match published Terms text'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_acceptance_digest BEFORE INSERT ON legal.terms_acceptances
    FOR EACH ROW EXECUTE FUNCTION legal.acceptance_digest_guard();

-- Gate used by the API layer and by row-level security on every project table.
CREATE OR REPLACE FUNCTION legal.has_accepted_current_terms(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = legal, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1
        FROM legal.terms_versions tv
        JOIN legal.terms_acceptances ta USING (terms_version_id)
        WHERE tv.is_current AND ta.user_id = p_user_id
    );
$$;

-- Risk-specific acknowledgements that gate individual outputs (Terms cl. 7-12).
CREATE TYPE legal.acknowledgement_kind AS ENUM (
    'dbyd_physical_verification',      -- BYDA plans + physical locating before any excavation
    'setback_user_verification',       -- automated setbacks checked against current DCP/LEP/QPS
    'cut_fill_indicative_only',        -- cut/fill volumes are indicative, not for pricing/earthworks
    'retaining_wall_not_structural',   -- wall sizing is not structural design
    'crossover_not_certified',         -- AS/NZS 2890.1 check is screening only
    'cadastre_not_survey',             -- boundaries are not a survey; identification survey required
    'uploaded_plan_accuracy',          -- uploaded architectural PDF alignment unverified
    'upload_rights_warranty',          -- user holds rights to upload the plan
    'hydrology_not_certified'          -- RWT / stormwater outputs are not hydraulic certification
);

CREATE TABLE legal.project_acknowledgements (
    acknowledgement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       uuid NOT NULL REFERENCES core.projects (project_id),
    user_id          uuid NOT NULL REFERENCES core.users (user_id),
    kind             legal.acknowledgement_kind NOT NULL,
    terms_version_id uuid NOT NULL REFERENCES legal.terms_versions (terms_version_id),
    acknowledged_at  timestamptz NOT NULL DEFAULT now(),
    -- Content the user was looking at, so the acknowledgement is tied to a specific output.
    subject_table    text,
    subject_id       uuid,
    subject_sha256   bytea,
    ip_address       inet,
    UNIQUE (project_id, user_id, kind, subject_table, subject_id)
);
CREATE INDEX ix_ack_project_kind ON legal.project_acknowledgements (project_id, kind);
CREATE TRIGGER trg_ack_append_only
    BEFORE UPDATE OR DELETE ON legal.project_acknowledgements
    FOR EACH ROW EXECUTE FUNCTION core.forbid_mutation();

-- Export gate: DXF/PDF/3D export is refused unless every required kind is present.
CREATE OR REPLACE FUNCTION legal.export_gate_missing(p_project_id uuid, p_user_id uuid)
RETURNS legal.acknowledgement_kind[] LANGUAGE sql STABLE AS $$
    SELECT COALESCE(array_agg(req.kind), ARRAY[]::legal.acknowledgement_kind[])
    FROM unnest(enum_range(NULL::legal.acknowledgement_kind)) AS req(kind)
    WHERE NOT EXISTS (
        SELECT 1 FROM legal.project_acknowledgements pa
        WHERE pa.project_id = p_project_id
          AND pa.user_id = p_user_id
          AND pa.kind = req.kind
    );
$$;

-- -----------------------------------------------------------------------------
-- 3. cadastre: lots, boundary segments, roads, easements, provenance
-- -----------------------------------------------------------------------------

CREATE TABLE cadastre.source_snapshots (
    snapshot_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction  core.jurisdiction NOT NULL,
    provider      text NOT NULL,       -- 'NSW Spatial Services', 'QLD Dept Resources'
    service_url   text NOT NULL,
    layer_name    text NOT NULL,       -- e.g. 'NSW_Cadastre/Lot', 'Cadastral parcels'
    query_params  jsonb NOT NULL,
    response_sha256 bytea NOT NULL,
    http_etag     text,
    licence       text NOT NULL DEFAULT 'CC BY 4.0',
    attribution   text NOT NULL,
    fetched_at    timestamptz NOT NULL DEFAULT now(),
    data_currency date                 -- provider's stated data date, when published
);
CREATE TRIGGER trg_snapshots_append_only
    BEFORE UPDATE OR DELETE ON cadastre.source_snapshots
    FOR EACH ROW EXECUTE FUNCTION core.forbid_mutation();

CREATE TABLE cadastre.lots (
    lot_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction      core.jurisdiction NOT NULL,
    -- Real property description.
    lot_number        text NOT NULL,                         -- may be alphanumeric (e.g. '12A')
    section_number    text,                                  -- NSW only
    plan_type         text NOT NULL,                         -- 'DP','SP','RP','SL','CP','BUP','GTP', ...
    plan_number       text NOT NULL,
    lotplan           text GENERATED ALWAYS AS (
                          CASE WHEN jurisdiction = 'QLD'
                               THEN lot_number || plan_type || plan_number     -- e.g. 1RP12345
                               ELSE lot_number
                                    || COALESCE('/' || section_number, '/')
                                    || '/' || plan_type || plan_number         -- e.g. 12//DP34567
                          END) STORED,
    nsw_lot_id        text,                                  -- NSW Spatial 'lotidstring'
    qld_lotplan_id    text,                                  -- QLD 'lotplan'
    parish_county     text,                                  -- NSW cadastral hierarchy
    locality          text,
    lga_name          text NOT NULL,
    lga_code          text,
    street_address    text,
    geom_gda2020      geometry(MultiPolygon, 7844) NOT NULL,
    mga_srid          integer NOT NULL REFERENCES core.mga_zones (srid),
    geom_mga          geometry(MultiPolygon) NOT NULL,
    area_m2_calculated numeric(14,3) GENERATED ALWAYS AS (ST_Area(geom_mga)::numeric) STORED,
    area_m2_registered numeric(14,3),                        -- area on the registered plan
    perimeter_m       numeric(12,3) GENERATED ALWAYS AS (ST_Perimeter(geom_mga)::numeric) STORED,
    snapshot_id       uuid NOT NULL REFERENCES cadastre.source_snapshots (snapshot_id),
    survey_status     text NOT NULL DEFAULT 'cadastral_indicative'
                      CHECK (survey_status IN ('cadastral_indicative', 'identification_survey_loaded')),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CHECK (ST_SRID(geom_mga) = mga_srid),
    CHECK (ST_IsValid(geom_gda2020) AND ST_IsValid(geom_mga)),
    CHECK (jurisdiction <> 'NSW' OR plan_type IN ('DP','SP','CP','BUP','SL','PS','GTP','OTHER')),
    CHECK (jurisdiction <> 'QLD' OR plan_type IN ('RP','SP','CP','BUP','SL','AP','CSH','OTHER')),
    CONSTRAINT ux_lot_identity UNIQUE (jurisdiction, lotplan)
);
CREATE INDEX gx_lots_gda ON cadastre.lots USING gist (geom_gda2020);
CREATE INDEX gx_lots_mga ON cadastre.lots USING gist (geom_mga);
CREATE INDEX ix_lots_lga ON cadastre.lots (jurisdiction, lga_name);
CREATE TRIGGER trg_lots_updated BEFORE UPDATE ON cadastre.lots
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

ALTER TABLE core.projects
    ADD CONSTRAINT fk_projects_primary_lot
    FOREIGN KEY (primary_lot_id) REFERENCES cadastre.lots (lot_id);

-- One row per boundary leg. Bearings are grid bearings (MGA) in decimal degrees
-- 0-360 clockwise from grid north; distances are metres from geometry.
CREATE TABLE cadastre.lot_boundary_segments (
    segment_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_id          uuid NOT NULL REFERENCES cadastre.lots (lot_id) ON DELETE CASCADE,
    ring_index      smallint NOT NULL DEFAULT 0,       -- 0 = exterior, >0 = interior ring
    polygon_index   smallint NOT NULL DEFAULT 0,
    seq             integer NOT NULL,
    geom_mga        geometry(LineString) NOT NULL,
    mga_srid        integer NOT NULL REFERENCES core.mga_zones (srid),
    distance_m      numeric(12,3) NOT NULL CHECK (distance_m > 0),
    bearing_deg     numeric(8,5) NOT NULL CHECK (bearing_deg >= 0 AND bearing_deg < 360),
    bearing_dms     text NOT NULL,                      -- e.g. 87°14'30"
    adjoins         text NOT NULL DEFAULT 'unknown'
                    CHECK (adjoins IN ('road','lot','reserve','waterway','easement','unknown')),
    adjoining_road_id uuid,                             -- FK added below
    is_front        boolean NOT NULL DEFAULT false,
    is_secondary_frontage boolean NOT NULL DEFAULT false,
    UNIQUE (lot_id, polygon_index, ring_index, seq),
    CHECK (ST_SRID(geom_mga) = mga_srid),
    CHECK (ST_NumPoints(geom_mga) = 2)
);
CREATE INDEX gx_segments ON cadastre.lot_boundary_segments USING gist (geom_mga);
CREATE INDEX ix_segments_lot ON cadastre.lot_boundary_segments (lot_id);

CREATE TABLE cadastre.roads (
    road_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction   core.jurisdiction NOT NULL,
    road_name      text NOT NULL,
    road_type      text,                                -- 'ST','RD','AVE','CT'
    road_class     text CHECK (road_class IN ('local','collector','sub_arterial','arterial','state','private','unknown')),
    managing_authority text,                            -- council or TfNSW / TMR
    reserve_width_m numeric(7,2),
    carriageway_width_m numeric(7,2),
    speed_limit_kmh smallint,
    geom_gda2020   geometry(MultiLineString, 7844) NOT NULL,
    reserve_gda2020 geometry(MultiPolygon, 7844),
    snapshot_id    uuid NOT NULL REFERENCES cadastre.source_snapshots (snapshot_id)
);
CREATE INDEX gx_roads_geom ON cadastre.roads USING gist (geom_gda2020);
CREATE INDEX gx_roads_reserve ON cadastre.roads USING gist (reserve_gda2020);

ALTER TABLE cadastre.lot_boundary_segments
    ADD CONSTRAINT fk_segments_road FOREIGN KEY (adjoining_road_id) REFERENCES cadastre.roads (road_id);

CREATE TABLE cadastre.easements (
    easement_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_id         uuid NOT NULL REFERENCES cadastre.lots (lot_id) ON DELETE CASCADE,
    purpose        text NOT NULL,                       -- 'drainage','sewer','water','access','electricity','carriageway'
    width_m        numeric(7,2),
    benefiting_party text,
    instrument_ref text,                                -- e.g. 'DP 1234567', 'Dealing AB123456'
    geom_mga       geometry(MultiPolygon) NOT NULL,
    mga_srid       integer NOT NULL REFERENCES core.mga_zones (srid),
    source         text NOT NULL DEFAULT 'cadastral_layer',
    CHECK (ST_SRID(geom_mga) = mga_srid)
);
CREATE INDEX gx_easements ON cadastre.easements USING gist (geom_mga);

-- -----------------------------------------------------------------------------
-- 4. planning: zoning, DCP RAG store, setback rules, building envelope
-- -----------------------------------------------------------------------------

CREATE TABLE planning.zones (
    zone_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction   core.jurisdiction NOT NULL,
    instrument     text NOT NULL,         -- e.g. 'Hornsby LEP 2013', 'Brisbane City Plan 2014'
    zone_code      text NOT NULL,         -- 'R2','R3','RU5' (NSW) / 'LDR','MDR','LMR' (QLD)
    zone_name      text NOT NULL,         -- 'Low Density Residential'
    is_residential boolean NOT NULL,
    geom_gda2020   geometry(MultiPolygon, 7844) NOT NULL,
    effective_date date,
    snapshot_id    uuid REFERENCES cadastre.source_snapshots (snapshot_id)
);
CREATE INDEX gx_zones ON planning.zones USING gist (geom_gda2020);
CREATE INDEX ix_zones_code ON planning.zones (jurisdiction, instrument, zone_code);

CREATE TABLE planning.lot_zoning (
    lot_id         uuid NOT NULL REFERENCES cadastre.lots (lot_id) ON DELETE CASCADE,
    zone_id        uuid NOT NULL REFERENCES planning.zones (zone_id),
    overlap_area_m2 numeric(14,3) NOT NULL CHECK (overlap_area_m2 > 0),
    overlap_fraction numeric(6,5) NOT NULL CHECK (overlap_fraction > 0 AND overlap_fraction <= 1),
    is_dominant    boolean NOT NULL,
    PRIMARY KEY (lot_id, zone_id)
);
CREATE UNIQUE INDEX ux_lot_dominant_zone ON planning.lot_zoning (lot_id) WHERE is_dominant;

-- Overlays and constraints affecting envelope (flood, bushfire, heritage, acid sulfate, etc.).
CREATE TABLE planning.lot_overlays (
    overlay_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_id         uuid NOT NULL REFERENCES cadastre.lots (lot_id) ON DELETE CASCADE,
    overlay_type   text NOT NULL CHECK (overlay_type IN
                   ('flood','bushfire','heritage','acid_sulfate','biodiversity','coastal',
                    'airport_noise','landslide','transport_corridor','other')),
    overlay_label  text NOT NULL,
    attribute_json jsonb NOT NULL DEFAULT '{}'::jsonb,   -- e.g. {"bal":"BAL-29"}
    snapshot_id    uuid REFERENCES cadastre.source_snapshots (snapshot_id)
);

CREATE TABLE planning.dcp_documents (
    dcp_document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction    core.jurisdiction NOT NULL,
    council_name    text NOT NULL,
    lga_code        text,
    title           text NOT NULL,                      -- 'Hornsby DCP 2013', 'Moreton Bay Planning Scheme'
    document_kind   text NOT NULL CHECK (document_kind IN ('DCP','LEP','QPS','QDC','CODE','POLICY')),
    version_label   text,
    effective_date  date,
    superseded_date date,
    source_url      text,
    file_sha256     bytea NOT NULL,
    storage_uri     text NOT NULL,                      -- object store location of the PDF
    page_count      integer,
    ingested_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (council_name, title, file_sha256)
);

CREATE TABLE planning.dcp_chunks (
    chunk_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dcp_document_id uuid NOT NULL REFERENCES planning.dcp_documents (dcp_document_id) ON DELETE CASCADE,
    page_from       integer NOT NULL,
    page_to         integer NOT NULL,
    section_ref     text,                               -- '4.1.2 Front setbacks'
    chunk_kind      text NOT NULL CHECK (chunk_kind IN ('text','table','figure_caption')),
    content         text NOT NULL,
    content_tsv     tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    embedding       vector(1536) NOT NULL,
    embedding_model text NOT NULL,
    token_count     integer NOT NULL,
    CHECK (page_to >= page_from)
);
CREATE INDEX ix_chunks_doc ON planning.dcp_chunks (dcp_document_id);
CREATE INDEX ix_chunks_tsv ON planning.dcp_chunks USING gin (content_tsv);
CREATE INDEX ix_chunks_embedding ON planning.dcp_chunks
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 128);

-- Structured rule extracted by Sub-Agent 2 and cited back to its source chunk.
CREATE TABLE planning.setback_rules (
    rule_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dcp_document_id uuid NOT NULL REFERENCES planning.dcp_documents (dcp_document_id),
    source_chunk_id uuid NOT NULL REFERENCES planning.dcp_chunks (chunk_id),
    zone_code       text NOT NULL,
    dwelling_type   text NOT NULL DEFAULT 'dwelling_house'
                    CHECK (dwelling_type IN ('dwelling_house','dual_occupancy','secondary_dwelling',
                                             'multi_dwelling','attached','garage','outbuilding')),
    element         text NOT NULL CHECK (element IN
                    ('front','secondary_frontage','side','rear','side_upper','rear_upper',
                     'garage_front','site_cover_max','landscape_min','private_open_space_min',
                     'height_max','storeys_max','floor_space_ratio_max')),
    lot_condition   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"min_area_m2":450,"corner_lot":true,...}
    value_numeric   numeric(10,3) NOT NULL,
    unit            text NOT NULL CHECK (unit IN ('m','percent','m2','ratio','count')),
    is_performance_outcome boolean NOT NULL DEFAULT false, -- acceptable solution vs performance criterion
    extraction_confidence numeric(4,3) NOT NULL CHECK (extraction_confidence BETWEEN 0 AND 1),
    verification    core.verification_status NOT NULL DEFAULT 'unverified',
    verified_by     uuid REFERENCES core.users (user_id),
    verified_at     timestamptz
);
CREATE INDEX ix_setback_lookup ON planning.setback_rules (dcp_document_id, zone_code, element);

-- Per-project resolved envelope (the buildable area).
CREATE TABLE planning.building_envelopes (
    envelope_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    lot_id          uuid NOT NULL REFERENCES cadastre.lots (lot_id),
    mga_srid        integer NOT NULL REFERENCES core.mga_zones (srid),
    envelope_geom   geometry(MultiPolygon) NOT NULL,     -- footprint envelope in MGA
    max_height_m    numeric(6,2),
    max_site_cover_pct numeric(5,2),
    applied_rule_ids uuid[] NOT NULL,
    status          core.verification_status NOT NULL DEFAULT 'unverified',
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (ST_SRID(envelope_geom) = mga_srid)
);
CREATE INDEX gx_envelope ON planning.building_envelopes USING gist (envelope_geom);

-- -----------------------------------------------------------------------------
-- 5. terrain: contours, TIN, cut/fill, retaining walls, crossovers
-- -----------------------------------------------------------------------------

CREATE TABLE terrain.contour_sets (
    contour_set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    source         text NOT NULL CHECK (source IN
                   ('nsw_elvis_lidar','qld_qspatial_dem','council_contours','user_survey_dxf','user_survey_csv')),
    interval_m     numeric(5,2) NOT NULL CHECK (interval_m > 0),
    vertical_datum text NOT NULL DEFAULT 'AHD',
    stated_vertical_accuracy_m numeric(5,2),
    mga_srid       integer NOT NULL REFERENCES core.mga_zones (srid),
    snapshot_id    uuid REFERENCES cadastre.source_snapshots (snapshot_id),
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE terrain.contours (
    contour_id     bigserial PRIMARY KEY,
    contour_set_id uuid NOT NULL REFERENCES terrain.contour_sets (contour_set_id) ON DELETE CASCADE,
    elevation_m    numeric(8,3) NOT NULL,
    geom_mga       geometry(LineStringZ) NOT NULL         -- Z carries elevation
);
CREATE INDEX gx_contours ON terrain.contours USING gist (geom_mga);
CREATE INDEX ix_contours_set ON terrain.contours (contour_set_id, elevation_m);

CREATE TABLE terrain.tin_surfaces (
    tin_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contour_set_id uuid NOT NULL REFERENCES terrain.contour_sets (contour_set_id) ON DELETE CASCADE,
    surface_role   text NOT NULL CHECK (surface_role IN ('existing','proposed')),
    mga_srid       integer NOT NULL REFERENCES core.mga_zones (srid),
    vertex_count   integer NOT NULL,
    triangle_count integer NOT NULL,
    min_z          numeric(8,3) NOT NULL,
    max_z          numeric(8,3) NOT NULL,
    -- Float64 interleaved x,y,z little-endian; triangles as uint32 index triplets.
    vertices_f64   bytea NOT NULL,
    triangles_u32  bytea NOT NULL,
    mesh_geom      geometry(MultiPolygonZ),               -- optional TIN as PostGIS TIN faces
    build_params   jsonb NOT NULL,                        -- breakline handling, max edge length, etc.
    created_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (octet_length(vertices_f64) = vertex_count * 24),
    CHECK (octet_length(triangles_u32) = triangle_count * 12)
);

CREATE TABLE terrain.cut_fill_runs (
    run_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    existing_tin_id uuid NOT NULL REFERENCES terrain.tin_surfaces (tin_id),
    proposed_tin_id uuid NOT NULL REFERENCES terrain.tin_surfaces (tin_id),
    method         text NOT NULL DEFAULT 'prismoidal_triangle'
                   CHECK (method IN ('prismoidal_triangle','grid_average_end_area')),
    pad_level_m    numeric(8,3),
    cut_volume_m3  numeric(14,3) NOT NULL,
    fill_volume_m3 numeric(14,3) NOT NULL,
    net_volume_m3  numeric(14,3) GENERATED ALWAYS AS (cut_volume_m3 - fill_volume_m3) STORED,
    bulking_factor numeric(4,3) NOT NULL DEFAULT 1.250,   -- cut -> loose volume
    shrinkage_factor numeric(4,3) NOT NULL DEFAULT 0.900, -- fill compaction allowance
    topsoil_strip_depth_m numeric(4,2) NOT NULL DEFAULT 0.15,
    stated_uncertainty_pct numeric(5,2) NOT NULL,         -- derived from source vertical accuracy
    result_geom    geometry(MultiPolygon),                -- zoned cut/fill depth polygons
    status         core.verification_status NOT NULL DEFAULT 'unverified',
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE terrain.retaining_walls (
    wall_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id         uuid NOT NULL REFERENCES terrain.cut_fill_runs (run_id) ON DELETE CASCADE,
    alignment_mga  geometry(LineString) NOT NULL,
    mga_srid       integer NOT NULL REFERENCES core.mga_zones (srid),
    max_retained_height_m numeric(5,2) NOT NULL,
    wall_type      text NOT NULL CHECK (wall_type IN
                   ('masonry_block','concrete_sleeper','timber_sleeper','boulder','reinforced_concrete')),
    -- Assumption record. Every field is surfaced to the user before export.
    assumed_soil_unit_weight_knm3 numeric(5,2) NOT NULL DEFAULT 18.0,
    assumed_phi_deg numeric(5,2) NOT NULL DEFAULT 28.0,
    assumed_surcharge_kpa numeric(5,2) NOT NULL DEFAULT 0.0,
    assumed_groundwater text NOT NULL DEFAULT 'none_assumed',
    geotechnical_report_sighted boolean NOT NULL DEFAULT false,
    engineer_certification_required boolean GENERATED ALWAYS AS (max_retained_height_m > 1.0) STORED,
    indicative_footing_width_m numeric(5,2),
    notes          text,
    status         core.verification_status NOT NULL DEFAULT 'unverified',
    CHECK (ST_SRID(alignment_mga) = mga_srid)
);

CREATE TABLE terrain.crossover_checks (
    check_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    road_id        uuid REFERENCES cadastre.roads (road_id),
    mga_srid       integer NOT NULL REFERENCES core.mga_zones (srid),
    centreline_mga geometry(LineStringZ) NOT NULL,        -- kerb to garage threshold
    standard       text NOT NULL DEFAULT 'AS/NZS 2890.1:2004',
    user_class     smallint NOT NULL DEFAULT 1 CHECK (user_class BETWEEN 1 AND 4),
    design_vehicle text NOT NULL DEFAULT 'B85',
    max_grade_pct  numeric(5,2) NOT NULL,
    max_grade_change_pct numeric(5,2) NOT NULL,
    min_width_m    numeric(5,2) NOT NULL,
    ramp_length_m  numeric(7,2) NOT NULL,
    scraping_clearance_ok boolean NOT NULL,
    grade_ok       boolean NOT NULL,
    width_ok       boolean NOT NULL,
    council_standard_override text,
    violations     jsonb NOT NULL DEFAULT '[]'::jsonb,
    status         core.verification_status NOT NULL DEFAULT 'unverified',
    CHECK (ST_SRID(centreline_mga) = mga_srid)
);

-- -----------------------------------------------------------------------------
-- 6. utilities: DBYD, service assets, exclusion buffers, RWT sizing
-- -----------------------------------------------------------------------------

CREATE TABLE utilities.dbyd_enquiries (
    enquiry_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    reference_number text NOT NULL,                       -- BYDA sequence number
    submitted_at   timestamptz NOT NULL,
    valid_until    timestamptz NOT NULL,                  -- BYDA responses are time-limited
    work_area_mga  geometry(Polygon) NOT NULL,
    mga_srid       integer NOT NULL REFERENCES core.mga_zones (srid),
    response_files jsonb NOT NULL DEFAULT '[]'::jsonb,    -- storage URIs + SHA-256
    uploaded_by    uuid NOT NULL REFERENCES core.users (user_id),
    CHECK (ST_SRID(work_area_mga) = mga_srid),
    CHECK (valid_until > submitted_at),
    UNIQUE (project_id, reference_number)
);

CREATE TYPE utilities.service_type AS ENUM
    ('water','sewer','stormwater','electricity_hv','electricity_lv','gas','telecom','optic_fibre','other');

CREATE TABLE utilities.service_assets (
    asset_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    enquiry_id     uuid REFERENCES utilities.dbyd_enquiries (enquiry_id),
    service        utilities.service_type NOT NULL,
    owner_agency   text NOT NULL,                         -- 'Sydney Water','Urban Utilities','Ausgrid','Energex'
    asset_label    text,
    diameter_mm    integer,
    material       text,
    depth_m        numeric(5,2),                          -- depth to top of asset, as shown on plan
    depth_basis    text NOT NULL DEFAULT 'unknown'
                   CHECK (depth_basis IN ('surveyed','potholed','plan_indicated','assumed','unknown')),
    plan_position_tolerance_m numeric(5,2) NOT NULL DEFAULT 1.0, -- agencies commonly state +/-
    mga_srid       integer NOT NULL REFERENCES core.mga_zones (srid),
    geom_mga       geometry(LineStringZ) NOT NULL,
    extraction_method text NOT NULL CHECK (extraction_method IN
                   ('dbyd_pdf_vector','dbyd_pdf_raster_cv','agency_gis','user_digitised','proposed_design')),
    extraction_confidence numeric(4,3) CHECK (extraction_confidence BETWEEN 0 AND 1),
    is_proposed    boolean NOT NULL DEFAULT false,
    status         core.verification_status NOT NULL DEFAULT 'unverified',
    CHECK (ST_SRID(geom_mga) = mga_srid)
);
CREATE INDEX gx_assets ON utilities.service_assets USING gist (geom_mga);
CREATE INDEX ix_assets_project ON utilities.service_assets (project_id, service);

-- Exclusion buffer = nominal clearance + stated positional tolerance, per asset.
CREATE TABLE utilities.exclusion_buffers (
    buffer_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id       uuid NOT NULL REFERENCES utilities.service_assets (asset_id) ON DELETE CASCADE,
    clearance_m    numeric(5,2) NOT NULL,                 -- from owner-agency "build-over/near" rules
    tolerance_m    numeric(5,2) NOT NULL,
    rule_source    text NOT NULL,                         -- document + clause of the agency requirement
    geom_mga       geometry(Polygon) NOT NULL,
    mga_srid       integer NOT NULL REFERENCES core.mga_zones (srid),
    CHECK (ST_SRID(geom_mga) = mga_srid)
);
CREATE INDEX gx_buffers ON utilities.exclusion_buffers USING gist (geom_mga);

CREATE TABLE utilities.conflicts (
    conflict_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    buffer_id      uuid NOT NULL REFERENCES utilities.exclusion_buffers (buffer_id),
    conflicting_element text NOT NULL CHECK (conflicting_element IN
                   ('slab','footing','retaining_wall','driveway','rwt','trench','excavation')),
    overlap_geom_mga geometry(MultiPolygon),
    severity       text NOT NULL CHECK (severity IN ('info','warning','blocking')),
    message        text NOT NULL
);

-- Rainwater tank sizing. Targets differ by State; the rule is stored, not hard-coded.
CREATE TABLE utilities.rwt_sizing (
    rwt_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    regime         text NOT NULL CHECK (regime IN ('BASIX_NSW','QDC_MP4_2_QLD','COUNCIL_OVERRIDE')),
    roof_area_m2   numeric(10,2) NOT NULL,
    connected_roof_area_m2 numeric(10,2) NOT NULL,
    bom_station_id text NOT NULL,                         -- rainfall record used
    mean_annual_rainfall_mm numeric(7,1) NOT NULL,
    demand_l_per_day numeric(8,1) NOT NULL,
    first_flush_mm numeric(4,1) NOT NULL DEFAULT 2.0,
    tank_volume_l  integer NOT NULL,
    reliability_pct numeric(5,2),
    mass_balance_series jsonb,                            -- monthly storage trace
    onsite_detention_required boolean,
    osd_volume_m3  numeric(8,2),
    status         core.verification_status NOT NULL DEFAULT 'unverified',
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- Cutaway-ready view consumed by Sub-Agent 6 (GlideInside 3D sync).
CREATE VIEW utilities.v_cutaway_features AS
SELECT
    a.project_id,
    a.asset_id,
    a.service,
    a.owner_agency,
    a.diameter_mm,
    a.depth_m,
    a.depth_basis,
    a.plan_position_tolerance_m,
    a.status,
    a.is_proposed,
    a.mga_srid,
    ST_AsGeoJSON(a.geom_mga, 3) AS centreline_geojson,
    (SELECT ST_AsGeoJSON(b.geom_mga, 3)
       FROM utilities.exclusion_buffers b
      WHERE b.asset_id = a.asset_id
      ORDER BY b.clearance_m DESC LIMIT 1) AS exclusion_geojson
FROM utilities.service_assets a;

-- -----------------------------------------------------------------------------
-- 7. plans: architectural PDF uploads, vector overlays, alignment transforms
-- -----------------------------------------------------------------------------

CREATE TABLE plans.plan_uploads (
    upload_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    uploaded_by    uuid NOT NULL REFERENCES core.users (user_id),
    original_filename text NOT NULL,
    storage_uri    text NOT NULL,
    file_sha256    bytea NOT NULL,
    byte_size      bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 200 * 1024 * 1024),
    page_count     integer NOT NULL CHECK (page_count > 0),
    selected_page  integer,
    pdf_producer   text,
    pdf_creator    text,
    content_class  text NOT NULL CHECK (content_class IN ('vector','raster','hybrid')),
    page_width_pt  numeric(10,3),
    page_height_pt numeric(10,3),
    rotation_deg   smallint NOT NULL DEFAULT 0 CHECK (rotation_deg IN (0,90,180,270)),
    paper_size     text,                                  -- 'A1','A2','A3'
    -- Scale as read from the drawing. Both the text and the validated numeric are kept.
    scale_text     text,                                  -- '1:100 @ A1'
    scale_denominator numeric(10,3) CHECK (scale_denominator IS NULL OR scale_denominator > 0),
    scale_source   text CHECK (scale_source IN
                   ('title_block_text','scale_bar_measure','dimension_string','user_entered')),
    scale_confidence numeric(4,3) CHECK (scale_confidence BETWEEN 0 AND 1),
    architect_name text,
    drawing_number text,
    revision       text,
    upload_rights_acknowledged boolean NOT NULL,
    status         text NOT NULL DEFAULT 'uploaded'
                   CHECK (status IN ('uploaded','extracted','scale_confirmed','aligned','failed')),
    failure_reason text,
    uploaded_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (upload_rights_acknowledged),
    UNIQUE (project_id, file_sha256)
);

-- Extracted vector primitives (paper space, PDF points).
CREATE TABLE plans.plan_vector_entities (
    entity_id      bigserial PRIMARY KEY,
    upload_id      uuid NOT NULL REFERENCES plans.plan_uploads (upload_id) ON DELETE CASCADE,
    page_number    integer NOT NULL,
    entity_kind    text NOT NULL CHECK (entity_kind IN
                   ('line','polyline','polygon','rect','curve','text','hatch')),
    classification text NOT NULL DEFAULT 'unclassified'
                   CHECK (classification IN ('slab_outline','external_wall','internal_wall','garage',
                                             'porch','alfresco','roof_outline','dimension','grid',
                                             'north_arrow','scale_bar','boundary_line','title_block',
                                             'unclassified')),
    classification_confidence numeric(4,3),
    stroke_width_pt numeric(6,3),
    stroke_rgb     char(6),
    pdf_layer      text,                                  -- optional content group name
    paper_geom     geometry NOT NULL,                     -- SRID 0, PDF points, origin bottom-left
    text_content   text,
    CHECK (ST_SRID(paper_geom) = 0)
);
CREATE INDEX gx_plan_entities ON plans.plan_vector_entities USING gist (paper_geom);
CREATE INDEX ix_plan_entities_cls ON plans.plan_vector_entities (upload_id, classification);

-- Raster layers when the PDF is scanned or a flattened export.
CREATE TABLE plans.plan_raster_layers (
    raster_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id      uuid NOT NULL REFERENCES plans.plan_uploads (upload_id) ON DELETE CASCADE,
    page_number    integer NOT NULL,
    storage_uri    text NOT NULL,
    dpi            integer NOT NULL CHECK (dpi BETWEEN 72 AND 1200),
    width_px       integer NOT NULL,
    height_px      integer NOT NULL,
    deskew_deg     numeric(6,3) NOT NULL DEFAULT 0,
    paper_to_pixel numeric(14,8)[6] NOT NULL              -- affine a,b,d,e,xoff,yoff
);

-- Control-point correspondences (paper <-> site), the input to the solver.
CREATE TABLE plans.alignment_control_points (
    control_point_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id      uuid NOT NULL REFERENCES plans.plan_uploads (upload_id) ON DELETE CASCADE,
    label          text NOT NULL,
    paper_xy       geometry(Point) NOT NULL,              -- SRID 0, PDF points
    site_xy_mga    geometry(Point) NOT NULL,              -- MGA metres
    mga_srid       integer NOT NULL REFERENCES core.mga_zones (srid),
    source         text NOT NULL CHECK (source IN
                   ('lot_corner_match','boundary_dimension_match','user_picked','dbyd_reference')),
    weight         numeric(5,3) NOT NULL DEFAULT 1.0 CHECK (weight > 0),
    residual_m     numeric(8,4),                          -- filled after solve
    is_outlier     boolean NOT NULL DEFAULT false,
    CHECK (ST_SRID(paper_xy) = 0),
    CHECK (ST_SRID(site_xy_mga) = mga_srid)
);

-- The georeferenced overlay with its transform. A new row per solve; never overwritten.
--
-- Mapping from PDF-point paper space to MGA metres:
--     X = a*x + b*y + xoff
--     Y = d*x + e*y + yoff
-- For a similarity transform with scale denominator N, rotation theta (radians, anticlockwise
-- from paper +x to grid east) and uniform scale s = (25.4 / 72) / 1000 * N  [metres per point]:
--     a =  s cos(theta)   b = -s sin(theta)
--     d =  s sin(theta)   e =  s cos(theta)
-- Matches PostGIS ST_Affine(geom, a, b, d, e, xoff, yoff) for 2D input.
CREATE TABLE plans.plan_overlays (
    overlay_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id      uuid NOT NULL REFERENCES plans.plan_uploads (upload_id) ON DELETE CASCADE,
    project_id     uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    lot_id         uuid NOT NULL REFERENCES cadastre.lots (lot_id),
    mga_srid       integer NOT NULL REFERENCES core.mga_zones (srid),
    solver         text NOT NULL CHECK (solver IN
                   ('umeyama_similarity','affine_least_squares','user_manual','ransac_similarity')),
    scale_denominator_used numeric(10,3) NOT NULL CHECK (scale_denominator_used > 0),
    metres_per_point numeric(14,10) NOT NULL CHECK (metres_per_point > 0),
    rotation_rad   double precision NOT NULL,
    transform_a    double precision NOT NULL,
    transform_b    double precision NOT NULL,
    transform_d    double precision NOT NULL,
    transform_e    double precision NOT NULL,
    transform_xoff double precision NOT NULL,
    transform_yoff double precision NOT NULL,
    -- Full 3x3 homogeneous matrix, row-major, for the WebGL layer:
    -- [a b xoff; d e yoff; 0 0 1]
    matrix_3x3     double precision[9] NOT NULL,
    reflection_applied boolean NOT NULL DEFAULT false,    -- true if determinant < 0 was corrected
    control_point_count integer NOT NULL CHECK (control_point_count >= 2),
    rmse_m         numeric(8,4) NOT NULL,
    max_residual_m numeric(8,4) NOT NULL,
    footprint_mga  geometry(MultiPolygon) NOT NULL,       -- proposed slab/footprint in MGA
    footprint_area_m2 numeric(12,3) GENERATED ALWAYS AS (ST_Area(footprint_mga)::numeric) STORED,
    footprint_class text NOT NULL DEFAULT 'slab_outline'
                    CHECK (footprint_class IN ('slab_outline','roof_outline','building_outline')),
    inside_envelope boolean,
    envelope_encroachment_m2 numeric(12,3),
    status         core.verification_status NOT NULL DEFAULT 'unverified',
    is_active      boolean NOT NULL DEFAULT true,
    created_by_agent uuid,                                -- FK added after agents.invocations
    created_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (ST_SRID(footprint_mga) = mga_srid),
    CHECK (array_length(matrix_3x3, 1) = 9),
    CHECK (abs(transform_a * transform_e - transform_b * transform_d) > 0)
);
CREATE INDEX gx_overlay_footprint ON plans.plan_overlays USING gist (footprint_mga);
CREATE UNIQUE INDEX ux_overlay_active ON plans.plan_overlays (upload_id) WHERE is_active;

-- Applies an overlay's affine transform to any paper-space geometry.
CREATE OR REPLACE FUNCTION plans.apply_overlay_transform(p_overlay_id uuid, p_paper geometry)
RETURNS geometry LANGUAGE plpgsql STABLE AS $$
DECLARE
    o plans.plan_overlays%ROWTYPE;
BEGIN
    SELECT * INTO o FROM plans.plan_overlays WHERE overlay_id = p_overlay_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Overlay % not found', p_overlay_id;
    END IF;
    RETURN ST_SetSRID(
        ST_Affine(ST_Force2D(ST_SetSRID(p_paper, 0)),
                  o.transform_a, o.transform_b,
                  o.transform_d, o.transform_e,
                  o.transform_xoff, o.transform_yoff),
        o.mga_srid);
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. annotations: CAD text labels and DXF registry
-- -----------------------------------------------------------------------------

CREATE TABLE annotations.dxf_layers (
    layer_name     text PRIMARY KEY,                      -- e.g. 'C-PROP-BDY', 'C-ANNO-BRNG'
    aci_colour     smallint NOT NULL CHECK (aci_colour BETWEEN 1 AND 255),
    linetype       text NOT NULL DEFAULT 'CONTINUOUS',
    lineweight_mm  numeric(4,2) NOT NULL DEFAULT 0.25,
    description    text NOT NULL,
    is_plottable   boolean NOT NULL DEFAULT true
);

INSERT INTO annotations.dxf_layers (layer_name, aci_colour, linetype, lineweight_mm, description) VALUES
    ('C-PROP-BDY',   3, 'CONTINUOUS', 0.50, 'Lot boundary'),
    ('C-PROP-EASE',  6, 'DASHED',     0.25, 'Easements'),
    ('C-ROAD-BDY',   2, 'CONTINUOUS', 0.35, 'Road reserve / kerb'),
    ('C-ZONE-SBAK',  1, 'DASHED2',    0.25, 'Setback lines'),
    ('C-ZONE-ENVL',  1, 'CONTINUOUS', 0.35, 'Building envelope'),
    ('A-BLDG-SLAB',  5, 'CONTINUOUS', 0.50, 'Proposed slab / footprint (from architect PDF)'),
    ('C-TOPO-MAJR',  8, 'CONTINUOUS', 0.35, 'Major contours'),
    ('C-TOPO-MINR',  9, 'CONTINUOUS', 0.13, 'Minor contours'),
    ('C-EART-CUTT',  1, 'CONTINUOUS', 0.25, 'Cut zones'),
    ('C-EART-FILL',  3, 'CONTINUOUS', 0.25, 'Fill zones'),
    ('C-WALL-RETN',  4, 'CONTINUOUS', 0.50, 'Retaining walls'),
    ('C-DRIV-XOVR',  7, 'CONTINUOUS', 0.35, 'Driveway crossover'),
    ('C-UTIL-WATR',  5, 'CONTINUOUS', 0.25, 'Water mains/services'),
    ('C-UTIL-SEWR',  3, 'CONTINUOUS', 0.25, 'Sewer'),
    ('C-UTIL-STRM',  4, 'CONTINUOUS', 0.25, 'Stormwater'),
    ('C-UTIL-ELEC',  1, 'CONTINUOUS', 0.25, 'Electricity'),
    ('C-UTIL-EXCL',  1, 'DASHED',     0.18, 'DBYD exclusion buffers'),
    ('C-ANNO-BRNG',  7, 'CONTINUOUS', 0.18, 'Bearing and distance text'),
    ('C-ANNO-LOTN',  7, 'CONTINUOUS', 0.25, 'Lot / plan labels'),
    ('C-ANNO-ROAD',  7, 'CONTINUOUS', 0.25, 'Road names'),
    ('C-ANNO-NOTE',  7, 'CONTINUOUS', 0.18, 'General notes and disclaimers'),
    ('C-ANNO-TTLB',  7, 'CONTINUOUS', 0.25, 'Title block');

CREATE TABLE annotations.text_annotations (
    annotation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    lot_id         uuid REFERENCES cadastre.lots (lot_id),
    source_segment_id uuid REFERENCES cadastre.lot_boundary_segments (segment_id) ON DELETE CASCADE,
    kind           text NOT NULL CHECK (kind IN
                   ('bearing_distance','lot_label','road_name','area','setback_dimension',
                    'level_spot','contour_label','service_label','wall_label','crossover_label',
                    'disclaimer','user_note')),
    content        text NOT NULL,
    content_params jsonb NOT NULL DEFAULT '{}'::jsonb,     -- raw numbers so labels can be regenerated
    insertion_mga  geometry(PointZ) NOT NULL,
    mga_srid       integer NOT NULL REFERENCES core.mga_zones (srid),
    rotation_deg   numeric(7,3) NOT NULL DEFAULT 0 CHECK (rotation_deg > -360 AND rotation_deg < 360),
    text_height_mm numeric(5,2) NOT NULL DEFAULT 2.5,      -- plotted height at drawing scale
    attachment     text NOT NULL DEFAULT 'MIDDLE_CENTER'
                   CHECK (attachment IN ('TOP_LEFT','TOP_CENTER','TOP_RIGHT','MIDDLE_LEFT','MIDDLE_CENTER',
                                         'MIDDLE_RIGHT','BOTTOM_LEFT','BOTTOM_CENTER','BOTTOM_RIGHT')),
    layer_name     text NOT NULL REFERENCES annotations.dxf_layers (layer_name),
    keep_upright   boolean NOT NULL DEFAULT true,          -- flips text so it is never upside-down
    collision_group text,
    created_by_agent uuid,                                 -- FK added after agents.invocations
    CHECK (ST_SRID(insertion_mga) = mga_srid)
);
CREATE INDEX gx_annotations ON annotations.text_annotations USING gist (insertion_mga);
CREATE INDEX ix_annotations_project ON annotations.text_annotations (project_id, kind);

CREATE TABLE annotations.export_jobs (
    export_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    requested_by   uuid NOT NULL REFERENCES core.users (user_id),
    format         text NOT NULL CHECK (format IN ('dxf_r2018','dxf_r2010','pdf','ifc_site','gltf')),
    drawing_scale_denominator integer NOT NULL CHECK (drawing_scale_denominator > 0),
    storage_uri    text,
    file_sha256    bytea,
    terms_version_id uuid NOT NULL REFERENCES legal.terms_versions (terms_version_id),
    acknowledgements_present legal.acknowledgement_kind[] NOT NULL,
    status         text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','blocked')),
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 9. agents: orchestrator runs, sub-agent state, payload store, token ledger
-- -----------------------------------------------------------------------------

CREATE TYPE agents.agent_code AS ENUM (
    'ORCH',        -- Master Orchestrator
    'SA1_CADASTRE',
    'SA2_DCP_RAG',
    'SA3_GEOM_TIN',
    'SA4_HYDRO',
    'SA5_CAD_DXF',
    'SA6_GLIDE3D',
    'SA7_PDF_ALIGN'
);

CREATE TYPE agents.run_status AS ENUM
    ('queued','running','waiting_user','succeeded','failed','cancelled','blocked_by_gate');

-- Content-addressed payload store. Agents pass IDs and hashes, not bodies, in LLM context.
CREATE TABLE agents.payloads (
    payload_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sha256         bytea NOT NULL UNIQUE,
    schema_name    text NOT NULL,                          -- e.g. 'lot_context.v1'
    schema_version integer NOT NULL,
    body_json      jsonb,                                  -- small payloads inline
    storage_uri    text,                                   -- large payloads in object storage
    byte_size      bigint NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (octet_length(sha256) = 32),
    CHECK (body_json IS NOT NULL OR storage_uri IS NOT NULL)
);

CREATE TABLE agents.runs (
    run_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    requested_by   uuid NOT NULL REFERENCES core.users (user_id),
    terms_version_id uuid NOT NULL REFERENCES legal.terms_versions (terms_version_id),
    plan_json      jsonb NOT NULL,                         -- the DAG the orchestrator chose
    status         agents.run_status NOT NULL DEFAULT 'queued',
    token_budget   integer NOT NULL CHECK (token_budget > 0),
    tokens_used    integer NOT NULL DEFAULT 0,
    started_at     timestamptz,
    finished_at    timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_runs_project ON agents.runs (project_id, created_at DESC);

CREATE TABLE agents.invocations (
    invocation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id         uuid NOT NULL REFERENCES agents.runs (run_id) ON DELETE CASCADE,
    agent          agents.agent_code NOT NULL,
    attempt        smallint NOT NULL DEFAULT 1,
    depends_on     uuid[] NOT NULL DEFAULT '{}',
    status         agents.run_status NOT NULL DEFAULT 'queued',
    idempotency_key text NOT NULL,                         -- hash(agent, input payload sha256, code version)
    input_payload_id  uuid REFERENCES agents.payloads (payload_id),
    output_payload_id uuid REFERENCES agents.payloads (payload_id),
    agent_version  text NOT NULL,                          -- git SHA of the sub-agent image
    model_id       text,                                   -- NULL when the agent is purely deterministic
    cache_hit      boolean NOT NULL DEFAULT false,         -- served from idempotency cache
    error_code     text,
    error_detail   text,
    started_at     timestamptz,
    finished_at    timestamptz,
    UNIQUE (run_id, agent, attempt)
);
CREATE INDEX ix_invocations_idem ON agents.invocations (idempotency_key) WHERE status = 'succeeded';
CREATE INDEX ix_invocations_run ON agents.invocations (run_id, agent);

ALTER TABLE plans.plan_overlays
    ADD CONSTRAINT fk_overlay_agent FOREIGN KEY (created_by_agent) REFERENCES agents.invocations (invocation_id);
ALTER TABLE annotations.text_annotations
    ADD CONSTRAINT fk_annotation_agent FOREIGN KEY (created_by_agent) REFERENCES agents.invocations (invocation_id);

-- Append-only event log: every state transition and every message between agents.
CREATE TABLE agents.state_log (
    log_id         bigserial PRIMARY KEY,
    run_id         uuid NOT NULL REFERENCES agents.runs (run_id) ON DELETE CASCADE,
    invocation_id  uuid REFERENCES agents.invocations (invocation_id) ON DELETE CASCADE,
    logged_at      timestamptz NOT NULL DEFAULT now(),
    event          text NOT NULL CHECK (event IN
                   ('spawned','started','progress','checkpoint','handoff','cache_hit','retry',
                    'gate_blocked','user_input_requested','succeeded','failed','cancelled')),
    from_agent     agents.agent_code,
    to_agent       agents.agent_code,
    payload_id     uuid REFERENCES agents.payloads (payload_id),
    detail         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_state_log_run ON agents.state_log (run_id, log_id);
CREATE TRIGGER trg_state_log_append_only BEFORE UPDATE OR DELETE ON agents.state_log
    FOR EACH ROW EXECUTE FUNCTION core.forbid_mutation();

-- Token ledger: one row per model call. Cached input is tracked separately from fresh input.
CREATE TABLE agents.token_ledger (
    ledger_id      bigserial PRIMARY KEY,
    run_id         uuid NOT NULL REFERENCES agents.runs (run_id) ON DELETE CASCADE,
    invocation_id  uuid NOT NULL REFERENCES agents.invocations (invocation_id) ON DELETE CASCADE,
    model_id       text NOT NULL,
    input_tokens_fresh  integer NOT NULL DEFAULT 0,
    input_tokens_cache_write integer NOT NULL DEFAULT 0,
    input_tokens_cache_read  integer NOT NULL DEFAULT 0,
    output_tokens  integer NOT NULL DEFAULT 0,
    cost_aud_micros bigint NOT NULL DEFAULT 0,
    recorded_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_token_ledger_run ON agents.token_ledger (run_id);

CREATE OR REPLACE FUNCTION agents.roll_up_tokens() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE agents.runs
       SET tokens_used = tokens_used
           + NEW.input_tokens_fresh + NEW.input_tokens_cache_write
           + NEW.input_tokens_cache_read + NEW.output_tokens
     WHERE run_id = NEW.run_id;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_token_rollup AFTER INSERT ON agents.token_ledger
    FOR EACH ROW EXECUTE FUNCTION agents.roll_up_tokens();

-- Stable prompt prefixes (system prompt + tool schemas + jurisdiction rule packs) are cached once.
CREATE TABLE agents.prompt_cache_registry (
    prefix_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent          agents.agent_code NOT NULL,
    prefix_sha256  bytea NOT NULL,
    token_estimate integer NOT NULL,
    ttl_seconds    integer NOT NULL DEFAULT 300,
    last_used_at   timestamptz,
    UNIQUE (agent, prefix_sha256)
);

-- -----------------------------------------------------------------------------
-- 10. Row-level security
--     The API sets: SET LOCAL app.user_id = '<uuid>' for every request.
--     Policies require (a) project membership and (b) current Terms accepted.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION core.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION core.can_access_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = core, legal, pg_temp AS $$
    SELECT legal.has_accepted_current_terms(core.current_user_id())
       AND (
            EXISTS (SELECT 1 FROM core.projects p
                    WHERE p.project_id = p_project_id AND p.owner_user_id = core.current_user_id())
         OR EXISTS (SELECT 1 FROM core.project_members m
                    WHERE m.project_id = p_project_id AND m.user_id = core.current_user_id())
       );
$$;

DO $$
DECLARE
    t record;
BEGIN
    FOR t IN
        SELECT * FROM (VALUES
            ('planning','building_envelopes','project_id'),
            ('terrain','contour_sets','project_id'),
            ('terrain','cut_fill_runs','project_id'),
            ('terrain','crossover_checks','project_id'),
            ('utilities','dbyd_enquiries','project_id'),
            ('utilities','service_assets','project_id'),
            ('utilities','conflicts','project_id'),
            ('utilities','rwt_sizing','project_id'),
            ('plans','plan_uploads','project_id'),
            ('plans','plan_overlays','project_id'),
            ('annotations','text_annotations','project_id'),
            ('annotations','export_jobs','project_id'),
            ('agents','runs','project_id'),
            ('legal','project_acknowledgements','project_id')
        ) AS v(schema_name, table_name, project_col)
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schema_name, t.table_name);
        EXECUTE format(
            'CREATE POLICY p_project_access ON %I.%I USING (core.can_access_project(%I)) '
            'WITH CHECK (core.can_access_project(%I))',
            t.schema_name, t.table_name, t.project_col, t.project_col);
    END LOOP;
END;
$$;

-- Projects: owner or member may read/update; only a Terms-accepted user may create their own.
ALTER TABLE core.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_projects_select ON core.projects FOR SELECT
    USING (core.can_access_project(project_id));
CREATE POLICY p_projects_update ON core.projects FOR UPDATE
    USING (core.can_access_project(project_id)) WITH CHECK (core.can_access_project(project_id));
CREATE POLICY p_projects_insert ON core.projects FOR INSERT
    WITH CHECK (owner_user_id = core.current_user_id()
                AND legal.has_accepted_current_terms(core.current_user_id()));
CREATE POLICY p_projects_delete ON core.projects FOR DELETE
    USING (owner_user_id = core.current_user_id());

-- Terms acceptance rows: a user may read and insert only their own.
ALTER TABLE legal.terms_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_own_acceptance_read ON legal.terms_acceptances
    FOR SELECT USING (user_id = core.current_user_id());
CREATE POLICY p_own_acceptance_insert ON legal.terms_acceptances
    FOR INSERT WITH CHECK (user_id = core.current_user_id());

COMMIT;
