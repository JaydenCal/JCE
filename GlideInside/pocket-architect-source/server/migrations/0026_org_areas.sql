-- Builder areas for free plan set leads. One builder of each type holds a postcode or suburb (first come, first served; enforced in
-- server/lib/portal.js, admin only). builder_type is 'house' or 'shed' (NULL reads as 'house'). areas_json is a JSON array of 4 digit postcodes
-- and suburb names. Additive only.
ALTER TABLE orgs ADD COLUMN builder_type TEXT;
ALTER TABLE orgs ADD COLUMN areas_json TEXT;
