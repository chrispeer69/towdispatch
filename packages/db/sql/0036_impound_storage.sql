-- =====================================================================
-- 0036_impound_storage.sql  (Impound & Storage — Session 22)
--
-- Yard-based impound management for vehicles a tenant takes into storage:
-- police / abandoned / accident / owner-request holds, photo intake on
-- arrival, daily storage-fee accrual, a documented release workflow, and
-- a lien-eligibility flag. State-form generation (the documents
-- themselves) is deferred to Session 23 — this migration lands the data
-- model the forms read from.
--
-- Tables added:
--   1. impound_yards     — the physical lots a tenant operates
--   2. impound_records   — one row per vehicle taken into storage
--   3. impound_holds     — legal holds on a record (many per record)
--   4. impound_fees      — fee ledger (daily accrual + manual line items)
--   5. impound_releases  — the documented release of a record
--
-- Patterns followed (match 0034_tier_offer_composer.sql / 0033):
--   * Every table: tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE RESTRICT.
--   * Every table: ENABLE + FORCE ROW LEVEL SECURITY, policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on every table.
--   * Idempotent: CREATE ... IF NOT EXISTS, every constraint preceded by
--     DROP CONSTRAINT IF EXISTS, every policy by DROP POLICY IF EXISTS,
--     every trigger by DROP TRIGGER IF EXISTS.
--   * Soft delete (deleted_at timestamptz) everywhere — impound records
--     are long-lived legal/financial documents.
--   * Cross-tenant consistency BEFORE-trigger on every child table: the
--     FKs guarantee the parent row exists but not that its tenant_id
--     matches. RLS hides foreign parents from the trigger's SELECT, so a
--     foreign-id injection fails "does not exist"/"does not match".
--   * One shared BEFORE UPDATE updated_at trigger function reused across
--     all five tables (Drizzle's defaultNow() only fires on INSERT).
--
-- Down (rollback):
--   DROP TABLE IF EXISTS impound_releases;
--   DROP TABLE IF EXISTS impound_fees;
--   DROP TABLE IF EXISTS impound_holds;
--   DROP TABLE IF EXISTS impound_records;
--   DROP TABLE IF EXISTS impound_yards;
--   DROP FUNCTION IF EXISTS fn_impound_records_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_impound_child_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_impound_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper, reused by all five impound tables.
CREATE OR REPLACE FUNCTION fn_impound_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Tenant-consistency guard for the three child tables that hang off
-- impound_records (holds, fees, releases). Verifies the referenced
-- record's tenant_id matches the child row's tenant_id. RLS hides
-- foreign records, so a cross-tenant impound_record_id surfaces as
-- "does not exist".
CREATE OR REPLACE FUNCTION fn_impound_child_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_record_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_record_tenant
  FROM impound_records WHERE id = NEW.impound_record_id;

  IF v_record_tenant IS NULL THEN
    RAISE EXCEPTION 'impound child: impound_record_id % does not exist', NEW.impound_record_id;
  END IF;

  IF v_record_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'impound child: tenant_id (%) does not match impound_records.tenant_id (%)',
      NEW.tenant_id, v_record_tenant;
  END IF;

  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. impound_yards
-- ---------------------------------------------------------------------
-- The physical lots a tenant operates. `code` is the short operator-
-- facing label ("NORTH", "LOT-2"); unique per tenant among live rows.
-- `capacity` is advisory (NULL = untracked); the app surfaces a warning
-- rather than hard-blocking intake when a yard is full.

CREATE TABLE IF NOT EXISTS impound_yards (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name            text NOT NULL,
  code            text NOT NULL,
  address_line1   text,
  address_line2   text,
  city            text,
  state           text,
  postal_code     text,
  capacity        integer,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

ALTER TABLE impound_yards DROP CONSTRAINT IF EXISTS impound_yards_name_nonempty;
ALTER TABLE impound_yards ADD CONSTRAINT impound_yards_name_nonempty
  CHECK (length(trim(name)) > 0);

ALTER TABLE impound_yards DROP CONSTRAINT IF EXISTS impound_yards_code_nonempty;
ALTER TABLE impound_yards ADD CONSTRAINT impound_yards_code_nonempty
  CHECK (length(trim(code)) > 0);

ALTER TABLE impound_yards DROP CONSTRAINT IF EXISTS impound_yards_capacity_positive;
ALTER TABLE impound_yards ADD CONSTRAINT impound_yards_capacity_positive
  CHECK (capacity IS NULL OR capacity > 0);

-- One live yard per (tenant, code).
DROP INDEX IF EXISTS impound_yards_tenant_code_unique;
CREATE UNIQUE INDEX impound_yards_tenant_code_unique
  ON impound_yards (tenant_id, lower(code))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS impound_yards_tenant_active_idx
  ON impound_yards (tenant_id, is_active)
  WHERE deleted_at IS NULL;

ALTER TABLE impound_yards ENABLE ROW LEVEL SECURITY;
ALTER TABLE impound_yards FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS impound_yards_tenant_isolation ON impound_yards;
CREATE POLICY impound_yards_tenant_isolation ON impound_yards
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_impound_yards ON impound_yards;
CREATE TRIGGER trg_audit_impound_yards
  AFTER INSERT OR UPDATE OR DELETE ON impound_yards
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_impound_yards_set_updated_at ON impound_yards;
CREATE TRIGGER trg_impound_yards_set_updated_at
  BEFORE UPDATE ON impound_yards
  FOR EACH ROW EXECUTE FUNCTION fn_impound_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. impound_records
-- ---------------------------------------------------------------------
-- One row per vehicle in storage. job_id links the tow that brought it
-- in (nullable — vehicles can be dropped off without a dispatched job);
-- vehicle_id links a known vehicle (nullable — most impounds are for
-- vehicles not in the tenant's customer book, so the make/model/VIN are
-- snapshotted on the row).
--
-- Storage clock: storage_started_at is when the daily fee begins
-- (defaults to arrival). accrued_fee_cents is the running total the
-- accrual cron maintains; last_accrued_on is the most recent calendar
-- day a daily_storage fee was written — the cron's idempotency anchor.
--
-- Status machine (enforced in the service layer):
--   stored -> pending_release -> released
--   stored -> transferred | disposed
-- Fee accrual runs while status IN ('stored','pending_release') and
-- stops once released/transferred/disposed.

CREATE TABLE IF NOT EXISTS impound_records (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  yard_id             uuid NOT NULL REFERENCES impound_yards(id) ON DELETE RESTRICT,
  job_id              uuid REFERENCES jobs(id) ON DELETE SET NULL,
  vehicle_id          uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  vehicle_make        text,
  vehicle_model       text,
  vehicle_year        integer,
  vehicle_color       text,
  vehicle_vin         text,
  license_plate       text,
  license_state       text,
  status              text NOT NULL DEFAULT 'stored',
  arrived_at          timestamptz NOT NULL DEFAULT now(),
  storage_started_at  timestamptz NOT NULL DEFAULT now(),
  released_at         timestamptz,
  daily_fee_cents     integer NOT NULL DEFAULT 0,
  intake_mileage      integer,
  intake_photo_keys   text[] NOT NULL DEFAULT '{}',
  condition_notes     text,
  lien_eligible       boolean NOT NULL DEFAULT false,
  lien_eligible_at    timestamptz,
  accrued_fee_cents   bigint NOT NULL DEFAULT 0,
  last_accrued_on     date,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE impound_records DROP CONSTRAINT IF EXISTS impound_records_status_chk;
ALTER TABLE impound_records ADD CONSTRAINT impound_records_status_chk
  CHECK (status IN ('stored', 'pending_release', 'released', 'transferred', 'disposed'));

ALTER TABLE impound_records DROP CONSTRAINT IF EXISTS impound_records_daily_fee_nonneg;
ALTER TABLE impound_records ADD CONSTRAINT impound_records_daily_fee_nonneg
  CHECK (daily_fee_cents >= 0);

ALTER TABLE impound_records DROP CONSTRAINT IF EXISTS impound_records_accrued_fee_nonneg;
ALTER TABLE impound_records ADD CONSTRAINT impound_records_accrued_fee_nonneg
  CHECK (accrued_fee_cents >= 0);

ALTER TABLE impound_records DROP CONSTRAINT IF EXISTS impound_records_intake_mileage_nonneg;
ALTER TABLE impound_records ADD CONSTRAINT impound_records_intake_mileage_nonneg
  CHECK (intake_mileage IS NULL OR intake_mileage >= 0);

ALTER TABLE impound_records DROP CONSTRAINT IF EXISTS impound_records_vehicle_year_sane;
ALTER TABLE impound_records ADD CONSTRAINT impound_records_vehicle_year_sane
  CHECK (vehicle_year IS NULL OR (vehicle_year >= 1900 AND vehicle_year <= 2200));

CREATE INDEX IF NOT EXISTS impound_records_tenant_status_idx
  ON impound_records (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS impound_records_tenant_yard_idx
  ON impound_records (tenant_id, yard_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS impound_records_tenant_lien_idx
  ON impound_records (tenant_id, lien_eligible)
  WHERE deleted_at IS NULL;

-- Cron-sweep target: records whose storage clock is still running.
CREATE INDEX IF NOT EXISTS impound_records_accrual_active_idx
  ON impound_records (last_accrued_on)
  WHERE status IN ('stored', 'pending_release') AND deleted_at IS NULL;

ALTER TABLE impound_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE impound_records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS impound_records_tenant_isolation ON impound_records;
CREATE POLICY impound_records_tenant_isolation ON impound_records
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- Cross-tenant consistency: yard (required) + job/vehicle (optional)
-- must all belong to this row's tenant.
CREATE OR REPLACE FUNCTION fn_impound_records_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_yard_tenant    uuid;
  v_job_tenant     uuid;
  v_vehicle_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_yard_tenant FROM impound_yards WHERE id = NEW.yard_id;
  IF v_yard_tenant IS NULL THEN
    RAISE EXCEPTION 'impound_records: yard_id % does not exist', NEW.yard_id;
  END IF;
  IF v_yard_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'impound_records: tenant_id (%) does not match impound_yards.tenant_id (%)',
      NEW.tenant_id, v_yard_tenant;
  END IF;

  IF NEW.job_id IS NOT NULL THEN
    SELECT tenant_id INTO v_job_tenant FROM jobs WHERE id = NEW.job_id;
    IF v_job_tenant IS NULL THEN
      RAISE EXCEPTION 'impound_records: job_id % does not exist', NEW.job_id;
    END IF;
    IF v_job_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'impound_records: tenant_id (%) does not match jobs.tenant_id (%)',
        NEW.tenant_id, v_job_tenant;
    END IF;
  END IF;

  IF NEW.vehicle_id IS NOT NULL THEN
    SELECT tenant_id INTO v_vehicle_tenant FROM vehicles WHERE id = NEW.vehicle_id;
    IF v_vehicle_tenant IS NULL THEN
      RAISE EXCEPTION 'impound_records: vehicle_id % does not exist', NEW.vehicle_id;
    END IF;
    IF v_vehicle_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'impound_records: tenant_id (%) does not match vehicles.tenant_id (%)',
        NEW.tenant_id, v_vehicle_tenant;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_impound_records_tenant_consistency ON impound_records;
CREATE TRIGGER trg_impound_records_tenant_consistency
  BEFORE INSERT OR UPDATE ON impound_records
  FOR EACH ROW EXECUTE FUNCTION fn_impound_records_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_impound_records ON impound_records;
CREATE TRIGGER trg_audit_impound_records
  AFTER INSERT OR UPDATE OR DELETE ON impound_records
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_impound_records_set_updated_at ON impound_records;
CREATE TRIGGER trg_impound_records_set_updated_at
  BEFORE UPDATE ON impound_records
  FOR EACH ROW EXECUTE FUNCTION fn_impound_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. impound_holds
-- ---------------------------------------------------------------------
-- Legal holds on a record. A vehicle can carry several simultaneously
-- (police + abandoned, say). released_at IS NULL means the hold is
-- active; an active hold blocks release in the service layer.

CREATE TABLE IF NOT EXISTS impound_holds (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  impound_record_id   uuid NOT NULL REFERENCES impound_records(id) ON DELETE CASCADE,
  hold_type           text NOT NULL,
  authority_name      text,
  authority_reference text,
  reason              text,
  placed_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  placed_at           timestamptz NOT NULL DEFAULT now(),
  released_at         timestamptz,
  released_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE impound_holds DROP CONSTRAINT IF EXISTS impound_holds_hold_type_chk;
ALTER TABLE impound_holds ADD CONSTRAINT impound_holds_hold_type_chk
  CHECK (hold_type IN ('police', 'abandoned', 'accident', 'owner_request'));

CREATE INDEX IF NOT EXISTS impound_holds_tenant_record_idx
  ON impound_holds (tenant_id, impound_record_id)
  WHERE deleted_at IS NULL;

-- Active-hold lookups (the release gate).
CREATE INDEX IF NOT EXISTS impound_holds_record_active_idx
  ON impound_holds (impound_record_id)
  WHERE released_at IS NULL AND deleted_at IS NULL;

ALTER TABLE impound_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE impound_holds FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS impound_holds_tenant_isolation ON impound_holds;
CREATE POLICY impound_holds_tenant_isolation ON impound_holds
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_impound_holds_tenant_consistency ON impound_holds;
CREATE TRIGGER trg_impound_holds_tenant_consistency
  BEFORE INSERT OR UPDATE ON impound_holds
  FOR EACH ROW EXECUTE FUNCTION fn_impound_child_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_impound_holds ON impound_holds;
CREATE TRIGGER trg_audit_impound_holds
  AFTER INSERT OR UPDATE OR DELETE ON impound_holds
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_impound_holds_set_updated_at ON impound_holds;
CREATE TRIGGER trg_impound_holds_set_updated_at
  BEFORE UPDATE ON impound_holds
  FOR EACH ROW EXECUTE FUNCTION fn_impound_set_updated_at();


-- ---------------------------------------------------------------------
-- 4. impound_fees
-- ---------------------------------------------------------------------
-- Fee ledger. daily_storage rows are written by the accrual cron, one
-- per record per calendar day; the partial unique index makes a double
-- run a no-op. Manual line items (intake, administrative, lien
-- processing, gate) carry a NULL accrued_for_date and created_by = the
-- operator.

CREATE TABLE IF NOT EXISTS impound_fees (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  impound_record_id   uuid NOT NULL REFERENCES impound_records(id) ON DELETE CASCADE,
  fee_type            text NOT NULL,
  description         text,
  amount_cents        bigint NOT NULL,
  accrued_for_date    date,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE impound_fees DROP CONSTRAINT IF EXISTS impound_fees_fee_type_chk;
ALTER TABLE impound_fees ADD CONSTRAINT impound_fees_fee_type_chk
  CHECK (fee_type IN ('daily_storage', 'intake', 'administrative', 'lien_processing', 'gate', 'other'));

ALTER TABLE impound_fees DROP CONSTRAINT IF EXISTS impound_fees_amount_nonneg;
ALTER TABLE impound_fees ADD CONSTRAINT impound_fees_amount_nonneg
  CHECK (amount_cents >= 0);

-- A daily_storage fee must name the day it covers; manual fees must not.
ALTER TABLE impound_fees DROP CONSTRAINT IF EXISTS impound_fees_daily_requires_date;
ALTER TABLE impound_fees ADD CONSTRAINT impound_fees_daily_requires_date
  CHECK (
    (fee_type = 'daily_storage' AND accrued_for_date IS NOT NULL)
    OR (fee_type <> 'daily_storage' AND accrued_for_date IS NULL)
  );

-- One daily_storage fee per record per day (accrual idempotency).
DROP INDEX IF EXISTS impound_fees_record_day_unique;
CREATE UNIQUE INDEX impound_fees_record_day_unique
  ON impound_fees (impound_record_id, accrued_for_date)
  WHERE fee_type = 'daily_storage' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS impound_fees_tenant_record_idx
  ON impound_fees (tenant_id, impound_record_id)
  WHERE deleted_at IS NULL;

ALTER TABLE impound_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE impound_fees FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS impound_fees_tenant_isolation ON impound_fees;
CREATE POLICY impound_fees_tenant_isolation ON impound_fees
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_impound_fees_tenant_consistency ON impound_fees;
CREATE TRIGGER trg_impound_fees_tenant_consistency
  BEFORE INSERT OR UPDATE ON impound_fees
  FOR EACH ROW EXECUTE FUNCTION fn_impound_child_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_impound_fees ON impound_fees;
CREATE TRIGGER trg_audit_impound_fees
  AFTER INSERT OR UPDATE OR DELETE ON impound_fees
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_impound_fees_set_updated_at ON impound_fees;
CREATE TRIGGER trg_impound_fees_set_updated_at
  BEFORE UPDATE ON impound_fees
  FOR EACH ROW EXECUTE FUNCTION fn_impound_set_updated_at();


-- ---------------------------------------------------------------------
-- 5. impound_releases
-- ---------------------------------------------------------------------
-- The documented release of a record. One live release per record
-- (partial unique index). The documentation gate — id_verified +
-- ownership_doc_verified, plus zero active holds — is enforced in the
-- service layer; the columns are the audit record of what was checked.

CREATE TABLE IF NOT EXISTS impound_releases (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  impound_record_id       uuid NOT NULL REFERENCES impound_records(id) ON DELETE CASCADE,
  released_to_name        text NOT NULL,
  released_to_type        text NOT NULL,
  id_verified             boolean NOT NULL DEFAULT false,
  ownership_doc_verified  boolean NOT NULL DEFAULT false,
  authorization_doc_ref   text,
  payment_received_cents  bigint NOT NULL DEFAULT 0,
  payment_method          text,
  total_fees_cents        bigint NOT NULL DEFAULT 0,
  released_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  released_at             timestamptz NOT NULL DEFAULT now(),
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);

ALTER TABLE impound_releases DROP CONSTRAINT IF EXISTS impound_releases_released_to_name_nonempty;
ALTER TABLE impound_releases ADD CONSTRAINT impound_releases_released_to_name_nonempty
  CHECK (length(trim(released_to_name)) > 0);

ALTER TABLE impound_releases DROP CONSTRAINT IF EXISTS impound_releases_released_to_type_chk;
ALTER TABLE impound_releases ADD CONSTRAINT impound_releases_released_to_type_chk
  CHECK (released_to_type IN ('owner', 'agent', 'insurance', 'lienholder', 'salvage', 'other'));

ALTER TABLE impound_releases DROP CONSTRAINT IF EXISTS impound_releases_payment_method_chk;
ALTER TABLE impound_releases ADD CONSTRAINT impound_releases_payment_method_chk
  CHECK (payment_method IS NULL OR payment_method IN ('cash', 'card', 'check', 'ach', 'waived', 'other'));

ALTER TABLE impound_releases DROP CONSTRAINT IF EXISTS impound_releases_payment_nonneg;
ALTER TABLE impound_releases ADD CONSTRAINT impound_releases_payment_nonneg
  CHECK (payment_received_cents >= 0);

ALTER TABLE impound_releases DROP CONSTRAINT IF EXISTS impound_releases_total_fees_nonneg;
ALTER TABLE impound_releases ADD CONSTRAINT impound_releases_total_fees_nonneg
  CHECK (total_fees_cents >= 0);

-- One live release per record.
DROP INDEX IF EXISTS impound_releases_record_unique;
CREATE UNIQUE INDEX impound_releases_record_unique
  ON impound_releases (impound_record_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS impound_releases_tenant_record_idx
  ON impound_releases (tenant_id, impound_record_id)
  WHERE deleted_at IS NULL;

ALTER TABLE impound_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE impound_releases FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS impound_releases_tenant_isolation ON impound_releases;
CREATE POLICY impound_releases_tenant_isolation ON impound_releases
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_impound_releases_tenant_consistency ON impound_releases;
CREATE TRIGGER trg_impound_releases_tenant_consistency
  BEFORE INSERT OR UPDATE ON impound_releases
  FOR EACH ROW EXECUTE FUNCTION fn_impound_child_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_impound_releases ON impound_releases;
CREATE TRIGGER trg_audit_impound_releases
  AFTER INSERT OR UPDATE OR DELETE ON impound_releases
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_impound_releases_set_updated_at ON impound_releases;
CREATE TRIGGER trg_impound_releases_set_updated_at
  BEFORE UPDATE ON impound_releases
  FOR EACH ROW EXECUTE FUNCTION fn_impound_set_updated_at();
