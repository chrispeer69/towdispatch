-- =====================================================================
-- 0029_ar_management_and_red_alert.sql  (Admin Settings — build 5 of 7)
--
-- The Accounts Receivable management surface. Three deliverables:
--
--   1. accounts.delinquency_days_threshold (nullable integer)
--      Per-account "how many days past posted_date until 'past due'".
--      NULL = use tenant-wide default. Motor clubs vary wildly:
--      Agero ≈ 7, AAA ≈ 15, Allstate ≈ 14, Honk ≈ 10, fleet net-30, etc.
--
--   2. users.receives_red_alert (boolean) — opt-in flag for the Monday
--      6:00 AM past-due email. Owners are auto-opted-in at creation
--      (handled app-side); admins receive by virtue of role. Other
--      roles must explicitly opt in.
--
--   3. statement_sends + red_alert_sends — audit trail for every
--      statement email sent + every Monday RED ALERT delivery.
--      Both tables follow the Build 2/6 pattern: tenant_id denormalized
--      for RLS, FORCE RLS, audit trigger, BTREE indexes on tenant_id +
--      sent_at DESC for "recent sends" queries.
--
-- Tenant-wide defaults (default_delinquency_days, cash_customer_*,
-- invoice number prefix, invoice footer text, default invoice terms)
-- ride on tenants.settings jsonb — no DDL needed for those, they're
-- read/written via the existing settings column.
--
-- Down (rollback):
--   DROP TRIGGER  IF EXISTS trg_audit_red_alert_sends ON red_alert_sends;
--   DROP TABLE    IF EXISTS red_alert_sends;
--   DROP TRIGGER  IF EXISTS trg_audit_statement_sends ON statement_sends;
--   DROP TABLE    IF EXISTS statement_sends;
--   ALTER TABLE users    DROP COLUMN IF EXISTS receives_red_alert;
--   ALTER TABLE accounts DROP COLUMN IF EXISTS delinquency_days_threshold;
-- =====================================================================

-- ---------- 1) accounts.delinquency_days_threshold ----------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS delinquency_days_threshold integer;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_delinquency_days_threshold_chk;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_delinquency_days_threshold_chk
  CHECK (delinquency_days_threshold IS NULL OR delinquency_days_threshold > 0);

-- ---------- 2) users.receives_red_alert ----------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS receives_red_alert boolean NOT NULL DEFAULT false;

-- Auto-opt-in the existing owners so the very first Monday after deploy
-- sends to them without a manual settings round-trip.
UPDATE users SET receives_red_alert = true WHERE role = 'owner';

-- ---------- 3) statement_sends ----------
CREATE TABLE IF NOT EXISTS statement_sends (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  sent_to         text NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  sent_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  pdf_url         text,
  date_from       timestamptz,
  date_to         timestamptz,
  invoice_count   integer NOT NULL DEFAULT 0,
  total_cents     bigint NOT NULL DEFAULT 0,
  subject         text,
  body_preview    text,
  status          text NOT NULL DEFAULT 'sent',
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE statement_sends
  DROP CONSTRAINT IF EXISTS statement_sends_status_chk;
ALTER TABLE statement_sends
  ADD CONSTRAINT statement_sends_status_chk
  CHECK (status IN ('queued', 'sent', 'failed'));

CREATE INDEX IF NOT EXISTS statement_sends_tenant_sent_at_idx
  ON statement_sends (tenant_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS statement_sends_tenant_account_idx
  ON statement_sends (tenant_id, account_id, sent_at DESC);

ALTER TABLE statement_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_sends FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS statement_sends_tenant_isolation ON statement_sends;
CREATE POLICY statement_sends_tenant_isolation ON statement_sends
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_statement_sends ON statement_sends;
CREATE TRIGGER trg_audit_statement_sends
  AFTER INSERT OR UPDATE OR DELETE ON statement_sends
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- 4) red_alert_sends ----------
CREATE TABLE IF NOT EXISTS red_alert_sends (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  sent_at               timestamptz NOT NULL DEFAULT now(),
  -- The Monday calendar date in the tenant's local timezone, used by the
  -- uniqueness guard so the hourly cron can't double-send if it ticks
  -- twice or the server restarts mid-Monday.
  alert_for_date        date NOT NULL,
  sent_to               text[] NOT NULL DEFAULT '{}',
  invoice_count         integer NOT NULL DEFAULT 0,
  account_count         integer NOT NULL DEFAULT 0,
  total_past_due_cents  bigint NOT NULL DEFAULT 0,
  breakdown_json        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                text NOT NULL DEFAULT 'queued',
  error_message         text,
  retry_count           integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE red_alert_sends
  DROP CONSTRAINT IF EXISTS red_alert_sends_status_chk;
ALTER TABLE red_alert_sends
  ADD CONSTRAINT red_alert_sends_status_chk
  CHECK (status IN ('queued', 'sent', 'failed'));

-- Uniqueness guard: at most one successful send per tenant per Monday.
-- Partial unique index — failed/queued rows can coexist while the
-- retry loop is still chewing on a particular Monday.
DROP INDEX IF EXISTS red_alert_sends_tenant_monday_unique;
CREATE UNIQUE INDEX red_alert_sends_tenant_monday_unique
  ON red_alert_sends (tenant_id, alert_for_date)
  WHERE status = 'sent';

CREATE INDEX IF NOT EXISTS red_alert_sends_tenant_sent_at_idx
  ON red_alert_sends (tenant_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS red_alert_sends_tenant_status_idx
  ON red_alert_sends (tenant_id, status);

ALTER TABLE red_alert_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE red_alert_sends FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS red_alert_sends_tenant_isolation ON red_alert_sends;
CREATE POLICY red_alert_sends_tenant_isolation ON red_alert_sends
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_red_alert_sends ON red_alert_sends;
CREATE TRIGGER trg_audit_red_alert_sends
  AFTER INSERT OR UPDATE OR DELETE ON red_alert_sends
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
