-- Migration 0039 — Tenant preferred-region pin (Multi-Region, Session 44)
--
-- Adds a nullable `preferred_region` to tenants. When set, it expresses which
-- region a tenant would prefer to be served from. Honoring it is edge/DNS work
-- (owner-side) and out of scope this session — the API validates and echoes
-- the X-Preferred-Region header but does not route on it.
--
-- Deliberately NULLABLE and WITHOUT a CHECK constraint: the whole point of the
-- multi-region foundation is forward-compatibility for more than two regions.
-- A `CHECK (preferred_region IN ('us-east','us-west'))` would lock us to today's
-- two and force a migration to add a third. Allowed values are validated at the
-- app input boundary (Zod regionIdSchema) instead.
--
-- Idempotent: ALTER TABLE ... IF NOT EXISTS isn't valid for ADD COLUMN, so we
-- guard with a DO block. Re-runnable without side effects. The tenants audit
-- trigger (0004) is column-agnostic — to_jsonb(NEW) — so adding a column is safe.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'preferred_region'
  ) THEN
    ALTER TABLE tenants ADD COLUMN preferred_region text;
  END IF;
END$$;

COMMENT ON COLUMN tenants.preferred_region IS
  'Multi-Region (S44): tenant region preference (e.g. us-east|us-west). Nullable; no CHECK by design (forward-compat). Routing is edge/DNS, owner-side — API does not route on it yet.';
