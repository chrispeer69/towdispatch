-- =====================================================================
-- 0006_customers_vehicles_accounts.sql
--
-- RLS, partial unique indexes, and audit triggers for the customer / vehicle
-- / account spine. Drizzle-generated tables and indexes already exist by the
-- time this runs (ordered after the drizzle migrations in migrate.ts).
--
-- Key invariants:
--   * Every new table is FORCE RLS — even the table owner cannot bypass.
--   * Soft-delete shaped: partial unique indexes use WHERE deleted_at IS NULL
--     so a re-created row after a soft-delete does not collide.
--   * VIN normalization is enforced by CHECK (VIN, when present, is the
--     standard 17-char A-Z 0-9 minus I/O/Q).
--   * Audit triggers cover all 4 new tables — wired into the generic
--     fn_audit_log() defined in 0004.
-- =====================================================================

-- ---------- accounts ----------
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_tenant_isolation ON accounts;
CREATE POLICY accounts_tenant_isolation ON accounts
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP INDEX IF EXISTS accounts_tenant_name_unique;
CREATE UNIQUE INDEX accounts_tenant_name_unique
  ON accounts (tenant_id, name)
  WHERE deleted_at IS NULL;

-- credit_used + credit_limit numeric guardrails:
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_credit_used_nonnegative;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_credit_used_nonnegative
  CHECK (credit_used >= 0);

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_credit_limit_nonnegative;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_credit_limit_nonnegative
  CHECK (credit_limit IS NULL OR credit_limit >= 0);

DROP TRIGGER IF EXISTS trg_audit_accounts ON accounts;
CREATE TRIGGER trg_audit_accounts
  AFTER INSERT OR UPDATE OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- customers ----------
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_tenant_isolation ON customers;
CREATE POLICY customers_tenant_isolation ON customers
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- Phone uniqueness within a tenant when present and live.
DROP INDEX IF EXISTS customers_tenant_phone_unique;
CREATE UNIQUE INDEX customers_tenant_phone_unique
  ON customers (tenant_id, phone)
  WHERE phone IS NOT NULL AND deleted_at IS NULL;

-- Trigram-style search index for autocomplete on name (cheap LIKE 'foo%').
-- Postgres' default lower(text) expression index covers case-insensitive
-- prefix matches without needing pg_trgm yet.
DROP INDEX IF EXISTS customers_tenant_name_lower_idx;
CREATE INDEX customers_tenant_name_lower_idx
  ON customers (tenant_id, lower(name));

DROP INDEX IF EXISTS customers_tenant_email_lower_idx;
CREATE INDEX customers_tenant_email_lower_idx
  ON customers (tenant_id, lower(email))
  WHERE email IS NOT NULL;

DROP TRIGGER IF EXISTS trg_audit_customers ON customers;
CREATE TRIGGER trg_audit_customers
  AFTER INSERT OR UPDATE OR DELETE ON customers
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- vehicles ----------
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicles_tenant_isolation ON vehicles;
CREATE POLICY vehicles_tenant_isolation ON vehicles
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- VIN: 17 chars, uppercase A-Z (no I/O/Q) + digits, when present.
ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_vin_format;
ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_vin_format
  CHECK (vin IS NULL OR vin ~ '^[A-HJ-NPR-Z0-9]{17}$');

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_year_range;
ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_year_range
  CHECK (year IS NULL OR (year BETWEEN 1900 AND 2100));

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS vehicles_plate_state_format;
ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_plate_state_format
  CHECK (plate_state IS NULL OR plate_state ~ '^[A-Z]{2}$');

DROP INDEX IF EXISTS vehicles_tenant_vin_unique;
CREATE UNIQUE INDEX vehicles_tenant_vin_unique
  ON vehicles (tenant_id, vin)
  WHERE vin IS NOT NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_audit_vehicles ON vehicles;
CREATE TRIGGER trg_audit_vehicles
  AFTER INSERT OR UPDATE OR DELETE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- customer_vehicles ----------
ALTER TABLE customer_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_vehicles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_vehicles_tenant_isolation ON customer_vehicles;
CREATE POLICY customer_vehicles_tenant_isolation ON customer_vehicles
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP INDEX IF EXISTS customer_vehicles_tenant_pair_unique;
CREATE UNIQUE INDEX customer_vehicles_tenant_pair_unique
  ON customer_vehicles (tenant_id, customer_id, vehicle_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_audit_customer_vehicles ON customer_vehicles;
CREATE TRIGGER trg_audit_customer_vehicles
  AFTER INSERT OR UPDATE OR DELETE ON customer_vehicles
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
