-- =====================================================================
-- 0051_repo_workflow.sql  (Repossession Workflow — core — Session 49)
--
-- Repossession is legally and operationally distinct from impound (S22)
-- and statutory lien sale (S23/S35): the lienholder is the CLIENT (not the
-- vehicle owner), recovery is "peaceful" (no debtor signature, no debtor
-- notice), and billing is recovery-fee + skip-trace + storage + per-attempt.
-- This migration lands the core lifecycle data model. Per-state compliance
-- engines (S50/S51) and RDN/Clearplan/MBSi forwarder adapters (S52, partner-
-- gated) build on top of it.
--
-- Tables added:
--   1. lienholders            — the repo client (tenant-scoped reference book)
--   2. repo_cases             — one assignment: a vehicle to recover
--   3. repo_location_attempts — each field attempt to locate / recover
--   4. repo_recovery_events   — the recovery itself (peaceful / surrender / impound)
--   5. repo_personal_property — debtor belongings inventoried on recovery
--   6. repo_condition_photos  — body-damage documentation (8 standard slots)
--
-- Also (additive, on the existing jobs table):
--   * jobs.repo_case_id uuid  — nullable FK linking a dispatch job to its case.
-- The 'repo' service_type value is enforced only at the Zod/Drizzle layer
-- (jobs.service_type has no DB CHECK constraint), so no ALTER is needed here.
--
-- Patterns followed (match 0036_impound_storage.sql):
--   * Every tenant table: tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE RESTRICT; ENABLE + FORCE ROW LEVEL SECURITY; tenant-isolation
--     policy USING/WITH CHECK (tenant_id = fn_current_tenant_id()); audit
--     trigger fn_audit_log(); soft delete (deleted_at).
--   * One shared BEFORE UPDATE updated_at stamper reused by all six tables.
--   * Cross-tenant consistency BEFORE-trigger on every child table: FKs prove
--     the parent row exists but not that its tenant matches; RLS hides foreign
--     parents so a foreign-id injection fails "does not exist"/"does not match".
--   * Idempotent: CREATE ... IF NOT EXISTS; every constraint/policy/trigger/
--     index preceded by DROP ... IF EXISTS.
--   * gps coordinates are double precision (nullable) — adequate for field
--     pins, exposed as numbers in the DTO with no string coercion tax.
--
-- Down (rollback):
--   ALTER TABLE jobs DROP COLUMN IF EXISTS repo_case_id;
--   DROP TABLE IF EXISTS repo_condition_photos;
--   DROP TABLE IF EXISTS repo_personal_property;
--   DROP TABLE IF EXISTS repo_recovery_events;
--   DROP TABLE IF EXISTS repo_location_attempts;
--   DROP TABLE IF EXISTS repo_cases;
--   DROP TABLE IF EXISTS lienholders;
--   DROP FUNCTION IF EXISTS fn_repo_cases_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_repo_child_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_repo_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper, reused by all six repo tables.
CREATE OR REPLACE FUNCTION fn_repo_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Tenant-consistency guard for the four child tables that hang off
-- repo_cases. Verifies the referenced case's tenant_id matches the child
-- row's tenant_id. RLS hides foreign cases, so a cross-tenant
-- repo_case_id surfaces as "does not exist".
CREATE OR REPLACE FUNCTION fn_repo_child_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_case_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_case_tenant
  FROM repo_cases WHERE id = NEW.repo_case_id;

  IF v_case_tenant IS NULL THEN
    RAISE EXCEPTION 'repo child: repo_case_id % does not exist', NEW.repo_case_id;
  END IF;

  IF v_case_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'repo child: tenant_id (%) does not match repo_cases.tenant_id (%)',
      NEW.tenant_id, v_case_tenant;
  END IF;

  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. lienholders
-- ---------------------------------------------------------------------
-- The repo client (bank, credit union, BHPH dealer, forwarder). Tenant-
-- scoped — operators keep their own lienholder book, unlike the global
-- jurisdictions reference. `invoice_format` selects the billing export
-- shape; only 'basic' is rendered in v1 ('rdn'/'clearplan' are S52 stubs).

CREATE TABLE IF NOT EXISTS lienholders (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name            text NOT NULL,
  contact_name    text,
  phone           text,
  email           text,
  address_line1   text,
  address_line2   text,
  city            text,
  state           text,
  postal_code     text,
  billing_terms   jsonb,
  invoice_format  text NOT NULL DEFAULT 'basic',
  notes           text,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

ALTER TABLE lienholders DROP CONSTRAINT IF EXISTS lienholders_name_nonempty;
ALTER TABLE lienholders ADD CONSTRAINT lienholders_name_nonempty
  CHECK (length(trim(name)) > 0);

ALTER TABLE lienholders DROP CONSTRAINT IF EXISTS lienholders_invoice_format_chk;
ALTER TABLE lienholders ADD CONSTRAINT lienholders_invoice_format_chk
  CHECK (invoice_format IN ('basic', 'rdn', 'clearplan'));

-- One live lienholder per (tenant, lower(name)).
DROP INDEX IF EXISTS lienholders_tenant_name_unique;
CREATE UNIQUE INDEX lienholders_tenant_name_unique
  ON lienholders (tenant_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS lienholders_tenant_active_idx
  ON lienholders (tenant_id, is_active)
  WHERE deleted_at IS NULL;

ALTER TABLE lienholders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lienholders FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lienholders_tenant_isolation ON lienholders;
CREATE POLICY lienholders_tenant_isolation ON lienholders
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_lienholders ON lienholders;
CREATE TRIGGER trg_audit_lienholders
  AFTER INSERT OR UPDATE OR DELETE ON lienholders
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_lienholders_set_updated_at ON lienholders;
CREATE TRIGGER trg_lienholders_set_updated_at
  BEFORE UPDATE ON lienholders
  FOR EACH ROW EXECUTE FUNCTION fn_repo_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. repo_cases
-- ---------------------------------------------------------------------
-- One assignment: recover a specific vehicle for a lienholder. The vehicle
-- and debtor are snapshotted on the row (the debtor is never a tenant
-- customer). Status machine (enforced in the service layer):
--   open -> located -> recovered -> closed
--   open -> surrendered -> closed          (voluntary surrender)
--   open|located -> cancelled              (lienholder pulls the assignment)
-- redemption_ends_at is computed from recovered_at + redemption_window_days
-- when the vehicle is recovered (post-recovery debtor cure window).

CREATE TABLE IF NOT EXISTS repo_cases (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  lienholder_id           uuid NOT NULL REFERENCES lienholders(id) ON DELETE RESTRICT,
  case_number             text NOT NULL,
  vin                     text,
  vehicle_year            integer,
  vehicle_make            text,
  vehicle_model           text,
  vehicle_color           text,
  plate                   text,
  debtor_name             text,
  debtor_address          text,
  debtor_phone            text,
  debtor_secondary_address jsonb,
  status                  text NOT NULL DEFAULT 'open',
  assigned_at             timestamptz NOT NULL DEFAULT now(),
  located_at              timestamptz,
  recovered_at            timestamptz,
  closed_at               timestamptz,
  redemption_window_days  integer,
  redemption_ends_at      timestamptz,
  ref_assignment_id       text,
  notes                   text,
  created_by              uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);

ALTER TABLE repo_cases DROP CONSTRAINT IF EXISTS repo_cases_case_number_nonempty;
ALTER TABLE repo_cases ADD CONSTRAINT repo_cases_case_number_nonempty
  CHECK (length(trim(case_number)) > 0);

ALTER TABLE repo_cases DROP CONSTRAINT IF EXISTS repo_cases_status_chk;
ALTER TABLE repo_cases ADD CONSTRAINT repo_cases_status_chk
  CHECK (status IN ('open', 'located', 'recovered', 'surrendered', 'closed', 'cancelled'));

ALTER TABLE repo_cases DROP CONSTRAINT IF EXISTS repo_cases_vehicle_year_sane;
ALTER TABLE repo_cases ADD CONSTRAINT repo_cases_vehicle_year_sane
  CHECK (vehicle_year IS NULL OR (vehicle_year >= 1900 AND vehicle_year <= 2200));

ALTER TABLE repo_cases DROP CONSTRAINT IF EXISTS repo_cases_redemption_window_nonneg;
ALTER TABLE repo_cases ADD CONSTRAINT repo_cases_redemption_window_nonneg
  CHECK (redemption_window_days IS NULL OR redemption_window_days >= 0);

-- Idempotency: one non-cancelled case per (tenant, lienholder, case_number).
-- A cancelled case frees the number for re-assignment.
DROP INDEX IF EXISTS repo_cases_tenant_lienholder_number_unique;
CREATE UNIQUE INDEX repo_cases_tenant_lienholder_number_unique
  ON repo_cases (tenant_id, lienholder_id, case_number)
  WHERE status <> 'cancelled' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS repo_cases_tenant_status_idx
  ON repo_cases (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS repo_cases_tenant_lienholder_idx
  ON repo_cases (tenant_id, lienholder_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS repo_cases_tenant_assigned_idx
  ON repo_cases (tenant_id, assigned_at)
  WHERE deleted_at IS NULL;

ALTER TABLE repo_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE repo_cases FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repo_cases_tenant_isolation ON repo_cases;
CREATE POLICY repo_cases_tenant_isolation ON repo_cases
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- Cross-tenant consistency: the referenced lienholder must belong to this
-- row's tenant.
CREATE OR REPLACE FUNCTION fn_repo_cases_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_lienholder_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_lienholder_tenant FROM lienholders WHERE id = NEW.lienholder_id;
  IF v_lienholder_tenant IS NULL THEN
    RAISE EXCEPTION 'repo_cases: lienholder_id % does not exist', NEW.lienholder_id;
  END IF;
  IF v_lienholder_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'repo_cases: tenant_id (%) does not match lienholders.tenant_id (%)',
      NEW.tenant_id, v_lienholder_tenant;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_repo_cases_tenant_consistency ON repo_cases;
CREATE TRIGGER trg_repo_cases_tenant_consistency
  BEFORE INSERT OR UPDATE ON repo_cases
  FOR EACH ROW EXECUTE FUNCTION fn_repo_cases_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_repo_cases ON repo_cases;
CREATE TRIGGER trg_audit_repo_cases
  AFTER INSERT OR UPDATE OR DELETE ON repo_cases
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_repo_cases_set_updated_at ON repo_cases;
CREATE TRIGGER trg_repo_cases_set_updated_at
  BEFORE UPDATE ON repo_cases
  FOR EACH ROW EXECUTE FUNCTION fn_repo_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. repo_location_attempts
-- ---------------------------------------------------------------------
-- Each field attempt to locate / recover the vehicle. The append-only log
-- a forwarder bills "per attempt" from and a court reads to prove the
-- recovery was peaceful (no breach of peace).

CREATE TABLE IF NOT EXISTS repo_location_attempts (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  repo_case_id        uuid NOT NULL REFERENCES repo_cases(id) ON DELETE CASCADE,
  attempted_at        timestamptz NOT NULL DEFAULT now(),
  attempted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  address             text,
  outcome             text NOT NULL,
  notes               text,
  gps_lat             double precision,
  gps_lng             double precision,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE repo_location_attempts DROP CONSTRAINT IF EXISTS repo_location_attempts_outcome_chk;
ALTER TABLE repo_location_attempts ADD CONSTRAINT repo_location_attempts_outcome_chk
  CHECK (outcome IN (
    'not_home', 'wrong_address', 'spotted_no_attempt',
    'attempted_failed', 'peaceful_recovery', 'surrendered'
  ));

CREATE INDEX IF NOT EXISTS repo_location_attempts_tenant_case_idx
  ON repo_location_attempts (tenant_id, repo_case_id)
  WHERE deleted_at IS NULL;

ALTER TABLE repo_location_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE repo_location_attempts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repo_location_attempts_tenant_isolation ON repo_location_attempts;
CREATE POLICY repo_location_attempts_tenant_isolation ON repo_location_attempts
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_repo_location_attempts_tenant_consistency ON repo_location_attempts;
CREATE TRIGGER trg_repo_location_attempts_tenant_consistency
  BEFORE INSERT OR UPDATE ON repo_location_attempts
  FOR EACH ROW EXECUTE FUNCTION fn_repo_child_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_repo_location_attempts ON repo_location_attempts;
CREATE TRIGGER trg_audit_repo_location_attempts
  AFTER INSERT OR UPDATE OR DELETE ON repo_location_attempts
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_repo_location_attempts_set_updated_at ON repo_location_attempts;
CREATE TRIGGER trg_repo_location_attempts_set_updated_at
  BEFORE UPDATE ON repo_location_attempts
  FOR EACH ROW EXECUTE FUNCTION fn_repo_set_updated_at();


-- ---------------------------------------------------------------------
-- 4. repo_recovery_events
-- ---------------------------------------------------------------------
-- The recovery itself. Normally one per case, but the table is append-only
-- (a botched recovery + a later successful one both belong in the record).

CREATE TABLE IF NOT EXISTS repo_recovery_events (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  repo_case_id        uuid NOT NULL REFERENCES repo_cases(id) ON DELETE CASCADE,
  recovered_at        timestamptz NOT NULL DEFAULT now(),
  recovered_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  recovery_type       text NOT NULL,
  odometer            integer,
  condition_notes     text,
  gps_lat             double precision,
  gps_lng             double precision,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE repo_recovery_events DROP CONSTRAINT IF EXISTS repo_recovery_events_type_chk;
ALTER TABLE repo_recovery_events ADD CONSTRAINT repo_recovery_events_type_chk
  CHECK (recovery_type IN ('peaceful', 'voluntary_surrender', 'involuntary_impound'));

ALTER TABLE repo_recovery_events DROP CONSTRAINT IF EXISTS repo_recovery_events_odometer_nonneg;
ALTER TABLE repo_recovery_events ADD CONSTRAINT repo_recovery_events_odometer_nonneg
  CHECK (odometer IS NULL OR odometer >= 0);

CREATE INDEX IF NOT EXISTS repo_recovery_events_tenant_case_idx
  ON repo_recovery_events (tenant_id, repo_case_id)
  WHERE deleted_at IS NULL;

ALTER TABLE repo_recovery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE repo_recovery_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repo_recovery_events_tenant_isolation ON repo_recovery_events;
CREATE POLICY repo_recovery_events_tenant_isolation ON repo_recovery_events
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_repo_recovery_events_tenant_consistency ON repo_recovery_events;
CREATE TRIGGER trg_repo_recovery_events_tenant_consistency
  BEFORE INSERT OR UPDATE ON repo_recovery_events
  FOR EACH ROW EXECUTE FUNCTION fn_repo_child_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_repo_recovery_events ON repo_recovery_events;
CREATE TRIGGER trg_audit_repo_recovery_events
  AFTER INSERT OR UPDATE OR DELETE ON repo_recovery_events
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_repo_recovery_events_set_updated_at ON repo_recovery_events;
CREATE TRIGGER trg_repo_recovery_events_set_updated_at
  BEFORE UPDATE ON repo_recovery_events
  FOR EACH ROW EXECUTE FUNCTION fn_repo_set_updated_at();


-- ---------------------------------------------------------------------
-- 5. repo_personal_property
-- ---------------------------------------------------------------------
-- Debtor belongings inventoried at recovery. Most states require the
-- repossessor to hold and return personal property; released_at/released_to
-- record the handoff back to the debtor.

CREATE TABLE IF NOT EXISTS repo_personal_property (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  repo_case_id        uuid NOT NULL REFERENCES repo_cases(id) ON DELETE CASCADE,
  item_description    text NOT NULL,
  photo_url           text,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  released_at         timestamptz,
  released_to         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE repo_personal_property DROP CONSTRAINT IF EXISTS repo_personal_property_desc_nonempty;
ALTER TABLE repo_personal_property ADD CONSTRAINT repo_personal_property_desc_nonempty
  CHECK (length(trim(item_description)) > 0);

CREATE INDEX IF NOT EXISTS repo_personal_property_tenant_case_idx
  ON repo_personal_property (tenant_id, repo_case_id)
  WHERE deleted_at IS NULL;

ALTER TABLE repo_personal_property ENABLE ROW LEVEL SECURITY;
ALTER TABLE repo_personal_property FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repo_personal_property_tenant_isolation ON repo_personal_property;
CREATE POLICY repo_personal_property_tenant_isolation ON repo_personal_property
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_repo_personal_property_tenant_consistency ON repo_personal_property;
CREATE TRIGGER trg_repo_personal_property_tenant_consistency
  BEFORE INSERT OR UPDATE ON repo_personal_property
  FOR EACH ROW EXECUTE FUNCTION fn_repo_child_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_repo_personal_property ON repo_personal_property;
CREATE TRIGGER trg_audit_repo_personal_property
  AFTER INSERT OR UPDATE OR DELETE ON repo_personal_property
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_repo_personal_property_set_updated_at ON repo_personal_property;
CREATE TRIGGER trg_repo_personal_property_set_updated_at
  BEFORE UPDATE ON repo_personal_property
  FOR EACH ROW EXECUTE FUNCTION fn_repo_set_updated_at();


-- ---------------------------------------------------------------------
-- 6. repo_condition_photos
-- ---------------------------------------------------------------------
-- Body-damage documentation captured by the driver on recovery. Eight
-- standard slots (matches industry repo condition-report sheets) plus
-- 'other'; the slot is advisory (a case can carry several of one type).

CREATE TABLE IF NOT EXISTS repo_condition_photos (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  repo_case_id        uuid NOT NULL REFERENCES repo_cases(id) ON DELETE CASCADE,
  photo_url           text NOT NULL,
  photo_type          text NOT NULL,
  taken_at            timestamptz NOT NULL DEFAULT now(),
  gps_lat             double precision,
  gps_lng             double precision,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE repo_condition_photos DROP CONSTRAINT IF EXISTS repo_condition_photos_url_nonempty;
ALTER TABLE repo_condition_photos ADD CONSTRAINT repo_condition_photos_url_nonempty
  CHECK (length(trim(photo_url)) > 0);

ALTER TABLE repo_condition_photos DROP CONSTRAINT IF EXISTS repo_condition_photos_type_chk;
ALTER TABLE repo_condition_photos ADD CONSTRAINT repo_condition_photos_type_chk
  CHECK (photo_type IN (
    'exterior_front', 'exterior_rear', 'exterior_left', 'exterior_right',
    'interior', 'odometer', 'damage', 'vin_plate', 'other'
  ));

CREATE INDEX IF NOT EXISTS repo_condition_photos_tenant_case_idx
  ON repo_condition_photos (tenant_id, repo_case_id)
  WHERE deleted_at IS NULL;

ALTER TABLE repo_condition_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE repo_condition_photos FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repo_condition_photos_tenant_isolation ON repo_condition_photos;
CREATE POLICY repo_condition_photos_tenant_isolation ON repo_condition_photos
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_repo_condition_photos_tenant_consistency ON repo_condition_photos;
CREATE TRIGGER trg_repo_condition_photos_tenant_consistency
  BEFORE INSERT OR UPDATE ON repo_condition_photos
  FOR EACH ROW EXECUTE FUNCTION fn_repo_child_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_repo_condition_photos ON repo_condition_photos;
CREATE TRIGGER trg_audit_repo_condition_photos
  AFTER INSERT OR UPDATE OR DELETE ON repo_condition_photos
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_repo_condition_photos_set_updated_at ON repo_condition_photos;
CREATE TRIGGER trg_repo_condition_photos_set_updated_at
  BEFORE UPDATE ON repo_condition_photos
  FOR EACH ROW EXECUTE FUNCTION fn_repo_set_updated_at();


-- ---------------------------------------------------------------------
-- 7. jobs.repo_case_id (additive)
-- ---------------------------------------------------------------------
-- Links a dispatch job to its repo case. Nullable: the vast majority of
-- jobs are not repos. ON DELETE SET NULL so soft-deleting a case (or the
-- rare hard delete) never blocks the job row.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS repo_case_id uuid REFERENCES repo_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jobs_tenant_repo_case_idx
  ON jobs (tenant_id, repo_case_id)
  WHERE repo_case_id IS NOT NULL;
