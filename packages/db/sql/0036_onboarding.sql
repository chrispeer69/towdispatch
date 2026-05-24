-- =====================================================================
-- 0036_onboarding.sql  (Self-Serve Onboarding — Session 25)
--
-- Two new tenant tables backing the self-serve onboarding wizard and the
-- "first job dispatched" activation goal. Composes on top of the existing
-- auth signup flow (AuthService.signup already provisions tenant + owner +
-- email-verification token); these tables only track the post-signup
-- wizard progress and the activation-milestone ledger.
--
-- Tables added:
--   1. onboarding_progress        — one live row per tenant. Tracks the
--                                    wizard's current step, completed steps,
--                                    resumable collected step data, the
--                                    activated pricing tier, and when the
--                                    wizard finished. Soft-delete shaped.
--   2. tenant_activation_events   — append-only ledger of activation
--                                    milestones (account_created,
--                                    email_verified, first_truck_added,
--                                    first_job_dispatched, ...). One row per
--                                    (tenant, event_type) — a partial unique
--                                    index makes "emit once" idempotent at
--                                    the DB level. No soft delete (ledger).
--
-- Patterns followed (all match the existing codebase, e.g. 0033):
--   * tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT.
--   * ENABLE + FORCE ROW LEVEL SECURITY, policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on both tables.
--   * Idempotent: CREATE ... IF NOT EXISTS, DROP ... IF EXISTS before every
--     constraint / policy / trigger / index.
--   * BEFORE-UPDATE set_updated_at trigger on the mutable table.
--   * CHECK constraints enumerate the allowed step / event_type literals so
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
-- One live row per tenant. Created the moment a tenant is provisioned via
-- POST /onboarding/start. current_step drives the wizard resume point;
-- steps_completed is the audited set of finished steps; step_data holds the
-- resumable form payloads (company info, etc.) so a half-finished wizard
-- survives a reload. completed_at is set when every required step is done.

CREATE TABLE IF NOT EXISTS onboarding_progress (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  current_step     text NOT NULL DEFAULT 'account',
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
    'account',
    'verify_email',
    'company_info',
    'first_user',
    'first_truck',
    'first_driver',
    'dispatch_first_job',
    'completed'
  ));

ALTER TABLE onboarding_progress
  DROP CONSTRAINT IF EXISTS onboarding_progress_tier_chk;
ALTER TABLE onboarding_progress
  ADD CONSTRAINT onboarding_progress_tier_chk
  CHECK (tier IN ('free', 'starter', 'pro'));

-- One live progress row per tenant.
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

-- Explicit grants (no DELETE — soft delete only). Matches the defensive
-- per-table grant pattern used by 0015 / 0026 rather than relying solely on
-- ALTER DEFAULT PRIVILEGES from 0002_roles.sql.
GRANT SELECT, INSERT, UPDATE ON onboarding_progress TO app_user;


-- ---------------------------------------------------------------------
-- 2. tenant_activation_events
-- ---------------------------------------------------------------------
-- Append-only ledger. Each row marks an activation milestone reached for
-- the first time. The partial unique index on (tenant_id, event_type) makes
-- emission idempotent: the service can attempt an insert every time it
-- observes a milestone and rely on ON CONFLICT DO NOTHING to keep exactly
-- one row. No soft delete — a milestone, once reached, is permanent.

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
    'first_job_dispatched',
    'free_tier_activated',
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

-- Append-only ledger: app_user can read + insert (idempotent ON CONFLICT).
-- UPDATE is granted to keep parity with the standard grant triple; rows are
-- never deleted from the app.
GRANT SELECT, INSERT, UPDATE ON tenant_activation_events TO app_user;
