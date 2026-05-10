-- =====================================================================
-- 0010_drivers_trucks_shifts.sql
--
-- RLS, partial unique indexes, audit triggers, and check constraints for
-- the dispatch / fleet spine: drivers, trucks, driver_shifts.
--
-- Originally drafted for Session 5 as 0009; renumbered 0010 here so we
-- sit above the existing 0009_customers_extended_contact.sql in master.
-- The Session-8 fleet additions (documents, dvirs, maintenance,
-- driver_truck_assignments) live in 0011.
--
-- Invariants:
--   * Every new tenant-scoped table is FORCE RLS.
--   * One driver can only have one active shift — partial unique index
--     (tenant_id, driver_id) WHERE ended_at IS NULL AND deleted_at IS NULL.
--   * One truck can only be tied to one active shift.
--   * One user can be linked to at most one driver row per tenant.
--   * Trucks have a unique unit_number per tenant for live rows.
-- =====================================================================

-- ---------- drivers ----------
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS drivers_tenant_isolation ON drivers;
CREATE POLICY drivers_tenant_isolation ON drivers
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- One driver row per (tenant, user_id) for live rows. Partial unique so a
-- soft-deleted driver can be re-onboarded later without colliding.
DROP INDEX IF EXISTS drivers_tenant_user_unique;
CREATE UNIQUE INDEX drivers_tenant_user_unique
  ON drivers (tenant_id, user_id)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;

-- License-state two-letter US format (when supplied).
ALTER TABLE drivers
  DROP CONSTRAINT IF EXISTS drivers_license_state_format;
ALTER TABLE drivers
  ADD CONSTRAINT drivers_license_state_format
  CHECK (license_state IS NULL OR license_state ~ '^[A-Z]{2}$');

DROP TRIGGER IF EXISTS trg_audit_drivers ON drivers;
CREATE TRIGGER trg_audit_drivers
  AFTER INSERT OR UPDATE OR DELETE ON drivers
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- trucks ----------
ALTER TABLE trucks ENABLE ROW LEVEL SECURITY;
ALTER TABLE trucks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trucks_tenant_isolation ON trucks;
CREATE POLICY trucks_tenant_isolation ON trucks
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

ALTER TABLE trucks
  DROP CONSTRAINT IF EXISTS trucks_unit_number_nonempty;
ALTER TABLE trucks
  ADD CONSTRAINT trucks_unit_number_nonempty
  CHECK (length(trim(unit_number)) > 0);

ALTER TABLE trucks
  DROP CONSTRAINT IF EXISTS trucks_plate_state_format;
ALTER TABLE trucks
  ADD CONSTRAINT trucks_plate_state_format
  CHECK (plate_state IS NULL OR plate_state ~ '^[A-Z]{2}$');

ALTER TABLE trucks
  DROP CONSTRAINT IF EXISTS trucks_year_format;
ALTER TABLE trucks
  ADD CONSTRAINT trucks_year_format
  CHECK (year IS NULL OR year ~ '^[0-9]{4}$');

ALTER TABLE trucks
  DROP CONSTRAINT IF EXISTS trucks_gvwr_nonneg;
ALTER TABLE trucks
  ADD CONSTRAINT trucks_gvwr_nonneg
  CHECK (gvwr_lbs IS NULL OR gvwr_lbs > 0);

ALTER TABLE trucks
  DROP CONSTRAINT IF EXISTS trucks_odometer_nonneg;
ALTER TABLE trucks
  ADD CONSTRAINT trucks_odometer_nonneg
  CHECK (current_odometer IS NULL OR current_odometer >= 0);

DROP TRIGGER IF EXISTS trg_audit_trucks ON trucks;
CREATE TRIGGER trg_audit_trucks
  AFTER INSERT OR UPDATE OR DELETE ON trucks
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- driver_shifts ----------
ALTER TABLE driver_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_shifts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_shifts_tenant_isolation ON driver_shifts;
CREATE POLICY driver_shifts_tenant_isolation ON driver_shifts
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP INDEX IF EXISTS driver_shifts_tenant_active_driver_unique;
CREATE UNIQUE INDEX driver_shifts_tenant_active_driver_unique
  ON driver_shifts (tenant_id, driver_id)
  WHERE ended_at IS NULL AND deleted_at IS NULL;

DROP INDEX IF EXISTS driver_shifts_tenant_active_truck_unique;
CREATE UNIQUE INDEX driver_shifts_tenant_active_truck_unique
  ON driver_shifts (tenant_id, truck_id)
  WHERE ended_at IS NULL AND deleted_at IS NULL AND truck_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_audit_driver_shifts ON driver_shifts;
CREATE TRIGGER trg_audit_driver_shifts
  AFTER INSERT OR UPDATE OR DELETE ON driver_shifts
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- job_status_transitions ----------
-- Folded into 0010 during the Session-5↔Session-8 merge so the dispatch
-- audit table sits alongside the rest of the dispatch spine.
ALTER TABLE job_status_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_status_transitions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_status_transitions_tenant_isolation ON job_status_transitions;
CREATE POLICY job_status_transitions_tenant_isolation ON job_status_transitions
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- No audit trigger on job_status_transitions — it IS the audit trail. The
-- generic audit_log already captures the corresponding jobs UPDATE.
