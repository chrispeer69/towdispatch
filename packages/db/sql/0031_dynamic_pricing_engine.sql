-- =====================================================================
-- 0031_dynamic_pricing_engine.sql  (Moat #1 — full module)
--
-- Dynamic Pricing Engine. Five tier categories (weather, traffic,
-- calendar, time_of_day, special_event) stack multiplicatively up to a
-- per-tenant cap (default 3.0×). Auto-activation by NOAA / time / call-
-- volume / calendar; manual activation for special events.
--
-- Tables added (10):
--   1. dynamic_pricing_tiers              — tier definitions (long-lived, soft-deleted)
--   2. dynamic_pricing_tier_activations   — append-only activation/deactivation events
--   3. dynamic_pricing_curves             — 24-hour or 7×24 multiplier curves
--   4. dynamic_pricing_noaa_mappings      — NOAA alert type → multiplier per tenant
--   5. dynamic_pricing_holiday_calendar   — holiday/event multipliers per tenant
--   6. dynamic_pricing_overrides          — per-quote operator price overrides (append-only)
--   7. quote_save_workflow_events         — quote-decline save funnel events (append-only)
--   8. dynamic_pricing_pulse_daily        — denormalized daily aggregate (one row per tenant per day)
--   9. invoice_line_dynamic_pricing_audit — per-line tier breakdown for QBO / audit (append-only)
--  10. dynamic_pricing_demand_surge_suggestions — pending suggestions from cron
--
-- Schema changes:
--   - jobs.frozen_price_cents             — quote-freeze snapshot (Build 1's
--     "quotes" surface is the jobs table; the rate-engine output lives on
--     rate_quoted_cents already).
--
-- All tables follow the standard pattern: tenant_id NOT NULL, FORCE RLS,
-- audit trigger (fn_audit_log), and (where applicable) cross-tenant
-- integrity triggers on FKs.
--
-- Idempotent — re-applies cleanly on every deploy. Uses CREATE TABLE IF
-- NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY, DROP TRIGGER IF
-- EXISTS + CREATE TRIGGER.
--
-- Down (rollback):
--   DROP TABLE IF EXISTS dynamic_pricing_demand_surge_suggestions;
--   DROP TABLE IF EXISTS invoice_line_dynamic_pricing_audit;
--   DROP TABLE IF EXISTS dynamic_pricing_pulse_daily;
--   DROP TABLE IF EXISTS quote_save_workflow_events;
--   DROP TABLE IF EXISTS dynamic_pricing_overrides;
--   DROP TABLE IF EXISTS dynamic_pricing_holiday_calendar;
--   DROP TABLE IF EXISTS dynamic_pricing_noaa_mappings;
--   DROP TABLE IF EXISTS dynamic_pricing_curves;
--   DROP TABLE IF EXISTS dynamic_pricing_tier_activations;
--   DROP TABLE IF EXISTS dynamic_pricing_tiers;
--   ALTER TABLE jobs DROP COLUMN IF EXISTS frozen_price_cents;
-- =====================================================================

BEGIN;

-- ---------- jobs.frozen_price_cents ----------
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS frozen_price_cents bigint;

-- =====================================================================
-- 1) dynamic_pricing_tiers
-- =====================================================================
CREATE TABLE IF NOT EXISTS dynamic_pricing_tiers (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name                text NOT NULL,
  category            text NOT NULL,
  multiplier          numeric(5, 3) NOT NULL,
  scope_yard_ids      uuid[],
  is_active           boolean NOT NULL DEFAULT false,
  schedule            jsonb,
  auto_revert_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE dynamic_pricing_tiers
  DROP CONSTRAINT IF EXISTS dynamic_pricing_tiers_category_chk;
ALTER TABLE dynamic_pricing_tiers
  ADD CONSTRAINT dynamic_pricing_tiers_category_chk
  CHECK (category IN ('weather', 'traffic', 'calendar', 'time_of_day', 'special_event'));

ALTER TABLE dynamic_pricing_tiers
  DROP CONSTRAINT IF EXISTS dynamic_pricing_tiers_multiplier_chk;
ALTER TABLE dynamic_pricing_tiers
  ADD CONSTRAINT dynamic_pricing_tiers_multiplier_chk
  CHECK (multiplier > 0 AND multiplier <= 10);

CREATE INDEX IF NOT EXISTS dynamic_pricing_tiers_tenant_active_idx
  ON dynamic_pricing_tiers (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS dynamic_pricing_tiers_tenant_category_idx
  ON dynamic_pricing_tiers (tenant_id, category);

ALTER TABLE dynamic_pricing_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_pricing_tiers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dynamic_pricing_tiers_tenant_isolation ON dynamic_pricing_tiers;
CREATE POLICY dynamic_pricing_tiers_tenant_isolation ON dynamic_pricing_tiers
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_dynamic_pricing_tiers ON dynamic_pricing_tiers;
CREATE TRIGGER trg_audit_dynamic_pricing_tiers
  AFTER INSERT OR UPDATE OR DELETE ON dynamic_pricing_tiers
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();


-- =====================================================================
-- 2) dynamic_pricing_tier_activations  (append-only)
-- =====================================================================
CREATE TABLE IF NOT EXISTS dynamic_pricing_tier_activations (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  tier_id                  uuid NOT NULL REFERENCES dynamic_pricing_tiers(id) ON DELETE RESTRICT,
  activated_at             timestamptz NOT NULL DEFAULT now(),
  deactivated_at           timestamptz,
  activated_by_user_id     uuid,
  deactivated_by_user_id   uuid,
  activation_reason        text,
  deactivation_reason      text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dpta_tenant_tier_idx
  ON dynamic_pricing_tier_activations (tenant_id, tier_id, activated_at DESC);
CREATE INDEX IF NOT EXISTS dpta_tenant_activated_idx
  ON dynamic_pricing_tier_activations (tenant_id, activated_at DESC);
CREATE INDEX IF NOT EXISTS dpta_tenant_open_idx
  ON dynamic_pricing_tier_activations (tenant_id, deactivated_at)
  WHERE deactivated_at IS NULL;

ALTER TABLE dynamic_pricing_tier_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_pricing_tier_activations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dpta_tenant_isolation ON dynamic_pricing_tier_activations;
CREATE POLICY dpta_tenant_isolation ON dynamic_pricing_tier_activations
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_dpta ON dynamic_pricing_tier_activations;
CREATE TRIGGER trg_audit_dpta
  AFTER INSERT OR UPDATE OR DELETE ON dynamic_pricing_tier_activations
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();


-- =====================================================================
-- 3) dynamic_pricing_curves
-- =====================================================================
CREATE TABLE IF NOT EXISTS dynamic_pricing_curves (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  mode        text NOT NULL,
  curve_data  jsonb NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

ALTER TABLE dynamic_pricing_curves
  DROP CONSTRAINT IF EXISTS dynamic_pricing_curves_mode_chk;
ALTER TABLE dynamic_pricing_curves
  ADD CONSTRAINT dynamic_pricing_curves_mode_chk
  CHECK (mode IN ('24_hour', '7x24'));

CREATE INDEX IF NOT EXISTS dynamic_pricing_curves_tenant_active_idx
  ON dynamic_pricing_curves (tenant_id, is_active);

ALTER TABLE dynamic_pricing_curves ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_pricing_curves FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dynamic_pricing_curves_tenant_isolation ON dynamic_pricing_curves;
CREATE POLICY dynamic_pricing_curves_tenant_isolation ON dynamic_pricing_curves
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_dynamic_pricing_curves ON dynamic_pricing_curves;
CREATE TRIGGER trg_audit_dynamic_pricing_curves
  AFTER INSERT OR UPDATE OR DELETE ON dynamic_pricing_curves
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();


-- =====================================================================
-- 4) dynamic_pricing_noaa_mappings
-- =====================================================================
CREATE TABLE IF NOT EXISTS dynamic_pricing_noaa_mappings (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  noaa_alert_type  text NOT NULL,
  multiplier       numeric(5, 3) NOT NULL,
  is_enabled       boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dynamic_pricing_noaa_mappings
  DROP CONSTRAINT IF EXISTS dpnm_multiplier_chk;
ALTER TABLE dynamic_pricing_noaa_mappings
  ADD CONSTRAINT dpnm_multiplier_chk
  CHECK (multiplier > 0 AND multiplier <= 10);

DROP INDEX IF EXISTS dpnm_tenant_alert_unique;
CREATE UNIQUE INDEX dpnm_tenant_alert_unique
  ON dynamic_pricing_noaa_mappings (tenant_id, noaa_alert_type);

ALTER TABLE dynamic_pricing_noaa_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_pricing_noaa_mappings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dpnm_tenant_isolation ON dynamic_pricing_noaa_mappings;
CREATE POLICY dpnm_tenant_isolation ON dynamic_pricing_noaa_mappings
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_dpnm ON dynamic_pricing_noaa_mappings;
CREATE TRIGGER trg_audit_dpnm
  AFTER INSERT OR UPDATE OR DELETE ON dynamic_pricing_noaa_mappings
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();


-- =====================================================================
-- 5) dynamic_pricing_holiday_calendar
-- =====================================================================
CREATE TABLE IF NOT EXISTS dynamic_pricing_holiday_calendar (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  occurrence  text NOT NULL,
  date_spec   jsonb NOT NULL,
  multiplier  numeric(5, 3) NOT NULL,
  is_enabled  boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dynamic_pricing_holiday_calendar
  DROP CONSTRAINT IF EXISTS dphc_occurrence_chk;
ALTER TABLE dynamic_pricing_holiday_calendar
  ADD CONSTRAINT dphc_occurrence_chk
  CHECK (occurrence IN ('fixed_date', 'nth_weekday'));

ALTER TABLE dynamic_pricing_holiday_calendar
  DROP CONSTRAINT IF EXISTS dphc_multiplier_chk;
ALTER TABLE dynamic_pricing_holiday_calendar
  ADD CONSTRAINT dphc_multiplier_chk
  CHECK (multiplier > 0 AND multiplier <= 10);

CREATE INDEX IF NOT EXISTS dphc_tenant_enabled_idx
  ON dynamic_pricing_holiday_calendar (tenant_id, is_enabled);

ALTER TABLE dynamic_pricing_holiday_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_pricing_holiday_calendar FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dphc_tenant_isolation ON dynamic_pricing_holiday_calendar;
CREATE POLICY dphc_tenant_isolation ON dynamic_pricing_holiday_calendar
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_dphc ON dynamic_pricing_holiday_calendar;
CREATE TRIGGER trg_audit_dphc
  AFTER INSERT OR UPDATE OR DELETE ON dynamic_pricing_holiday_calendar
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();


-- =====================================================================
-- 6) dynamic_pricing_overrides  (append-only)
-- =====================================================================
CREATE TABLE IF NOT EXISTS dynamic_pricing_overrides (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id                 uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  user_id                uuid REFERENCES users(id) ON DELETE SET NULL,
  original_price_cents   bigint NOT NULL,
  override_price_cents   bigint NOT NULL,
  tier_stack_snapshot    jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason_code            text NOT NULL,
  note                   text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dynamic_pricing_overrides
  DROP CONSTRAINT IF EXISTS dpo_reason_code_chk;
ALTER TABLE dynamic_pricing_overrides
  ADD CONSTRAINT dpo_reason_code_chk
  CHECK (reason_code IN (
    'price_match',
    'customer_complaint',
    'manager_approved',
    'goodwill',
    'error_correction',
    'competitive_pressure',
    'other_with_note'
  ));

ALTER TABLE dynamic_pricing_overrides
  DROP CONSTRAINT IF EXISTS dpo_other_requires_note;
ALTER TABLE dynamic_pricing_overrides
  ADD CONSTRAINT dpo_other_requires_note
  CHECK (reason_code <> 'other_with_note' OR (note IS NOT NULL AND length(trim(note)) > 0));

CREATE INDEX IF NOT EXISTS dpo_tenant_job_idx
  ON dynamic_pricing_overrides (tenant_id, job_id);
CREATE INDEX IF NOT EXISTS dpo_tenant_created_idx
  ON dynamic_pricing_overrides (tenant_id, created_at DESC);

ALTER TABLE dynamic_pricing_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_pricing_overrides FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dpo_tenant_isolation ON dynamic_pricing_overrides;
CREATE POLICY dpo_tenant_isolation ON dynamic_pricing_overrides
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_dpo ON dynamic_pricing_overrides;
CREATE TRIGGER trg_audit_dpo
  AFTER INSERT OR UPDATE OR DELETE ON dynamic_pricing_overrides
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- Cross-tenant integrity: the job_id must belong to the same tenant.
CREATE OR REPLACE FUNCTION fn_dpo_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_job_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_job_tenant FROM jobs WHERE id = NEW.job_id;
  IF v_job_tenant IS NULL THEN
    RAISE EXCEPTION 'dynamic_pricing_overrides: job_id % does not exist', NEW.job_id;
  END IF;
  IF v_job_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'dynamic_pricing_overrides: tenant_id % does not match job tenant_id %',
      NEW.tenant_id, v_job_tenant;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dpo_tenant_consistency ON dynamic_pricing_overrides;
CREATE TRIGGER trg_dpo_tenant_consistency
  BEFORE INSERT OR UPDATE ON dynamic_pricing_overrides
  FOR EACH ROW EXECUTE FUNCTION fn_dpo_tenant_consistency();


-- =====================================================================
-- 7) quote_save_workflow_events  (append-only)
-- =====================================================================
CREATE TABLE IF NOT EXISTS quote_save_workflow_events (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id                uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  step                  text NOT NULL,
  discount_pct          numeric(5, 2),
  custom_price_cents    bigint,
  decline_reason_code   text,
  accepted              boolean NOT NULL DEFAULT false,
  recorded_by_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE quote_save_workflow_events
  DROP CONSTRAINT IF EXISTS qswe_step_chk;
ALTER TABLE quote_save_workflow_events
  ADD CONSTRAINT qswe_step_chk
  CHECK (step IN ('save_step_1', 'save_step_2', 'save_step_counter', 'save_step_manager_call'));

ALTER TABLE quote_save_workflow_events
  DROP CONSTRAINT IF EXISTS qswe_decline_reason_chk;
ALTER TABLE quote_save_workflow_events
  ADD CONSTRAINT qswe_decline_reason_chk
  CHECK (decline_reason_code IS NULL OR decline_reason_code IN (
    'too_expensive',
    'found_alternative',
    'no_longer_needs',
    'eta_too_long',
    'payment_issue',
    'customer_changed_mind',
    'other'
  ));

CREATE INDEX IF NOT EXISTS qswe_tenant_job_idx
  ON quote_save_workflow_events (tenant_id, job_id, created_at);
CREATE INDEX IF NOT EXISTS qswe_tenant_created_idx
  ON quote_save_workflow_events (tenant_id, created_at DESC);

ALTER TABLE quote_save_workflow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_save_workflow_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qswe_tenant_isolation ON quote_save_workflow_events;
CREATE POLICY qswe_tenant_isolation ON quote_save_workflow_events
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_qswe ON quote_save_workflow_events;
CREATE TRIGGER trg_audit_qswe
  AFTER INSERT OR UPDATE OR DELETE ON quote_save_workflow_events
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();


-- =====================================================================
-- 8) dynamic_pricing_pulse_daily  (one row per tenant per local-date)
-- =====================================================================
CREATE TABLE IF NOT EXISTS dynamic_pricing_pulse_daily (
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  pulse_date             date NOT NULL,
  revenue_cents          bigint NOT NULL DEFAULT 0,
  standard_revenue_cents bigint NOT NULL DEFAULT 0,
  delta_cents            bigint NOT NULL DEFAULT 0,
  accepted_quote_count   integer NOT NULL DEFAULT 0,
  by_tier                jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, pulse_date)
);

ALTER TABLE dynamic_pricing_pulse_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_pricing_pulse_daily FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dppd_tenant_isolation ON dynamic_pricing_pulse_daily;
CREATE POLICY dppd_tenant_isolation ON dynamic_pricing_pulse_daily
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_dppd ON dynamic_pricing_pulse_daily;
CREATE TRIGGER trg_audit_dppd
  AFTER INSERT OR UPDATE OR DELETE ON dynamic_pricing_pulse_daily
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();


-- =====================================================================
-- 9) invoice_line_dynamic_pricing_audit  (append-only)
-- =====================================================================
CREATE TABLE IF NOT EXISTS invoice_line_dynamic_pricing_audit (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  invoice_line_id     uuid NOT NULL,
  tier_id             uuid NOT NULL REFERENCES dynamic_pricing_tiers(id) ON DELETE RESTRICT,
  multiplier          numeric(5, 3) NOT NULL,
  contribution_cents  bigint NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ildpa_tenant_line_idx
  ON invoice_line_dynamic_pricing_audit (tenant_id, invoice_line_id);
CREATE INDEX IF NOT EXISTS ildpa_tenant_tier_idx
  ON invoice_line_dynamic_pricing_audit (tenant_id, tier_id);

ALTER TABLE invoice_line_dynamic_pricing_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_dynamic_pricing_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ildpa_tenant_isolation ON invoice_line_dynamic_pricing_audit;
CREATE POLICY ildpa_tenant_isolation ON invoice_line_dynamic_pricing_audit
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_ildpa ON invoice_line_dynamic_pricing_audit;
CREATE TRIGGER trg_audit_ildpa
  AFTER INSERT OR UPDATE OR DELETE ON invoice_line_dynamic_pricing_audit
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();


-- =====================================================================
-- 10) dynamic_pricing_demand_surge_suggestions
-- =====================================================================
CREATE TABLE IF NOT EXISTS dynamic_pricing_demand_surge_suggestions (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  yard_id                uuid,
  threshold_pct          integer NOT NULL,
  suggested_multiplier   numeric(5, 3) NOT NULL,
  current_jobs           integer NOT NULL,
  baseline_jobs          numeric(8, 2) NOT NULL,
  status                 text NOT NULL DEFAULT 'pending',
  created_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at            timestamptz,
  resolved_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE dynamic_pricing_demand_surge_suggestions
  DROP CONSTRAINT IF EXISTS dpdss_status_chk;
ALTER TABLE dynamic_pricing_demand_surge_suggestions
  ADD CONSTRAINT dpdss_status_chk
  CHECK (status IN ('pending', 'approved', 'dismissed'));

CREATE INDEX IF NOT EXISTS dpdss_tenant_status_idx
  ON dynamic_pricing_demand_surge_suggestions (tenant_id, status, created_at DESC);

-- One pending suggestion per (tenant, yard, threshold) at a time.
DROP INDEX IF EXISTS dpdss_tenant_yard_threshold_pending_unique;
CREATE UNIQUE INDEX dpdss_tenant_yard_threshold_pending_unique
  ON dynamic_pricing_demand_surge_suggestions (tenant_id, yard_id, threshold_pct)
  WHERE status = 'pending';

ALTER TABLE dynamic_pricing_demand_surge_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_pricing_demand_surge_suggestions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dpdss_tenant_isolation ON dynamic_pricing_demand_surge_suggestions;
CREATE POLICY dpdss_tenant_isolation ON dynamic_pricing_demand_surge_suggestions
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_dpdss ON dynamic_pricing_demand_surge_suggestions;
CREATE TRIGGER trg_audit_dpdss
  AFTER INSERT OR UPDATE OR DELETE ON dynamic_pricing_demand_surge_suggestions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

COMMIT;
