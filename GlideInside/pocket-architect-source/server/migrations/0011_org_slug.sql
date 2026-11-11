-- Builder slug: the short public name used by the Glide Inside home page builder picker (/portal/?builder=<slug>).
-- Additive only: one nullable column and a unique index (NULLs are allowed more than once). The owner sets it with
-- POST /portal/admin/orgs/:id/slug; new organisations get one from their name.
ALTER TABLE orgs ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_slug ON orgs(slug);
