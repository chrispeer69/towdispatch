-- =====================================================================
-- 0009_drivers_trucks_shifts.sql
--
-- RLS, partial unique indexes, audit triggers, and check constraints for
-- Session 5 — the live dispatch board. Adds: drivers, trucks, driver_shifts,
-- job_status_transitions. Also extends jobs with assignment columns FK'd
-- back to drivers / trucks / driver_shifts.
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

-- One driver row per (tenant, user_id) for live rows. Kept as a partial
-- unique because a soft-deleted driver can be re-onboarded later.
DROP INDEX IF EXISTS drivers_tenant_user_unique;
CREATE UNIQUE INDEX drivers_tenant_user_unique
  ON drivers (tenant_id, user_id)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;

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
ALTER TABLE job_status_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_status_transitions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_status_transitions_tenant_isolation ON job_status_transitions;
CREATE POLICY job_status_transitions_tenant_isolation ON job_status_transitions
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- No audit trigger on job_status_transitions — it IS the audit trail. The
-- generic audit_log already captures the corresponding jobs UPDATE.
