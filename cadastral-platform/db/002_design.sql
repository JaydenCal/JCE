-- =============================================================================
-- Design / visualisation module (play mode, placeable store items)
-- Load AFTER 001_schema.sql. Schema: design
--
-- Conventions follow 001: metres, geometry in the lot's MGA zone (EPSG:7854/5/6),
-- heights AHD unless stated, RLS via core.can_access_project (project membership
-- AND current Terms accepted). Renders are illustrative only (legal/TERMS_ADDENDUM_DESIGN.md).
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS design;

CREATE TYPE design.layout_source AS ENUM ('from_scratch', 'pdf_import', 'dxf_import');
CREATE TYPE design.opening_kind  AS ENUM ('door', 'window');
CREATE TYPE design.roof_kind     AS ENUM ('gable', 'hip', 'skillion', 'flat');
CREATE TYPE design.model_kind    AS ENUM ('real', 'proxy_box');
CREATE TYPE design.anchor_surface AS ENUM ('floor', 'ground', 'wall', 'ceiling');
CREATE TYPE design.check_severity AS ENUM ('info', 'warning', 'blocking');

-- -----------------------------------------------------------------------------
-- Building layout: levels > rooms / walls > openings, roofs, materials
-- -----------------------------------------------------------------------------

CREATE TABLE design.layouts (
    layout_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    name         text NOT NULL,
    source       design.layout_source NOT NULL DEFAULT 'from_scratch',
    upload_id    uuid REFERENCES plans.plan_uploads (upload_id),   -- set for pdf_import / dxf_import
    mga_srid     integer NOT NULL REFERENCES core.mga_zones (srid),
    origin_x     double precision NOT NULL DEFAULT 0,              -- layout local (0,0) in MGA easting
    origin_y     double precision NOT NULL DEFAULT 0,              -- ... and northing
    rotation_deg double precision NOT NULL DEFAULT 0,
    created_by   uuid REFERENCES core.users (user_id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (source = 'from_scratch' OR upload_id IS NOT NULL)
);
CREATE INDEX ix_layouts_project ON design.layouts (project_id);
CREATE TRIGGER trg_layouts_updated BEFORE UPDATE ON design.layouts
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TABLE design.levels (
    level_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    layout_id    uuid NOT NULL REFERENCES design.layouts (layout_id) ON DELETE CASCADE,
    name         text NOT NULL,
    ordinal      integer NOT NULL DEFAULT 0,
    floor_rl_m   numeric(7,3) NOT NULL,                            -- finished floor level, m AHD
    height_m     numeric(5,2) NOT NULL DEFAULT 2.7 CHECK (height_m > 0),
    UNIQUE (layout_id, ordinal)
);

CREATE TABLE design.materials (
    material_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    name         text NOT NULL,
    colour_hex   text CHECK (colour_hex ~ '^#[0-9a-fA-F]{6}$'),
    texture_uri  text,
    roughness    numeric(3,2) CHECK (roughness BETWEEN 0 AND 1),
    catalogue_item_id uuid                                         -- optional link; FK added below
);
CREATE INDEX ix_materials_project ON design.materials (project_id);

CREATE TABLE design.rooms (
    room_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    level_id     uuid NOT NULL REFERENCES design.levels (level_id) ON DELETE CASCADE,
    name         text NOT NULL,
    use_class    text,
    footprint_mga geometry(Polygon) NOT NULL,
    mga_srid     integer NOT NULL REFERENCES core.mga_zones (srid),
    floor_material_id uuid REFERENCES design.materials (material_id),
    CHECK (ST_SRID(footprint_mga) = mga_srid)
);
CREATE INDEX ix_rooms_level ON design.rooms (level_id);
CREATE INDEX gx_rooms ON design.rooms USING gist (footprint_mga);

CREATE TABLE design.walls (
    wall_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    level_id     uuid NOT NULL REFERENCES design.levels (level_id) ON DELETE CASCADE,
    centreline_mga geometry(LineString) NOT NULL,
    mga_srid     integer NOT NULL REFERENCES core.mga_zones (srid),
    thickness_m  numeric(5,3) NOT NULL DEFAULT 0.11 CHECK (thickness_m > 0),
    height_m     numeric(5,2) NOT NULL DEFAULT 2.7 CHECK (height_m > 0),
    is_external  boolean NOT NULL DEFAULT false,
    material_id  uuid REFERENCES design.materials (material_id),
    CHECK (ST_SRID(centreline_mga) = mga_srid)
);
CREATE INDEX ix_walls_level ON design.walls (level_id);
CREATE INDEX gx_walls ON design.walls USING gist (centreline_mga);

CREATE TABLE design.openings (
    opening_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    wall_id      uuid NOT NULL REFERENCES design.walls (wall_id) ON DELETE CASCADE,
    kind         design.opening_kind NOT NULL,
    offset_m     numeric(6,3) NOT NULL CHECK (offset_m >= 0),      -- along the wall from its start
    width_m      numeric(5,3) NOT NULL CHECK (width_m > 0),
    height_m     numeric(5,3) NOT NULL CHECK (height_m > 0),
    sill_m       numeric(5,3) NOT NULL DEFAULT 0 CHECK (sill_m >= 0)
);
CREATE INDEX ix_openings_wall ON design.openings (wall_id);

CREATE TABLE design.roofs (
    roof_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    level_id     uuid NOT NULL REFERENCES design.levels (level_id) ON DELETE CASCADE,
    kind         design.roof_kind NOT NULL,
    pitch_deg    numeric(4,1) NOT NULL DEFAULT 22.5 CHECK (pitch_deg BETWEEN 0 AND 60),
    eaves_m      numeric(4,2) NOT NULL DEFAULT 0.45 CHECK (eaves_m >= 0),
    ridge_bearing_deg double precision,
    footprint_mga geometry(Polygon) NOT NULL,
    mga_srid     integer NOT NULL REFERENCES core.mga_zones (srid),
    material_id  uuid REFERENCES design.materials (material_id),
    CHECK (ST_SRID(footprint_mga) = mga_srid)
);
CREATE INDEX ix_roofs_level ON design.roofs (level_id);

-- -----------------------------------------------------------------------------
-- Store catalogue (shared across projects) and placed items (per project)
-- -----------------------------------------------------------------------------

CREATE TABLE design.catalogue_items (
    catalogue_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    retailer     text NOT NULL,
    source_url   text NOT NULL,
    sku          text,
    title        text NOT NULL,
    brand        text,
    price_aud    numeric(12,2) CHECK (price_aud >= 0),
    price_captured_at timestamptz,                                 -- price is "as at" this time
    width_m      numeric(7,3) CHECK (width_m > 0),
    depth_m      numeric(7,3) CHECK (depth_m > 0),
    height_m     numeric(7,3) CHECK (height_m > 0),
    category     text,
    image_uri    text,
    model_uri    text,                                             -- glTF / GLB
    model_kind   design.model_kind NOT NULL DEFAULT 'proxy_box',
    licence_note text,                                             -- asset/image licence or permission basis
    captured_by  uuid REFERENCES core.users (user_id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (model_kind = 'proxy_box' OR model_uri IS NOT NULL),
    CHECK (price_aud IS NULL OR price_captured_at IS NOT NULL),
    CHECK (model_kind = 'real' OR (width_m IS NOT NULL AND depth_m IS NOT NULL AND height_m IS NOT NULL))
);
CREATE UNIQUE INDEX ux_catalogue_source ON design.catalogue_items (retailer, source_url);
CREATE INDEX ix_catalogue_category ON design.catalogue_items (category);
CREATE INDEX ix_catalogue_title ON design.catalogue_items USING gin (to_tsvector('simple', title));
ALTER TABLE design.materials ADD CONSTRAINT fk_materials_catalogue
    FOREIGN KEY (catalogue_item_id) REFERENCES design.catalogue_items (catalogue_item_id);

CREATE TABLE design.placed_items (
    placed_item_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    catalogue_item_id uuid NOT NULL REFERENCES design.catalogue_items (catalogue_item_id),
    level_id          uuid REFERENCES design.levels (level_id) ON DELETE SET NULL,
    room_id           uuid REFERENCES design.rooms (room_id) ON DELETE SET NULL,
    mga_srid          integer NOT NULL REFERENCES core.mga_zones (srid),
    x double precision NOT NULL,                                   -- MGA easting, m
    y double precision NOT NULL,                                   -- MGA northing, m
    z double precision NOT NULL,                                   -- m AHD
    yaw_deg   double precision NOT NULL DEFAULT 0,
    pitch_deg double precision NOT NULL DEFAULT 0,
    roll_deg  double precision NOT NULL DEFAULT 0,
    scale     double precision NOT NULL DEFAULT 1 CHECK (scale > 0),
    scale_locked boolean NOT NULL DEFAULT true,                    -- locked = real dimensions
    anchor    design.anchor_surface NOT NULL DEFAULT 'ground',
    locked    boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES core.users (user_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (NOT scale_locked OR scale = 1)
);
CREATE INDEX ix_placed_project ON design.placed_items (project_id);
CREATE INDEX ix_placed_catalogue ON design.placed_items (catalogue_item_id);
CREATE INDEX gx_placed_pt ON design.placed_items USING gist (ST_SetSRID(ST_MakePoint(x, y), mga_srid));
CREATE TRIGGER trg_placed_updated BEFORE UPDATE ON design.placed_items
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- Compliance result of a placement against envelope / DBYD buffers / driveway / boundary.
CREATE TABLE design.item_checks (
    check_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     uuid NOT NULL REFERENCES core.projects (project_id) ON DELETE CASCADE,
    placed_item_id uuid NOT NULL REFERENCES design.placed_items (placed_item_id) ON DELETE CASCADE,
    check_kind     text NOT NULL CHECK (check_kind IN
                   ('envelope','boundary','dbyd_buffer','driveway','collision','terrain','dimensions')),
    passed         boolean NOT NULL,
    severity       design.check_severity NOT NULL,
    message        text NOT NULL,
    ref_table      text,
    ref_id         uuid,
    checked_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_item_checks_item ON design.item_checks (placed_item_id);
CREATE INDEX ix_item_checks_project ON design.item_checks (project_id);

-- -----------------------------------------------------------------------------
-- Row-level security (same pattern as 001 section 10)
-- -----------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['layouts','levels','materials','rooms','walls','openings','roofs',
                             'placed_items','item_checks']
    LOOP
        EXECUTE format('ALTER TABLE design.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY p_project_access ON design.%I USING (core.can_access_project(project_id)) '
                       'WITH CHECK (core.can_access_project(project_id))', t);
    END LOOP;
END;
$$;

-- Catalogue is shared: any Terms-accepted user may read and add; only the capturer may change/remove.
ALTER TABLE design.catalogue_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_catalogue_select ON design.catalogue_items FOR SELECT
    USING (legal.has_accepted_current_terms(core.current_user_id()));
CREATE POLICY p_catalogue_insert ON design.catalogue_items FOR INSERT
    WITH CHECK (legal.has_accepted_current_terms(core.current_user_id())
                AND captured_by = core.current_user_id());
CREATE POLICY p_catalogue_update ON design.catalogue_items FOR UPDATE
    USING (captured_by = core.current_user_id()
           AND legal.has_accepted_current_terms(core.current_user_id()));
CREATE POLICY p_catalogue_delete ON design.catalogue_items FOR DELETE
    USING (captured_by = core.current_user_id()
           AND legal.has_accepted_current_terms(core.current_user_id()));

COMMIT;
