-- =====================================================================
-- 0034_tier_offer_composer.sql  (Tier Offer Composer — Session 1)
--
-- Schema foundation for the operator-side composer that turns a dynamic
-- pricing tier into a signed, magic-linked offer sent to motor-club
-- account managers. Recipients accept or decline independently. The
-- acceptance ledger is the contractual record: clubs that accept are
-- bound to the elevated rate for the event window; clubs that decline
-- (or don't respond by the deadline) follow `default_for_non_responders`
-- — typically opt_out, which leaves the operator free to route to
-- partners that did accept.
--
-- This is negotiation infrastructure, not surge-pricing-by-fiat. The
-- operator proposes terms, partners accept or decline, and the resulting
-- allocation is contractually clean and audit-trailed.
--
-- Tables added:
--   1. tier_offers              — the composed offer (one per send)
--   2. tier_offer_recipients    — per-account-manager acceptance ledger
--
-- Patterns followed (all match the existing codebase, see 0031/0033):
--   * Every tenant table: tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE RESTRICT.
--   * Every tenant table: ENABLE + FORCE ROW LEVEL SECURITY, policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on both tables.
--   * Idempotent: CREATE TABLE / CREATE INDEX IF NOT EXISTS, every
--     constraint preceded by DROP CONSTRAINT IF EXISTS, every policy by
--     DROP POLICY IF EXISTS, every trigger by DROP TRIGGER IF EXISTS.
--   * Soft delete (deleted_at timestamptz) on both — long-lived business
--     records that may need post-hoc archival recovery.
--   * Cross-tenant consistency BEFORE-trigger on
--     tier_offer_recipients(account_id, offer_id) — the FKs guarantee
--     the rows exist but not that their tenant_id matches. The trigger
--     raises on mismatch. Mirrors the job_evidence pattern from 0033 but
--     account_id is NULLable (ad-hoc emails), so the trigger short-
--     circuits cleanly on NULL.
--   * BEFORE UPDATE updated_at trigger on both — Drizzle's defaultNow()
--     only fires on INSERT.
--
-- Down (rollback):
--   DROP TRIGGER IF EXISTS trg_tor_set_updated_at      ON tier_offer_recipients;
--   DROP TRIGGER IF EXISTS trg_audit_tier_offer_recipients ON tier_offer_recipients;
--   DROP TRIGGER IF EXISTS trg_tor_tenant_consistency  ON tier_offer_recipients;
--   DROP FUNCTION IF EXISTS fn_tier_offer_recipients_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_tier_offer_recipients_set_updated_at();
--   DROP TRIGGER IF EXISTS trg_tier_offers_set_updated_at ON tier_offers;
--   DROP TRIGGER IF EXISTS trg_audit_tier_offers       ON tier_offers;
--   DROP FUNCTION IF EXISTS fn_tier_offers_set_updated_at();
--   DROP TABLE IF EXISTS tier_offer_recipients;
--   DROP TABLE IF EXISTS tier_offers;
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. tier_offers
-- ---------------------------------------------------------------------
-- The composed offer the operator sends. One row per "send" — re-sending
-- to the same list under a new title is a new offer (audit trails are
-- per-offer). The status machine is intentionally linear:
--
--   draft -> sent -> event_active -> event_concluded
--                 \                       /
--                  \--> cancelled <------/
--
-- Transitions are enforced by the service layer; the column is plain
-- text + CHECK so adding a future state ("expired", "renegotiated")
-- doesn't need an ALTER TYPE on a hot table.

CREATE TABLE IF NOT EXISTS tier_offers (
  id                            uuid PRIMARY KEY,
  tenant_id                     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  tier_id                       uuid NOT NULL REFERENCES dynamic_pricing_tiers(id) ON DELETE RESTRICT,
  composed_by                   uuid REFERENCES users(id) ON DELETE SET NULL,
  title                         text NOT NULL,
  subject_line                  text NOT NULL,
  narrative                     text NOT NULL,
  event_window_start            timestamptz NOT NULL,
  event_window_end              timestamptz NOT NULL,
  committed_truck_count         integer NOT NULL,
  acceptance_deadline_at        timestamptz NOT NULL,
  default_for_non_responders    text NOT NULL DEFAULT 'opt_out',
  status                        text NOT NULL DEFAULT 'draft',
  sent_at                       timestamptz,
  cancelled_at                  timestamptz,
  cancelled_reason              text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  deleted_at                    timestamptz
);

ALTER TABLE tier_offers
  DROP CONSTRAINT IF EXISTS tier_offers_title_nonempty;
ALTER TABLE tier_offers
  ADD CONSTRAINT tier_offers_title_nonempty
  CHECK (length(trim(title)) > 0);

ALTER TABLE tier_offers
  DROP CONSTRAINT IF EXISTS tier_offers_subject_line_nonempty;
ALTER TABLE tier_offers
  ADD CONSTRAINT tier_offers_subject_line_nonempty
  CHECK (length(trim(subject_line)) > 0);

ALTER TABLE tier_offers
  DROP CONSTRAINT IF EXISTS tier_offers_narrative_nonempty;
ALTER TABLE tier_offers
  ADD CONSTRAINT tier_offers_narrative_nonempty
  CHECK (length(trim(narrative)) > 0);

ALTER TABLE tier_offers
  DROP CONSTRAINT IF EXISTS tier_offers_committed_truck_count_positive;
ALTER TABLE tier_offers
  ADD CONSTRAINT tier_offers_committed_truck_count_positive
  CHECK (committed_truck_count > 0);

ALTER TABLE tier_offers
  DROP CONSTRAINT IF EXISTS tier_offers_event_window_order;
ALTER TABLE tier_offers
  ADD CONSTRAINT tier_offers_event_window_order
  CHECK (event_window_end > event_window_start);

ALTER TABLE tier_offers
  DROP CONSTRAINT IF EXISTS tier_offers_acceptance_before_event;
ALTER TABLE tier_offers
  ADD CONSTRAINT tier_offers_acceptance_before_event
  CHECK (acceptance_deadline_at <= event_window_start);

ALTER TABLE tier_offers
  DROP CONSTRAINT IF EXISTS tier_offers_default_for_non_responders_chk;
ALTER TABLE tier_offers
  ADD CONSTRAINT tier_offers_default_for_non_responders_chk
  CHECK (default_for_non_responders IN ('opt_out', 'accept_at_standard_rate'));

ALTER TABLE tier_offers
  DROP CONSTRAINT IF EXISTS tier_offers_status_chk;
ALTER TABLE tier_offers
  ADD CONSTRAINT tier_offers_status_chk
  CHECK (status IN ('draft', 'sent', 'event_active', 'event_concluded', 'cancelled'));

CREATE INDEX IF NOT EXISTS tier_offers_tenant_status_idx
  ON tier_offers (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tier_offers_tenant_event_window_idx
  ON tier_offers (tenant_id, event_window_start)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tier_offers_tenant_tier_idx
  ON tier_offers (tenant_id, tier_id)
  WHERE deleted_at IS NULL;

ALTER TABLE tier_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tier_offers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tier_offers_tenant_isolation ON tier_offers;
CREATE POLICY tier_offers_tenant_isolation ON tier_offers
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_tier_offers ON tier_offers;
CREATE TRIGGER trg_audit_tier_offers
  AFTER INSERT OR UPDATE OR DELETE ON tier_offers
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE OR REPLACE FUNCTION fn_tier_offers_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_tier_offers_set_updated_at ON tier_offers;
CREATE TRIGGER trg_tier_offers_set_updated_at
  BEFORE UPDATE ON tier_offers
  FOR EACH ROW EXECUTE FUNCTION fn_tier_offers_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. tier_offer_recipients
-- ---------------------------------------------------------------------
-- The acceptance ledger. One row per recipient per offer — uniqueness
-- on (offer_id, recipient_email) prevents accidental double-sends and
-- doubles as the idempotency key for the send pipeline.
--
-- magic_link_token is the per-recipient signed token embedded in the
-- accept/decline URL. Session 1 stores the string only — token format
-- (HMAC-signed JWT planned) and signature verification land in
-- Session 2 alongside the SendGrid webhook handler.
--
-- magic_link_expires_at is intentionally LATER than the offer's
-- acceptance_deadline_at: a recipient who clicks late still resolves to
-- a "this offer is no longer accepting responses" page instead of a
-- 404. The cron sweep that flips status -> 'expired' uses the partial
-- index `tor_tenant_expiry_active_idx` below.
--
-- account_id is nullable because some offers go to ad-hoc email
-- addresses not yet in the operator's rolodex. The recipient_name /
-- recipient_email are the source of truth for delivery; account_id is
-- a downstream-reporting convenience.

CREATE TABLE IF NOT EXISTS tier_offer_recipients (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  offer_id                uuid NOT NULL REFERENCES tier_offers(id) ON DELETE CASCADE,
  account_id              uuid REFERENCES accounts(id) ON DELETE SET NULL,
  recipient_name          text NOT NULL,
  recipient_role          text,
  recipient_email         text NOT NULL,
  recipient_phone         text,
  magic_link_token        text NOT NULL,
  magic_link_expires_at   timestamptz NOT NULL,
  status                  text NOT NULL DEFAULT 'pending_send',
  email_sent_at           timestamptz,
  email_delivered_at      timestamptz,
  email_opened_at         timestamptz,
  responded_at            timestamptz,
  response_ip             text,
  response_user_agent     text,
  decline_reason          text,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);

ALTER TABLE tier_offer_recipients
  DROP CONSTRAINT IF EXISTS tier_offer_recipients_recipient_name_nonempty;
ALTER TABLE tier_offer_recipients
  ADD CONSTRAINT tier_offer_recipients_recipient_name_nonempty
  CHECK (length(trim(recipient_name)) > 0);

ALTER TABLE tier_offer_recipients
  DROP CONSTRAINT IF EXISTS tier_offer_recipients_recipient_email_nonempty;
ALTER TABLE tier_offer_recipients
  ADD CONSTRAINT tier_offer_recipients_recipient_email_nonempty
  CHECK (length(trim(recipient_email)) > 0);

ALTER TABLE tier_offer_recipients
  DROP CONSTRAINT IF EXISTS tier_offer_recipients_magic_link_token_nonempty;
ALTER TABLE tier_offer_recipients
  ADD CONSTRAINT tier_offer_recipients_magic_link_token_nonempty
  CHECK (length(trim(magic_link_token)) > 0);

ALTER TABLE tier_offer_recipients
  DROP CONSTRAINT IF EXISTS tier_offer_recipients_status_chk;
ALTER TABLE tier_offer_recipients
  ADD CONSTRAINT tier_offer_recipients_status_chk
  CHECK (status IN (
    'pending_send',
    'sent',
    'delivered',
    'bounced',
    'opened',
    'accepted',
    'declined',
    'expired',
    'revoked'
  ));

-- Token uniqueness must be global (across tenants): the public landing
-- page resolves a recipient by token alone, before any tenant context
-- is established. A non-unique token across tenants would leak rows.
DROP INDEX IF EXISTS tier_offer_recipients_magic_link_token_unique;
CREATE UNIQUE INDEX tier_offer_recipients_magic_link_token_unique
  ON tier_offer_recipients (magic_link_token);

-- No double-sends to the same email on the same offer.
DROP INDEX IF EXISTS tier_offer_recipients_offer_email_unique;
CREATE UNIQUE INDEX tier_offer_recipients_offer_email_unique
  ON tier_offer_recipients (offer_id, recipient_email)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tier_offer_recipients_tenant_status_idx
  ON tier_offer_recipients (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tier_offer_recipients_offer_status_idx
  ON tier_offer_recipients (offer_id, status)
  WHERE deleted_at IS NULL;

-- Cron-sweep target: rows still in flight that we may need to auto-
-- expire after their magic-link TTL elapses.
CREATE INDEX IF NOT EXISTS tier_offer_recipients_tenant_expiry_active_idx
  ON tier_offer_recipients (tenant_id, magic_link_expires_at)
  WHERE status IN ('sent', 'delivered', 'opened') AND deleted_at IS NULL;

ALTER TABLE tier_offer_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE tier_offer_recipients FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tier_offer_recipients_tenant_isolation ON tier_offer_recipients;
CREATE POLICY tier_offer_recipients_tenant_isolation ON tier_offer_recipients
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- Cross-tenant consistency: offer_id's tenant AND account_id's tenant
-- (if non-null) must match this row's tenant. RLS hides foreign rows
-- from the trigger's SELECTs, so a foreign-id injection fails on
-- "does not exist" or "does not match" — both reject the write.
CREATE OR REPLACE FUNCTION fn_tier_offer_recipients_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_offer_tenant   uuid;
  v_account_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_offer_tenant FROM tier_offers WHERE id = NEW.offer_id;

  IF v_offer_tenant IS NULL THEN
    RAISE EXCEPTION 'tier_offer_recipients: offer_id % does not exist', NEW.offer_id;
  END IF;

  IF v_offer_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'tier_offer_recipients: tenant_id (%) does not match tier_offers.tenant_id (%)',
      NEW.tenant_id, v_offer_tenant;
  END IF;

  IF NEW.account_id IS NOT NULL THEN
    SELECT tenant_id INTO v_account_tenant FROM accounts WHERE id = NEW.account_id;

    IF v_account_tenant IS NULL THEN
      RAISE EXCEPTION 'tier_offer_recipients: account_id % does not exist', NEW.account_id;
    END IF;

    IF v_account_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'tier_offer_recipients: tenant_id (%) does not match accounts.tenant_id (%)',
        NEW.tenant_id, v_account_tenant;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_tor_tenant_consistency ON tier_offer_recipients;
CREATE TRIGGER trg_tor_tenant_consistency
  BEFORE INSERT OR UPDATE ON tier_offer_recipients
  FOR EACH ROW EXECUTE FUNCTION fn_tier_offer_recipients_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_tier_offer_recipients ON tier_offer_recipients;
CREATE TRIGGER trg_audit_tier_offer_recipients
  AFTER INSERT OR UPDATE OR DELETE ON tier_offer_recipients
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE OR REPLACE FUNCTION fn_tier_offer_recipients_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_tor_set_updated_at ON tier_offer_recipients;
CREATE TRIGGER trg_tor_set_updated_at
  BEFORE UPDATE ON tier_offer_recipients
  FOR EACH ROW EXECUTE FUNCTION fn_tier_offer_recipients_set_updated_at();
