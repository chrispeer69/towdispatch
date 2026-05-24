-- =====================================================================
-- 0042_ev_recovery.sql  (EV-Specific Recovery Workflows — Session 48)
--
-- Electric vehicles need different recovery handling: flatbed-only towing
-- (no wheel-down past a short distance — regenerative-braking motors are
-- damaged by being rolled), HV-disconnect awareness, thermal-event
-- monitoring, charge-state intake, and OEM-specific tow modes. This
-- migration adds the EV-aware data layer on top of the existing dispatch
-- (jobs) module without touching dispatch core.
--
-- IMPORTANT — the OEM tow-mode / HV-disconnect steps seeded here are
-- best-effort, sourced from public OEM towing guidance, and MUST be
-- verified against the current OEM service manual before a tech relies on
-- them in the field. Every seed row carries last_verified_at; the equipment
-- rule engine defaults UNKNOWN EVs to flatbed-only. See SESSION_48_DECISIONS.md.
--
-- Tables added:
--   1. ev_oem_procedures       — per-make/model/year-range OEM tow guidance
--                                (GLOBAL reference data; NOT tenant-scoped,
--                                no RLS — same as lien_state_rules).
--   2. ev_job_attributes       — one row per EV job: chemistry, SOC, HV
--                                isolation, tow-mode, OEM-ack. FK to jobs.
--   3. ev_thermal_events       — observed battery thermal events on a job.
--   4. ev_charge_station_visits — charge stops during long-haul transport.
--
-- Patterns followed (match 0038_lien_processing.sql exactly):
--   * Every tenant table: tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE RESTRICT; ENABLE + FORCE ROW LEVEL SECURITY; policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on every tenant table.
--   * Idempotent: CREATE ... IF NOT EXISTS, DROP ... IF EXISTS before
--     every constraint / policy / trigger / index.
--   * Soft delete (deleted_at timestamptz) on every tenant table.
--   * Cross-tenant consistency BEFORE-trigger: the three job-linked tables
--     verify the referenced job's tenant matches the row's tenant. RLS hides
--     foreign jobs from the trigger's SELECT, so a foreign job_id surfaces
--     as "does not exist".
--   * Shared BEFORE UPDATE updated_at trigger function across all tables.
--   * ev_oem_procedures is GLOBAL reference data: app_user reads it via the
--     default-privilege GRANT (0002_roles.sql); no tenant_id, no RLS.
--
-- Migration number: 0042. Master tops out at 0037_reporting.sql; 0038-0041
-- are claimed by parallel feature sessions (lien=0038, etc.). 0042 only
-- depends on pre-existing tables (jobs, tenants, users), so lexicographic
-- ordering with the gap is safe. scripts/check-migrations.sh is not touched.
--
-- Down (rollback):
--   DROP TABLE IF EXISTS ev_charge_station_visits;
--   DROP TABLE IF EXISTS ev_thermal_events;
--   DROP TABLE IF EXISTS ev_job_attributes;
--   DROP TABLE IF EXISTS ev_oem_procedures;
--   DROP FUNCTION IF EXISTS fn_ev_job_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_ev_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper, reused by all ev-recovery tables.
CREATE OR REPLACE FUNCTION fn_ev_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Tenant-consistency guard for the three job-linked tables: the referenced
-- job's tenant_id must match the row's tenant_id. RLS hides foreign jobs, so
-- a cross-tenant job_id surfaces as "does not exist".
CREATE OR REPLACE FUNCTION fn_ev_job_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_job_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_job_tenant
  FROM jobs WHERE id = NEW.job_id;

  IF v_job_tenant IS NULL THEN
    RAISE EXCEPTION 'ev_recovery: job_id % does not exist', NEW.job_id;
  END IF;

  IF v_job_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'ev_recovery: tenant_id (%) does not match jobs.tenant_id (%)',
      NEW.tenant_id, v_job_tenant;
  END IF;

  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. ev_oem_procedures  (GLOBAL reference data — NOT tenant-scoped)
-- ---------------------------------------------------------------------
-- One row per make / model / model-year-range with the OEM towing guidance
-- a tech needs on scene: tow-mode engage steps, HV-disconnect steps, jacking
-- points, and the official OEM doc. Seeded below for the top 15 EVs.
--
-- The launch spec named `make` as the PK, but a make has many models (Tesla
-- alone ships 5) and `model` is nullable, so a single-/composite-PK on those
-- columns cannot hold. We use a surrogate uuid PK + a unique index on
-- (make, model, model_year_from) instead (see SESSION_48_DECISIONS.md).
-- No tenant_id, no RLS: OEM procedure is identical for every operator.
-- app_user reads it via the default-privilege SELECT grant.

CREATE TABLE IF NOT EXISTS ev_oem_procedures (
  id                  uuid PRIMARY KEY,
  make                text NOT NULL,
  model               text,
  model_year_from     integer,
  model_year_to       integer,
  tow_mode_steps      text NOT NULL,
  hv_disconnect_steps text NOT NULL,
  jacking_points_url  text,
  official_doc_url    text,
  last_verified_at    timestamptz NOT NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ev_oem_procedures DROP CONSTRAINT IF EXISTS ev_oem_procedures_year_range_chk;
ALTER TABLE ev_oem_procedures ADD CONSTRAINT ev_oem_procedures_year_range_chk
  CHECK (model_year_from IS NULL OR model_year_to IS NULL OR model_year_to >= model_year_from);

-- One procedure row per (make, model, year-from). COALESCE the nullable model
-- so a make-wide fallback row (model IS NULL) is also de-duplicated.
DROP INDEX IF EXISTS ev_oem_procedures_make_model_year_unique;
CREATE UNIQUE INDEX ev_oem_procedures_make_model_year_unique
  ON ev_oem_procedures (lower(make), lower(coalesce(model, '')), coalesce(model_year_from, 0));

CREATE INDEX IF NOT EXISTS ev_oem_procedures_make_idx
  ON ev_oem_procedures (lower(make));

DROP TRIGGER IF EXISTS trg_ev_oem_procedures_set_updated_at ON ev_oem_procedures;
CREATE TRIGGER trg_ev_oem_procedures_set_updated_at
  BEFORE UPDATE ON ev_oem_procedures
  FOR EACH ROW EXECUTE FUNCTION fn_ev_set_updated_at();

-- Seed the top 15 EVs. Re-runnable: the migrate runner re-applies every SQL
-- file on each run (no tracking table), so we DELETE the seeded makes first
-- and re-INSERT — avoiding any ON CONFLICT inference against the expression
-- unique index. Scoped to the seeded makes so it never touches other rows.
-- tow_mode_steps / hv_disconnect_steps are best-effort summaries of public
-- OEM towing guidance and MUST be verified against the current service
-- manual before field use. last_verified_at is set to the migration date.
DELETE FROM ev_oem_procedures
 WHERE lower(make) IN (
   'tesla', 'ford', 'rivian', 'lucid', 'chevrolet', 'hyundai', 'kia', 'nissan', 'volkswagen'
 );

INSERT INTO ev_oem_procedures
  (id, make, model, model_year_from, model_year_to, tow_mode_steps, hv_disconnect_steps, jacking_points_url, official_doc_url, last_verified_at, notes)
VALUES
  (gen_random_uuid(), 'Tesla', 'Model 3', 2017, NULL,
   'Flatbed only. Do NOT tow with any wheels on the ground — drive units are damaged by rolling. Enable Transport Mode: Controls > Service > Transport Mode (vehicle must be awake and have charge). Maintain <5 mph onto the flatbed.',
   'Cut loop behind the front trunk (frunk) liner de-energizes the HV system. First responder loop: pull to disable HV. Wait 10+ minutes after disconnect before touching HV components.',
   'https://www.tesla.com/ownersmanual/model3/en_us/GUID-jacking', 'https://www.tesla.com/ownersmanual/model3', now(),
   'AWD and RWD both flatbed-only. Air suspension (none on 3). Transport Mode releases the parking brake but does NOT make the car safe to flat-tow.'),
  (gen_random_uuid(), 'Tesla', 'Model Y', 2020, NULL,
   'Flatbed only. Enable Transport Mode (Controls > Service > Transport Mode). Never flat-tow or use dollies — AWD drive units. Winch slowly onto the bed.',
   'First-responder cut loop behind frunk liner; pull to de-energize HV. Wait 10+ minutes.',
   'https://www.tesla.com/ownersmanual/modely/en_us/GUID-jacking', 'https://www.tesla.com/ownersmanual/modely', now(),
   'AWD only — dollies not permitted.'),
  (gen_random_uuid(), 'Tesla', 'Model S', 2012, NULL,
   'Flatbed only. Enable Transport Mode. Lower air suspension to Very High for ramp clearance only via the touchscreen if drivable; otherwise winch slowly. Never tow with wheels down.',
   'First-responder loop in the frunk; HV battery cut loop. De-energize and wait 10+ minutes before HV contact.',
   'https://www.tesla.com/ownersmanual/models/en_us/GUID-jacking', 'https://www.tesla.com/ownersmanual/models', now(),
   'Air suspension — set Jack Mode before lifting on a flatbed.'),
  (gen_random_uuid(), 'Tesla', 'Model X', 2015, NULL,
   'Flatbed only. Enable Transport Mode. Falcon doors must be closed. Air suspension Jack Mode before lifting. Never flat-tow.',
   'First-responder loop in the frunk; pull to cut HV. Wait 10+ minutes.',
   'https://www.tesla.com/ownersmanual/modelx/en_us/GUID-jacking', 'https://www.tesla.com/ownersmanual/modelx', now(),
   'AWD + air suspension. Dollies not permitted.'),
  (gen_random_uuid(), 'Tesla', 'Cybertruck', 2023, NULL,
   'Flatbed only. Enable Transport Mode. Steer-by-wire — vehicle must be powered/awake to steer onto the bed. Air suspension Jack Mode before lifting.',
   'First-responder cut loop; HV disconnect per the Cybertruck emergency response guide. Stainless body — standard cut points differ.',
   NULL, 'https://www.tesla.com/ownersmanual/cybertruck', now(),
   'Steer-by-wire: if the 48V/HV system is fully dead the wheels will not steer — plan winch path accordingly.'),
  (gen_random_uuid(), 'Ford', 'F-150 Lightning', 2022, NULL,
   'Flatbed strongly preferred. Place in Neutral Tow (Tow/Haul + Neutral procedure via the SYNC screen) only for short repositioning; otherwise flatbed. Do not exceed manufacturer wheel-down limits.',
   'Cut the first-responder loops at the driver A-pillar and under-hood per the Ford ERG. Disable HV; wait per ERG before HV contact.',
   'https://www.ford.com/support/vehicle/f-150-lightning', 'https://www.fordservicecontent.com', now(),
   'Has an under-hood frunk and HV battery between the frame rails — confirm jacking points, do not lift on the battery.'),
  (gen_random_uuid(), 'Ford', 'Mustang Mach-E', 2021, NULL,
   'Flatbed only for any meaningful distance. Neutral can be selected for winching onto the bed. Do not flat-tow.',
   'First-responder cut loops per the Mach-E ERG (under hood + behind rear bumper area). De-energize HV before contact.',
   'https://www.ford.com/support/vehicle/mustang-mach-e', 'https://www.fordservicecontent.com', now(),
   'RWD and AWD variants — both flatbed-only.'),
  (gen_random_uuid(), 'Rivian', 'R1T', 2021, NULL,
   'Flatbed only. Enable Tow Mode / Transport via the center screen (Vehicle > Towing). Air suspension — raise to Highest for ramp clearance if drivable. Quad-motor: never flat-tow.',
   'First-responder loop per the Rivian ERG; HV disconnect at the battery service disconnect. Wait per ERG.',
   NULL, 'https://rivian.com/support', now(),
   'Air suspension + quad/dual motor. Dollies not permitted.'),
  (gen_random_uuid(), 'Rivian', 'R1S', 2022, NULL,
   'Flatbed only. Enable Transport Mode (Vehicle > Towing). Air suspension Highest for clearance. Never flat-tow or use dollies.',
   'First-responder loop per the Rivian ERG; HV service disconnect at the battery.',
   NULL, 'https://rivian.com/support', now(),
   'SUV variant of the R1T platform.'),
  (gen_random_uuid(), 'Lucid', 'Air', 2021, NULL,
   'Flatbed only. Place in Transport/Tow Mode via the screen. Never tow with wheels on the ground.',
   'First-responder HV disconnect per the Lucid Air ERG. De-energize and wait before HV contact.',
   NULL, 'https://www.lucidmotors.com/owners', now(),
   '900V architecture — extra caution around HV after a crash.'),
  (gen_random_uuid(), 'Chevrolet', 'Bolt EV', 2017, NULL,
   'Flatbed preferred. May be moved a SHORT distance (under ~5 mi, under 35 mph) with front (drive) wheels OFF the ground on a wheel-lift + dollies as a last resort; flatbed for anything longer.',
   'Disconnect the 12V negative; HV manual service disconnect (MSD) is under the rear seat per the GM ERG. Wait 5+ minutes after MSD removal.',
   'https://www.chevrolet.com/support', 'https://www.gmupfitter.com', now(),
   'FWD. Short wheel-lift moves possible with drive wheels up; default to flatbed.'),
  (gen_random_uuid(), 'Hyundai', 'Ioniq 5', 2021, NULL,
   'Flatbed only. Engage the Utility/Tow handling per the manual; do not flat-tow. E-GMP platform.',
   'Disconnect 12V; HV battery disconnect per the Hyundai ERG. 800V system — observe extended wait times.',
   'https://www.hyundaiusa.com/us/en/owner-resources', NULL, now(),
   '800V E-GMP. AWD and RWD — flatbed-only.'),
  (gen_random_uuid(), 'Hyundai', 'Ioniq 6', 2022, NULL,
   'Flatbed only. E-GMP — do not flat-tow.',
   'Disconnect 12V; HV disconnect per the Hyundai ERG. 800V system.',
   'https://www.hyundaiusa.com/us/en/owner-resources', NULL, now(),
   'Sedan sibling of the Ioniq 5.'),
  (gen_random_uuid(), 'Kia', 'EV6', 2021, NULL,
   'Flatbed only. E-GMP platform — do not flat-tow.',
   'Disconnect 12V; HV battery service disconnect per the Kia ERG. 800V — extended wait.',
   'https://www.kia.com/us/en/owners', NULL, now(),
   'Shares the E-GMP platform with the Ioniq 5/6.'),
  (gen_random_uuid(), 'Nissan', 'Leaf', 2011, NULL,
   'Flatbed only. FWD — do not flat-tow (drive wheels on the ground damage the reduction gear/motor).',
   'Disconnect 12V; HV service disconnect per the Nissan ERG (orange high-voltage service plug). Wait per ERG.',
   'https://www.nissanusa.com/owners', NULL, now(),
   'CHAdeMO fast charge. FWD.'),
  (gen_random_uuid(), 'Volkswagen', 'ID.4', 2020, NULL,
   'Flatbed only. MEB platform — do not flat-tow. Neutral via the gear selector only for winching onto the bed.',
   'Disconnect 12V; HV disconnect per the VW ERG. De-energize before HV contact.',
   'https://www.vw.com/en/owners.html', NULL, now(),
   'RWD and AWD MEB variants — both flatbed-only.');


-- ---------------------------------------------------------------------
-- 2. ev_job_attributes
-- ---------------------------------------------------------------------
-- One row per EV job. job_id links the dispatched job (ON DELETE CASCADE —
-- the EV attributes are meaningless without the job). Carries the charge-
-- state intake, HV-isolation / tow-mode flags the tech records on scene, and
-- the OEM-procedure acknowledgement. One live row per job (partial unique).

CREATE TABLE IF NOT EXISTS ev_job_attributes (
  id                              uuid PRIMARY KEY,
  tenant_id                       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id                          uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  make                            text,
  model                           text,
  model_year                      integer,
  battery_chemistry               text,
  battery_kwh                     numeric(6, 2),
  state_of_charge_pct             integer,
  charge_port_locked              boolean NOT NULL DEFAULT false,
  hv_isolated                     boolean NOT NULL DEFAULT false,
  tow_mode_engaged                boolean NOT NULL DEFAULT false,
  oem_tow_procedure_acknowledged  boolean NOT NULL DEFAULT false,
  thermal_event_observed          boolean NOT NULL DEFAULT false,
  thermal_event_notes             text,
  created_by                      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  deleted_at                      timestamptz
);

ALTER TABLE ev_job_attributes DROP CONSTRAINT IF EXISTS ev_job_attributes_chemistry_chk;
ALTER TABLE ev_job_attributes ADD CONSTRAINT ev_job_attributes_chemistry_chk
  CHECK (battery_chemistry IS NULL OR battery_chemistry IN ('li_ion', 'lfp', 'nicd', 'nimh', 'other'));

ALTER TABLE ev_job_attributes DROP CONSTRAINT IF EXISTS ev_job_attributes_soc_chk;
ALTER TABLE ev_job_attributes ADD CONSTRAINT ev_job_attributes_soc_chk
  CHECK (state_of_charge_pct IS NULL OR (state_of_charge_pct >= 0 AND state_of_charge_pct <= 100));

ALTER TABLE ev_job_attributes DROP CONSTRAINT IF EXISTS ev_job_attributes_kwh_nonneg;
ALTER TABLE ev_job_attributes ADD CONSTRAINT ev_job_attributes_kwh_nonneg
  CHECK (battery_kwh IS NULL OR battery_kwh >= 0);

ALTER TABLE ev_job_attributes DROP CONSTRAINT IF EXISTS ev_job_attributes_model_year_chk;
ALTER TABLE ev_job_attributes ADD CONSTRAINT ev_job_attributes_model_year_chk
  CHECK (model_year IS NULL OR (model_year >= 1990 AND model_year <= 2100));

-- One live EV-attributes row per job.
DROP INDEX IF EXISTS ev_job_attributes_job_unique;
CREATE UNIQUE INDEX ev_job_attributes_job_unique
  ON ev_job_attributes (job_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ev_job_attributes_tenant_idx
  ON ev_job_attributes (tenant_id)
  WHERE deleted_at IS NULL;

ALTER TABLE ev_job_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ev_job_attributes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ev_job_attributes_tenant_isolation ON ev_job_attributes;
CREATE POLICY ev_job_attributes_tenant_isolation ON ev_job_attributes
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_ev_job_attributes_tenant_consistency ON ev_job_attributes;
CREATE TRIGGER trg_ev_job_attributes_tenant_consistency
  BEFORE INSERT OR UPDATE ON ev_job_attributes
  FOR EACH ROW EXECUTE FUNCTION fn_ev_job_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_ev_job_attributes ON ev_job_attributes;
CREATE TRIGGER trg_audit_ev_job_attributes
  AFTER INSERT OR UPDATE OR DELETE ON ev_job_attributes
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_ev_job_attributes_set_updated_at ON ev_job_attributes;
CREATE TRIGGER trg_ev_job_attributes_set_updated_at
  BEFORE UPDATE ON ev_job_attributes
  FOR EACH ROW EXECUTE FUNCTION fn_ev_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. ev_thermal_events
-- ---------------------------------------------------------------------
-- Battery thermal events observed on a job (smoke / flames / venting /
-- swelling / odor / sparking). severity drives the escalation matrix in the
-- pure engine (thermalEventEscalation). The boolean flags record what the
-- tech actually did; photo_keys references storage objects. Append-only in
-- practice; soft-delete columns present for invariant parity.

CREATE TABLE IF NOT EXISTS ev_thermal_events (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id              uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  observed_at         timestamptz NOT NULL DEFAULT now(),
  severity            text NOT NULL,
  action_taken        text,
  hazmat_called       boolean NOT NULL DEFAULT false,
  fire_dept_called    boolean NOT NULL DEFAULT false,
  customer_evacuated  boolean NOT NULL DEFAULT false,
  scene_secured       boolean NOT NULL DEFAULT false,
  photo_keys          text[] NOT NULL DEFAULT '{}',
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE ev_thermal_events DROP CONSTRAINT IF EXISTS ev_thermal_events_severity_chk;
ALTER TABLE ev_thermal_events ADD CONSTRAINT ev_thermal_events_severity_chk
  CHECK (severity IN ('odor', 'swelling', 'smoke', 'venting', 'sparking', 'flames'));

CREATE INDEX IF NOT EXISTS ev_thermal_events_tenant_job_idx
  ON ev_thermal_events (tenant_id, job_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ev_thermal_events_observed_idx
  ON ev_thermal_events (observed_at)
  WHERE deleted_at IS NULL;

ALTER TABLE ev_thermal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ev_thermal_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ev_thermal_events_tenant_isolation ON ev_thermal_events;
CREATE POLICY ev_thermal_events_tenant_isolation ON ev_thermal_events
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_ev_thermal_events_tenant_consistency ON ev_thermal_events;
CREATE TRIGGER trg_ev_thermal_events_tenant_consistency
  BEFORE INSERT OR UPDATE ON ev_thermal_events
  FOR EACH ROW EXECUTE FUNCTION fn_ev_job_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_ev_thermal_events ON ev_thermal_events;
CREATE TRIGGER trg_audit_ev_thermal_events
  AFTER INSERT OR UPDATE OR DELETE ON ev_thermal_events
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_ev_thermal_events_set_updated_at ON ev_thermal_events;
CREATE TRIGGER trg_ev_thermal_events_set_updated_at
  BEFORE UPDATE ON ev_thermal_events
  FOR EACH ROW EXECUTE FUNCTION fn_ev_set_updated_at();


-- ---------------------------------------------------------------------
-- 4. ev_charge_station_visits
-- ---------------------------------------------------------------------
-- Charge stops made during a long-haul EV recovery (a drained EV may need
-- charge to reach the destination, or to enable Transport Mode). Tracks the
-- network, dwell window, energy delivered, cost, and who pays.

CREATE TABLE IF NOT EXISTS ev_charge_station_visits (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id            uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  station_network   text,
  station_address   text,
  arrived_at        timestamptz NOT NULL DEFAULT now(),
  departed_at       timestamptz,
  kwh_delivered     numeric(7, 2),
  cost_cents        bigint,
  paid_by           text NOT NULL DEFAULT 'tenant',
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

ALTER TABLE ev_charge_station_visits DROP CONSTRAINT IF EXISTS ev_charge_station_visits_paid_by_chk;
ALTER TABLE ev_charge_station_visits ADD CONSTRAINT ev_charge_station_visits_paid_by_chk
  CHECK (paid_by IN ('tenant', 'customer', 'club'));

ALTER TABLE ev_charge_station_visits DROP CONSTRAINT IF EXISTS ev_charge_station_visits_kwh_nonneg;
ALTER TABLE ev_charge_station_visits ADD CONSTRAINT ev_charge_station_visits_kwh_nonneg
  CHECK (kwh_delivered IS NULL OR kwh_delivered >= 0);

ALTER TABLE ev_charge_station_visits DROP CONSTRAINT IF EXISTS ev_charge_station_visits_cost_nonneg;
ALTER TABLE ev_charge_station_visits ADD CONSTRAINT ev_charge_station_visits_cost_nonneg
  CHECK (cost_cents IS NULL OR cost_cents >= 0);

ALTER TABLE ev_charge_station_visits DROP CONSTRAINT IF EXISTS ev_charge_station_visits_window_chk;
ALTER TABLE ev_charge_station_visits ADD CONSTRAINT ev_charge_station_visits_window_chk
  CHECK (departed_at IS NULL OR departed_at >= arrived_at);

CREATE INDEX IF NOT EXISTS ev_charge_station_visits_tenant_job_idx
  ON ev_charge_station_visits (tenant_id, job_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ev_charge_station_visits_arrived_idx
  ON ev_charge_station_visits (arrived_at)
  WHERE deleted_at IS NULL;

ALTER TABLE ev_charge_station_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE ev_charge_station_visits FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ev_charge_station_visits_tenant_isolation ON ev_charge_station_visits;
CREATE POLICY ev_charge_station_visits_tenant_isolation ON ev_charge_station_visits
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_ev_charge_station_visits_tenant_consistency ON ev_charge_station_visits;
CREATE TRIGGER trg_ev_charge_station_visits_tenant_consistency
  BEFORE INSERT OR UPDATE ON ev_charge_station_visits
  FOR EACH ROW EXECUTE FUNCTION fn_ev_job_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_ev_charge_station_visits ON ev_charge_station_visits;
CREATE TRIGGER trg_audit_ev_charge_station_visits
  AFTER INSERT OR UPDATE OR DELETE ON ev_charge_station_visits
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_ev_charge_station_visits_set_updated_at ON ev_charge_station_visits;
CREATE TRIGGER trg_ev_charge_station_visits_set_updated_at
  BEFORE UPDATE ON ev_charge_station_visits
  FOR EACH ROW EXECUTE FUNCTION fn_ev_set_updated_at();
