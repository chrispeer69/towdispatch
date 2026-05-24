-- =====================================================================
-- 0040_dot_compliance.sql  (Full DOT Compliance — Session 37)
--
-- FMCSA / DOT recordkeeping & reporting for commercial carriers. Pure
-- recordkeeping — no live ELD integration this session (HOS is entered
-- manually). Tables added:
--   1. dot_carrier_profile        — one row per tenant (USDOT/MC, type, rating)
--   2. dot_driver_qualifications  — 1:1 DQ-file EXTENSION of drivers (see below)
--   3. dot_hos_logs               — hours-of-service duty-status entries
--   4. dot_drug_alcohol_tests     — drug & alcohol program test records
--   5. dot_incident_reports       — DOT-recordable accident/incident reports
--
-- DVIR is NOT added here. A complete DVIR system-of-record already exists
-- on master (`dvirs` table + apps/api/src/modules/fleet/dvirs.service.ts +
-- the apps/web .../fleet/dvirs entry page, from the driver-app sessions).
-- The DOT audit packet and the "open DVIR defects" report READ that table;
-- adding dot_dvir would create a second source of truth. See
-- SESSION_37_DECISIONS.md.
--
-- dot_driver_qualifications is an EXTENSION, not a duplicate. The `drivers`
-- table already carries cdl_class, license_*, medical_card_expires_at,
-- drug_test_last_at, road_test_completed_at, certifications. This table
-- holds ONLY the DQ-file fields drivers lacks: the file-review status, the
-- signed-employment-application date, and the MVR pull/expiry. The
-- dq-completeness function reads BOTH rows. (SESSION_37_DECISIONS.md.)
--
-- Patterns followed (match 0036_impound_storage.sql / 0037_reporting.sql):
--   * Every table: tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE RESTRICT.
--   * Every table: ENABLE + FORCE ROW LEVEL SECURITY, policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on every table.
--   * Idempotent: CREATE ... IF NOT EXISTS; every constraint/policy/
--     trigger/index preceded by DROP ... IF EXISTS.
--   * Soft delete (deleted_at) everywhere — DOT records are legal records
--     with multi-year retention requirements (FMCSA: DQ 3yr post-term,
--     HOS 6 months, drug/alcohol 5yr, accident register 3yr).
--   * Cross-tenant consistency BEFORE-trigger on every table with an FK to
--     another tenant-scoped table (drivers/trucks/jobs): the FK proves the
--     row exists, not that its tenant matches. RLS hides foreign parents,
--     so a foreign id surfaces as "does not exist".
--   * One shared BEFORE UPDATE updated_at stamper (Drizzle defaultNow()
--     only fires on INSERT).
--
-- Migration numbering: 0040. 0038 (lien-processing, Session 23) and 0039
-- (heavy-duty, Session 36) live on parallel feature branches not yet on
-- master; 0040 reserves room for them and avoids a duplicate number when
-- they merge. This file only depends on tables already on master
-- (tenants, users, drivers, trucks, jobs).
--
-- Down (rollback):
--   DROP TABLE IF EXISTS dot_incident_reports;
--   DROP TABLE IF EXISTS dot_drug_alcohol_tests;
--   DROP TABLE IF EXISTS dot_hos_logs;
--   DROP TABLE IF EXISTS dot_driver_qualifications;
--   DROP TABLE IF EXISTS dot_carrier_profile;
--   DROP FUNCTION IF EXISTS fn_dot_incident_consistency();
--   DROP FUNCTION IF EXISTS fn_dot_hos_consistency();
--   DROP FUNCTION IF EXISTS fn_dot_driver_consistency();
--   DROP FUNCTION IF EXISTS fn_dot_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper, reused by all DOT tables.
CREATE OR REPLACE FUNCTION fn_dot_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Tenant-consistency guard for tables whose only foreign tenant-scoped FK
-- is driver_id (dot_driver_qualifications, dot_drug_alcohol_tests).
CREATE OR REPLACE FUNCTION fn_dot_driver_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_driver_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_driver_tenant FROM drivers WHERE id = NEW.driver_id;
  IF v_driver_tenant IS NULL THEN
    RAISE EXCEPTION 'dot: driver_id % does not exist', NEW.driver_id;
  END IF;
  IF v_driver_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'dot: tenant_id (%) does not match drivers.tenant_id (%)',
      NEW.tenant_id, v_driver_tenant;
  END IF;
  RETURN NEW;
END
$$;

-- Consistency guard for dot_hos_logs: driver_id (required) + vehicle_id
-- (optional, references trucks) must both belong to the row's tenant.
CREATE OR REPLACE FUNCTION fn_dot_hos_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_driver_tenant uuid;
  v_truck_tenant  uuid;
BEGIN
  SELECT tenant_id INTO v_driver_tenant FROM drivers WHERE id = NEW.driver_id;
  IF v_driver_tenant IS NULL THEN
    RAISE EXCEPTION 'dot_hos_logs: driver_id % does not exist', NEW.driver_id;
  END IF;
  IF v_driver_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'dot_hos_logs: tenant_id (%) does not match drivers.tenant_id (%)',
      NEW.tenant_id, v_driver_tenant;
  END IF;

  IF NEW.vehicle_id IS NOT NULL THEN
    SELECT tenant_id INTO v_truck_tenant FROM trucks WHERE id = NEW.vehicle_id;
    IF v_truck_tenant IS NULL THEN
      RAISE EXCEPTION 'dot_hos_logs: vehicle_id % does not exist', NEW.vehicle_id;
    END IF;
    IF v_truck_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'dot_hos_logs: tenant_id (%) does not match trucks.tenant_id (%)',
        NEW.tenant_id, v_truck_tenant;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Consistency guard for dot_incident_reports: job_id / driver_id / truck_id
-- are all optional but, when present, must belong to the row's tenant.
CREATE OR REPLACE FUNCTION fn_dot_incident_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF NEW.job_id IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant FROM jobs WHERE id = NEW.job_id;
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'dot_incident_reports: job_id % does not exist', NEW.job_id;
    END IF;
    IF v_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'dot_incident_reports: tenant_id (%) does not match jobs.tenant_id (%)',
        NEW.tenant_id, v_tenant;
    END IF;
  END IF;

  IF NEW.driver_id IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant FROM drivers WHERE id = NEW.driver_id;
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'dot_incident_reports: driver_id % does not exist', NEW.driver_id;
    END IF;
    IF v_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'dot_incident_reports: tenant_id (%) does not match drivers.tenant_id (%)',
        NEW.tenant_id, v_tenant;
    END IF;
  END IF;

  IF NEW.truck_id IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant FROM trucks WHERE id = NEW.truck_id;
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'dot_incident_reports: truck_id % does not exist', NEW.truck_id;
    END IF;
    IF v_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'dot_incident_reports: tenant_id (%) does not match trucks.tenant_id (%)',
        NEW.tenant_id, v_tenant;
    END IF;
  END IF;
  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. dot_carrier_profile
-- ---------------------------------------------------------------------
-- One row per tenant (partial-unique on tenant_id). Modeled with an `id`
-- PK + UNIQUE(tenant_id) rather than tenant_id-as-PK so fn_audit_log() can
-- record a meaningful resource_id and the row matches every other table's
-- shape. operating_classification is a jsonb array of FMCSA operating
-- classifications (e.g. ["authorized_for_hire","us_mail"]).

CREATE TABLE IF NOT EXISTS dot_carrier_profile (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  usdot_number             text,
  mc_number                text,
  legal_name               text NOT NULL,
  dba_name                 text,
  carrier_type             text NOT NULL DEFAULT 'authorized_for_hire',
  operating_classification jsonb NOT NULL DEFAULT '[]',
  safety_rating            text,
  last_audited_at          timestamptz,
  created_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

ALTER TABLE dot_carrier_profile DROP CONSTRAINT IF EXISTS dot_carrier_profile_legal_name_nonempty;
ALTER TABLE dot_carrier_profile ADD CONSTRAINT dot_carrier_profile_legal_name_nonempty
  CHECK (length(trim(legal_name)) > 0);

ALTER TABLE dot_carrier_profile DROP CONSTRAINT IF EXISTS dot_carrier_profile_carrier_type_chk;
ALTER TABLE dot_carrier_profile ADD CONSTRAINT dot_carrier_profile_carrier_type_chk
  CHECK (carrier_type IN ('authorized_for_hire', 'private', 'exempt'));

ALTER TABLE dot_carrier_profile DROP CONSTRAINT IF EXISTS dot_carrier_profile_safety_rating_chk;
ALTER TABLE dot_carrier_profile ADD CONSTRAINT dot_carrier_profile_safety_rating_chk
  CHECK (safety_rating IS NULL OR safety_rating IN ('satisfactory', 'conditional', 'unsatisfactory', 'unrated'));

-- One live carrier profile per tenant.
DROP INDEX IF EXISTS dot_carrier_profile_tenant_unique;
CREATE UNIQUE INDEX dot_carrier_profile_tenant_unique
  ON dot_carrier_profile (tenant_id)
  WHERE deleted_at IS NULL;

ALTER TABLE dot_carrier_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE dot_carrier_profile FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dot_carrier_profile_tenant_isolation ON dot_carrier_profile;
CREATE POLICY dot_carrier_profile_tenant_isolation ON dot_carrier_profile
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_dot_carrier_profile ON dot_carrier_profile;
CREATE TRIGGER trg_audit_dot_carrier_profile
  AFTER INSERT OR UPDATE OR DELETE ON dot_carrier_profile
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_dot_carrier_profile_set_updated_at ON dot_carrier_profile;
CREATE TRIGGER trg_dot_carrier_profile_set_updated_at
  BEFORE UPDATE ON dot_carrier_profile
  FOR EACH ROW EXECUTE FUNCTION fn_dot_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. dot_driver_qualifications  (1:1 extension of drivers)
-- ---------------------------------------------------------------------
-- The DQ-file fields the `drivers` table doesn't already carry. License,
-- CDL class, medical-card expiry, drug-test and road-test dates live on
-- `drivers` and are NOT copied here (single source of truth). One live
-- row per driver.

CREATE TABLE IF NOT EXISTS dot_driver_qualifications (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  driver_id                uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  dq_file_status           text NOT NULL DEFAULT 'incomplete',
  employment_app_signed_at timestamptz,
  mvr_pulled_at            timestamptz,
  mvr_expires_at           timestamptz,
  notes                    text,
  created_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

ALTER TABLE dot_driver_qualifications DROP CONSTRAINT IF EXISTS dot_driver_qualifications_status_chk;
ALTER TABLE dot_driver_qualifications ADD CONSTRAINT dot_driver_qualifications_status_chk
  CHECK (dq_file_status IN ('incomplete', 'complete', 'on_hold'));

-- One live DQ extension per driver.
DROP INDEX IF EXISTS dot_driver_qualifications_driver_unique;
CREATE UNIQUE INDEX dot_driver_qualifications_driver_unique
  ON dot_driver_qualifications (driver_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS dot_driver_qualifications_tenant_idx
  ON dot_driver_qualifications (tenant_id)
  WHERE deleted_at IS NULL;

ALTER TABLE dot_driver_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE dot_driver_qualifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dot_driver_qualifications_tenant_isolation ON dot_driver_qualifications;
CREATE POLICY dot_driver_qualifications_tenant_isolation ON dot_driver_qualifications
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_dot_driver_qualifications_consistency ON dot_driver_qualifications;
CREATE TRIGGER trg_dot_driver_qualifications_consistency
  BEFORE INSERT OR UPDATE ON dot_driver_qualifications
  FOR EACH ROW EXECUTE FUNCTION fn_dot_driver_consistency();

DROP TRIGGER IF EXISTS trg_audit_dot_driver_qualifications ON dot_driver_qualifications;
CREATE TRIGGER trg_audit_dot_driver_qualifications
  AFTER INSERT OR UPDATE OR DELETE ON dot_driver_qualifications
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_dot_driver_qualifications_set_updated_at ON dot_driver_qualifications;
CREATE TRIGGER trg_dot_driver_qualifications_set_updated_at
  BEFORE UPDATE ON dot_driver_qualifications
  FOR EACH ROW EXECUTE FUNCTION fn_dot_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. dot_hos_logs
-- ---------------------------------------------------------------------
-- Hours-of-service duty-status entries (manual entry — no ELD this
-- session). One row per duty-status segment; the HOS validator rolls a
-- driver's entries into a week and flags 11h/14h/30-min/60-70h violations.
-- vehicle_id references trucks (the commercial motor vehicle driven).

CREATE TABLE IF NOT EXISTS dot_hos_logs (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  driver_id     uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  log_date      date NOT NULL,
  status        text NOT NULL,
  start_at      timestamptz NOT NULL,
  end_at        timestamptz,
  miles_driven  integer,
  vehicle_id    uuid REFERENCES trucks(id) ON DELETE SET NULL,
  location_text text,
  remarks       text,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

ALTER TABLE dot_hos_logs DROP CONSTRAINT IF EXISTS dot_hos_logs_status_chk;
ALTER TABLE dot_hos_logs ADD CONSTRAINT dot_hos_logs_status_chk
  CHECK (status IN ('off_duty', 'sleeper', 'driving', 'on_duty_not_driving'));

ALTER TABLE dot_hos_logs DROP CONSTRAINT IF EXISTS dot_hos_logs_end_after_start;
ALTER TABLE dot_hos_logs ADD CONSTRAINT dot_hos_logs_end_after_start
  CHECK (end_at IS NULL OR end_at >= start_at);

ALTER TABLE dot_hos_logs DROP CONSTRAINT IF EXISTS dot_hos_logs_miles_nonneg;
ALTER TABLE dot_hos_logs ADD CONSTRAINT dot_hos_logs_miles_nonneg
  CHECK (miles_driven IS NULL OR miles_driven >= 0);

CREATE INDEX IF NOT EXISTS dot_hos_logs_tenant_driver_date_idx
  ON dot_hos_logs (tenant_id, driver_id, log_date)
  WHERE deleted_at IS NULL;

ALTER TABLE dot_hos_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dot_hos_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dot_hos_logs_tenant_isolation ON dot_hos_logs;
CREATE POLICY dot_hos_logs_tenant_isolation ON dot_hos_logs
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_dot_hos_logs_consistency ON dot_hos_logs;
CREATE TRIGGER trg_dot_hos_logs_consistency
  BEFORE INSERT OR UPDATE ON dot_hos_logs
  FOR EACH ROW EXECUTE FUNCTION fn_dot_hos_consistency();

DROP TRIGGER IF EXISTS trg_audit_dot_hos_logs ON dot_hos_logs;
CREATE TRIGGER trg_audit_dot_hos_logs
  AFTER INSERT OR UPDATE OR DELETE ON dot_hos_logs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_dot_hos_logs_set_updated_at ON dot_hos_logs;
CREATE TRIGGER trg_dot_hos_logs_set_updated_at
  BEFORE UPDATE ON dot_hos_logs
  FOR EACH ROW EXECUTE FUNCTION fn_dot_set_updated_at();


-- ---------------------------------------------------------------------
-- 4. dot_drug_alcohol_tests
-- ---------------------------------------------------------------------
-- Drug & alcohol program test records (49 CFR Part 382). Log-only — no
-- consortium/C-TPA integration this session. doc_key references the stored
-- chain-of-custody document in object storage.

CREATE TABLE IF NOT EXISTS dot_drug_alcohol_tests (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  driver_id    uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  test_type    text NOT NULL,
  collected_at timestamptz NOT NULL,
  result       text NOT NULL,
  lab          text,
  doc_key      text,
  notes        text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

ALTER TABLE dot_drug_alcohol_tests DROP CONSTRAINT IF EXISTS dot_drug_alcohol_tests_type_chk;
ALTER TABLE dot_drug_alcohol_tests ADD CONSTRAINT dot_drug_alcohol_tests_type_chk
  CHECK (test_type IN ('pre_employment', 'random', 'reasonable_suspicion', 'post_accident', 'return_to_duty', 'follow_up'));

ALTER TABLE dot_drug_alcohol_tests DROP CONSTRAINT IF EXISTS dot_drug_alcohol_tests_result_chk;
ALTER TABLE dot_drug_alcohol_tests ADD CONSTRAINT dot_drug_alcohol_tests_result_chk
  CHECK (result IN ('negative', 'positive', 'refused', 'cancelled'));

CREATE INDEX IF NOT EXISTS dot_drug_alcohol_tests_tenant_driver_idx
  ON dot_drug_alcohol_tests (tenant_id, driver_id, collected_at)
  WHERE deleted_at IS NULL;

ALTER TABLE dot_drug_alcohol_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE dot_drug_alcohol_tests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dot_drug_alcohol_tests_tenant_isolation ON dot_drug_alcohol_tests;
CREATE POLICY dot_drug_alcohol_tests_tenant_isolation ON dot_drug_alcohol_tests
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_dot_drug_alcohol_tests_consistency ON dot_drug_alcohol_tests;
CREATE TRIGGER trg_dot_drug_alcohol_tests_consistency
  BEFORE INSERT OR UPDATE ON dot_drug_alcohol_tests
  FOR EACH ROW EXECUTE FUNCTION fn_dot_driver_consistency();

DROP TRIGGER IF EXISTS trg_audit_dot_drug_alcohol_tests ON dot_drug_alcohol_tests;
CREATE TRIGGER trg_audit_dot_drug_alcohol_tests
  AFTER INSERT OR UPDATE OR DELETE ON dot_drug_alcohol_tests
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_dot_drug_alcohol_tests_set_updated_at ON dot_drug_alcohol_tests;
CREATE TRIGGER trg_dot_drug_alcohol_tests_set_updated_at
  BEFORE UPDATE ON dot_drug_alcohol_tests
  FOR EACH ROW EXECUTE FUNCTION fn_dot_set_updated_at();


-- ---------------------------------------------------------------------
-- 5. dot_incident_reports
-- ---------------------------------------------------------------------
-- Accident/incident register (49 CFR 390.15). job_id / driver_id /
-- truck_id are optional (an incident may predate a dispatched job or
-- involve an unassigned unit). dot_reportable is the operator's recorded
-- determination (FMCSA: a recordable accident = fatality, injury treated
-- away from scene, or a vehicle towed from the scene).

CREATE TABLE IF NOT EXISTS dot_incident_reports (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id         uuid REFERENCES jobs(id) ON DELETE SET NULL,
  driver_id      uuid REFERENCES drivers(id) ON DELETE SET NULL,
  truck_id       uuid REFERENCES trucks(id) ON DELETE SET NULL,
  occurred_at    timestamptz NOT NULL,
  location_text  text,
  severity       text NOT NULL DEFAULT 'property_damage',
  fatalities     integer NOT NULL DEFAULT 0,
  injuries       integer NOT NULL DEFAULT 0,
  hazmat_release boolean NOT NULL DEFAULT false,
  towed_away     boolean NOT NULL DEFAULT false,
  narrative      text,
  dot_reportable boolean NOT NULL DEFAULT false,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

ALTER TABLE dot_incident_reports DROP CONSTRAINT IF EXISTS dot_incident_reports_severity_chk;
ALTER TABLE dot_incident_reports ADD CONSTRAINT dot_incident_reports_severity_chk
  CHECK (severity IN ('property_damage', 'injury', 'fatality'));

ALTER TABLE dot_incident_reports DROP CONSTRAINT IF EXISTS dot_incident_reports_fatalities_nonneg;
ALTER TABLE dot_incident_reports ADD CONSTRAINT dot_incident_reports_fatalities_nonneg
  CHECK (fatalities >= 0);

ALTER TABLE dot_incident_reports DROP CONSTRAINT IF EXISTS dot_incident_reports_injuries_nonneg;
ALTER TABLE dot_incident_reports ADD CONSTRAINT dot_incident_reports_injuries_nonneg
  CHECK (injuries >= 0);

CREATE INDEX IF NOT EXISTS dot_incident_reports_tenant_occurred_idx
  ON dot_incident_reports (tenant_id, occurred_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS dot_incident_reports_tenant_reportable_idx
  ON dot_incident_reports (tenant_id, dot_reportable)
  WHERE deleted_at IS NULL;

ALTER TABLE dot_incident_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE dot_incident_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dot_incident_reports_tenant_isolation ON dot_incident_reports;
CREATE POLICY dot_incident_reports_tenant_isolation ON dot_incident_reports
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_dot_incident_reports_consistency ON dot_incident_reports;
CREATE TRIGGER trg_dot_incident_reports_consistency
  BEFORE INSERT OR UPDATE ON dot_incident_reports
  FOR EACH ROW EXECUTE FUNCTION fn_dot_incident_consistency();

DROP TRIGGER IF EXISTS trg_audit_dot_incident_reports ON dot_incident_reports;
CREATE TRIGGER trg_audit_dot_incident_reports
  AFTER INSERT OR UPDATE OR DELETE ON dot_incident_reports
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_dot_incident_reports_set_updated_at ON dot_incident_reports;
CREATE TRIGGER trg_dot_incident_reports_set_updated_at
  BEFORE UPDATE ON dot_incident_reports
  FOR EACH ROW EXECUTE FUNCTION fn_dot_set_updated_at();
