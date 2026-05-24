-- =====================================================================
-- 0046_voice_commands.sql  (Voice-Controlled Driver Workflows — Session 45)
--
-- Hands-free driver workflow: CarPlay / Android Auto (and a web fallback)
-- send a spoken transcript to /voice-driver/command; the API parses an
-- intent and maps it onto the EXISTING driver job-status transitions
-- (enroute / on_scene / in_progress / completed / cancelled). This
-- migration adds the single audit table that records every voice command
-- the platform processed — what was said, what intent we recognized, how
-- confident the parser was, and what action (if any) we took.
--
-- IMPORTANT — this table is an AUDIT LOG, not a command queue. The actual
-- business logic still lives in JobsService.transition; voice_command_log
-- only records the attempt. The two confirmation columns
-- (confirmation_required / confirmed_at) implement the spoken-confirmation
-- gate for destructive intents (decline_job / clear_job / mark_breakdown)
-- WITHOUT any server-side session state: a pending row is one where
-- confirmation_required = true AND confirmed_at IS NULL AND succeeded =
-- false, looked up by (tenant_id, driver_id) within a short TTL when the
-- driver says "yes". See SESSION_45_DECISIONS.md.
--
-- Tables added:
--   1. voice_command_log — one row per processed voice command.
--
-- Patterns followed (match 0038_lien_processing.sql exactly):
--   * Every tenant table: tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE RESTRICT; ENABLE + FORCE ROW LEVEL SECURITY; policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on the tenant table.
--   * Idempotent: CREATE ... IF NOT EXISTS, DROP ... IF EXISTS before
--     every constraint / policy / trigger / index.
--   * Soft delete (deleted_at timestamptz).
--   * id is uuid PRIMARY KEY with NO default — the app passes uuidv7().
--   * Cross-tenant consistency BEFORE-trigger: the referenced driver (and
--     job, when present) must belong to the same tenant. RLS hides foreign
--     parents from the trigger's SELECT, so a foreign-id injection fails
--     "does not exist".
--   * Shared BEFORE UPDATE updated_at trigger function.
--
-- Down (rollback):
--   DROP TABLE IF EXISTS voice_command_log;
--   DROP FUNCTION IF EXISTS fn_voice_command_log_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_voice_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper for voice-driver tables.
CREATE OR REPLACE FUNCTION fn_voice_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Tenant-consistency guard: the referenced driver (and, when set, the
-- referenced job) must share the row's tenant_id. RLS hides foreign rows,
-- so a cross-tenant driver_id / job_id surfaces as "does not exist".
CREATE OR REPLACE FUNCTION fn_voice_command_log_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_driver_tenant uuid;
  v_job_tenant    uuid;
BEGIN
  SELECT tenant_id INTO v_driver_tenant
  FROM drivers WHERE id = NEW.driver_id;

  IF v_driver_tenant IS NULL THEN
    RAISE EXCEPTION 'voice_command_log: driver_id % does not exist', NEW.driver_id;
  END IF;

  IF v_driver_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'voice_command_log: tenant_id (%) does not match drivers.tenant_id (%)',
      NEW.tenant_id, v_driver_tenant;
  END IF;

  IF NEW.job_id IS NOT NULL THEN
    SELECT tenant_id INTO v_job_tenant
    FROM jobs WHERE id = NEW.job_id;

    IF v_job_tenant IS NULL THEN
      RAISE EXCEPTION 'voice_command_log: job_id % does not exist', NEW.job_id;
    END IF;

    IF v_job_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'voice_command_log: tenant_id (%) does not match jobs.tenant_id (%)',
        NEW.tenant_id, v_job_tenant;
    END IF;
  END IF;

  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. voice_command_log
-- ---------------------------------------------------------------------
-- One row per voice command the platform processed.
--   command_text       — the raw transcript the speech recognizer produced.
--   recognized_intent  — parser output (one of the 12 driver intents, or
--                        'clarify' below the confidence threshold, or the
--                        internal 'confirm_yes' / 'confirm_no' resolution
--                        of a pending destructive action).
--   intent_confidence  — 0.0–1.0; below VOICE_DRIVER_CONFIDENCE_MIN the
--                        intent is downgraded to 'clarify'.
--   action_taken       — what the service did (e.g. 'transition:enroute',
--                        'awaiting_confirmation', 'informational',
--                        'clarify', 'declined', 'feature_disabled').
--   succeeded          — whether the mapped action completed. A pending
--                        (awaiting-confirmation) row is succeeded = false.
--   confirmation_required / confirmed_at — the destructive-intent gate.
--   platform           — which surface sent the command.
--   locale             — language for the spoken response (en | es).

CREATE TABLE IF NOT EXISTS voice_command_log (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  driver_id             uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  job_id                uuid REFERENCES jobs(id) ON DELETE SET NULL,
  command_text          text NOT NULL,
  recognized_intent     text NOT NULL,
  intent_confidence     double precision NOT NULL DEFAULT 0,
  action_taken          text,
  succeeded             boolean NOT NULL DEFAULT false,
  error                 text,
  confirmation_required boolean NOT NULL DEFAULT false,
  confirmed_at          timestamptz,
  platform              text NOT NULL DEFAULT 'other',
  locale                text NOT NULL DEFAULT 'en',
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

ALTER TABLE voice_command_log DROP CONSTRAINT IF EXISTS voice_command_log_intent_chk;
ALTER TABLE voice_command_log ADD CONSTRAINT voice_command_log_intent_chk
  CHECK (recognized_intent IN (
    'accept_job',
    'decline_job',
    'en_route',
    'arrive_on_scene',
    'vehicle_loaded',
    'en_route_drop',
    'arrive_drop',
    'clear_job',
    'request_help',
    'repeat_address',
    'eta_update',
    'mark_breakdown',
    'clarify',
    'confirm_yes',
    'confirm_no'
  ));

ALTER TABLE voice_command_log DROP CONSTRAINT IF EXISTS voice_command_log_platform_chk;
ALTER TABLE voice_command_log ADD CONSTRAINT voice_command_log_platform_chk
  CHECK (platform IN ('ios_carplay', 'android_auto', 'web', 'other'));

ALTER TABLE voice_command_log DROP CONSTRAINT IF EXISTS voice_command_log_locale_chk;
ALTER TABLE voice_command_log ADD CONSTRAINT voice_command_log_locale_chk
  CHECK (locale IN ('en', 'es'));

ALTER TABLE voice_command_log DROP CONSTRAINT IF EXISTS voice_command_log_confidence_range;
ALTER TABLE voice_command_log ADD CONSTRAINT voice_command_log_confidence_range
  CHECK (intent_confidence >= 0 AND intent_confidence <= 1);

-- Driver activity feed / debugging: a driver's commands newest-first.
CREATE INDEX IF NOT EXISTS voice_command_log_tenant_driver_idx
  ON voice_command_log (tenant_id, driver_id, occurred_at DESC)
  WHERE deleted_at IS NULL;

-- Pending-confirmation lookup: the "did the driver just queue a
-- destructive action?" predicate, scoped to the driver, newest first.
CREATE INDEX IF NOT EXISTS voice_command_log_pending_confirm_idx
  ON voice_command_log (tenant_id, driver_id, occurred_at DESC)
  WHERE confirmation_required = true AND confirmed_at IS NULL
    AND succeeded = false AND deleted_at IS NULL;

-- Per-job voice history.
CREATE INDEX IF NOT EXISTS voice_command_log_job_idx
  ON voice_command_log (job_id)
  WHERE job_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE voice_command_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_command_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voice_command_log_tenant_isolation ON voice_command_log;
CREATE POLICY voice_command_log_tenant_isolation ON voice_command_log
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_voice_command_log_tenant_consistency ON voice_command_log;
CREATE TRIGGER trg_voice_command_log_tenant_consistency
  BEFORE INSERT OR UPDATE ON voice_command_log
  FOR EACH ROW EXECUTE FUNCTION fn_voice_command_log_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_voice_command_log ON voice_command_log;
CREATE TRIGGER trg_audit_voice_command_log
  AFTER INSERT OR UPDATE OR DELETE ON voice_command_log
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_voice_command_log_set_updated_at ON voice_command_log;
CREATE TRIGGER trg_voice_command_log_set_updated_at
  BEFORE UPDATE ON voice_command_log
  FOR EACH ROW EXECUTE FUNCTION fn_voice_set_updated_at();
