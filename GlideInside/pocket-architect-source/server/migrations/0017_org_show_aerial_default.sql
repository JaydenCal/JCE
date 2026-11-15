-- Builder setting "Show aerial by default": the aerial imagery state new lots open with for that builder's clients (and staff).
-- Additive only. 1 (the default) shows the aerial; a person's own Aerial on/off choice in their browser still wins.
ALTER TABLE orgs ADD COLUMN show_aerial_default INTEGER NOT NULL DEFAULT 1;
