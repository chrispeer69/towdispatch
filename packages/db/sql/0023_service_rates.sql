-- =====================================================================
-- 0023_service_rates.sql  (Admin Settings — build 2 of 6)
--
-- Adds the Master Rate Sheet: one row per (service, vehicle_class) holding
-- the operator's price in integer cents. The Service Catalog (build 1)
-- defined the *structure* of what tenants bill for; this table answers the
-- "how much" question.
--
-- Design notes:
--   * One row per (service_id, vehicle_class). For services that are
--     class-independent (applicable_vehicle_classes = '{}'), the price row
--     uses vehicle_class = 'any' as a sentinel — this keeps the same shape
--     for class-dependent and class-independent services in a single table.
--   * tenant_id is denormalized on the row so RLS works without joining
--     through service_catalog. It is enforced consistent via FK + a CHECK
--     constraint that compares to the parent row at insert/update time
--     through a trigger.
--   * price_cents is bigint NOT NULL so a "no rate set" state is
--     unrepresentable. The UI seeds zero ("price not set") rows lazily;
--     missing rows mean the rate engine falls back to the legacy
--     rate_sheets JSON definition.
--   * Soft delete is intentionally NOT modeled here. Operators can null out
--     a price by deleting the row; the engine then falls back. A wholesale
--     "deactivate a service" lives on service_catalog (is_active flag).
--   * The Master Rate Sheet is per-tenant. Per-account overrides land in
--     build 5 (Account Rate Cards) as a separate table that diffs against
--     this one.
--
-- Down (rollback):
--   DROP TRIGGER  IF EXISTS trg_audit_service_rates ON service_rates;
--   DROP TABLE    IF EXISTS service_rates;
-- =====================================================================

CREATE TABLE IF NOT EXISTS service_rates (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  service_id      uuid NOT NULL REFERENCES service_catalog(id) ON DELETE CASCADE,
  -- vehicle_class is the @ustowdispatch/shared VehicleClass value, or 'any'
  -- as the sentinel for class-independent services. Validated app-side.
  vehicle_class   text NOT NULL,
  price_cents     bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE service_rates
  DROP CONSTRAINT IF EXISTS service_rates_price_cents_nonneg_chk;
ALTER TABLE service_rates
  ADD CONSTRAINT service_rates_price_cents_nonneg_chk
  CHECK (price_cents >= 0);

ALTER TABLE service_rates
  DROP CONSTRAINT IF EXISTS service_rates_vehicle_class_chk;
ALTER TABLE service_rates
  ADD CONSTRAINT service_rates_vehicle_class_chk
  CHECK (vehicle_class IN (
    'any', 'light_duty', 'medium_duty', 'heavy_duty',
    'motorcycle', 'commercial', 'rv', 'unknown'
  ));

-- ---------- indexes ----------
DROP INDEX IF EXISTS service_rates_service_class_unique;
CREATE UNIQUE INDEX service_rates_service_class_unique
  ON service_rates (service_id, vehicle_class);

CREATE INDEX IF NOT EXISTS service_rates_tenant_idx
  ON service_rates (tenant_id);

-- ---------- RLS ----------
ALTER TABLE service_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_rates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_rates_tenant_isolation ON service_rates;
CREATE POLICY service_rates_tenant_isolation ON service_rates
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- ---------- guard against cross-tenant FK injection ----------
-- The FK ensures service_id references a real service_catalog row, but RLS
-- alone won't catch an attacker who somehow knows another tenant's service_id
-- and passes their own tenant_id. This trigger enforces that service_id's
-- tenant matches the row's tenant_id, raising a clean error if not.
CREATE OR REPLACE FUNCTION fn_service_rates_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_service_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_service_tenant
  FROM service_catalog
  WHERE id = NEW.service_id;

  IF v_service_tenant IS NULL THEN
    RAISE EXCEPTION 'service_rates: service_id % does not exist', NEW.service_id;
  END IF;

  IF v_service_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'service_rates: tenant_id (%) does not match service_catalog.tenant_id (%)',
      NEW.tenant_id, v_service_tenant;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_service_rates_tenant_consistency ON service_rates;
CREATE TRIGGER trg_service_rates_tenant_consistency
  BEFORE INSERT OR UPDATE ON service_rates
  FOR EACH ROW EXECUTE FUNCTION fn_service_rates_tenant_consistency();

-- ---------- audit ----------
DROP TRIGGER IF EXISTS trg_audit_service_rates ON service_rates;
CREATE TRIGGER trg_audit_service_rates
  AFTER INSERT OR UPDATE OR DELETE ON service_rates
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
