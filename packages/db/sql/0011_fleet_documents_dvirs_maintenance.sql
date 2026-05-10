-- =====================================================================
-- 0011_fleet_documents_dvirs_maintenance.sql  (Session 8)
--
-- RLS, audit triggers, partial unique indexes, and check constraints for
-- the Session 8 fleet additions:
--   - driver_truck_assignments
--   - documents
--   - dvirs
--   - maintenance_schedules
--   - maintenance_records
--
-- Also adds CHECK constraints to drivers.certifications and trucks.equipment
-- because those text[] columns landed in 0005 without value enforcement.
--
-- Invariants:
--   * Every Session 8 tenant-scoped table is FORCE RLS.
--   * One live (driver, truck) assignment per tenant — partial unique.
--   * documents.owner_type is constrained to the polymorphic allow-list.
--   * documents.size_bytes >= 0; expires_at, when set, must be future-ish
--     (we don't enforce that in DB — uploads can record past expiry on a
--     pre-expired document, by design).
-- =====================================================================

-- ---------- drivers.certifications value allow-list ----------
ALTER TABLE drivers
  DROP CONSTRAINT IF EXISTS drivers_certifications_allowed;
ALTER TABLE drivers
  ADD CONSTRAINT drivers_certifications_allowed
  CHECK (
    certifications IS NULL
    OR certifications <@ ARRAY[
      'WreckMaster_4_5',
      'WreckMaster_6_7',
      'TIM',
      'Tesla_certified',
      'OSHA_10',
      'CPR'
    ]::text[]
  );

-- ---------- trucks.equipment value allow-list ----------
ALTER TABLE trucks
  DROP CONSTRAINT IF EXISTS trucks_equipment_allowed;
ALTER TABLE trucks
  ADD CONSTRAINT trucks_equipment_allowed
  CHECK (
    equipment IS NULL
    OR equipment <@ ARRAY[
      'flatbed',
      'wheel_lift',
      'wrecker_light',
      'wrecker_medium',
      'wrecker_heavy',
      'integrated',
      'sliding_rotator',
      'dollies',
      'skates',
      'jump_pack',
      'winch'
    ]::text[]
  );

-- ---------- driver_truck_assignments ----------
ALTER TABLE driver_truck_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_truck_assignments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_truck_assignments_tenant_isolation ON driver_truck_assignments;
CREATE POLICY driver_truck_assignments_tenant_isolation ON driver_truck_assignments
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP INDEX IF EXISTS dta_tenant_driver_truck_unique;
CREATE UNIQUE INDEX dta_tenant_driver_truck_unique
  ON driver_truck_assignments (tenant_id, driver_id, truck_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_audit_driver_truck_assignments ON driver_truck_assignments;
CREATE TRIGGER trg_audit_driver_truck_assignments
  AFTER INSERT OR UPDATE OR DELETE ON driver_truck_assignments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- documents ----------
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documents_tenant_isolation ON documents;
CREATE POLICY documents_tenant_isolation ON documents
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_owner_type_allowed;
ALTER TABLE documents
  ADD CONSTRAINT documents_owner_type_allowed
  CHECK (owner_type IN ('truck', 'driver', 'vehicle', 'customer', 'account', 'job'));

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_doc_type_allowed;
ALTER TABLE documents
  ADD CONSTRAINT documents_doc_type_allowed
  CHECK (doc_type IN (
    'registration', 'insurance', 'inspection', 'cdl', 'license',
    'medical_card', 'drug_test', 'road_test', 'training_cert',
    'tax_exempt', 'coi', 'photo', 'invoice', 'other'
  ));

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_size_nonneg;
ALTER TABLE documents
  ADD CONSTRAINT documents_size_nonneg
  CHECK (size_bytes >= 0);

DROP TRIGGER IF EXISTS trg_audit_documents ON documents;
CREATE TRIGGER trg_audit_documents
  AFTER INSERT OR UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- dvirs ----------
ALTER TABLE dvirs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvirs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dvirs_tenant_isolation ON dvirs;
CREATE POLICY dvirs_tenant_isolation ON dvirs
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

ALTER TABLE dvirs
  DROP CONSTRAINT IF EXISTS dvirs_type_allowed;
ALTER TABLE dvirs
  ADD CONSTRAINT dvirs_type_allowed
  CHECK (type IN ('pre_trip', 'post_trip'));

ALTER TABLE dvirs
  DROP CONSTRAINT IF EXISTS dvirs_status_allowed;
ALTER TABLE dvirs
  ADD CONSTRAINT dvirs_status_allowed
  CHECK (status IN ('no_defects', 'minor', 'out_of_service'));

ALTER TABLE dvirs
  DROP CONSTRAINT IF EXISTS dvirs_odometer_nonneg;
ALTER TABLE dvirs
  ADD CONSTRAINT dvirs_odometer_nonneg
  CHECK (odometer_reading IS NULL OR odometer_reading >= 0);

DROP TRIGGER IF EXISTS trg_audit_dvirs ON dvirs;
CREATE TRIGGER trg_audit_dvirs
  AFTER INSERT OR UPDATE OR DELETE ON dvirs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- maintenance_schedules ----------
ALTER TABLE maintenance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_schedules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS maintenance_schedules_tenant_isolation ON maintenance_schedules;
CREATE POLICY maintenance_schedules_tenant_isolation ON maintenance_schedules
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

ALTER TABLE maintenance_schedules
  DROP CONSTRAINT IF EXISTS maint_sched_intervals_required;
ALTER TABLE maintenance_schedules
  ADD CONSTRAINT maint_sched_intervals_required
  CHECK (
    (schedule_type = 'mileage' AND interval_miles IS NOT NULL) OR
    (schedule_type = 'time'    AND interval_days IS NOT NULL) OR
    (schedule_type = 'both'    AND interval_miles IS NOT NULL AND interval_days IS NOT NULL)
  );

ALTER TABLE maintenance_schedules
  DROP CONSTRAINT IF EXISTS maint_sched_intervals_positive;
ALTER TABLE maintenance_schedules
  ADD CONSTRAINT maint_sched_intervals_positive
  CHECK (
    (interval_miles IS NULL OR interval_miles > 0) AND
    (interval_days  IS NULL OR interval_days  > 0)
  );

DROP TRIGGER IF EXISTS trg_audit_maintenance_schedules ON maintenance_schedules;
CREATE TRIGGER trg_audit_maintenance_schedules
  AFTER INSERT OR UPDATE OR DELETE ON maintenance_schedules
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- maintenance_records ----------
ALTER TABLE maintenance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS maintenance_records_tenant_isolation ON maintenance_records;
CREATE POLICY maintenance_records_tenant_isolation ON maintenance_records
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

ALTER TABLE maintenance_records
  DROP CONSTRAINT IF EXISTS maint_rec_cost_nonneg;
ALTER TABLE maintenance_records
  ADD CONSTRAINT maint_rec_cost_nonneg
  CHECK (cost_cents >= 0);

ALTER TABLE maintenance_records
  DROP CONSTRAINT IF EXISTS maint_rec_miles_nonneg;
ALTER TABLE maintenance_records
  ADD CONSTRAINT maint_rec_miles_nonneg
  CHECK (performed_miles IS NULL OR performed_miles >= 0);

DROP TRIGGER IF EXISTS trg_audit_maintenance_records ON maintenance_records;
CREATE TRIGGER trg_audit_maintenance_records
  AFTER INSERT OR UPDATE OR DELETE ON maintenance_records
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
