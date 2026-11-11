-- Builder colour scheme: the colours a builder's portal pages and Pocket Architect logins switch to.
-- Additive only: four nullable columns. NULL primary means the Glide Inside look. Values are #rrggbb, validated in lib/portal.js.
ALTER TABLE orgs ADD COLUMN brand_primary TEXT;
ALTER TABLE orgs ADD COLUMN brand_accent TEXT;
ALTER TABLE orgs ADD COLUMN brand_dark_ink TEXT;
ALTER TABLE orgs ADD COLUMN brand_dark_bg TEXT;
