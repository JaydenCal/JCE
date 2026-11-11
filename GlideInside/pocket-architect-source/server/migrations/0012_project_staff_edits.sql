-- Builder staff can open a client's saved project in the client view and save it back. The project stays the client's;
-- these nullable columns record who last saved it when that was staff. Additive only.
ALTER TABLE portal_projects ADD COLUMN edited_by_id TEXT;
ALTER TABLE portal_projects ADD COLUMN edited_by_name TEXT;
ALTER TABLE portal_projects ADD COLUMN edited_by_staff_at TEXT;
