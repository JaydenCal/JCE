-- 14. Internal test accounts: an owner-only flag on an org (org_accounts.internal = 1). No charges are ever raised for it, no trial or
-- pause applies, and it is left out of usage, revenue and trial reporting. Additive only. Run once after deploying the Worker.
-- (If this column already exists the statement fails harmlessly: the migration has been applied.)
ALTER TABLE org_accounts ADD COLUMN internal INTEGER NOT NULL DEFAULT 0;
