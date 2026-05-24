-- =====================================================================
-- 0039_heavy_duty.sql  (Heavy-Duty Specialist Module — Session 36)
--
-- An HD-aware layer on top of the existing truck / driver / job entities
-- for Class 7/8 + commercial recoveries. NOT a fork: each table hangs off
-- a pre-existing parent (trucks, drivers, jobs) or is tenant-scoped
-- reference data (rate sheets). The dispatch-facing hot-path flag
-- trucks.heavy_duty_capable stays authoritative for the roster scan;
-- hd_truck_capabilities is the rich detail row that eligibility filters
-- on. Setting capabilities flips heavy_duty_capable=true in the service
-- layer (a tenant-scoped UPDATE — no trucks-module/schema change here).
--
-- Tables added:
--   1. hd_truck_capabilities    — per-truck HD equipment / rating (1:1)
--   2. hd_driver_certifications — per-driver HD certs (many, one live per type)
--   3. hd_job_attributes        — per-job HD recovery facts (1:1)
--   4. hd_rate_sheets           — tenant HD rate cards
--
-- Patterns followed (match 0036_impound_storage.sql / 0037_reporting.sql):
--   * tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT.
--   * ENABLE + FORCE ROW LEVEL SECURITY, policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on every table.
--   * Idempotent: CREATE ... IF NOT EXISTS, DROP ... IF EXISTS before every
--     constraint / policy / trigger / index.
--   * Soft delete (deleted_at) everywhere — HD records are operational +
--     financial documents.
--   * Cross-tenant consistency BEFORE-trigger on the three child tables:
--     RLS hides foreign parents from the trigger's SELECT, so a foreign
--     parent id surfaces as "does not exist". hd_rate_sheets has no
--     secondary parent, so the tenant_id FK + RLS policy suffice (no
--     consistency trigger needed).
--   * One shared BEFORE UPDATE updated_at trigger function reused across
--     all four tables (Drizzle's defaultNow() only fires on INSERT).
--
-- Down (rollback):
--   DROP TABLE IF EXISTS hd_job_attributes;
--   DROP TABLE IF EXISTS hd_driver_certifications;
--   DROP TABLE IF EXISTS hd_truck_capabilities;
--   DROP TABLE IF EXISTS hd_rate_sheets;
--   DROP FUNCTION IF EXISTS fn_hd_truck_caps_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_hd_driver_certs_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_hd_job_attrs_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_hd_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper, reused by all four HD tables.
CREATE OR REPLACE FUNCTION fn_hd_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Tenant-consistency guard for hd_truck_capabilities → trucks.
CREATE OR REPLACE FUNCTION fn_hd_truck_caps_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_truck_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_truck_tenant FROM trucks WHERE id = NEW.truck_id;
  IF v_truck_tenant IS NULL THEN
    RAISE EXCEPTION 'hd_truck_capabilities: truck_id % does not exist', NEW.truck_id;
  END IF;
  IF v_truck_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'hd_truck_capabilities: tenant_id (%) does not match trucks.tenant_id (%)',
      NEW.tenant_id, v_truck_tenant;
  END IF;
  RETURN NEW;
END
$$;

-- Tenant-consistency guard for hd_driver_certifications → drivers.
CREATE OR REPLACE FUNCTION fn_hd_driver_certs_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_driver_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_driver_tenant FROM drivers WHERE id = NEW.driver_id;
  IF v_driver_tenant IS NULL THEN
    RAISE EXCEPTION 'hd_driver_certifications: driver_id % does not exist', NEW.driver_id;
  END IF;
  IF v_driver_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'hd_driver_certifications: tenant_id (%) does not match drivers.tenant_id (%)',
      NEW.tenant_id, v_driver_tenant;
  END IF;
  RETURN NEW;
END
$$;

-- Tenant-consistency guard for hd_job_attributes → jobs.
CREATE OR REPLACE FUNCTION fn_hd_job_attrs_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_job_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_job_tenant FROM jobs WHERE id = NEW.job_id;
  IF v_job_tenant IS NULL THEN
    RAISE EXCEPTION 'hd_job_attributes: job_id % does not exist', NEW.job_id;
  END IF;
  IF v_job_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'hd_job_attributes: tenant_id (%) does not match jobs.tenant_id (%)',
      NEW.tenant_id, v_job_tenant;
  END IF;
  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. hd_truck_capabilities
-- ---------------------------------------------------------------------
-- The HD detail row for a wrecker. One live row per truck. gvwr_class is
-- the FMCSA categorical class (3-8) the truck is rated to recover;
-- max_recovery_weight_lbs is the operator-stated rated recovery weight.
-- has_rotator / has_under_lift / has_air_cushions are the equipment gates
-- eligibility filters on. heavy_duty_capable on trucks is kept in sync by
-- the service layer (set true when a capabilities row is written).

CREATE TABLE IF NOT EXISTS hd_truck_capabilities (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  truck_id                 uuid NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  gvwr_class               integer,
  winch_capacity_lbs       integer,
  boom_capacity_lbs        integer,
  has_rotator              boolean NOT NULL DEFAULT false,
  has_under_lift           boolean NOT NULL DEFAULT false,
  has_air_cushions         boolean NOT NULL DEFAULT false,
  axle_count               integer,
  max_recovery_weight_lbs  integer,
  notes                    text,
  created_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

ALTER TABLE hd_truck_capabilities DROP CONSTRAINT IF EXISTS hd_truck_capabilities_gvwr_class_chk;
ALTER TABLE hd_truck_capabilities ADD CONSTRAINT hd_truck_capabilities_gvwr_class_chk
  CHECK (gvwr_class IS NULL OR (gvwr_class >= 3 AND gvwr_class <= 8));

ALTER TABLE hd_truck_capabilities DROP CONSTRAINT IF EXISTS hd_truck_capabilities_winch_nonneg;
ALTER TABLE hd_truck_capabilities ADD CONSTRAINT hd_truck_capabilities_winch_nonneg
  CHECK (winch_capacity_lbs IS NULL OR winch_capacity_lbs >= 0);

ALTER TABLE hd_truck_capabilities DROP CONSTRAINT IF EXISTS hd_truck_capabilities_boom_nonneg;
ALTER TABLE hd_truck_capabilities ADD CONSTRAINT hd_truck_capabilities_boom_nonneg
  CHECK (boom_capacity_lbs IS NULL OR boom_capacity_lbs >= 0);

ALTER TABLE hd_truck_capabilities DROP CONSTRAINT IF EXISTS hd_truck_capabilities_axle_positive;
ALTER TABLE hd_truck_capabilities ADD CONSTRAINT hd_truck_capabilities_axle_positive
  CHECK (axle_count IS NULL OR axle_count > 0);

ALTER TABLE hd_truck_capabilities DROP CONSTRAINT IF EXISTS hd_truck_capabilities_max_recovery_nonneg;
ALTER TABLE hd_truck_capabilities ADD CONSTRAINT hd_truck_capabilities_max_recovery_nonneg
  CHECK (max_recovery_weight_lbs IS NULL OR max_recovery_weight_lbs >= 0);

-- One live capabilities row per truck.
DROP INDEX IF EXISTS hd_truck_capabilities_truck_unique;
CREATE UNIQUE INDEX hd_truck_capabilities_truck_unique
  ON hd_truck_capabilities (truck_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS hd_truck_capabilities_tenant_idx
  ON hd_truck_capabilities (tenant_id)
  WHERE deleted_at IS NULL;

ALTER TABLE hd_truck_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE hd_truck_capabilities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hd_truck_capabilities_tenant_isolation ON hd_truck_capabilities;
CREATE POLICY hd_truck_capabilities_tenant_isolation ON hd_truck_capabilities
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_hd_truck_caps_tenant_consistency ON hd_truck_capabilities;
CREATE TRIGGER trg_hd_truck_caps_tenant_consistency
  BEFORE INSERT OR UPDATE ON hd_truck_capabilities
  FOR EACH ROW EXECUTE FUNCTION fn_hd_truck_caps_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_hd_truck_capabilities ON hd_truck_capabilities;
CREATE TRIGGER trg_audit_hd_truck_capabilities
  AFTER INSERT OR UPDATE OR DELETE ON hd_truck_capabilities
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_hd_truck_capabilities_set_updated_at ON hd_truck_capabilities;
CREATE TRIGGER trg_hd_truck_capabilities_set_updated_at
  BEFORE UPDATE ON hd_truck_capabilities
  FOR EACH ROW EXECUTE FUNCTION fn_hd_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. hd_driver_certifications
-- ---------------------------------------------------------------------
-- HD certifications a driver holds. One LIVE row per (driver, cert_type):
-- recording a renewed cert of the same type supersedes the prior live row
-- (the service soft-deletes / overwrites). issued_at / expires_at are
-- calendar dates (a cert is valid for the whole day it expires);
-- verified_at + verified_by record the operator who checked the document
-- behind doc_key.

CREATE TABLE IF NOT EXISTS hd_driver_certifications (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  driver_id     uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  cert_type     text NOT NULL,
  issued_at     date,
  expires_at    date,
  doc_key       text,
  verified_at   timestamptz,
  verified_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  notes         text,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

ALTER TABLE hd_driver_certifications DROP CONSTRAINT IF EXISTS hd_driver_certifications_cert_type_chk;
ALTER TABLE hd_driver_certifications ADD CONSTRAINT hd_driver_certifications_cert_type_chk
  CHECK (cert_type IN ('hd_operator', 'rotator', 'hazmat', 'cdl_a', 'cdl_b'));

-- expires_at, when present, must not precede issued_at.
ALTER TABLE hd_driver_certifications DROP CONSTRAINT IF EXISTS hd_driver_certifications_dates_sane;
ALTER TABLE hd_driver_certifications ADD CONSTRAINT hd_driver_certifications_dates_sane
  CHECK (issued_at IS NULL OR expires_at IS NULL OR expires_at >= issued_at);

-- One live cert per (driver, cert_type).
DROP INDEX IF EXISTS hd_driver_certifications_driver_type_unique;
CREATE UNIQUE INDEX hd_driver_certifications_driver_type_unique
  ON hd_driver_certifications (driver_id, cert_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS hd_driver_certifications_tenant_driver_idx
  ON hd_driver_certifications (tenant_id, driver_id)
  WHERE deleted_at IS NULL;

-- Cert-expiry roster / cron sweep target.
CREATE INDEX IF NOT EXISTS hd_driver_certifications_expiry_idx
  ON hd_driver_certifications (expires_at)
  WHERE deleted_at IS NULL;

ALTER TABLE hd_driver_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE hd_driver_certifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hd_driver_certifications_tenant_isolation ON hd_driver_certifications;
CREATE POLICY hd_driver_certifications_tenant_isolation ON hd_driver_certifications
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_hd_driver_certs_tenant_consistency ON hd_driver_certifications;
CREATE TRIGGER trg_hd_driver_certs_tenant_consistency
  BEFORE INSERT OR UPDATE ON hd_driver_certifications
  FOR EACH ROW EXECUTE FUNCTION fn_hd_driver_certs_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_hd_driver_certifications ON hd_driver_certifications;
CREATE TRIGGER trg_audit_hd_driver_certifications
  AFTER INSERT OR UPDATE OR DELETE ON hd_driver_certifications
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_hd_driver_certifications_set_updated_at ON hd_driver_certifications;
CREATE TRIGGER trg_hd_driver_certifications_set_updated_at
  BEFORE UPDATE ON hd_driver_certifications
  FOR EACH ROW EXECUTE FUNCTION fn_hd_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. hd_job_attributes
-- ---------------------------------------------------------------------
-- The HD recovery facts for a job. One live row per job. Added ALONGSIDE
-- jobs (no jobs-table change). vehicle_class is the FMCSA class of the
-- towed/recovered unit; requires_* are the operator-declared needs that
-- eligibility filters trucks + drivers against. on_scene_estimate_cents
-- and final_invoice_cents are the HD ticket lifecycle (estimate → final).
-- requires_dot_report flags DOT-report linkage (rendering is Session 37).

CREATE TABLE IF NOT EXISTS hd_job_attributes (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id                   uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  vehicle_class            integer,
  vehicle_gvwr_lbs         integer,
  vehicle_axle_count       integer,
  incident_type            text,
  cargo_type               text,
  requires_rotator         boolean NOT NULL DEFAULT false,
  requires_hazmat          boolean NOT NULL DEFAULT false,
  requires_dot_report      boolean NOT NULL DEFAULT false,
  on_scene_estimate_cents  bigint,
  final_invoice_cents      bigint,
  notes                    text,
  created_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

ALTER TABLE hd_job_attributes DROP CONSTRAINT IF EXISTS hd_job_attributes_vehicle_class_chk;
ALTER TABLE hd_job_attributes ADD CONSTRAINT hd_job_attributes_vehicle_class_chk
  CHECK (vehicle_class IS NULL OR (vehicle_class >= 1 AND vehicle_class <= 8));

ALTER TABLE hd_job_attributes DROP CONSTRAINT IF EXISTS hd_job_attributes_incident_type_chk;
ALTER TABLE hd_job_attributes ADD CONSTRAINT hd_job_attributes_incident_type_chk
  CHECK (
    incident_type IS NULL
    OR incident_type IN ('overturn', 'underride', 'jackknife', 'load_shift', 'fire', 'water', 'other')
  );

ALTER TABLE hd_job_attributes DROP CONSTRAINT IF EXISTS hd_job_attributes_gvwr_nonneg;
ALTER TABLE hd_job_attributes ADD CONSTRAINT hd_job_attributes_gvwr_nonneg
  CHECK (vehicle_gvwr_lbs IS NULL OR vehicle_gvwr_lbs >= 0);

ALTER TABLE hd_job_attributes DROP CONSTRAINT IF EXISTS hd_job_attributes_axle_positive;
ALTER TABLE hd_job_attributes ADD CONSTRAINT hd_job_attributes_axle_positive
  CHECK (vehicle_axle_count IS NULL OR vehicle_axle_count > 0);

ALTER TABLE hd_job_attributes DROP CONSTRAINT IF EXISTS hd_job_attributes_estimate_nonneg;
ALTER TABLE hd_job_attributes ADD CONSTRAINT hd_job_attributes_estimate_nonneg
  CHECK (on_scene_estimate_cents IS NULL OR on_scene_estimate_cents >= 0);

ALTER TABLE hd_job_attributes DROP CONSTRAINT IF EXISTS hd_job_attributes_invoice_nonneg;
ALTER TABLE hd_job_attributes ADD CONSTRAINT hd_job_attributes_invoice_nonneg
  CHECK (final_invoice_cents IS NULL OR final_invoice_cents >= 0);

-- One live HD attribute row per job.
DROP INDEX IF EXISTS hd_job_attributes_job_unique;
CREATE UNIQUE INDEX hd_job_attributes_job_unique
  ON hd_job_attributes (job_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS hd_job_attributes_tenant_idx
  ON hd_job_attributes (tenant_id)
  WHERE deleted_at IS NULL;

-- "HD jobs by month" report range scan.
CREATE INDEX IF NOT EXISTS hd_job_attributes_tenant_created_idx
  ON hd_job_attributes (tenant_id, created_at)
  WHERE deleted_at IS NULL;

ALTER TABLE hd_job_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hd_job_attributes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hd_job_attributes_tenant_isolation ON hd_job_attributes;
CREATE POLICY hd_job_attributes_tenant_isolation ON hd_job_attributes
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_hd_job_attrs_tenant_consistency ON hd_job_attributes;
CREATE TRIGGER trg_hd_job_attrs_tenant_consistency
  BEFORE INSERT OR UPDATE ON hd_job_attributes
  FOR EACH ROW EXECUTE FUNCTION fn_hd_job_attrs_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_hd_job_attributes ON hd_job_attributes;
CREATE TRIGGER trg_audit_hd_job_attributes
  AFTER INSERT OR UPDATE OR DELETE ON hd_job_attributes
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_hd_job_attributes_set_updated_at ON hd_job_attributes;
CREATE TRIGGER trg_hd_job_attributes_set_updated_at
  BEFORE UPDATE ON hd_job_attributes
  FOR EACH ROW EXECUTE FUNCTION fn_hd_set_updated_at();


-- ---------------------------------------------------------------------
-- 4. hd_rate_sheets
-- ---------------------------------------------------------------------
-- Tenant HD rate cards the on-scene estimate generator + final invoice
-- price from. All money is cents-per-unit (per hour / per mile / flat).
-- after_hours_multiplier + holiday_multiplier scale the whole ticket;
-- numeric(4,2), constrained to [1.00, 10.00]. Tenant-scoped reference
-- data: no secondary parent, so RLS + the tenant_id FK are the isolation
-- guarantee (no cross-tenant consistency trigger needed).

CREATE TABLE IF NOT EXISTS hd_rate_sheets (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name                     text NOT NULL,
  hourly_rate_cents        integer NOT NULL DEFAULT 0,
  hookup_fee_cents         integer NOT NULL DEFAULT 0,
  winching_per_hr_cents    integer NOT NULL DEFAULT 0,
  recovery_per_hr_cents    integer NOT NULL DEFAULT 0,
  rotator_per_hr_cents     integer NOT NULL DEFAULT 0,
  mileage_loaded_cents     integer NOT NULL DEFAULT 0,
  mileage_deadhead_cents   integer NOT NULL DEFAULT 0,
  after_hours_multiplier   numeric(4, 2) NOT NULL DEFAULT 1.00,
  holiday_multiplier       numeric(4, 2) NOT NULL DEFAULT 1.00,
  is_active                boolean NOT NULL DEFAULT true,
  notes                    text,
  created_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

ALTER TABLE hd_rate_sheets DROP CONSTRAINT IF EXISTS hd_rate_sheets_name_nonempty;
ALTER TABLE hd_rate_sheets ADD CONSTRAINT hd_rate_sheets_name_nonempty
  CHECK (length(trim(name)) > 0);

ALTER TABLE hd_rate_sheets DROP CONSTRAINT IF EXISTS hd_rate_sheets_cents_nonneg;
ALTER TABLE hd_rate_sheets ADD CONSTRAINT hd_rate_sheets_cents_nonneg
  CHECK (
    hourly_rate_cents >= 0
    AND hookup_fee_cents >= 0
    AND winching_per_hr_cents >= 0
    AND recovery_per_hr_cents >= 0
    AND rotator_per_hr_cents >= 0
    AND mileage_loaded_cents >= 0
    AND mileage_deadhead_cents >= 0
  );

ALTER TABLE hd_rate_sheets DROP CONSTRAINT IF EXISTS hd_rate_sheets_multipliers_range;
ALTER TABLE hd_rate_sheets ADD CONSTRAINT hd_rate_sheets_multipliers_range
  CHECK (
    after_hours_multiplier >= 1.00 AND after_hours_multiplier <= 10.00
    AND holiday_multiplier >= 1.00 AND holiday_multiplier <= 10.00
  );

-- One live rate sheet per (tenant, name).
DROP INDEX IF EXISTS hd_rate_sheets_tenant_name_unique;
CREATE UNIQUE INDEX hd_rate_sheets_tenant_name_unique
  ON hd_rate_sheets (tenant_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS hd_rate_sheets_tenant_active_idx
  ON hd_rate_sheets (tenant_id, is_active)
  WHERE deleted_at IS NULL;

ALTER TABLE hd_rate_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE hd_rate_sheets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hd_rate_sheets_tenant_isolation ON hd_rate_sheets;
CREATE POLICY hd_rate_sheets_tenant_isolation ON hd_rate_sheets
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_hd_rate_sheets ON hd_rate_sheets;
CREATE TRIGGER trg_audit_hd_rate_sheets
  AFTER INSERT OR UPDATE OR DELETE ON hd_rate_sheets
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_hd_rate_sheets_set_updated_at ON hd_rate_sheets;
CREATE TRIGGER trg_hd_rate_sheets_set_updated_at
  BEFORE UPDATE ON hd_rate_sheets
  FOR EACH ROW EXECUTE FUNCTION fn_hd_set_updated_at();
