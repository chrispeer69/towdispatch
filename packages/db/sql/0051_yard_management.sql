-- =====================================================================
-- 0051_yard_management.sql  (Yard Management — Session 54)
--
-- The operator-facing yard floor, layered ADDITIVELY over Session 22's
-- impound module (impound_records is the vehicle of record; this session
-- never alters it). Adds:
--   1. yard_facilities      — physical facilities a tenant operates
--   2. yard_stalls          — the visual stall grid per facility
--   3. yard_stall_photos    — photos attached to a stall
--   4. storage_rate_cards   — per-facility, per-vehicle-class day rates
--   5. storage_billing_runs — one row per auto-billing cron sweep
--   6. storage_charges      — per-vehicle, per-day storage charge ledger
--   7. release_workflows    — the gated 4-step vehicle-release wizard
--
-- Relationship to Session 22 (documented in SESSION_54_DECISIONS.md):
--   * yard_facilities is a NEW concept distinct from impound_yards; the two
--     coexist. impound_records.yard_id keeps pointing at impound_yards.
--   * storage_charges is a NEW, rate-card-driven ledger that is INDEPENDENT
--     of impound_fees (the S22 flat daily_fee_cents ledger). Both can run;
--     STORAGE_AUTOBILLING_CRON_ENABLED defaults false so they never
--     double-bill in prod by accident.
--
-- Patterns mirror 0036_impound_storage.sql exactly:
--   * tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT.
--   * ENABLE + FORCE ROW LEVEL SECURITY; policy USING/WITH CHECK
--     (tenant_id = fn_current_tenant_id()).
--   * fn_audit_log() AFTER trigger on every table.
--   * Idempotent everywhere: CREATE ... IF NOT EXISTS, DROP ... IF EXISTS
--     before each constraint / policy / trigger / index.
--   * Soft delete (deleted_at) on the long-lived config + ledger tables.
--   * One shared BEFORE UPDATE updated_at stamper.
--   * Cross-tenant consistency BEFORE triggers: RLS hides foreign parents,
--     so a foreign FK surfaces as "does not exist".
--
-- Down (rollback):
--   DROP TABLE IF EXISTS release_workflows;
--   DROP TABLE IF EXISTS storage_charges;
--   DROP TABLE IF EXISTS storage_billing_runs;
--   DROP TABLE IF EXISTS storage_rate_cards;
--   DROP TABLE IF EXISTS yard_stall_photos;
--   DROP TABLE IF EXISTS yard_stalls;
--   DROP TABLE IF EXISTS yard_facilities;
--   DROP FUNCTION IF EXISTS fn_yard_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helper: generic updated_at stamper for all yard tables.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_yard_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. yard_facilities
-- ---------------------------------------------------------------------
-- A physical facility a tenant operates. `address` and `gate_hours` are
-- jsonb (free-form structured blobs the UI renders). Many per tenant.

CREATE TABLE IF NOT EXISTS yard_facilities (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name            text NOT NULL,
  address         jsonb NOT NULL DEFAULT '{}'::jsonb,
  gate_hours      jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes           text,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

ALTER TABLE yard_facilities DROP CONSTRAINT IF EXISTS yard_facilities_name_nonempty;
ALTER TABLE yard_facilities ADD CONSTRAINT yard_facilities_name_nonempty
  CHECK (length(trim(name)) > 0);

CREATE INDEX IF NOT EXISTS yard_facilities_tenant_active_idx
  ON yard_facilities (tenant_id, is_active)
  WHERE deleted_at IS NULL;

ALTER TABLE yard_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE yard_facilities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS yard_facilities_tenant_isolation ON yard_facilities;
CREATE POLICY yard_facilities_tenant_isolation ON yard_facilities
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_yard_facilities ON yard_facilities;
CREATE TRIGGER trg_audit_yard_facilities
  AFTER INSERT OR UPDATE OR DELETE ON yard_facilities
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_yard_facilities_set_updated_at ON yard_facilities;
CREATE TRIGGER trg_yard_facilities_set_updated_at
  BEFORE UPDATE ON yard_facilities
  FOR EACH ROW EXECUTE FUNCTION fn_yard_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. yard_stalls
-- ---------------------------------------------------------------------
-- One stall on a facility's floor. (x, y) are grid coordinates the web
-- map renders; (row, col) are optional human labels. occupied_by_impound_id
-- points at the S22 impound_records row currently parked here (NULL = empty).

CREATE TABLE IF NOT EXISTS yard_stalls (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  facility_id             uuid NOT NULL REFERENCES yard_facilities(id) ON DELETE RESTRICT,
  label                   text NOT NULL,
  row_label               text,
  col_label               text,
  x                       integer NOT NULL DEFAULT 0,
  y                       integer NOT NULL DEFAULT 0,
  stall_type              text NOT NULL DEFAULT 'standard',
  occupied_by_impound_id  uuid REFERENCES impound_records(id) ON DELETE SET NULL,
  occupied_since          timestamptz,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);

ALTER TABLE yard_stalls DROP CONSTRAINT IF EXISTS yard_stalls_label_nonempty;
ALTER TABLE yard_stalls ADD CONSTRAINT yard_stalls_label_nonempty
  CHECK (length(trim(label)) > 0);

ALTER TABLE yard_stalls DROP CONSTRAINT IF EXISTS yard_stalls_type_chk;
ALTER TABLE yard_stalls ADD CONSTRAINT yard_stalls_type_chk
  CHECK (stall_type IN ('standard', 'oversized', 'covered', 'secure', 'hazmat', 'ev'));

-- An occupied stall must record when occupancy began, and vice versa.
ALTER TABLE yard_stalls DROP CONSTRAINT IF EXISTS yard_stalls_occupancy_consistent;
ALTER TABLE yard_stalls ADD CONSTRAINT yard_stalls_occupancy_consistent
  CHECK (
    (occupied_by_impound_id IS NULL AND occupied_since IS NULL)
    OR (occupied_by_impound_id IS NOT NULL AND occupied_since IS NOT NULL)
  );

-- One live stall per (tenant, facility, label) — the idempotency anchor.
DROP INDEX IF EXISTS yard_stalls_facility_label_unique;
CREATE UNIQUE INDEX yard_stalls_facility_label_unique
  ON yard_stalls (tenant_id, facility_id, lower(label))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS yard_stalls_tenant_facility_idx
  ON yard_stalls (tenant_id, facility_id)
  WHERE deleted_at IS NULL;

-- One vehicle occupies at most one stall: partial unique on the occupant.
DROP INDEX IF EXISTS yard_stalls_occupant_unique;
CREATE UNIQUE INDEX yard_stalls_occupant_unique
  ON yard_stalls (occupied_by_impound_id)
  WHERE occupied_by_impound_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE yard_stalls ENABLE ROW LEVEL SECURITY;
ALTER TABLE yard_stalls FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS yard_stalls_tenant_isolation ON yard_stalls;
CREATE POLICY yard_stalls_tenant_isolation ON yard_stalls
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- Cross-tenant consistency: facility (required) + occupant impound record
-- (optional) must belong to this row's tenant.
CREATE OR REPLACE FUNCTION fn_yard_stalls_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_facility_tenant uuid;
  v_impound_tenant  uuid;
BEGIN
  SELECT tenant_id INTO v_facility_tenant FROM yard_facilities WHERE id = NEW.facility_id;
  IF v_facility_tenant IS NULL THEN
    RAISE EXCEPTION 'yard_stalls: facility_id % does not exist', NEW.facility_id;
  END IF;
  IF v_facility_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'yard_stalls: tenant_id (%) does not match yard_facilities.tenant_id (%)',
      NEW.tenant_id, v_facility_tenant;
  END IF;

  IF NEW.occupied_by_impound_id IS NOT NULL THEN
    SELECT tenant_id INTO v_impound_tenant FROM impound_records WHERE id = NEW.occupied_by_impound_id;
    IF v_impound_tenant IS NULL THEN
      RAISE EXCEPTION 'yard_stalls: occupied_by_impound_id % does not exist', NEW.occupied_by_impound_id;
    END IF;
    IF v_impound_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'yard_stalls: tenant_id (%) does not match impound_records.tenant_id (%)',
        NEW.tenant_id, v_impound_tenant;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_yard_stalls_tenant_consistency ON yard_stalls;
CREATE TRIGGER trg_yard_stalls_tenant_consistency
  BEFORE INSERT OR UPDATE ON yard_stalls
  FOR EACH ROW EXECUTE FUNCTION fn_yard_stalls_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_yard_stalls ON yard_stalls;
CREATE TRIGGER trg_audit_yard_stalls
  AFTER INSERT OR UPDATE OR DELETE ON yard_stalls
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_yard_stalls_set_updated_at ON yard_stalls;
CREATE TRIGGER trg_yard_stalls_set_updated_at
  BEFORE UPDATE ON yard_stalls
  FOR EACH ROW EXECUTE FUNCTION fn_yard_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. yard_stall_photos
-- ---------------------------------------------------------------------
-- Photos pinned to a stall (overview / vehicle in / vehicle out / condition).
-- No soft delete: photos are append-only evidence; a hard delete is the
-- intentional "remove this photo" action via the service.

CREATE TABLE IF NOT EXISTS yard_stall_photos (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  stall_id            uuid NOT NULL REFERENCES yard_stalls(id) ON DELETE CASCADE,
  photo_url           text NOT NULL,
  photo_type          text NOT NULL DEFAULT 'overview',
  captured_at         timestamptz NOT NULL DEFAULT now(),
  captured_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE yard_stall_photos DROP CONSTRAINT IF EXISTS yard_stall_photos_url_nonempty;
ALTER TABLE yard_stall_photos ADD CONSTRAINT yard_stall_photos_url_nonempty
  CHECK (length(trim(photo_url)) > 0);

ALTER TABLE yard_stall_photos DROP CONSTRAINT IF EXISTS yard_stall_photos_type_chk;
ALTER TABLE yard_stall_photos ADD CONSTRAINT yard_stall_photos_type_chk
  CHECK (photo_type IN ('overview', 'vehicle_in', 'vehicle_out', 'condition'));

CREATE INDEX IF NOT EXISTS yard_stall_photos_tenant_stall_idx
  ON yard_stall_photos (tenant_id, stall_id);

ALTER TABLE yard_stall_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE yard_stall_photos FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS yard_stall_photos_tenant_isolation ON yard_stall_photos;
CREATE POLICY yard_stall_photos_tenant_isolation ON yard_stall_photos
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

CREATE OR REPLACE FUNCTION fn_yard_stall_photos_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_stall_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_stall_tenant FROM yard_stalls WHERE id = NEW.stall_id;
  IF v_stall_tenant IS NULL THEN
    RAISE EXCEPTION 'yard_stall_photos: stall_id % does not exist', NEW.stall_id;
  END IF;
  IF v_stall_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'yard_stall_photos: tenant_id (%) does not match yard_stalls.tenant_id (%)',
      NEW.tenant_id, v_stall_tenant;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_yard_stall_photos_tenant_consistency ON yard_stall_photos;
CREATE TRIGGER trg_yard_stall_photos_tenant_consistency
  BEFORE INSERT OR UPDATE ON yard_stall_photos
  FOR EACH ROW EXECUTE FUNCTION fn_yard_stall_photos_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_yard_stall_photos ON yard_stall_photos;
CREATE TRIGGER trg_audit_yard_stall_photos
  AFTER INSERT OR UPDATE OR DELETE ON yard_stall_photos
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_yard_stall_photos_set_updated_at ON yard_stall_photos;
CREATE TRIGGER trg_yard_stall_photos_set_updated_at
  BEFORE UPDATE ON yard_stall_photos
  FOR EACH ROW EXECUTE FUNCTION fn_yard_set_updated_at();


-- ---------------------------------------------------------------------
-- 4. storage_rate_cards
-- ---------------------------------------------------------------------
-- Per-facility, per-vehicle-class daily storage rate, effective over a
-- date window. free_days waives the first N calendar days; max_daily_rate
-- caps a single day's charge (NULL = uncapped). The service enforces
-- non-overlapping effective windows per (facility, vehicle_class).

CREATE TABLE IF NOT EXISTS storage_rate_cards (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  facility_id          uuid NOT NULL REFERENCES yard_facilities(id) ON DELETE RESTRICT,
  name                 text NOT NULL,
  vehicle_class        text NOT NULL,
  daily_rate_cents     integer NOT NULL,
  free_days            integer NOT NULL DEFAULT 0,
  max_daily_rate_cents integer,
  effective_from       date NOT NULL,
  effective_to         date,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz
);

ALTER TABLE storage_rate_cards DROP CONSTRAINT IF EXISTS storage_rate_cards_name_nonempty;
ALTER TABLE storage_rate_cards ADD CONSTRAINT storage_rate_cards_name_nonempty
  CHECK (length(trim(name)) > 0);

ALTER TABLE storage_rate_cards DROP CONSTRAINT IF EXISTS storage_rate_cards_vehicle_class_chk;
ALTER TABLE storage_rate_cards ADD CONSTRAINT storage_rate_cards_vehicle_class_chk
  CHECK (vehicle_class IN ('passenger', 'light_truck', 'heavy', 'motorcycle', 'trailer', 'rv'));

ALTER TABLE storage_rate_cards DROP CONSTRAINT IF EXISTS storage_rate_cards_daily_rate_nonneg;
ALTER TABLE storage_rate_cards ADD CONSTRAINT storage_rate_cards_daily_rate_nonneg
  CHECK (daily_rate_cents >= 0);

ALTER TABLE storage_rate_cards DROP CONSTRAINT IF EXISTS storage_rate_cards_free_days_nonneg;
ALTER TABLE storage_rate_cards ADD CONSTRAINT storage_rate_cards_free_days_nonneg
  CHECK (free_days >= 0);

ALTER TABLE storage_rate_cards DROP CONSTRAINT IF EXISTS storage_rate_cards_max_rate_nonneg;
ALTER TABLE storage_rate_cards ADD CONSTRAINT storage_rate_cards_max_rate_nonneg
  CHECK (max_daily_rate_cents IS NULL OR max_daily_rate_cents >= 0);

ALTER TABLE storage_rate_cards DROP CONSTRAINT IF EXISTS storage_rate_cards_effective_order;
ALTER TABLE storage_rate_cards ADD CONSTRAINT storage_rate_cards_effective_order
  CHECK (effective_to IS NULL OR effective_to >= effective_from);

CREATE INDEX IF NOT EXISTS storage_rate_cards_tenant_facility_class_idx
  ON storage_rate_cards (tenant_id, facility_id, vehicle_class, effective_from)
  WHERE deleted_at IS NULL;

ALTER TABLE storage_rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_rate_cards FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS storage_rate_cards_tenant_isolation ON storage_rate_cards;
CREATE POLICY storage_rate_cards_tenant_isolation ON storage_rate_cards
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

CREATE OR REPLACE FUNCTION fn_storage_rate_cards_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_facility_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_facility_tenant FROM yard_facilities WHERE id = NEW.facility_id;
  IF v_facility_tenant IS NULL THEN
    RAISE EXCEPTION 'storage_rate_cards: facility_id % does not exist', NEW.facility_id;
  END IF;
  IF v_facility_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'storage_rate_cards: tenant_id (%) does not match yard_facilities.tenant_id (%)',
      NEW.tenant_id, v_facility_tenant;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_storage_rate_cards_tenant_consistency ON storage_rate_cards;
CREATE TRIGGER trg_storage_rate_cards_tenant_consistency
  BEFORE INSERT OR UPDATE ON storage_rate_cards
  FOR EACH ROW EXECUTE FUNCTION fn_storage_rate_cards_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_storage_rate_cards ON storage_rate_cards;
CREATE TRIGGER trg_audit_storage_rate_cards
  AFTER INSERT OR UPDATE OR DELETE ON storage_rate_cards
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_storage_rate_cards_set_updated_at ON storage_rate_cards;
CREATE TRIGGER trg_storage_rate_cards_set_updated_at
  BEFORE UPDATE ON storage_rate_cards
  FOR EACH ROW EXECUTE FUNCTION fn_yard_set_updated_at();


-- ---------------------------------------------------------------------
-- 5. storage_billing_runs
-- ---------------------------------------------------------------------
-- One summary row per auto-billing cron sweep (per tenant, optionally per
-- facility). No soft delete — an immutable run log.

CREATE TABLE IF NOT EXISTS storage_billing_runs (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  facility_id          uuid REFERENCES yard_facilities(id) ON DELETE SET NULL,
  ran_at               timestamptz NOT NULL DEFAULT now(),
  period_start         date NOT NULL,
  period_end           date NOT NULL,
  vehicles_charged     integer NOT NULL DEFAULT 0,
  total_charged_cents  bigint NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'pending',
  error_text           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storage_billing_runs DROP CONSTRAINT IF EXISTS storage_billing_runs_status_chk;
ALTER TABLE storage_billing_runs ADD CONSTRAINT storage_billing_runs_status_chk
  CHECK (status IN ('pending', 'completed', 'failed'));

ALTER TABLE storage_billing_runs DROP CONSTRAINT IF EXISTS storage_billing_runs_counts_nonneg;
ALTER TABLE storage_billing_runs ADD CONSTRAINT storage_billing_runs_counts_nonneg
  CHECK (vehicles_charged >= 0 AND total_charged_cents >= 0);

CREATE INDEX IF NOT EXISTS storage_billing_runs_tenant_ran_idx
  ON storage_billing_runs (tenant_id, ran_at DESC);

ALTER TABLE storage_billing_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_billing_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS storage_billing_runs_tenant_isolation ON storage_billing_runs;
CREATE POLICY storage_billing_runs_tenant_isolation ON storage_billing_runs
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_storage_billing_runs ON storage_billing_runs;
CREATE TRIGGER trg_audit_storage_billing_runs
  AFTER INSERT OR UPDATE OR DELETE ON storage_billing_runs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_storage_billing_runs_set_updated_at ON storage_billing_runs;
CREATE TRIGGER trg_storage_billing_runs_set_updated_at
  BEFORE UPDATE ON storage_billing_runs
  FOR EACH ROW EXECUTE FUNCTION fn_yard_set_updated_at();


-- ---------------------------------------------------------------------
-- 6. storage_charges
-- ---------------------------------------------------------------------
-- One row per (impound_record, charge_date) — the rate-card-driven daily
-- storage ledger. The partial unique on (impound_id, charge_date) makes a
-- double cron run a no-op (cannot double-charge a vehicle for a day).

CREATE TABLE IF NOT EXISTS storage_charges (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  impound_id      uuid NOT NULL REFERENCES impound_records(id) ON DELETE CASCADE,
  charge_date     date NOT NULL,
  vehicle_class   text NOT NULL,
  rate_card_id    uuid REFERENCES storage_rate_cards(id) ON DELETE SET NULL,
  amount_cents    integer NOT NULL,
  billing_run_id  uuid REFERENCES storage_billing_runs(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storage_charges DROP CONSTRAINT IF EXISTS storage_charges_vehicle_class_chk;
ALTER TABLE storage_charges ADD CONSTRAINT storage_charges_vehicle_class_chk
  CHECK (vehicle_class IN ('passenger', 'light_truck', 'heavy', 'motorcycle', 'trailer', 'rv'));

ALTER TABLE storage_charges DROP CONSTRAINT IF EXISTS storage_charges_amount_nonneg;
ALTER TABLE storage_charges ADD CONSTRAINT storage_charges_amount_nonneg
  CHECK (amount_cents >= 0);

-- One charge per vehicle per day (auto-billing idempotency anchor).
DROP INDEX IF EXISTS storage_charges_impound_day_unique;
CREATE UNIQUE INDEX storage_charges_impound_day_unique
  ON storage_charges (impound_id, charge_date);

CREATE INDEX IF NOT EXISTS storage_charges_tenant_impound_idx
  ON storage_charges (tenant_id, impound_id);

CREATE INDEX IF NOT EXISTS storage_charges_billing_run_idx
  ON storage_charges (billing_run_id);

ALTER TABLE storage_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_charges FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS storage_charges_tenant_isolation ON storage_charges;
CREATE POLICY storage_charges_tenant_isolation ON storage_charges
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- Cross-tenant consistency: the impound record (required) must belong to
-- this row's tenant. rate_card / billing_run are tenant-local by FK + the
-- same RLS hiding, but the impound record is the security-critical link.
CREATE OR REPLACE FUNCTION fn_storage_charges_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_impound_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_impound_tenant FROM impound_records WHERE id = NEW.impound_id;
  IF v_impound_tenant IS NULL THEN
    RAISE EXCEPTION 'storage_charges: impound_id % does not exist', NEW.impound_id;
  END IF;
  IF v_impound_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'storage_charges: tenant_id (%) does not match impound_records.tenant_id (%)',
      NEW.tenant_id, v_impound_tenant;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_storage_charges_tenant_consistency ON storage_charges;
CREATE TRIGGER trg_storage_charges_tenant_consistency
  BEFORE INSERT OR UPDATE ON storage_charges
  FOR EACH ROW EXECUTE FUNCTION fn_storage_charges_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_storage_charges ON storage_charges;
CREATE TRIGGER trg_audit_storage_charges
  AFTER INSERT OR UPDATE OR DELETE ON storage_charges
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_storage_charges_set_updated_at ON storage_charges;
CREATE TRIGGER trg_storage_charges_set_updated_at
  BEFORE UPDATE ON storage_charges
  FOR EACH ROW EXECUTE FUNCTION fn_yard_set_updated_at();


-- ---------------------------------------------------------------------
-- 7. release_workflows
-- ---------------------------------------------------------------------
-- The gated vehicle-release wizard. One LIVE (non-cancelled) workflow per
-- impound record. The state machine + gates are enforced in the service;
-- the columns are the audit record of what was checked / collected.

CREATE TABLE IF NOT EXISTS release_workflows (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  impound_id               uuid NOT NULL REFERENCES impound_records(id) ON DELETE CASCADE,
  status                   text NOT NULL DEFAULT 'initiated',
  initiated_at             timestamptz NOT NULL DEFAULT now(),
  initiated_by_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at             timestamptz,
  cancelled_at             timestamptz,
  cancel_reason            text,
  payer_name               text,
  payer_id_type            text,
  payer_id_last4           text,
  lienholder_auth_ref      text,
  payment_amount_cents     bigint,
  payment_method           text,
  gate_released_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  gate_released_at         timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE release_workflows DROP CONSTRAINT IF EXISTS release_workflows_status_chk;
ALTER TABLE release_workflows ADD CONSTRAINT release_workflows_status_chk
  CHECK (status IN ('initiated', 'id_verified', 'lienholder_authorized',
                    'payment_collected', 'gate_released', 'cancelled'));

ALTER TABLE release_workflows DROP CONSTRAINT IF EXISTS release_workflows_payer_id_type_chk;
ALTER TABLE release_workflows ADD CONSTRAINT release_workflows_payer_id_type_chk
  CHECK (payer_id_type IS NULL OR payer_id_type IN
    ('drivers_license', 'state_id', 'passport', 'military_id', 'other'));

ALTER TABLE release_workflows DROP CONSTRAINT IF EXISTS release_workflows_payment_method_chk;
ALTER TABLE release_workflows ADD CONSTRAINT release_workflows_payment_method_chk
  CHECK (payment_method IS NULL OR payment_method IN
    ('cash', 'card', 'check', 'ach', 'waived', 'other'));

ALTER TABLE release_workflows DROP CONSTRAINT IF EXISTS release_workflows_payment_nonneg;
ALTER TABLE release_workflows ADD CONSTRAINT release_workflows_payment_nonneg
  CHECK (payment_amount_cents IS NULL OR payment_amount_cents >= 0);

ALTER TABLE release_workflows DROP CONSTRAINT IF EXISTS release_workflows_id_last4_fmt;
ALTER TABLE release_workflows ADD CONSTRAINT release_workflows_id_last4_fmt
  CHECK (payer_id_last4 IS NULL OR payer_id_last4 ~ '^[0-9A-Za-z]{1,4}$');

-- One live (not cancelled) workflow per impound record.
DROP INDEX IF EXISTS release_workflows_impound_live_unique;
CREATE UNIQUE INDEX release_workflows_impound_live_unique
  ON release_workflows (impound_id)
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS release_workflows_tenant_status_idx
  ON release_workflows (tenant_id, status);

ALTER TABLE release_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_workflows FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS release_workflows_tenant_isolation ON release_workflows;
CREATE POLICY release_workflows_tenant_isolation ON release_workflows
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

CREATE OR REPLACE FUNCTION fn_release_workflows_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_impound_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_impound_tenant FROM impound_records WHERE id = NEW.impound_id;
  IF v_impound_tenant IS NULL THEN
    RAISE EXCEPTION 'release_workflows: impound_id % does not exist', NEW.impound_id;
  END IF;
  IF v_impound_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'release_workflows: tenant_id (%) does not match impound_records.tenant_id (%)',
      NEW.tenant_id, v_impound_tenant;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_release_workflows_tenant_consistency ON release_workflows;
CREATE TRIGGER trg_release_workflows_tenant_consistency
  BEFORE INSERT OR UPDATE ON release_workflows
  FOR EACH ROW EXECUTE FUNCTION fn_release_workflows_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_release_workflows ON release_workflows;
CREATE TRIGGER trg_audit_release_workflows
  AFTER INSERT OR UPDATE OR DELETE ON release_workflows
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_release_workflows_set_updated_at ON release_workflows;
CREATE TRIGGER trg_release_workflows_set_updated_at
  BEFORE UPDATE ON release_workflows
  FOR EACH ROW EXECUTE FUNCTION fn_yard_set_updated_at();
