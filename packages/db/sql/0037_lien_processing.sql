-- =====================================================================
-- 0037_lien_processing.sql  (Lien Processing — Session 23)
--
-- Statutory lien-sale workflow for impounded vehicles that go unclaimed:
-- DMV owner/lienholder lookup, certified-mail + publication notices, the
-- mandatory waiting period, and the ready-for-sale gate. Covers the top
-- 10 states (CA, TX, FL, NY, GA, NC, OH, IL, PA, MI); the remaining 40
-- are deferred to a later session.
--
-- IMPORTANT — this code does NOT auto-advance a lien sale. The nightly
-- cron (LIEN_ADVANCE_CRON_ENABLED) only recomputes next_action_due_at and
-- logs overdue actions. Every legal step (sending a notice, recording a
-- response, marking ready-for-sale) is an explicit operator action. The
-- per-state day counts are best-effort and MUST be reviewed by counsel
-- before a production sale runs through this code — see
-- SESSION_23_DECISIONS.md.
--
-- Tables added:
--   1. lien_state_rules       — per-state statutory rule config (GLOBAL
--                               reference data; NOT tenant-scoped, no RLS).
--   2. lien_cases             — one row per lien proceeding, FK to an
--                               impound_record.
--   3. lien_notices           — owner / lienholder / publication / DMV
--                               notices issued for a case.
--   4. lien_timeline_events   — append-only audit trail of case events.
--
-- Patterns followed (match 0036_impound_storage.sql exactly):
--   * Every tenant table: tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE RESTRICT; ENABLE + FORCE ROW LEVEL SECURITY; policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on every tenant table.
--   * Idempotent: CREATE ... IF NOT EXISTS, DROP ... IF EXISTS before
--     every constraint / policy / trigger / index.
--   * Soft delete (deleted_at timestamptz) on every tenant table — lien
--     proceedings are long-lived legal documents.
--   * Cross-tenant consistency BEFORE-trigger: lien_cases verifies the
--     referenced impound_record's tenant matches; lien_notices /
--     lien_timeline_events verify the referenced lien_case's tenant
--     matches. RLS hides foreign parents from the trigger's SELECT, so a
--     foreign-id injection fails "does not exist".
--   * Shared BEFORE UPDATE updated_at trigger function across all tables.
--   * lien_state_rules is GLOBAL reference data: app_user reads it via the
--     default-privilege GRANT (0002_roles.sql); no tenant_id, no RLS.
--
-- Down (rollback):
--   DROP TABLE IF EXISTS lien_timeline_events;
--   DROP TABLE IF EXISTS lien_notices;
--   DROP TABLE IF EXISTS lien_cases;
--   DROP TABLE IF EXISTS lien_state_rules;
--   DROP FUNCTION IF EXISTS fn_lien_cases_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_lien_child_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_lien_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper, reused by all lien-processing tables.
CREATE OR REPLACE FUNCTION fn_lien_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Tenant-consistency guard for lien_cases: the referenced impound_record's
-- tenant_id must match the case's tenant_id. RLS hides foreign records, so
-- a cross-tenant impound_record_id surfaces as "does not exist".
CREATE OR REPLACE FUNCTION fn_lien_cases_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_record_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_record_tenant
  FROM impound_records WHERE id = NEW.impound_record_id;

  IF v_record_tenant IS NULL THEN
    RAISE EXCEPTION 'lien_cases: impound_record_id % does not exist', NEW.impound_record_id;
  END IF;

  IF v_record_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'lien_cases: tenant_id (%) does not match impound_records.tenant_id (%)',
      NEW.tenant_id, v_record_tenant;
  END IF;

  RETURN NEW;
END
$$;

-- Tenant-consistency guard for the two child tables that hang off
-- lien_cases (notices, timeline events). Verifies the referenced case's
-- tenant_id matches the child row's tenant_id.
CREATE OR REPLACE FUNCTION fn_lien_child_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_case_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_case_tenant
  FROM lien_cases WHERE id = NEW.lien_case_id;

  IF v_case_tenant IS NULL THEN
    RAISE EXCEPTION 'lien child: lien_case_id % does not exist', NEW.lien_case_id;
  END IF;

  IF v_case_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'lien child: tenant_id (%) does not match lien_cases.tenant_id (%)',
      NEW.tenant_id, v_case_tenant;
  END IF;

  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. lien_state_rules  (GLOBAL reference data — NOT tenant-scoped)
-- ---------------------------------------------------------------------
-- One row per US state with the statutory day-counts the rule engine
-- reads. Seeded below for the top 10 states. The TypeScript module
-- apps/api/src/modules/lien-processing/state-rules.config.ts is the
-- runtime source of truth; this table mirrors it so the values are
-- queryable / auditable and a future session can let tenants override.
-- No tenant_id, no RLS: statute config is the same for every operator in
-- a given state. app_user reads it via the default-privilege SELECT grant.

CREATE TABLE IF NOT EXISTS lien_state_rules (
  state       text PRIMARY KEY,
  rules       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lien_state_rules DROP CONSTRAINT IF EXISTS lien_state_rules_state_format;
ALTER TABLE lien_state_rules ADD CONSTRAINT lien_state_rules_state_format
  CHECK (state ~ '^[A-Z]{2}$');

DROP TRIGGER IF EXISTS trg_lien_state_rules_set_updated_at ON lien_state_rules;
CREATE TRIGGER trg_lien_state_rules_set_updated_at
  BEFORE UPDATE ON lien_state_rules
  FOR EACH ROW EXECUTE FUNCTION fn_lien_set_updated_at();

-- Seed the top 10 states. Re-runnable: ON CONFLICT refreshes the rules.
-- Day-counts are best-effort against each state's lien-sale statute (cited
-- in the `statute` field) and require legal review before production use.
INSERT INTO lien_state_rules (state, rules) VALUES
  ('CA', '{"statute":"CA Civil Code 3068.1 / Vehicle Code 22851.12, 22851.10 (low-value)","dmvLookupWindowDays":3,"ownerNoticeWaitDays":10,"lienholderNoticeWaitDays":10,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":400000,"highMinCents":1000000}}'::jsonb),
  ('TX', '{"statute":"TX Occupations Code 2303 / Property Code 70.006","dmvLookupWindowDays":5,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":false,"publicationWaitDays":0,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('FL', '{"statute":"FL Statutes 713.78 / 713.585","dmvLookupWindowDays":7,"ownerNoticeWaitDays":30,"lienholderNoticeWaitDays":30,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":35,"lowValuePublicationExempt":false,"valueTiers":{"lowMaxCents":300000,"highMinCents":1000000}}'::jsonb),
  ('NY', '{"statute":"NY Lien Law 184 / 200-204","dmvLookupWindowDays":5,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":150000,"highMinCents":1000000}}'::jsonb),
  ('GA', '{"statute":"GA Code 40-11-1 through 40-11-19 / 44-1-13","dmvLookupWindowDays":5,"ownerNoticeWaitDays":10,"lienholderNoticeWaitDays":10,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('NC', '{"statute":"NC Gen Stat 44A-1 through 44A-4 (Chapter 44A Article 1)","dmvLookupWindowDays":7,"ownerNoticeWaitDays":10,"lienholderNoticeWaitDays":10,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":300000,"highMinCents":1000000}}'::jsonb),
  ('OH', '{"statute":"OH Rev Code 4505.101 / 4513.60-.62","dmvLookupWindowDays":5,"ownerNoticeWaitDays":15,"lienholderNoticeWaitDays":15,"publicationRequired":false,"publicationWaitDays":0,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('IL', '{"statute":"IL 625 ILCS 5/4-201 through 5/4-214 / 770 ILCS 50","dmvLookupWindowDays":7,"ownerNoticeWaitDays":15,"lienholderNoticeWaitDays":15,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('PA', '{"statute":"PA 75 Pa.C.S. 7301-7305 / Abandoned Vehicle provisions","dmvLookupWindowDays":7,"ownerNoticeWaitDays":15,"lienholderNoticeWaitDays":15,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb),
  ('MI', '{"statute":"MI Comp Laws 257.252 / 570.521-570.530","dmvLookupWindowDays":7,"ownerNoticeWaitDays":20,"lienholderNoticeWaitDays":20,"publicationRequired":true,"publicationWaitDays":10,"minDaysToSale":30,"lowValuePublicationExempt":true,"valueTiers":{"lowMaxCents":250000,"highMinCents":1000000}}'::jsonb)
ON CONFLICT (state) DO UPDATE
  SET rules = EXCLUDED.rules, updated_at = now();


-- ---------------------------------------------------------------------
-- 2. lien_cases
-- ---------------------------------------------------------------------
-- One row per lien proceeding. impound_record_id links the stored vehicle
-- (ON DELETE RESTRICT — a lien case must outlive deletion attempts on its
-- record). state drives which rule set applies. current_step is the
-- workflow position; next_action_due_at is the rule engine's computed
-- deadline for the next operator action (recomputed by the cron).
--
-- One live lien case per impound record (partial unique index) — opening a
-- second case for the same record returns a conflict.

CREATE TABLE IF NOT EXISTS lien_cases (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  impound_record_id   uuid NOT NULL REFERENCES impound_records(id) ON DELETE RESTRICT,
  state               text NOT NULL,
  status              text NOT NULL DEFAULT 'open',
  current_step        text NOT NULL DEFAULT 'opened',
  vehicle_value_tier  text NOT NULL DEFAULT 'mid',
  owner_found         boolean NOT NULL DEFAULT false,
  lienholder_found    boolean NOT NULL DEFAULT false,
  estimated_value_cents bigint,
  opened_at           timestamptz NOT NULL DEFAULT now(),
  next_action_due_at  timestamptz,
  ready_for_sale_at   timestamptz,
  sold_at             timestamptz,
  closed_at           timestamptz,
  closed_reason       text,
  notes               text,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE lien_cases DROP CONSTRAINT IF EXISTS lien_cases_state_format;
ALTER TABLE lien_cases ADD CONSTRAINT lien_cases_state_format
  CHECK (state ~ '^[A-Z]{2}$');

ALTER TABLE lien_cases DROP CONSTRAINT IF EXISTS lien_cases_status_chk;
ALTER TABLE lien_cases ADD CONSTRAINT lien_cases_status_chk
  CHECK (status IN ('open', 'ready_for_sale', 'sold', 'closed', 'canceled'));

ALTER TABLE lien_cases DROP CONSTRAINT IF EXISTS lien_cases_step_chk;
ALTER TABLE lien_cases ADD CONSTRAINT lien_cases_step_chk
  CHECK (current_step IN (
    'opened',
    'dmv_lookup_requested',
    'dmv_lookup_complete',
    'owner_notice_sent',
    'lienholder_notice_sent',
    'publication_complete',
    'waiting_period',
    'ready_for_sale',
    'sold',
    'closed'
  ));

ALTER TABLE lien_cases DROP CONSTRAINT IF EXISTS lien_cases_value_tier_chk;
ALTER TABLE lien_cases ADD CONSTRAINT lien_cases_value_tier_chk
  CHECK (vehicle_value_tier IN ('low', 'mid', 'high'));

ALTER TABLE lien_cases DROP CONSTRAINT IF EXISTS lien_cases_estimated_value_nonneg;
ALTER TABLE lien_cases ADD CONSTRAINT lien_cases_estimated_value_nonneg
  CHECK (estimated_value_cents IS NULL OR estimated_value_cents >= 0);

-- One live lien case per impound record.
DROP INDEX IF EXISTS lien_cases_record_unique;
CREATE UNIQUE INDEX lien_cases_record_unique
  ON lien_cases (impound_record_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS lien_cases_tenant_status_idx
  ON lien_cases (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS lien_cases_tenant_state_idx
  ON lien_cases (tenant_id, state)
  WHERE deleted_at IS NULL;

-- Cron-sweep target: open cases with a due date that may have passed.
CREATE INDEX IF NOT EXISTS lien_cases_due_active_idx
  ON lien_cases (next_action_due_at)
  WHERE status IN ('open', 'ready_for_sale') AND deleted_at IS NULL;

ALTER TABLE lien_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE lien_cases FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lien_cases_tenant_isolation ON lien_cases;
CREATE POLICY lien_cases_tenant_isolation ON lien_cases
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_lien_cases_tenant_consistency ON lien_cases;
CREATE TRIGGER trg_lien_cases_tenant_consistency
  BEFORE INSERT OR UPDATE ON lien_cases
  FOR EACH ROW EXECUTE FUNCTION fn_lien_cases_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_lien_cases ON lien_cases;
CREATE TRIGGER trg_audit_lien_cases
  AFTER INSERT OR UPDATE OR DELETE ON lien_cases
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_lien_cases_set_updated_at ON lien_cases;
CREATE TRIGGER trg_lien_cases_set_updated_at
  BEFORE UPDATE ON lien_cases
  FOR EACH ROW EXECUTE FUNCTION fn_lien_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. lien_notices
-- ---------------------------------------------------------------------
-- Notices issued for a case. notice_type + recipient_role describe who was
-- notified and how. sent_at / certified_tracking_no document delivery;
-- response_received_at records a claim or reply that halts the sale.
--
-- Idempotency: a case may carry only ONE *pending* (unanswered) notice of a
-- given (notice_type, recipient_role) at a time — the partial unique index.
-- Once a response is recorded, the row drops out of the index, so a
-- follow-up notice of the same type can be issued.

CREATE TABLE IF NOT EXISTS lien_notices (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  lien_case_id          uuid NOT NULL REFERENCES lien_cases(id) ON DELETE CASCADE,
  notice_type           text NOT NULL,
  recipient_role        text NOT NULL,
  recipient_name        text,
  recipient_address     text,
  delivery_method       text NOT NULL,
  sent_at               timestamptz NOT NULL DEFAULT now(),
  certified_tracking_no text,
  response_received_at  timestamptz,
  response_notes        text,
  notes                 text,
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

ALTER TABLE lien_notices DROP CONSTRAINT IF EXISTS lien_notices_type_chk;
ALTER TABLE lien_notices ADD CONSTRAINT lien_notices_type_chk
  CHECK (notice_type IN ('owner_notice', 'lienholder_notice', 'publication_notice', 'dmv_request'));

ALTER TABLE lien_notices DROP CONSTRAINT IF EXISTS lien_notices_recipient_role_chk;
ALTER TABLE lien_notices ADD CONSTRAINT lien_notices_recipient_role_chk
  CHECK (recipient_role IN ('owner', 'lienholder', 'dmv', 'public'));

ALTER TABLE lien_notices DROP CONSTRAINT IF EXISTS lien_notices_delivery_method_chk;
ALTER TABLE lien_notices ADD CONSTRAINT lien_notices_delivery_method_chk
  CHECK (delivery_method IN ('certified_mail', 'first_class_mail', 'publication', 'electronic', 'in_person'));

-- One pending (unanswered) notice per (case, type, recipient role).
DROP INDEX IF EXISTS lien_notices_pending_unique;
CREATE UNIQUE INDEX lien_notices_pending_unique
  ON lien_notices (lien_case_id, notice_type, recipient_role)
  WHERE response_received_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS lien_notices_tenant_case_idx
  ON lien_notices (tenant_id, lien_case_id)
  WHERE deleted_at IS NULL;

ALTER TABLE lien_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE lien_notices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lien_notices_tenant_isolation ON lien_notices;
CREATE POLICY lien_notices_tenant_isolation ON lien_notices
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_lien_notices_tenant_consistency ON lien_notices;
CREATE TRIGGER trg_lien_notices_tenant_consistency
  BEFORE INSERT OR UPDATE ON lien_notices
  FOR EACH ROW EXECUTE FUNCTION fn_lien_child_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_lien_notices ON lien_notices;
CREATE TRIGGER trg_audit_lien_notices
  AFTER INSERT OR UPDATE OR DELETE ON lien_notices
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_lien_notices_set_updated_at ON lien_notices;
CREATE TRIGGER trg_lien_notices_set_updated_at
  BEFORE UPDATE ON lien_notices
  FOR EACH ROW EXECUTE FUNCTION fn_lien_set_updated_at();


-- ---------------------------------------------------------------------
-- 4. lien_timeline_events
-- ---------------------------------------------------------------------
-- Append-only audit trail of everything that happened to a case. payload
-- carries event-specific detail (the step transition, the notice id, the
-- computed due date, etc.). actor_user_id is NULL for cron-generated
-- events. Soft-delete columns are present for invariant parity though the
-- table is written append-only in practice.

CREATE TABLE IF NOT EXISTS lien_timeline_events (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  lien_case_id    uuid NOT NULL REFERENCES lien_cases(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

ALTER TABLE lien_timeline_events DROP CONSTRAINT IF EXISTS lien_timeline_events_type_chk;
ALTER TABLE lien_timeline_events ADD CONSTRAINT lien_timeline_events_type_chk
  CHECK (event_type IN (
    'case_opened',
    'value_tier_set',
    'dmv_lookup_recorded',
    'notice_recorded',
    'response_recorded',
    'step_advanced',
    'action_due',
    'marked_ready_for_sale',
    'case_sold',
    'case_closed',
    'case_canceled'
  ));

CREATE INDEX IF NOT EXISTS lien_timeline_events_tenant_case_idx
  ON lien_timeline_events (tenant_id, lien_case_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS lien_timeline_events_case_occurred_idx
  ON lien_timeline_events (lien_case_id, occurred_at)
  WHERE deleted_at IS NULL;

ALTER TABLE lien_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lien_timeline_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lien_timeline_events_tenant_isolation ON lien_timeline_events;
CREATE POLICY lien_timeline_events_tenant_isolation ON lien_timeline_events
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_lien_timeline_events_tenant_consistency ON lien_timeline_events;
CREATE TRIGGER trg_lien_timeline_events_tenant_consistency
  BEFORE INSERT OR UPDATE ON lien_timeline_events
  FOR EACH ROW EXECUTE FUNCTION fn_lien_child_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_lien_timeline_events ON lien_timeline_events;
CREATE TRIGGER trg_audit_lien_timeline_events
  AFTER INSERT OR UPDATE OR DELETE ON lien_timeline_events
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_lien_timeline_events_set_updated_at ON lien_timeline_events;
CREATE TRIGGER trg_lien_timeline_events_set_updated_at
  BEFORE UPDATE ON lien_timeline_events
  FOR EACH ROW EXECUTE FUNCTION fn_lien_set_updated_at();
