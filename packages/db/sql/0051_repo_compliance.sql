-- =====================================================================
-- 0051_repo_compliance.sql  (Repo Compliance — Session 50)
--
-- State-by-state repossession compliance: breach-of-peace validation,
-- pre/post-repo notices, redemption windows, personal-property holds,
-- sheriff-notice + secondary-contact gates. Covers the top 10 states
-- (CA, TX, FL, NY, GA, NC, OH, IL, PA, MI); the remaining 40 + DC are
-- deferred to Session 51.
--
-- IMPORTANT — this code does NOT auto-advance a repossession or dispose of
-- a vehicle. The nightly cron (REPO_ADVANCE_CRON_ENABLED) only flags
-- response-overdue notices. Every legal step is an explicit operator
-- action. The per-state day counts are best-effort (UCC §9-609 + each
-- state's deficiency/redemption statutes) and MUST be reviewed by counsel
-- before a production repossession — see SESSION_50_DECISIONS.md.
--
-- S49 DEFERRAL (see SESSION_50_DECISIONS.md D0): the S49 repo_cases table /
-- RepoCaseService are NOT on master yet. The two tenant tables below carry
-- `repo_case_id uuid NOT NULL` with NO foreign key. The FK + the parent-
-- tenant-consistency trigger (the analogue of fn_lien_child_tenant_consistency)
-- land when S49 creates repo_cases. Tenant isolation here is still enforced
-- by RLS (tenant_id) + the WITH CHECK policy; only the parent-tenant cross-
-- check is deferred.
--
-- Tables added:
--   1. repo_state_rules        — per-state rule config (GLOBAL reference
--                                data; NOT tenant-scoped, no RLS).
--   2. repo_required_notices   — pre/post-repo, personal-property,
--                                redemption, sheriff notices for a case.
--   3. repo_timeline_events    — append-only audit trail of case activity.
--
-- Patterns followed (match 0038_lien_processing.sql):
--   * Every tenant table: tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE RESTRICT; ENABLE + FORCE ROW LEVEL SECURITY; policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on every tenant table.
--   * Idempotent: CREATE ... IF NOT EXISTS, DROP ... IF EXISTS before
--     every constraint / policy / trigger / index.
--   * Soft delete (deleted_at) on every tenant table.
--   * Shared BEFORE UPDATE updated_at trigger function across tables.
--   * repo_state_rules is GLOBAL reference data: app_user reads it via the
--     default-privilege GRANT (0002_roles.sql); no tenant_id, no RLS.
--
-- Down (rollback):
--   DROP TABLE IF EXISTS repo_timeline_events;
--   DROP TABLE IF EXISTS repo_required_notices;
--   DROP TABLE IF EXISTS repo_state_rules;
--   DROP FUNCTION IF EXISTS fn_repo_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helper
-- ---------------------------------------------------------------------

-- Generic updated_at stamper, reused by all repo-compliance tables.
CREATE OR REPLACE FUNCTION fn_repo_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. repo_state_rules  (GLOBAL reference data — NOT tenant-scoped)
-- ---------------------------------------------------------------------
-- One row per US state with the statutory rule config the engine reads.
-- Seeded below for the top 10 states. The TypeScript module
-- apps/api/src/modules/repo/compliance/state-rules.config.ts is the runtime
-- source of truth; this table mirrors it so the values are queryable /
-- auditable and a future session can let tenants override.

CREATE TABLE IF NOT EXISTS repo_state_rules (
  state       text PRIMARY KEY,
  rules       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE repo_state_rules DROP CONSTRAINT IF EXISTS repo_state_rules_state_format;
ALTER TABLE repo_state_rules ADD CONSTRAINT repo_state_rules_state_format
  CHECK (state ~ '^[A-Z]{2}$');

DROP TRIGGER IF EXISTS trg_repo_state_rules_set_updated_at ON repo_state_rules;
CREATE TRIGGER trg_repo_state_rules_set_updated_at
  BEFORE UPDATE ON repo_state_rules
  FOR EACH ROW EXECUTE FUNCTION fn_repo_set_updated_at();

-- Seed the top 10 states. Re-runnable: ON CONFLICT refreshes the rules.
-- Generated from state-rules.config.ts (code wins on drift). Day-counts are
-- best-effort and require legal review before production use.
INSERT INTO repo_state_rules (state, rules) VALUES
  ('CA', '{"statute":"CA Civil Code 2983.2 / 2983.3 (Rees-Levering) / 7507.x","peacefulRepoDefinition":"Self-help repossession is lawful only without a breach of the peace (UCC §9-609). A breach occurs on the debtor’s objection at the scene, entry into a residence or a closed/locked enclosure, any use or threat of force, or an officer directing the repossession (state action). California additionally regulates repossession agencies (Bus. & Prof. Code 7500 et seq.).","preRepoNoticeRequired":false,"preRepoNoticeDays":0,"postRepoNoticeRequired":true,"postRepoNoticeDays":2,"postRepoNoticeMethod":"certified","redemptionPeriodDays":15,"cureRight":true,"cureRightDays":15,"personalPropertyHoldDays":60,"personalPropertyReleaseMethod":"owner_pickup_after_notice","secondaryContactRequired":true,"sheriffNoticeRequired":false,"sheriffNoticeJurisdiction":null,"nightRepoIsBreach":false,"presenceObjectionStrict":true}'::jsonb),
  ('TX', '{"statute":"TX Bus. & Com. Code 9.609 / Finance Code Ch. 348","peacefulRepoDefinition":"Self-help repossession is lawful only without a breach of the peace (UCC §9-609). A breach occurs on the debtor’s objection at the scene, entry into a residence or a closed/locked enclosure, any use or threat of force, or an officer directing the repossession (state action).","preRepoNoticeRequired":false,"preRepoNoticeDays":0,"postRepoNoticeRequired":true,"postRepoNoticeDays":5,"postRepoNoticeMethod":"certified","redemptionPeriodDays":0,"cureRight":true,"cureRightDays":10,"personalPropertyHoldDays":30,"personalPropertyReleaseMethod":"owner_pickup_after_notice","secondaryContactRequired":false,"sheriffNoticeRequired":false,"sheriffNoticeJurisdiction":null,"nightRepoIsBreach":false,"presenceObjectionStrict":true}'::jsonb),
  ('FL', '{"statute":"FL Statutes 679.609 / 493 (recovery agents)","peacefulRepoDefinition":"Self-help repossession is lawful only without a breach of the peace (UCC §9-609). A breach occurs on the debtor’s objection at the scene, entry into a residence or a closed/locked enclosure, any use or threat of force, or an officer directing the repossession (state action). Florida licenses recovery agents under ch. 493.","preRepoNoticeRequired":false,"preRepoNoticeDays":0,"postRepoNoticeRequired":true,"postRepoNoticeDays":10,"postRepoNoticeMethod":"certified","redemptionPeriodDays":0,"cureRight":true,"cureRightDays":10,"personalPropertyHoldDays":30,"personalPropertyReleaseMethod":"owner_pickup_after_notice","secondaryContactRequired":false,"sheriffNoticeRequired":false,"sheriffNoticeJurisdiction":null,"nightRepoIsBreach":false,"presenceObjectionStrict":true}'::jsonb),
  ('NY', '{"statute":"NY UCC 9-609 / Banking Law 108","peacefulRepoDefinition":"Self-help repossession is lawful only without a breach of the peace (UCC §9-609). A breach occurs on the debtor’s objection at the scene, entry into a residence or a closed/locked enclosure, any use or threat of force, or an officer directing the repossession (state action).","preRepoNoticeRequired":false,"preRepoNoticeDays":0,"postRepoNoticeRequired":true,"postRepoNoticeDays":10,"postRepoNoticeMethod":"certified","redemptionPeriodDays":15,"cureRight":true,"cureRightDays":15,"personalPropertyHoldDays":45,"personalPropertyReleaseMethod":"owner_pickup_after_notice","secondaryContactRequired":true,"sheriffNoticeRequired":false,"sheriffNoticeJurisdiction":null,"nightRepoIsBreach":false,"presenceObjectionStrict":true}'::jsonb),
  ('GA', '{"statute":"GA OCGA 11-9-609 / 10-1-36","peacefulRepoDefinition":"Self-help repossession is lawful only without a breach of the peace (UCC §9-609). A breach occurs on the debtor’s objection at the scene, entry into a residence or a closed/locked enclosure, any use or threat of force, or an officer directing the repossession (state action).","preRepoNoticeRequired":false,"preRepoNoticeDays":0,"postRepoNoticeRequired":true,"postRepoNoticeDays":10,"postRepoNoticeMethod":"certified","redemptionPeriodDays":0,"cureRight":true,"cureRightDays":10,"personalPropertyHoldDays":30,"personalPropertyReleaseMethod":"owner_pickup_after_notice","secondaryContactRequired":false,"sheriffNoticeRequired":false,"sheriffNoticeJurisdiction":null,"nightRepoIsBreach":false,"presenceObjectionStrict":true}'::jsonb),
  ('NC', '{"statute":"NC Gen. Stat. 25-9-609 / 20-102.1 (LE report)","peacefulRepoDefinition":"Self-help repossession is lawful only without a breach of the peace (UCC §9-609). A breach occurs on the debtor’s objection at the scene, entry into a residence or a closed/locked enclosure, any use or threat of force, or an officer directing the repossession (state action). North Carolina requires reporting the repossession to local law enforcement (G.S. 20-102.1).","preRepoNoticeRequired":false,"preRepoNoticeDays":0,"postRepoNoticeRequired":true,"postRepoNoticeDays":10,"postRepoNoticeMethod":"certified","redemptionPeriodDays":0,"cureRight":true,"cureRightDays":15,"personalPropertyHoldDays":30,"personalPropertyReleaseMethod":"owner_pickup_after_notice","secondaryContactRequired":false,"sheriffNoticeRequired":true,"sheriffNoticeJurisdiction":"local law enforcement","nightRepoIsBreach":false,"presenceObjectionStrict":true}'::jsonb),
  ('OH', '{"statute":"OH Rev. Code 1309.609 / 1317.12 (right-to-cure)","peacefulRepoDefinition":"Self-help repossession is lawful only without a breach of the peace (UCC §9-609). A breach occurs on the debtor’s objection at the scene, entry into a residence or a closed/locked enclosure, any use or threat of force, or an officer directing the repossession (state action).","preRepoNoticeRequired":true,"preRepoNoticeDays":10,"postRepoNoticeRequired":true,"postRepoNoticeDays":10,"postRepoNoticeMethod":"certified","redemptionPeriodDays":0,"cureRight":true,"cureRightDays":10,"personalPropertyHoldDays":30,"personalPropertyReleaseMethod":"owner_pickup_after_notice","secondaryContactRequired":false,"sheriffNoticeRequired":false,"sheriffNoticeJurisdiction":null,"nightRepoIsBreach":false,"presenceObjectionStrict":true}'::jsonb),
  ('IL', '{"statute":"IL 810 ILCS 5/9-609 / 815 ILCS 375","peacefulRepoDefinition":"Self-help repossession is lawful only without a breach of the peace (UCC §9-609). A breach occurs on the debtor’s objection at the scene, entry into a residence or a closed/locked enclosure, any use or threat of force, or an officer directing the repossession (state action).","preRepoNoticeRequired":false,"preRepoNoticeDays":0,"postRepoNoticeRequired":true,"postRepoNoticeDays":10,"postRepoNoticeMethod":"certified","redemptionPeriodDays":0,"cureRight":true,"cureRightDays":21,"personalPropertyHoldDays":30,"personalPropertyReleaseMethod":"owner_pickup_after_notice","secondaryContactRequired":false,"sheriffNoticeRequired":false,"sheriffNoticeJurisdiction":null,"nightRepoIsBreach":false,"presenceObjectionStrict":true}'::jsonb),
  ('PA', '{"statute":"PA 13 Pa.C.S. 9609 / 69 P.S. 623 (MVSFA)","peacefulRepoDefinition":"Self-help repossession is lawful only without a breach of the peace (UCC §9-609). A breach occurs on the debtor’s objection at the scene, entry into a residence or a closed/locked enclosure, any use or threat of force, or an officer directing the repossession (state action).","preRepoNoticeRequired":true,"preRepoNoticeDays":15,"postRepoNoticeRequired":true,"postRepoNoticeDays":15,"postRepoNoticeMethod":"certified","redemptionPeriodDays":15,"cureRight":true,"cureRightDays":15,"personalPropertyHoldDays":30,"personalPropertyReleaseMethod":"owner_pickup_after_notice","secondaryContactRequired":true,"sheriffNoticeRequired":false,"sheriffNoticeJurisdiction":null,"nightRepoIsBreach":false,"presenceObjectionStrict":true}'::jsonb),
  ('MI', '{"statute":"MI MCL 440.9609 / 492.114a","peacefulRepoDefinition":"Self-help repossession is lawful only without a breach of the peace (UCC §9-609). A breach occurs on the debtor’s objection at the scene, entry into a residence or a closed/locked enclosure, any use or threat of force, or an officer directing the repossession (state action).","preRepoNoticeRequired":false,"preRepoNoticeDays":0,"postRepoNoticeRequired":true,"postRepoNoticeDays":10,"postRepoNoticeMethod":"certified","redemptionPeriodDays":0,"cureRight":true,"cureRightDays":10,"personalPropertyHoldDays":30,"personalPropertyReleaseMethod":"owner_pickup_after_notice","secondaryContactRequired":false,"sheriffNoticeRequired":false,"sheriffNoticeJurisdiction":null,"nightRepoIsBreach":false,"presenceObjectionStrict":true}'::jsonb)
ON CONFLICT (state) DO UPDATE
  SET rules = EXCLUDED.rules, updated_at = now();


-- ---------------------------------------------------------------------
-- 2. repo_required_notices
-- ---------------------------------------------------------------------
-- Notices issued for a repossession case. repo_case_id has NO FK yet (S49
-- deferral). state lets the engine/cron/PDF resolve per-state rules without
-- the parent case. response_due_at is computed at record time; the cron flags
-- notices past it without a response.
--
-- Idempotency: only ONE *pending* (unanswered) notice per (case, type,
-- recipient role) at a time — the partial unique index. Once a response is
-- recorded, the row drops out of the index so a follow-up may be issued.

CREATE TABLE IF NOT EXISTS repo_required_notices (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  repo_case_id          uuid NOT NULL,
  state                 text NOT NULL,
  notice_type           text NOT NULL,
  recipient_role        text NOT NULL,
  recipient_name        text,
  recipient_address     text,
  statute_citation      text NOT NULL,
  delivery_method       text NOT NULL,
  certified_tracking_no text,
  sent_at               timestamptz NOT NULL DEFAULT now(),
  response_due_at       timestamptz,
  response_received_at  timestamptz,
  response_notes        text,
  notes                 text,
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

ALTER TABLE repo_required_notices DROP CONSTRAINT IF EXISTS repo_required_notices_state_format;
ALTER TABLE repo_required_notices ADD CONSTRAINT repo_required_notices_state_format
  CHECK (state ~ '^[A-Z]{2}$');

ALTER TABLE repo_required_notices DROP CONSTRAINT IF EXISTS repo_required_notices_type_chk;
ALTER TABLE repo_required_notices ADD CONSTRAINT repo_required_notices_type_chk
  CHECK (notice_type IN ('pre_repo_notice', 'post_repo_notice', 'personal_property_notice', 'redemption_notice', 'sheriff_notice'));

ALTER TABLE repo_required_notices DROP CONSTRAINT IF EXISTS repo_required_notices_recipient_role_chk;
ALTER TABLE repo_required_notices ADD CONSTRAINT repo_required_notices_recipient_role_chk
  CHECK (recipient_role IN ('debtor', 'secondary_contact', 'lienholder', 'sheriff'));

ALTER TABLE repo_required_notices DROP CONSTRAINT IF EXISTS repo_required_notices_delivery_method_chk;
ALTER TABLE repo_required_notices ADD CONSTRAINT repo_required_notices_delivery_method_chk
  CHECK (delivery_method IN ('certified', 'publication', 'email', 'posted'));

-- One pending (unanswered) notice per (case, type, recipient role).
DROP INDEX IF EXISTS repo_required_notices_pending_unique;
CREATE UNIQUE INDEX repo_required_notices_pending_unique
  ON repo_required_notices (repo_case_id, notice_type, recipient_role)
  WHERE response_received_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS repo_required_notices_tenant_case_idx
  ON repo_required_notices (tenant_id, repo_case_id)
  WHERE deleted_at IS NULL;

-- Cron-sweep target: pending notices whose response window may have passed.
CREATE INDEX IF NOT EXISTS repo_required_notices_overdue_idx
  ON repo_required_notices (response_due_at)
  WHERE response_received_at IS NULL AND deleted_at IS NULL;

ALTER TABLE repo_required_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE repo_required_notices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repo_required_notices_tenant_isolation ON repo_required_notices;
CREATE POLICY repo_required_notices_tenant_isolation ON repo_required_notices
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_repo_required_notices ON repo_required_notices;
CREATE TRIGGER trg_audit_repo_required_notices
  AFTER INSERT OR UPDATE OR DELETE ON repo_required_notices
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_repo_required_notices_set_updated_at ON repo_required_notices;
CREATE TRIGGER trg_repo_required_notices_set_updated_at
  BEFORE UPDATE ON repo_required_notices
  FOR EACH ROW EXECUTE FUNCTION fn_repo_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. repo_timeline_events
-- ---------------------------------------------------------------------
-- Append-only audit trail of compliance activity for a case. payload carries
-- event-specific detail. actor_user_id is NULL for cron-generated events.
-- repo_case_id has NO FK yet (S49 deferral). Soft-delete columns present for
-- invariant parity though the table is written append-only in practice.

CREATE TABLE IF NOT EXISTS repo_timeline_events (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  repo_case_id    uuid NOT NULL,
  event_type      text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

ALTER TABLE repo_timeline_events DROP CONSTRAINT IF EXISTS repo_timeline_events_type_chk;
ALTER TABLE repo_timeline_events ADD CONSTRAINT repo_timeline_events_type_chk
  CHECK (event_type IN (
    'notice_recorded',
    'notice_response_recorded',
    'notice_overdue',
    'breach_of_peace_flagged',
    'redemption_computed',
    'personal_property_hold_computed'
  ));

CREATE INDEX IF NOT EXISTS repo_timeline_events_tenant_case_idx
  ON repo_timeline_events (tenant_id, repo_case_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS repo_timeline_events_case_occurred_idx
  ON repo_timeline_events (repo_case_id, occurred_at)
  WHERE deleted_at IS NULL;

ALTER TABLE repo_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE repo_timeline_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repo_timeline_events_tenant_isolation ON repo_timeline_events;
CREATE POLICY repo_timeline_events_tenant_isolation ON repo_timeline_events
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_repo_timeline_events ON repo_timeline_events;
CREATE TRIGGER trg_audit_repo_timeline_events
  AFTER INSERT OR UPDATE OR DELETE ON repo_timeline_events
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_repo_timeline_events_set_updated_at ON repo_timeline_events;
CREATE TRIGGER trg_repo_timeline_events_set_updated_at
  BEFORE UPDATE ON repo_timeline_events
  FOR EACH ROW EXECUTE FUNCTION fn_repo_set_updated_at();
