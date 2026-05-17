-- =====================================================================
-- 0026_invoice_line_commissions.sql  (Admin Settings — build 4 of 6)
--
-- Adds the per-invoice-line driver commission ledger plus the
-- multi-driver job assignment table. Together these power the
-- Invoice Review screen where a dispatcher splits an invoice's lines
-- across the drivers who worked the job.
--
-- New tables:
--
--   job_driver_assignments    — many-to-many (job, driver). One row per
--                               driver assigned to a job. The existing
--                               jobs.assigned_driver_id column models the
--                               *primary* driver; this table records the
--                               full crew (primary + support drivers) so
--                               multi-driver invoice splits are possible.
--                               Created only if it doesn't already exist.
--
--   invoice_line_commissions  — one row per (invoice_line_item, driver)
--                               recording the percent of that line the
--                               driver earns plus the cents amount frozen
--                               at post time. RLS + audit, plus a BEFORE
--                               INSERT/UPDATE trigger that rejects any
--                               write that would push a line's total
--                               commission % over 100.
--
-- Design notes:
--   * tenant_id is denormalized on both tables so the standard
--     fn_current_tenant_id() RLS policy works without joining through
--     invoice_line_items / jobs. The consistency trigger below validates
--     that tenant_id matches the parent row to prevent cross-tenant FK
--     injection (mirror of fn_service_rates_tenant_consistency in 0024).
--   * commission_pct is numeric(5,2). 0..100 enforced by CHECK.
--   * commission_amount_cents is integer (cents). It is computed and
--     written at POST time by the service layer — at the database it is
--     stored, not generated, so we can keep it cheap to read for the
--     Driver Commission Report (build 6).
--   * Unique (invoice_line_item_id, driver_id) — a driver appears at
--     most once per line item.
--   * Audit: trg_audit_invoice_line_commissions calls fn_audit_log
--     (defined in 0004) so every INSERT/UPDATE/DELETE writes to audit_log.
--   * Driver visibility wall: this table is never read by driver-role
--     endpoints. Enforced at the service / DTO layer, but RLS still
--     applies as the second line of defense.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP TRIGGER / POLICY IF
-- EXISTS, ADD CONSTRAINT via DROP+ADD. Safe to re-run.
--
-- Down (rollback):
--   DROP TRIGGER  IF EXISTS trg_audit_invoice_line_commissions ON invoice_line_commissions;
--   DROP TRIGGER  IF EXISTS trg_invoice_line_commission_sum_check ON invoice_line_commissions;
--   DROP TRIGGER  IF EXISTS trg_invoice_line_commissions_tenant_consistency ON invoice_line_commissions;
--   DROP TABLE    IF EXISTS invoice_line_commissions;
--   DROP TRIGGER  IF EXISTS trg_audit_job_driver_assignments ON job_driver_assignments;
--   DROP TABLE    IF EXISTS job_driver_assignments;  -- only if you created it here
-- =====================================================================

-- ---------- job_driver_assignments (created lazily) ----------
CREATE TABLE IF NOT EXISTS job_driver_assignments (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  driver_id   uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  -- Freeform v1: "primary", "support", "trainee", etc. The service layer
  -- writes "primary" for jobs.assigned_driver_id and "support" for the
  -- rest by default; dispatchers can edit via the review screen.
  role        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One driver per job (live, non-soft-deleted). Soft delete isn't modeled
-- here in v1 — operators remove a driver by deleting the row.
DROP INDEX IF EXISTS job_driver_assignments_job_driver_unique;
CREATE UNIQUE INDEX job_driver_assignments_job_driver_unique
  ON job_driver_assignments (job_id, driver_id);

CREATE INDEX IF NOT EXISTS job_driver_assignments_tenant_job_idx
  ON job_driver_assignments (tenant_id, job_id);

CREATE INDEX IF NOT EXISTS job_driver_assignments_tenant_driver_idx
  ON job_driver_assignments (tenant_id, driver_id);

ALTER TABLE job_driver_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_driver_assignments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_driver_assignments_tenant_isolation ON job_driver_assignments;
CREATE POLICY job_driver_assignments_tenant_isolation ON job_driver_assignments
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_job_driver_assignments ON job_driver_assignments;
CREATE TRIGGER trg_audit_job_driver_assignments
  AFTER INSERT OR UPDATE OR DELETE ON job_driver_assignments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- Tenant consistency trigger — reject a write whose tenant_id does not
-- match the job's tenant_id (parallel to fn_service_rates_tenant_consistency).
CREATE OR REPLACE FUNCTION fn_job_driver_assignments_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job_tenant    uuid;
  v_driver_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_job_tenant FROM jobs WHERE id = NEW.job_id;
  IF v_job_tenant IS NULL THEN
    RAISE EXCEPTION 'job_driver_assignments: job_id % does not exist', NEW.job_id;
  END IF;
  IF v_job_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'job_driver_assignments: tenant_id (%) does not match jobs.tenant_id (%)',
      NEW.tenant_id, v_job_tenant;
  END IF;

  SELECT tenant_id INTO v_driver_tenant FROM drivers WHERE id = NEW.driver_id;
  IF v_driver_tenant IS NULL THEN
    RAISE EXCEPTION 'job_driver_assignments: driver_id % does not exist', NEW.driver_id;
  END IF;
  IF v_driver_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'job_driver_assignments: tenant_id (%) does not match drivers.tenant_id (%)',
      NEW.tenant_id, v_driver_tenant;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_job_driver_assignments_tenant_consistency ON job_driver_assignments;
CREATE TRIGGER trg_job_driver_assignments_tenant_consistency
  BEFORE INSERT OR UPDATE ON job_driver_assignments
  FOR EACH ROW EXECUTE FUNCTION fn_job_driver_assignments_tenant_consistency();

GRANT SELECT, INSERT, UPDATE, DELETE ON job_driver_assignments TO app_user;
GRANT ALL ON job_driver_assignments TO app_admin;

-- ---------- invoice_line_commissions ----------
CREATE TABLE IF NOT EXISTS invoice_line_commissions (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  invoice_id               uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  invoice_line_item_id     uuid NOT NULL REFERENCES invoice_line_items(id) ON DELETE CASCADE,
  driver_id                uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  commission_pct           numeric(5,2) NOT NULL,
  -- Computed at post time = line.line_total_cents × commission_pct / 100.
  -- Drafts may store 0 here; the POST endpoint freezes the real cents.
  commission_amount_cents  integer NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE invoice_line_commissions
  DROP CONSTRAINT IF EXISTS invoice_line_commissions_pct_range;
ALTER TABLE invoice_line_commissions
  ADD CONSTRAINT invoice_line_commissions_pct_range
  CHECK (commission_pct >= 0 AND commission_pct <= 100);

ALTER TABLE invoice_line_commissions
  DROP CONSTRAINT IF EXISTS invoice_line_commissions_amount_nonneg;
ALTER TABLE invoice_line_commissions
  ADD CONSTRAINT invoice_line_commissions_amount_nonneg
  CHECK (commission_amount_cents >= 0);

DROP INDEX IF EXISTS invoice_line_commissions_line_driver_unique;
CREATE UNIQUE INDEX invoice_line_commissions_line_driver_unique
  ON invoice_line_commissions (invoice_line_item_id, driver_id);

CREATE INDEX IF NOT EXISTS invoice_line_commissions_tenant_invoice_idx
  ON invoice_line_commissions (tenant_id, invoice_id);

CREATE INDEX IF NOT EXISTS invoice_line_commissions_tenant_driver_idx
  ON invoice_line_commissions (tenant_id, driver_id);

CREATE INDEX IF NOT EXISTS invoice_line_commissions_tenant_line_idx
  ON invoice_line_commissions (tenant_id, invoice_line_item_id);

-- ---------- RLS ----------
ALTER TABLE invoice_line_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_commissions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_line_commissions_tenant_isolation ON invoice_line_commissions;
CREATE POLICY invoice_line_commissions_tenant_isolation ON invoice_line_commissions
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- ---------- tenant consistency ----------
CREATE OR REPLACE FUNCTION fn_invoice_line_commissions_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice_tenant uuid;
  v_line_tenant    uuid;
  v_line_invoice   uuid;
  v_driver_tenant  uuid;
BEGIN
  SELECT tenant_id INTO v_invoice_tenant FROM invoices WHERE id = NEW.invoice_id;
  IF v_invoice_tenant IS NULL THEN
    RAISE EXCEPTION 'invoice_line_commissions: invoice_id % does not exist', NEW.invoice_id;
  END IF;
  IF v_invoice_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'invoice_line_commissions: tenant_id (%) does not match invoices.tenant_id (%)',
      NEW.tenant_id, v_invoice_tenant;
  END IF;

  SELECT tenant_id, invoice_id INTO v_line_tenant, v_line_invoice
    FROM invoice_line_items WHERE id = NEW.invoice_line_item_id;
  IF v_line_tenant IS NULL THEN
    RAISE EXCEPTION 'invoice_line_commissions: invoice_line_item_id % does not exist',
      NEW.invoice_line_item_id;
  END IF;
  IF v_line_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'invoice_line_commissions: tenant_id (%) does not match invoice_line_items.tenant_id (%)',
      NEW.tenant_id, v_line_tenant;
  END IF;
  IF v_line_invoice <> NEW.invoice_id THEN
    RAISE EXCEPTION 'invoice_line_commissions: invoice_line_item_id % belongs to invoice %, not %',
      NEW.invoice_line_item_id, v_line_invoice, NEW.invoice_id;
  END IF;

  SELECT tenant_id INTO v_driver_tenant FROM drivers WHERE id = NEW.driver_id;
  IF v_driver_tenant IS NULL THEN
    RAISE EXCEPTION 'invoice_line_commissions: driver_id % does not exist', NEW.driver_id;
  END IF;
  IF v_driver_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'invoice_line_commissions: tenant_id (%) does not match drivers.tenant_id (%)',
      NEW.tenant_id, v_driver_tenant;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_invoice_line_commissions_tenant_consistency ON invoice_line_commissions;
CREATE TRIGGER trg_invoice_line_commissions_tenant_consistency
  BEFORE INSERT OR UPDATE ON invoice_line_commissions
  FOR EACH ROW EXECUTE FUNCTION fn_invoice_line_commissions_tenant_consistency();

-- ---------- per-line sum ≤ 100 trigger ----------
-- A line's commission_pct total across all of its drivers can never
-- exceed 100. We compute the new sum *including* the row being written
-- (and *excluding* the same row on UPDATE so percentage edits don't
-- double-count themselves).
CREATE OR REPLACE FUNCTION fn_invoice_line_commission_sum_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_sum numeric(7,2);
  v_proposed     numeric(7,2);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(SUM(commission_pct), 0) INTO v_existing_sum
      FROM invoice_line_commissions
     WHERE invoice_line_item_id = NEW.invoice_line_item_id
       AND id <> NEW.id;
  ELSE
    SELECT COALESCE(SUM(commission_pct), 0) INTO v_existing_sum
      FROM invoice_line_commissions
     WHERE invoice_line_item_id = NEW.invoice_line_item_id;
  END IF;

  v_proposed := v_existing_sum + NEW.commission_pct;

  IF v_proposed > 100 THEN
    RAISE EXCEPTION
      'commission percentages for line item % sum to %, exceeding 100',
      NEW.invoice_line_item_id, v_proposed
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_invoice_line_commission_sum_check ON invoice_line_commissions;
CREATE TRIGGER trg_invoice_line_commission_sum_check
  BEFORE INSERT OR UPDATE ON invoice_line_commissions
  FOR EACH ROW EXECUTE FUNCTION fn_invoice_line_commission_sum_check();

-- ---------- audit ----------
DROP TRIGGER IF EXISTS trg_audit_invoice_line_commissions ON invoice_line_commissions;
CREATE TRIGGER trg_audit_invoice_line_commissions
  AFTER INSERT OR UPDATE OR DELETE ON invoice_line_commissions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_line_commissions TO app_user;
GRANT ALL ON invoice_line_commissions TO app_admin;
