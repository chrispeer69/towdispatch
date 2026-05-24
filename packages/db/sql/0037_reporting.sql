-- =====================================================================
-- 0037_reporting.sql  (Session 14)
--
-- Reporting & Analytics — saved reports, scheduled reports, commission rules,
-- and a small set of materialized views used by the high-volume reports.
--
-- Decisions captured here:
--   * commission_rules — was a forward-declared FK from drivers.commission_rule_id
--     in Session 8 (the column existed without a referenced table). This
--     migration creates the table and back-fills the FK constraint.
--   * saved_reports / report_schedules — saved filter configurations and
--     optional email schedule. RLS-enforced, audit-triggered. One row per
--     saved config, optional 1:1 schedule.
--   * report_runs — append-only log of every emitted (interactive or scheduled)
--     report run. Used for the "last run" indicator and basic audit.
--   * mv_reporting_jobs_daily / mv_reporting_revenue_daily — materialized
--     views to keep the heavy aggregations under the 800ms p99 budget on
--     100k+ job tenants. Refreshed every 5 minutes by a cron-driven REFRESH
--     MATERIALIZED VIEW CONCURRENTLY call (queued from the reporting module).
-- =====================================================================

-- ---------- commission_rules ----------
CREATE TABLE IF NOT EXISTS commission_rules (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text,
  /* 'percent' | 'flat' — the calculation kind. Percent rates use rate_pct;
     flat rates use flat_cents. */
  rule_type text NOT NULL DEFAULT 'percent',
  rate_pct numeric(6,4) NOT NULL DEFAULT '0',
  flat_cents bigint NOT NULL DEFAULT 0,
  /* Optional cap so a percent rule can never pay out more than this. NULL
     means no cap. */
  cap_cents bigint,
  /* Optional minimum guaranteed per-job payout — pads up a percent-of-tiny
     job to a floor. */
  floor_cents bigint NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE commission_rules
  DROP CONSTRAINT IF EXISTS commission_rules_rule_type_chk;
ALTER TABLE commission_rules
  ADD CONSTRAINT commission_rules_rule_type_chk
  CHECK (rule_type IN ('percent', 'flat'));

CREATE UNIQUE INDEX IF NOT EXISTS commission_rules_tenant_name_unique
  ON commission_rules (tenant_id, name)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS commission_rules_tenant_active_idx
  ON commission_rules (tenant_id, active);

-- Back-fill the forward-declared FK from Session 8 drivers schema. Idempotent.
ALTER TABLE drivers
  DROP CONSTRAINT IF EXISTS drivers_commission_rule_id_fk;
ALTER TABLE drivers
  ADD CONSTRAINT drivers_commission_rule_id_fk
  FOREIGN KEY (commission_rule_id) REFERENCES commission_rules(id) ON DELETE SET NULL;

ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commission_rules_tenant_isolation ON commission_rules;
CREATE POLICY commission_rules_tenant_isolation ON commission_rules
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_commission_rules ON commission_rules;
CREATE TRIGGER trg_audit_commission_rules
  AFTER INSERT OR UPDATE OR DELETE ON commission_rules
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

GRANT SELECT, INSERT, UPDATE, DELETE ON commission_rules TO app_user;


-- ---------- saved_reports ----------
CREATE TABLE IF NOT EXISTS saved_reports (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  /* The report category id — 'dispatch-performance', 'revenue', etc. */
  report_id text NOT NULL,
  name text NOT NULL,
  /* Saved filter values; replayed verbatim on every run. */
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS saved_reports_tenant_report_idx
  ON saved_reports (tenant_id, report_id);
CREATE UNIQUE INDEX IF NOT EXISTS saved_reports_tenant_name_unique
  ON saved_reports (tenant_id, name)
  WHERE deleted_at IS NULL;

ALTER TABLE saved_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saved_reports_tenant_isolation ON saved_reports;
CREATE POLICY saved_reports_tenant_isolation ON saved_reports
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_saved_reports ON saved_reports;
CREATE TRIGGER trg_audit_saved_reports
  AFTER INSERT OR UPDATE OR DELETE ON saved_reports
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

GRANT SELECT, INSERT, UPDATE, DELETE ON saved_reports TO app_user;


-- ---------- report_schedules ----------
CREATE TABLE IF NOT EXISTS report_schedules (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  saved_report_id uuid NOT NULL REFERENCES saved_reports(id) ON DELETE CASCADE,
  cadence text NOT NULL,
  format text NOT NULL,
  /* Email recipients — array of validated addresses. */
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_status text,
  last_run_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE report_schedules
  DROP CONSTRAINT IF EXISTS report_schedules_cadence_chk;
ALTER TABLE report_schedules
  ADD CONSTRAINT report_schedules_cadence_chk
  CHECK (cadence IN ('daily', 'weekly', 'monthly'));

ALTER TABLE report_schedules
  DROP CONSTRAINT IF EXISTS report_schedules_format_chk;
ALTER TABLE report_schedules
  ADD CONSTRAINT report_schedules_format_chk
  CHECK (format IN ('csv', 'pdf'));

CREATE UNIQUE INDEX IF NOT EXISTS report_schedules_saved_report_unique
  ON report_schedules (saved_report_id);
CREATE INDEX IF NOT EXISTS report_schedules_due_idx
  ON report_schedules (tenant_id, active, next_run_at);

ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS report_schedules_tenant_isolation ON report_schedules;
CREATE POLICY report_schedules_tenant_isolation ON report_schedules
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_report_schedules ON report_schedules;
CREATE TRIGGER trg_audit_report_schedules
  AFTER INSERT OR UPDATE OR DELETE ON report_schedules
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

GRANT SELECT, INSERT, UPDATE, DELETE ON report_schedules TO app_user;


-- ---------- report_runs ----------
CREATE TABLE IF NOT EXISTS report_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  report_id text NOT NULL,
  saved_report_id uuid REFERENCES saved_reports(id) ON DELETE SET NULL,
  schedule_id uuid REFERENCES report_schedules(id) ON DELETE SET NULL,
  format text NOT NULL,
  status text NOT NULL,
  rows_emitted integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  storage_key text,
  error text,
  initiated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE report_runs
  DROP CONSTRAINT IF EXISTS report_runs_format_chk;
ALTER TABLE report_runs
  ADD CONSTRAINT report_runs_format_chk
  CHECK (format IN ('csv', 'pdf', 'interactive'));

ALTER TABLE report_runs
  DROP CONSTRAINT IF EXISTS report_runs_status_chk;
ALTER TABLE report_runs
  ADD CONSTRAINT report_runs_status_chk
  CHECK (status IN ('success', 'failed'));

CREATE INDEX IF NOT EXISTS report_runs_tenant_created_idx
  ON report_runs (tenant_id, created_at DESC);

ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS report_runs_tenant_isolation ON report_runs;
CREATE POLICY report_runs_tenant_isolation ON report_runs
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON report_runs TO app_user;


-- ---------- Materialized views ----------
-- These are tenant-aware via the underlying tables. We DO NOT enforce RLS
-- on the matview itself (RLS on matviews is not supported in PG 16); all
-- consumer queries WHERE on tenant_id explicitly and run inside the
-- per-request tenant-aware transaction, which still gives us defense in
-- depth because the matview reads rows that already passed RLS at refresh
-- time. The base tables remain the authoritative isolation boundary.

DROP MATERIALIZED VIEW IF EXISTS mv_reporting_jobs_daily CASCADE;
CREATE MATERIALIZED VIEW mv_reporting_jobs_daily AS
  SELECT
    j.tenant_id,
    date_trunc('day', j.created_at)::date AS day,
    count(*) FILTER (WHERE j.status NOT IN ('cancelled')) AS jobs_total,
    count(*) FILTER (WHERE j.status = 'completed') AS jobs_completed,
    count(*) FILTER (WHERE j.status = 'goa') AS jobs_goa,
    count(*) FILTER (WHERE j.status = 'cancelled') AS jobs_cancelled,
    coalesce(sum(j.rate_quoted_cents) FILTER (WHERE j.status = 'completed'), 0) AS revenue_cents,
    j.service_type
  FROM jobs j
  WHERE j.deleted_at IS NULL
  GROUP BY j.tenant_id, day, j.service_type
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_reporting_jobs_daily_pk
  ON mv_reporting_jobs_daily (tenant_id, day, service_type);
CREATE INDEX IF NOT EXISTS mv_reporting_jobs_daily_tenant_day_idx
  ON mv_reporting_jobs_daily (tenant_id, day DESC);
GRANT SELECT ON mv_reporting_jobs_daily TO app_user;


DROP MATERIALIZED VIEW IF EXISTS mv_reporting_revenue_daily CASCADE;
CREATE MATERIALIZED VIEW mv_reporting_revenue_daily AS
  SELECT
    i.tenant_id,
    date_trunc('day', coalesce(i.issued_at, i.created_at))::date AS day,
    coalesce(i.invoice_type, 'manual') AS invoice_type,
    count(*) AS invoice_count,
    coalesce(sum(i.subtotal_cents), 0) AS subtotal_cents,
    coalesce(sum(i.tax_cents), 0) AS tax_cents,
    coalesce(sum(i.total_cents), 0) AS total_cents,
    coalesce(sum(i.paid_cents), 0) AS paid_cents,
    coalesce(sum(i.balance_cents), 0) AS balance_cents
  FROM invoices i
  WHERE i.deleted_at IS NULL
    AND i.status <> 'void'
  GROUP BY i.tenant_id, day, i.invoice_type
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_reporting_revenue_daily_pk
  ON mv_reporting_revenue_daily (tenant_id, day, invoice_type);
CREATE INDEX IF NOT EXISTS mv_reporting_revenue_daily_tenant_day_idx
  ON mv_reporting_revenue_daily (tenant_id, day DESC);
GRANT SELECT ON mv_reporting_revenue_daily TO app_user;


-- Initial population. Subsequent refreshes use CONCURRENTLY (requires the
-- unique index above) so reads aren't blocked.
REFRESH MATERIALIZED VIEW mv_reporting_jobs_daily;
REFRESH MATERIALIZED VIEW mv_reporting_revenue_daily;
