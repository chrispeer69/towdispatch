-- =====================================================================
-- 0051_reporting_builder.sql  (Session 53)
--
-- Reporting — additive layer on top of Session 14's reporting module
-- (0037_reporting.sql). This migration adds the *custom report builder*
-- and the *KPI dashboard*; it does NOT touch saved_reports /
-- report_schedules / report_runs (those stay the canned-reporter lane).
--
-- Decisions captured here (see SESSION_53_DECISIONS.md):
--   * report_templates — a base entity + allowlisted field list + filters
--     + group-by + sort, compiled to parameterized SQL at run time. Distinct
--     from saved_reports (which only persists filters on a fixed report id).
--   * report_template_schedules / report_template_runs — a SEPARATE
--     scheduling lane for templates. We do NOT extend the 0037 tables
--     (their saved_report_id is NOT NULL and the format CHECK is csv/pdf-only);
--     keeping the lanes physically separate avoids regressing the in-prod
--     0037 scheduler. Mirrors the 0037 conventions exactly.
--   * kpi_dashboard_layouts — per-user, per-tenant widget grid layout.
--   * kpi_widget_catalog — GLOBAL reference table (no tenant_id, no RLS),
--     seeded with the widget definitions; read-only to app_user.
-- =====================================================================

-- ---------- report_templates ----------
CREATE TABLE IF NOT EXISTS report_templates (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text,
  /* Which base entity the builder queries. Only entities whose tables exist
     on master are allowed — repo is excluded (no module). */
  base_entity text NOT NULL,
  /* Allowlisted field keys to project, in display order. */
  selected_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  /* Array of { field, op, value } — every value binds as a parameter. */
  filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  /* Array of field keys to GROUP BY (aggregates the projection). */
  group_by jsonb NOT NULL DEFAULT '[]'::jsonb,
  /* Array of { field, dir } sort directives. */
  sort jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_shared_with_tenant boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE report_templates
  DROP CONSTRAINT IF EXISTS report_templates_base_entity_chk;
ALTER TABLE report_templates
  ADD CONSTRAINT report_templates_base_entity_chk
  CHECK (base_entity IN ('jobs', 'invoices', 'accounts', 'impound', 'lien_cases', 'drivers', 'trucks'));

CREATE UNIQUE INDEX IF NOT EXISTS report_templates_tenant_name_unique
  ON report_templates (tenant_id, name)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS report_templates_tenant_shared_idx
  ON report_templates (tenant_id, is_shared_with_tenant)
  WHERE deleted_at IS NULL;

ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS report_templates_tenant_isolation ON report_templates;
CREATE POLICY report_templates_tenant_isolation ON report_templates
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_report_templates ON report_templates;
CREATE TRIGGER trg_audit_report_templates
  AFTER INSERT OR UPDATE OR DELETE ON report_templates
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

GRANT SELECT, INSERT, UPDATE, DELETE ON report_templates TO app_user;


-- ---------- report_template_schedules ----------
CREATE TABLE IF NOT EXISTS report_template_schedules (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  template_id uuid NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  cadence text NOT NULL,
  /* Local wall-clock time of delivery, tenant timezone applied at compute. */
  delivery_at_local time NOT NULL DEFAULT '06:00',
  /* 0=Sunday..6=Saturday, only meaningful for weekly cadence. */
  delivery_dow smallint,
  /* 1..28, only meaningful for monthly cadence (28 keeps every month valid). */
  delivery_dom smallint,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  format text NOT NULL DEFAULT 'csv',
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE report_template_schedules
  DROP CONSTRAINT IF EXISTS report_template_schedules_cadence_chk;
ALTER TABLE report_template_schedules
  ADD CONSTRAINT report_template_schedules_cadence_chk
  CHECK (cadence IN ('daily', 'weekly', 'monthly'));

-- XLSX deferred (see D4) — CSV/PDF only this session.
ALTER TABLE report_template_schedules
  DROP CONSTRAINT IF EXISTS report_template_schedules_format_chk;
ALTER TABLE report_template_schedules
  ADD CONSTRAINT report_template_schedules_format_chk
  CHECK (format IN ('csv', 'pdf'));

ALTER TABLE report_template_schedules
  DROP CONSTRAINT IF EXISTS report_template_schedules_dow_chk;
ALTER TABLE report_template_schedules
  ADD CONSTRAINT report_template_schedules_dow_chk
  CHECK (delivery_dow IS NULL OR (delivery_dow BETWEEN 0 AND 6));

ALTER TABLE report_template_schedules
  DROP CONSTRAINT IF EXISTS report_template_schedules_dom_chk;
ALTER TABLE report_template_schedules
  ADD CONSTRAINT report_template_schedules_dom_chk
  CHECK (delivery_dom IS NULL OR (delivery_dom BETWEEN 1 AND 28));

-- One live schedule per template (mirrors 0037 one-per-saved-report).
CREATE UNIQUE INDEX IF NOT EXISTS report_template_schedules_template_unique
  ON report_template_schedules (tenant_id, template_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS report_template_schedules_due_idx
  ON report_template_schedules (tenant_id, enabled, next_run_at)
  WHERE deleted_at IS NULL;

ALTER TABLE report_template_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_template_schedules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS report_template_schedules_tenant_isolation ON report_template_schedules;
CREATE POLICY report_template_schedules_tenant_isolation ON report_template_schedules
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_report_template_schedules ON report_template_schedules;
CREATE TRIGGER trg_audit_report_template_schedules
  AFTER INSERT OR UPDATE OR DELETE ON report_template_schedules
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

GRANT SELECT, INSERT, UPDATE, DELETE ON report_template_schedules TO app_user;


-- ---------- report_template_runs ----------
CREATE TABLE IF NOT EXISTS report_template_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  template_id uuid REFERENCES report_templates(id) ON DELETE SET NULL,
  schedule_id uuid REFERENCES report_template_schedules(id) ON DELETE SET NULL,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  format text NOT NULL DEFAULT 'csv',
  row_count integer NOT NULL DEFAULT 0,
  storage_key text,
  error_text text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE report_template_runs
  DROP CONSTRAINT IF EXISTS report_template_runs_status_chk;
ALTER TABLE report_template_runs
  ADD CONSTRAINT report_template_runs_status_chk
  CHECK (status IN ('pending', 'running', 'succeeded', 'failed'));

CREATE INDEX IF NOT EXISTS report_template_runs_tenant_created_idx
  ON report_template_runs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS report_template_runs_template_idx
  ON report_template_runs (tenant_id, template_id, created_at DESC);

ALTER TABLE report_template_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_template_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS report_template_runs_tenant_isolation ON report_template_runs;
CREATE POLICY report_template_runs_tenant_isolation ON report_template_runs
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON report_template_runs TO app_user;


-- ---------- kpi_dashboard_layouts ----------
CREATE TABLE IF NOT EXISTS kpi_dashboard_layouts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  /* Array of { widget_id, x, y, w, h, config }. */
  layout jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One layout row per user per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS kpi_dashboard_layouts_tenant_user_unique
  ON kpi_dashboard_layouts (tenant_id, user_id);

ALTER TABLE kpi_dashboard_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_dashboard_layouts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kpi_dashboard_layouts_tenant_isolation ON kpi_dashboard_layouts;
CREATE POLICY kpi_dashboard_layouts_tenant_isolation ON kpi_dashboard_layouts
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_kpi_dashboard_layouts ON kpi_dashboard_layouts;
CREATE TRIGGER trg_audit_kpi_dashboard_layouts
  AFTER INSERT OR UPDATE OR DELETE ON kpi_dashboard_layouts
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

GRANT SELECT, INSERT, UPDATE, DELETE ON kpi_dashboard_layouts TO app_user;


-- ---------- kpi_widget_catalog (GLOBAL reference) ----------
-- No tenant_id, no RLS: a static catalog read by every tenant. Mirrors the
-- global-ref pattern used by ev_oem_procedures / tax_rules.
CREATE TABLE IF NOT EXISTS kpi_widget_catalog (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  /* operations | financial | fleet | compliance */
  category text NOT NULL DEFAULT 'operations',
  default_w smallint NOT NULL DEFAULT 1,
  default_h smallint NOT NULL DEFAULT 1,
  /* Optional JSON describing accepted widget config keys. */
  config_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON kpi_widget_catalog TO app_user;

INSERT INTO kpi_widget_catalog (id, title, description, category, default_w, default_h, config_schema) VALUES
  ('jobs_today',                 'Jobs Today',                 'Jobs created so far today (tenant local day).',        'operations', 1, 1, '{}'::jsonb),
  ('revenue_mtd',                'Revenue MTD',                'Invoiced revenue month-to-date.',                       'financial',  1, 1, '{"compare_to":["last_month"]}'::jsonb),
  ('revenue_ytd',                'Revenue YTD',                'Invoiced revenue year-to-date.',                        'financial',  1, 1, '{"compare_to":["last_year"]}'::jsonb),
  ('goa_rate_7d',                'GOA Rate (7d)',              'Gone-on-arrival rate over the last 7 days.',            'operations', 1, 1, '{}'::jsonb),
  ('avg_eta_7d',                 'Avg ETA (7d)',               'Average dispatch-to-on-scene minutes, last 7 days.',    'operations', 1, 1, '{}'::jsonb),
  ('open_impound_count',         'Open Impounds',              'Vehicles currently stored in the yard.',                'operations', 1, 1, '{}'::jsonb),
  ('lien_due_30d',               'Liens Due (30d)',            'Lien cases with next action due within 30 days.',       'compliance', 1, 1, '{}'::jsonb),
  ('accounts_aging_total',       'A/R Aging Total',            'Total open receivable balance across accounts.',        'financial',  1, 1, '{}'::jsonb),
  ('top_5_accounts_revenue_mtd', 'Top 5 Accounts (MTD)',       'Highest-revenue accounts month-to-date.',               'financial',  2, 1, '{}'::jsonb),
  ('top_5_motor_clubs_revenue_mtd','Top 5 Motor Clubs (MTD)',  'Highest-revenue motor clubs month-to-date.',            'financial',  2, 1, '{}'::jsonb),
  ('driver_count_active',        'Active Drivers',             'Drivers currently marked active.',                      'fleet',      1, 1, '{}'::jsonb),
  ('truck_count_active',         'Active Trucks',              'Trucks currently in service.',                          'fleet',      1, 1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
