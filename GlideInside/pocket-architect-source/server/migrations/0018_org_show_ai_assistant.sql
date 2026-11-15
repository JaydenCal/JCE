-- Builder setting "Show AI design assistant to clients": whether the AI design assistant is offered to that builder's clients.
-- Additive only. 1 (the default) shows it; 0 hides it entirely for the builder's client logins (staff logins keep it).
ALTER TABLE orgs ADD COLUMN show_ai_assistant INTEGER NOT NULL DEFAULT 1;
