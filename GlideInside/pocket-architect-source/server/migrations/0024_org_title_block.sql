-- Builder title block details: printed on every plan sheet a builder (or a client of that builder) exports. All nullable, additive only.
-- Validated in src/portal/brand-details.js. These are separate from the billing legal name and ABN (orgs.abn), which stay private to billing.
-- Numbered 0024 because another branch adds 0023_job_billing.
ALTER TABLE orgs ADD COLUMN brand_licence TEXT;
ALTER TABLE orgs ADD COLUMN brand_abn TEXT;
ALTER TABLE orgs ADD COLUMN brand_address TEXT;
ALTER TABLE orgs ADD COLUMN brand_phone TEXT;
ALTER TABLE orgs ADD COLUMN brand_email TEXT;
ALTER TABLE orgs ADD COLUMN brand_website TEXT;
