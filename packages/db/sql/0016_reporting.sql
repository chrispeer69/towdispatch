-- =====================================================================
-- 0016_reporting.sql  (Session 14)
--
-- Reporting & analytics module:
--   - saved_reports         (per-user named report configurations)
--   - report_schedules      (cron-ish email delivery for saved reports)
--   - mv_revenue_daily      (materialized view for the revenue report —
--                           the only query that fell out of the 800ms
--                           p99 budget on a 100k-job tenant)
--
-- All tenant tables FORCE RLS, tenant_id NOT NULL, audited.
-- =====================================================================

-- ---------- saved_reports ----------
CREATE TABLE IF NOT EXISTS saved_reports (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name            text NOT NULL,
  description     text,
  report_id       text NOT NULL,
  filters         jsonb NOT NULL,
  owner_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS saved_reports_tenant_owner_idx
  ON saved_reports (tenant_id, owner_user_id);
CREATE INDEX IF NOT EXISTS saved_reports_tenant_report_idx
  ON saved_reports (tenant_id, report_id);

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

-- ---------- report_schedules ----------
CREATE TABLE IF NOT EXISTS report_schedules (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  saved_report_id   uuid NOT NULL REFERENCES saved_reports(id) ON DELETE CASCADE,
  cadence           text NOT NULL CHECK (cadence IN ('daily','weekly','monthly')),
  hour_utc          bigint NOT NULL DEFAULT 13 CHECK (hour_utc >= 0 AND hour_utc <= 23),
  format            text NOT NULL DEFAULT 'pdf' CHECK (format IN ('csv','pdf')),
  recipients        jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_run_at       timestamptz,
  next_run_at       timestamptz,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE INDEX IF NOT EXISTS report_schedules_tenant_next_run_idx
  ON report_schedules (tenant_id, next_run_at);
CREATE INDEX IF NOT EXISTS report_schedules_tenant_saved_idx
  ON report_schedules (tenant_id, saved_report_id);

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

-- ---------- mv_revenue_daily ----------
-- Aggregates paid revenue by tenant + day + service_type + source-style flag.
-- Refreshed every 5 minutes by the scheduler (BullMQ repeatable job
-- `reporting:refresh-mv-revenue-daily`). RLS does NOT apply to materialized
-- views; queries against this MV must filter by tenant_id explicitly and the
-- API guard does exactly that.

DROP MATERIALIZED VIEW IF EXISTS mv_revenue_daily;

CREATE MATERIALIZED VIEW mv_revenue_daily AS
SELECT
  i.tenant_id,
  date_trunc('day', i.issued_at AT TIME ZONE 'UTC')::date          AS bucket,
  i.invoice_type                                                   AS source,
  COALESCE(j.service_type, 'other')                                AS service_type,
  i.account_id,
  COUNT(DISTINCT i.id)                                             AS invoice_count,
  COALESCE(SUM(i.total_cents), 0)::bigint                          AS total_cents,
  COALESCE(SUM(i.tax_cents), 0)::bigint                            AS tax_cents,
  COALESCE(SUM(i.paid_cents), 0)::bigint                           AS paid_cents
FROM invoices i
LEFT JOIN jobs j ON j.id = i.job_id
WHERE i.deleted_at IS NULL
  AND i.issued_at IS NOT NULL
  AND i.status <> 'void'
GROUP BY i.tenant_id, bucket, i.invoice_type, COALESCE(j.service_type, 'other'), i.account_id;

CREATE INDEX IF NOT EXISTS mv_revenue_daily_tenant_bucket_idx
  ON mv_revenue_daily (tenant_id, bucket);
CREATE INDEX IF NOT EXISTS mv_revenue_daily_tenant_service_idx
  ON mv_revenue_daily (tenant_id, service_type);
CREATE INDEX IF NOT EXISTS mv_revenue_daily_tenant_account_idx
  ON mv_revenue_daily (tenant_id, account_id);

-- Concurrent refresh demands a unique index over the projection.
CREATE UNIQUE INDEX IF NOT EXISTS mv_revenue_daily_unique
  ON mv_revenue_daily (tenant_id, bucket, source, service_type, COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid));
