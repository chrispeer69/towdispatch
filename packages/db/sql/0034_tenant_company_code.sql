-- Migration 0034 — Tenant Company Code (frictionless driver login)
--
-- Adds a 6-digit numeric `company_code` to every tenant. Drivers use this
-- on the /driver/login surface instead of having to know their tenant's
-- URL slug. Each existing tenant gets a backfilled unique code; new tenants
-- get a code at insert time via a BEFORE INSERT trigger. The column is
-- NOT NULL after backfill, UNIQUE across the platform.
--
-- Idempotent: re-runnable without side effects. ALTER TABLE IF NOT EXISTS
-- isn't a thing, so we use a DO block to add the column conditionally.

-- 1. Add the column nullable so we can backfill before flipping NOT NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'company_code'
  ) THEN
    ALTER TABLE tenants ADD COLUMN company_code text;
  END IF;
END$$;

-- 2. Generator function: returns a random 6-digit code that doesn't
-- already exist on tenants. Loops until a unique code is found. The
-- search space is 900,000 (100,000-999,999); collisions are negligible
-- until tens of thousands of tenants — far beyond Phase 1.
CREATE OR REPLACE FUNCTION fn_generate_tenant_company_code()
RETURNS text AS $$
DECLARE
  v_code text;
  v_attempt int := 0;
BEGIN
  LOOP
    v_code := lpad(floor(random() * 900000 + 100000)::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE company_code = v_code);
    v_attempt := v_attempt + 1;
    IF v_attempt > 50 THEN
      RAISE EXCEPTION 'fn_generate_tenant_company_code: could not find a free code in 50 attempts';
    END IF;
  END LOOP;
  RETURN v_code;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION fn_generate_tenant_company_code() OWNER TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION fn_generate_tenant_company_code() TO app_user, app_admin;

-- 3. Backfill all existing tenants that don't yet have a code.
UPDATE tenants
SET company_code = fn_generate_tenant_company_code()
WHERE company_code IS NULL;

-- 4. Now flip to NOT NULL + UNIQUE + check digits.
ALTER TABLE tenants
  ALTER COLUMN company_code SET NOT NULL;

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_company_code_unique;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_company_code_unique UNIQUE (company_code);

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_company_code_format;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_company_code_format
  CHECK (company_code ~ '^[0-9]{6}$');

-- 5. BEFORE INSERT trigger so new tenants always get a code.
CREATE OR REPLACE FUNCTION fn_tenants_assign_company_code()
RETURNS trigger AS $$
BEGIN
  IF NEW.company_code IS NULL OR NEW.company_code = '' THEN
    NEW.company_code := fn_generate_tenant_company_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION fn_tenants_assign_company_code() OWNER TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION fn_tenants_assign_company_code() TO app_user, app_admin;

DROP TRIGGER IF EXISTS trg_tenants_assign_company_code ON tenants;
CREATE TRIGGER trg_tenants_assign_company_code
  BEFORE INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION fn_tenants_assign_company_code();

-- 6. Index for fast lookup at /driver-auth/lookup-tenant.
CREATE UNIQUE INDEX IF NOT EXISTS tenants_company_code_idx ON tenants (company_code);
