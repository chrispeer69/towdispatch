-- =====================================================================
-- 0036_onboarding.sql  (Self-Serve Onboarding — Session 25)
--
-- Two tenant tables backing the self-serve onboarding wizard and the
-- "first job dispatched" activation goal. Composes on top of the existing
-- auth signup flow (AuthService.signup already provisions tenant + owner +
-- email-verification token); these tables only track post-signup wizard
-- progress and the activation-milestone ledger. No auth tables are touched.
--
-- Tables added:
--   1. onboarding_progress      — one live row per tenant. Tracks the wizard's
--                                 current step, completed steps, resumable
--                                 collected step data (jsonb), the activated
--                                 pricing tier, and when the wizard finished.
--                                 Soft-delete shaped.
--   2. tenant_activation_events — append-only ledger of activation milestones.
--                                 Exactly one row per (tenant, event_type) via a
--                                 unique index, so "emit once" is idempotent at
--                                 the DB level (INSERT ... ON CONFLICT DO NOTHING).
--                                 No soft delete — a milestone, once reached, is
--                                 permanent.
--
-- Patterns followed (match 0033/0034):
--   * tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT.
--   * ENABLE + FORCE ROW LEVEL SECURITY; policy USING/WITH CHECK
--     (tenant_id = fn_current_tenant_id()).
--   * Audit trigger fn_audit_log() on both tables.
--   * Idempotent: CREATE ... IF NOT EXISTS, DROP ... IF EXISTS before every
--     constraint / policy / trigger / index.
--   * Per-table BEFORE-UPDATE set_updated_at trigger on the mutable table.
--   * CHECK constraints enumerate allowed step / event_type / tier literals so
--     reporting and the wizard stay aligned with the app-layer enums.
--
-- Down (rollback):
--   DROP TRIGGER IF EXISTS trg_audit_tenant_activation_events ON tenant_activation_events;
--   DROP TRIGGER IF EXISTS trg_audit_onboarding_progress      ON onboarding_progress;
--   DROP TRIGGER IF EXISTS trg_onboarding_progress_set_updated_at ON onboarding_progress;
--   DROP FUNCTION IF EXISTS fn_onboarding_progress_set_updated_at();
--   DROP TABLE IF EXISTS tenant_activation_events;
--   DROP TABLE IF EXISTS onboarding_progress;
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. onboarding_progress
-- ---------------------------------------------------------------------
-- One live row per tenant, created on first authenticated wizard load
-- (GET /onboarding/progress) or by POST /onboarding/signup. current_step
-- drives the resume point; steps_completed is the audited set of finished
-- steps; step_data holds the resumable form payloads (company info, etc.)
-- so a half-finished wizard survives a reload. completed_at is set when the
-- owner finishes the wizard.

CREATE TABLE IF NOT EXISTS onboarding_progress (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  current_step     text NOT NULL DEFAULT 'company_info',
  steps_completed  text[] NOT NULL DEFAULT '{}',
  step_data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  tier             text NOT NULL DEFAULT 'free',
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE onboarding_progress
  DROP CONSTRAINT IF EXISTS onboarding_progress_current_step_chk;
ALTER TABLE onboarding_progress
  ADD CONSTRAINT onboarding_progress_current_step_chk
  CHECK (current_step IN (
    'company_info',
    'first_user',
    'first_truck',
    'first_driver',
    'activate',
    'completed'
  ));

ALTER TABLE onboarding_progress
  DROP CONSTRAINT IF EXISTS onboarding_progress_tier_chk;
ALTER TABLE onboarding_progress
  ADD CONSTRAINT onboarding_progress_tier_chk
  CHECK (tier IN ('free', 'starter', 'pro'));

-- One live progress row per tenant (soft-delete aware).
DROP INDEX IF EXISTS onboarding_progress_tenant_live_unique;
CREATE UNIQUE INDEX onboarding_progress_tenant_live_unique
  ON onboarding_progress (tenant_id)
  WHERE deleted_at IS NULL;

ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_progress FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_progress_tenant_isolation ON onboarding_progress;
CREATE POLICY onboarding_progress_tenant_isolation ON onboarding_progress
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_onboarding_progress ON onboarding_progress;
CREATE TRIGGER trg_audit_onboarding_progress
  AFTER INSERT OR UPDATE OR DELETE ON onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE OR REPLACE FUNCTION fn_onboarding_progress_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_onboarding_progress_set_updated_at ON onboarding_progress;
CREATE TRIGGER trg_onboarding_progress_set_updated_at
  BEFORE UPDATE ON onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION fn_onboarding_progress_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. tenant_activation_events
-- ---------------------------------------------------------------------
-- Append-only ledger. Each row marks an activation milestone reached for the
-- first time. The unique index on (tenant_id, event_type) makes emission
-- idempotent: the service attempts an insert every time it observes a
-- milestone and relies on ON CONFLICT DO NOTHING to keep exactly one row.

CREATE TABLE IF NOT EXISTS tenant_activation_events (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_type    text NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE tenant_activation_events
  DROP CONSTRAINT IF EXISTS tenant_activation_events_event_type_chk;
ALTER TABLE tenant_activation_events
  ADD CONSTRAINT tenant_activation_events_event_type_chk
  CHECK (event_type IN (
    'account_created',
    'email_verified',
    'company_info_completed',
    'first_user_invited',
    'first_truck_added',
    'first_driver_added',
    'free_tier_activated',
    'first_job_dispatched',
    'onboarding_completed'
  ));

-- Exactly one row per (tenant, event_type) — idempotent milestone ledger.
DROP INDEX IF EXISTS tenant_activation_events_tenant_type_unique;
CREATE UNIQUE INDEX tenant_activation_events_tenant_type_unique
  ON tenant_activation_events (tenant_id, event_type);

CREATE INDEX IF NOT EXISTS tenant_activation_events_tenant_occurred_idx
  ON tenant_activation_events (tenant_id, occurred_at);

ALTER TABLE tenant_activation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_activation_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_activation_events_tenant_isolation ON tenant_activation_events;
CREATE POLICY tenant_activation_events_tenant_isolation ON tenant_activation_events
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_tenant_activation_events ON tenant_activation_events;
CREATE TRIGGER trg_audit_tenant_activation_events
  AFTER INSERT OR UPDATE OR DELETE ON tenant_activation_events
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
