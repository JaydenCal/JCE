-- 008: rename the SA6 agent code after the JCESITE rebrand (stage 2A, 14/10/2026).
-- The package backend/app/agents/sa6_glide3d became sa6_site3d and AgentCode.SA6_GLIDE3D became SA6_SITE3D.
-- Idempotent: only renames when the old value is still present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'agents' AND t.typname = 'agent_code' AND e.enumlabel = 'SA6_GLIDE3D'
  ) THEN
    ALTER TYPE agents.agent_code RENAME VALUE 'SA6_GLIDE3D' TO 'SA6_SITE3D';
  END IF;
END $$;
