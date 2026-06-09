-- =====================================================================
-- 0017_import.sql
--
-- Session 16 — Towbook data importer.
--
-- Adds:
--   * external_source / external_id columns to every record type the
--     importer touches (customers, vehicles, jobs, drivers, trucks,
--     invoices, payments). The pair (tenant_id, external_source,
--     external_id) is unique per table — re-importing the same Towbook
--     row produces an idempotent UPDATE, never a duplicate INSERT.
--   * import_runs + import_run_events tables (tenant-scoped, RLS-forced,
--     audit-trigger'd) so the founder has a permanent record of what was
--     imported, when, and by whom.
--   * motor_club_dispatches table that the spec's Session 13 narrative
--     referred to. Session 13 in this repo turned out to be QuickBooks
--     Online, not motor-club history; this migration creates the table
--     fresh with the imported=true flag the importer needs.
--
-- Every modification uses IF NOT EXISTS / DROP IF EXISTS so the migration
-- is idempotent across re-runs.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. external_source / external_id columns
-- ---------------------------------------------------------------------------

ALTER TABLE customers ADD COLUMN IF NOT EXISTS external_source text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS external_id text;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS external_source text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS external_id text;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_source text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_id text;

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS external_source text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS external_id text;

ALTER TABLE trucks ADD COLUMN IF NOT EXISTS external_source text;
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS external_id text;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS external_source text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS external_id text;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS external_source text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS external_id text;

-- Idempotency: a partial unique index per table so re-importing the same
-- external row in the same tenant is a no-op (the importer reads the
-- existing row back and treats it as an UPDATE).
DROP INDEX IF EXISTS customers_external_unique;
CREATE UNIQUE INDEX customers_external_unique
  ON customers (tenant_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

DROP INDEX IF EXISTS vehicles_external_unique;
CREATE UNIQUE INDEX vehicles_external_unique
  ON vehicles (tenant_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

DROP INDEX IF EXISTS jobs_external_unique;
CREATE UNIQUE INDEX jobs_external_unique
  ON jobs (tenant_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

DROP INDEX IF EXISTS drivers_external_unique;
CREATE UNIQUE INDEX drivers_external_unique
  ON drivers (tenant_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

DROP INDEX IF EXISTS trucks_external_unique;
CREATE UNIQUE INDEX trucks_external_unique
  ON trucks (tenant_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

DROP INDEX IF EXISTS invoices_external_unique;
CREATE UNIQUE INDEX invoices_external_unique
  ON invoices (tenant_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

DROP INDEX IF EXISTS payments_external_unique;
CREATE UNIQUE INDEX payments_external_unique
  ON payments (tenant_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. import_runs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS import_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  initiated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'towbook',
  mode text NOT NULL,
  status text NOT NULL,
  bundle_storage_key text,
  errors_storage_key text,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  CONSTRAINT import_runs_mode_allowed CHECK (mode IN ('dry_run', 'live', 'reconcile')),
  CONSTRAINT import_runs_status_allowed CHECK (status IN ('queued', 'running', 'completed', 'cancelled', 'failed'))
);

CREATE INDEX IF NOT EXISTS import_runs_tenant_started_idx
  ON import_runs (tenant_id, started_at DESC);

ALTER TABLE import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_runs_tenant_isolation ON import_runs;
CREATE POLICY import_runs_tenant_isolation ON import_runs
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_import_runs ON import_runs;
CREATE TRIGGER trg_audit_import_runs
  AFTER INSERT OR UPDATE OR DELETE ON import_runs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------------------------------------------------------------------------
-- 3. import_run_events
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS import_run_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  record_type text NOT NULL,
  action text NOT NULL,
  external_id text,
  towdispatch_id uuid,
  error_message text,
  occurred_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT import_run_events_action_allowed
    CHECK (action IN ('create', 'update', 'skip_dedup', 'error', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS import_run_events_run_idx
  ON import_run_events (run_id, occurred_at);
CREATE INDEX IF NOT EXISTS import_run_events_run_action_idx
  ON import_run_events (run_id, action);

ALTER TABLE import_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_run_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_run_events_tenant_isolation ON import_run_events;
CREATE POLICY import_run_events_tenant_isolation ON import_run_events
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- ---------------------------------------------------------------------------
-- 4. motor_club_dispatches
--
-- The spec's reference to "Session 13's motor_club_dispatches table" doesn't
-- match what landed in Session 13 in this repo (that session was QuickBooks).
-- We create the table fresh here so the importer can route Towbook's network
-- history into a proper home. The Agero live integration (a later session)
-- will reuse this table; rows flagged imported=true pre-date live calls and
-- reconciliation knows to skip them.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS motor_club_dispatches (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  network text NOT NULL,
  network_external_id text,
  partial_fee_cents bigint,
  partial_fee_reason text,
  dispute_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  imported boolean NOT NULL DEFAULT false,
  external_source text,
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT motor_club_dispatches_network_allowed
    CHECK (network IN ('agero', 'aaa', 'allstate', 'urgently', 'honk', 'roadside_masters',
                       'state_farm', 'geico', 'progressive', 'other'))
);

CREATE INDEX IF NOT EXISTS motor_club_dispatches_tenant_job_idx
  ON motor_club_dispatches (tenant_id, job_id);
CREATE INDEX IF NOT EXISTS motor_club_dispatches_tenant_network_idx
  ON motor_club_dispatches (tenant_id, network);

DROP INDEX IF EXISTS motor_club_dispatches_external_unique;
CREATE UNIQUE INDEX motor_club_dispatches_external_unique
  ON motor_club_dispatches (tenant_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

ALTER TABLE motor_club_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE motor_club_dispatches FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS motor_club_dispatches_tenant_isolation ON motor_club_dispatches;
CREATE POLICY motor_club_dispatches_tenant_isolation ON motor_club_dispatches
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_motor_club_dispatches ON motor_club_dispatches;
CREATE TRIGGER trg_audit_motor_club_dispatches
  AFTER INSERT OR UPDATE OR DELETE ON motor_club_dispatches
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
