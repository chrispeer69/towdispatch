-- =====================================================================
-- 0051_self_serve_portal.sql  (Customer Self-Serve Portal — Session 55)
--
-- An account-less, per-impound portal where a vehicle owner looks up their
-- impounded vehicle (Host-resolved tenant), self-attests ID, pays via Stripe,
-- and initiates a release the yard gate finishes. DISTINCT from the Session 32
-- White-Label Customer Portal (account-scoped, password login) — that owns the
-- customer_portal_users / customer_portal_auth_tokens tables (0037). These four
-- tables are new and do not collide. See SESSION_55_DECISIONS.md.
--
-- Tables added:
--   1. customer_portal_sessions          — one per lookup→magic-link session
--   2. customer_portal_id_verifications  — self-attested ID (last4 ENCRYPTED)
--   3. customer_portal_release_intents   — the online "get my car" flow + status
--   4. customer_portal_payments          — Stripe PaymentIntent audit mirror
--
-- Patterns followed (match 0036_impound_storage.sql):
--   * Every table: tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT.
--   * ENABLE + FORCE ROW LEVEL SECURITY; policy USING/WITH CHECK
--     tenant_id = fn_current_tenant_id().
--   * Audit trigger fn_audit_log() on every table.
--   * Idempotent: CREATE ... IF NOT EXISTS, DROP ... IF EXISTS before every
--     constraint / policy / trigger / index.
--   * Soft delete (deleted_at timestamptz) everywhere — release intents and
--     payments are financial/legal records.
--   * Cross-tenant consistency BEFORE-trigger on every child table: RLS hides
--     foreign parents, so a foreign session_id surfaces as "does not exist".
--   * One shared BEFORE UPDATE updated_at trigger reused across all four tables.
--
-- Down (rollback):
--   DROP TABLE IF EXISTS customer_portal_payments;
--   DROP TABLE IF EXISTS customer_portal_release_intents;
--   DROP TABLE IF EXISTS customer_portal_id_verifications;
--   DROP TABLE IF EXISTS customer_portal_sessions;
--   DROP FUNCTION IF EXISTS fn_ssp_child_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_ssp_session_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_ssp_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper, reused by all four tables.
CREATE OR REPLACE FUNCTION fn_ssp_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Tenant-consistency guard for customer_portal_sessions: its optional
-- impound_id / account_id FKs must belong to the same tenant. RLS hides
-- foreign rows, so a cross-tenant id surfaces as "does not exist".
CREATE OR REPLACE FUNCTION fn_ssp_session_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF NEW.impound_id IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant FROM impound_records WHERE id = NEW.impound_id;
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'ssp session: impound_id % does not exist', NEW.impound_id;
    END IF;
    IF v_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'ssp session: impound_id tenant (%) <> session tenant (%)',
        v_tenant, NEW.tenant_id;
    END IF;
  END IF;

  IF NEW.account_id IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant FROM accounts WHERE id = NEW.account_id;
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'ssp session: account_id % does not exist', NEW.account_id;
    END IF;
    IF v_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'ssp session: account_id tenant (%) <> session tenant (%)',
        v_tenant, NEW.tenant_id;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

-- Tenant-consistency guard for the three child tables that hang off
-- customer_portal_sessions (id_verifications, release_intents, payments).
CREATE OR REPLACE FUNCTION fn_ssp_child_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_session_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_session_tenant
  FROM customer_portal_sessions WHERE id = NEW.session_id;

  IF v_session_tenant IS NULL THEN
    RAISE EXCEPTION 'ssp child: session_id % does not exist', NEW.session_id;
  END IF;

  IF v_session_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'ssp child: tenant_id (%) does not match session tenant (%)',
      NEW.tenant_id, v_session_tenant;
  END IF;

  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. customer_portal_sessions
-- ---------------------------------------------------------------------
-- One row per lookup that resolved to a single live impound. `lookup_token`
-- is the opaque handle returned to the browser; `magic_link_token` is the
-- one-time link sent over SMS/email and exchanged for the session cookie.
-- `claims` holds the verified-identity flags the session carries.

CREATE TABLE IF NOT EXISTS customer_portal_sessions (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  impound_id             uuid REFERENCES impound_records(id) ON DELETE SET NULL,
  account_id             uuid REFERENCES accounts(id) ON DELETE SET NULL,
  lookup_token           text NOT NULL,
  magic_link_token       text,
  magic_link_expires_at  timestamptz,
  claims                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip                     text,
  user_agent             text,
  last_seen_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);

ALTER TABLE customer_portal_sessions DROP CONSTRAINT IF EXISTS customer_portal_sessions_lookup_token_nonempty;
ALTER TABLE customer_portal_sessions ADD CONSTRAINT customer_portal_sessions_lookup_token_nonempty
  CHECK (length(trim(lookup_token)) > 0);

-- Idempotency: one live session per (tenant, lookup_token).
DROP INDEX IF EXISTS customer_portal_sessions_tenant_lookup_unique;
CREATE UNIQUE INDEX customer_portal_sessions_tenant_lookup_unique
  ON customer_portal_sessions (tenant_id, lookup_token)
  WHERE deleted_at IS NULL;

-- Magic-link tokens are globally unique among live, unconsumed rows.
DROP INDEX IF EXISTS customer_portal_sessions_magic_link_unique;
CREATE UNIQUE INDEX customer_portal_sessions_magic_link_unique
  ON customer_portal_sessions (magic_link_token)
  WHERE magic_link_token IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_portal_sessions_tenant_impound_idx
  ON customer_portal_sessions (tenant_id, impound_id)
  WHERE deleted_at IS NULL;

ALTER TABLE customer_portal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_portal_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_portal_sessions_tenant_isolation ON customer_portal_sessions;
CREATE POLICY customer_portal_sessions_tenant_isolation ON customer_portal_sessions
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_customer_portal_sessions ON customer_portal_sessions;
CREATE TRIGGER trg_audit_customer_portal_sessions
  AFTER INSERT OR UPDATE OR DELETE ON customer_portal_sessions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_ssp_sessions_set_updated_at ON customer_portal_sessions;
CREATE TRIGGER trg_ssp_sessions_set_updated_at
  BEFORE UPDATE ON customer_portal_sessions
  FOR EACH ROW EXECUTE FUNCTION fn_ssp_set_updated_at();

DROP TRIGGER IF EXISTS trg_ssp_sessions_tenant_consistency ON customer_portal_sessions;
CREATE TRIGGER trg_ssp_sessions_tenant_consistency
  BEFORE INSERT OR UPDATE ON customer_portal_sessions
  FOR EACH ROW EXECUTE FUNCTION fn_ssp_session_tenant_consistency();


-- ---------------------------------------------------------------------
-- 2. customer_portal_id_verifications
-- ---------------------------------------------------------------------
-- Self-attested identity. id_last4 is the AES-256-GCM-ENCRYPTED last 4 of the
-- ID (a base64 blob, NOT 4 chars) — never the full number, never an SSN. The
-- gate operator physically re-verifies at pickup; this only flags "id-on-file".

CREATE TABLE IF NOT EXISTS customer_portal_id_verifications (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  session_id   uuid NOT NULL REFERENCES customer_portal_sessions(id) ON DELETE CASCADE,
  id_type      text NOT NULL,
  id_last4     text NOT NULL,
  full_name    text NOT NULL,
  dob          date,
  verified_by  text NOT NULL DEFAULT 'self_attested',
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

ALTER TABLE customer_portal_id_verifications DROP CONSTRAINT IF EXISTS customer_portal_id_verifications_id_type_chk;
ALTER TABLE customer_portal_id_verifications ADD CONSTRAINT customer_portal_id_verifications_id_type_chk
  CHECK (id_type IN ('drivers_license', 'passport', 'state_id'));

ALTER TABLE customer_portal_id_verifications DROP CONSTRAINT IF EXISTS customer_portal_id_verifications_verified_by_chk;
ALTER TABLE customer_portal_id_verifications ADD CONSTRAINT customer_portal_id_verifications_verified_by_chk
  CHECK (verified_by IN ('self_attested', 'stripe_identity', 'operator_at_gate'));

CREATE INDEX IF NOT EXISTS customer_portal_id_verifications_session_idx
  ON customer_portal_id_verifications (tenant_id, session_id)
  WHERE deleted_at IS NULL;

ALTER TABLE customer_portal_id_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_portal_id_verifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_portal_id_verifications_tenant_isolation ON customer_portal_id_verifications;
CREATE POLICY customer_portal_id_verifications_tenant_isolation ON customer_portal_id_verifications
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_customer_portal_id_verifications ON customer_portal_id_verifications;
CREATE TRIGGER trg_audit_customer_portal_id_verifications
  AFTER INSERT OR UPDATE OR DELETE ON customer_portal_id_verifications
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_ssp_id_verifications_set_updated_at ON customer_portal_id_verifications;
CREATE TRIGGER trg_ssp_id_verifications_set_updated_at
  BEFORE UPDATE ON customer_portal_id_verifications
  FOR EACH ROW EXECUTE FUNCTION fn_ssp_set_updated_at();

DROP TRIGGER IF EXISTS trg_ssp_id_verifications_tenant_consistency ON customer_portal_id_verifications;
CREATE TRIGGER trg_ssp_id_verifications_tenant_consistency
  BEFORE INSERT OR UPDATE ON customer_portal_id_verifications
  FOR EACH ROW EXECUTE FUNCTION fn_ssp_child_tenant_consistency();


-- ---------------------------------------------------------------------
-- 3. customer_portal_release_intents
-- ---------------------------------------------------------------------
-- The online release flow + status machine (enforced in the service layer):
--   initiated -> id_provided -> paid -> ready_for_gate -> gate_completed
-- with cancelled reachable pre-payment. total_due_cents is the snapshot at
-- intent creation; a single full PaymentIntent flips paid -> ready_for_gate
-- (partial payments disallowed in v1).

CREATE TABLE IF NOT EXISTS customer_portal_release_intents (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  session_id               uuid NOT NULL REFERENCES customer_portal_sessions(id) ON DELETE CASCADE,
  impound_id               uuid NOT NULL REFERENCES impound_records(id) ON DELETE RESTRICT,
  status                   text NOT NULL DEFAULT 'initiated',
  total_due_cents          bigint NOT NULL,
  paid_cents               bigint NOT NULL DEFAULT 0,
  stripe_payment_intent_id text,
  initiated_at             timestamptz NOT NULL DEFAULT now(),
  ready_for_gate_at        timestamptz,
  gate_completed_at        timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

ALTER TABLE customer_portal_release_intents DROP CONSTRAINT IF EXISTS customer_portal_release_intents_status_chk;
ALTER TABLE customer_portal_release_intents ADD CONSTRAINT customer_portal_release_intents_status_chk
  CHECK (status IN ('initiated', 'id_provided', 'paid', 'ready_for_gate', 'cancelled', 'gate_completed'));

ALTER TABLE customer_portal_release_intents DROP CONSTRAINT IF EXISTS customer_portal_release_intents_amounts_chk;
ALTER TABLE customer_portal_release_intents ADD CONSTRAINT customer_portal_release_intents_amounts_chk
  CHECK (total_due_cents >= 0 AND paid_cents >= 0);

CREATE INDEX IF NOT EXISTS customer_portal_release_intents_tenant_status_idx
  ON customer_portal_release_intents (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_portal_release_intents_session_idx
  ON customer_portal_release_intents (tenant_id, session_id)
  WHERE deleted_at IS NULL;

-- Idempotency: one live release intent per Stripe PaymentIntent.
DROP INDEX IF EXISTS customer_portal_release_intents_pi_unique;
CREATE UNIQUE INDEX customer_portal_release_intents_pi_unique
  ON customer_portal_release_intents (tenant_id, stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE customer_portal_release_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_portal_release_intents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_portal_release_intents_tenant_isolation ON customer_portal_release_intents;
CREATE POLICY customer_portal_release_intents_tenant_isolation ON customer_portal_release_intents
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_customer_portal_release_intents ON customer_portal_release_intents;
CREATE TRIGGER trg_audit_customer_portal_release_intents
  AFTER INSERT OR UPDATE OR DELETE ON customer_portal_release_intents
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_ssp_release_intents_set_updated_at ON customer_portal_release_intents;
CREATE TRIGGER trg_ssp_release_intents_set_updated_at
  BEFORE UPDATE ON customer_portal_release_intents
  FOR EACH ROW EXECUTE FUNCTION fn_ssp_set_updated_at();

DROP TRIGGER IF EXISTS trg_ssp_release_intents_tenant_consistency ON customer_portal_release_intents;
CREATE TRIGGER trg_ssp_release_intents_tenant_consistency
  BEFORE INSERT OR UPDATE ON customer_portal_release_intents
  FOR EACH ROW EXECUTE FUNCTION fn_ssp_child_tenant_consistency();


-- ---------------------------------------------------------------------
-- 4. customer_portal_payments
-- ---------------------------------------------------------------------
-- Audit mirror of the Stripe PaymentIntents created for portal release intents.
-- The shared stripe_events table remains the webhook idempotency anchor; this
-- table is the portal-context ledger keyed by stripe_payment_intent_id.

CREATE TABLE IF NOT EXISTS customer_portal_payments (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  session_id               uuid NOT NULL REFERENCES customer_portal_sessions(id) ON DELETE CASCADE,
  release_intent_id        uuid REFERENCES customer_portal_release_intents(id) ON DELETE SET NULL,
  stripe_payment_intent_id text NOT NULL,
  amount_cents             integer NOT NULL,
  status                   text NOT NULL DEFAULT 'pending',
  paid_at                  timestamptz,
  refunded_at              timestamptz,
  error_text               text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

ALTER TABLE customer_portal_payments DROP CONSTRAINT IF EXISTS customer_portal_payments_status_chk;
ALTER TABLE customer_portal_payments ADD CONSTRAINT customer_portal_payments_status_chk
  CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded'));

ALTER TABLE customer_portal_payments DROP CONSTRAINT IF EXISTS customer_portal_payments_amount_chk;
ALTER TABLE customer_portal_payments ADD CONSTRAINT customer_portal_payments_amount_chk
  CHECK (amount_cents >= 0);

-- Idempotency: one live payment row per Stripe PaymentIntent per tenant.
DROP INDEX IF EXISTS customer_portal_payments_pi_unique;
CREATE UNIQUE INDEX customer_portal_payments_pi_unique
  ON customer_portal_payments (tenant_id, stripe_payment_intent_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_portal_payments_release_intent_idx
  ON customer_portal_payments (tenant_id, release_intent_id)
  WHERE deleted_at IS NULL;

ALTER TABLE customer_portal_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_portal_payments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_portal_payments_tenant_isolation ON customer_portal_payments;
CREATE POLICY customer_portal_payments_tenant_isolation ON customer_portal_payments
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_customer_portal_payments ON customer_portal_payments;
CREATE TRIGGER trg_audit_customer_portal_payments
  AFTER INSERT OR UPDATE OR DELETE ON customer_portal_payments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_ssp_payments_set_updated_at ON customer_portal_payments;
CREATE TRIGGER trg_ssp_payments_set_updated_at
  BEFORE UPDATE ON customer_portal_payments
  FOR EACH ROW EXECUTE FUNCTION fn_ssp_set_updated_at();

DROP TRIGGER IF EXISTS trg_ssp_payments_tenant_consistency ON customer_portal_payments;
CREATE TRIGGER trg_ssp_payments_tenant_consistency
  BEFORE INSERT OR UPDATE ON customer_portal_payments
  FOR EACH ROW EXECUTE FUNCTION fn_ssp_child_tenant_consistency();
