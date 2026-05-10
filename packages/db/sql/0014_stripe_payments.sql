-- =====================================================================
-- 0014_stripe_payments.sql  (Session 11)
--
-- Wires Stripe Connect into the existing Session 10 billing schema.
--
-- New columns (existing tables):
--   * tenants.stripe_account_id           — Stripe Connect Express account id
--   * tenants.stripe_account_status       — pending / active / restricted
--   * tenants.stripe_charges_enabled      — mirror of Stripe's flag
--   * tenants.stripe_payouts_enabled      — mirror of Stripe's flag
--   * tenants.platform_margin_bps         — basis points layered on top of
--                                           Stripe fees (default 30 = 0.3%)
--   * customers.stripe_customer_id        — saved-card-on-file holder
--   * customers.auto_charge_enabled       — opt-in to auto-charge invoices
--   * customers.default_payment_method_id — Stripe pm_xxx
--   * customers.card_last4 / card_brand / card_exp_month / card_exp_year
--                                          — display-only metadata (PCI SAQ A)
--   * payments.stripe_payment_intent_id   — links the row to its PI
--   * payments.stripe_charge_id           — the underlying charge
--   * payments.stripe_refund_id           — populated when this row is a refund
--   * payments.platform_margin_cents      — fee we kept (margin reporting)
--   * payments.stripe_fee_cents           — Stripe's processing fee
--   * invoices.payment_token              — opaque public token for /pay/[token]
--
-- New tables:
--   * stripe_events                       — webhook idempotency (tenant + id PK)
--
-- Invariants:
--   * stripe_account_id unique per Stripe — partial unique index ignores NULL
--   * payment_token unique per-tenant
--   * stripe_events.id is Stripe's event id, primary key, so a duplicate
--     delivery is a no-op INSERT … ON CONFLICT DO NOTHING.
-- =====================================================================

-- ---------- tenants additions ----------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_account_id text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_account_status text NOT NULL DEFAULT 'none';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_charges_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_payouts_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS platform_margin_bps integer NOT NULL DEFAULT 30;

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_stripe_account_status_chk;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_stripe_account_status_chk
  CHECK (stripe_account_status IN ('none', 'pending', 'active', 'restricted', 'rejected'));

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_platform_margin_bps_chk;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_platform_margin_bps_chk
  CHECK (platform_margin_bps >= 0 AND platform_margin_bps <= 1000);

DROP INDEX IF EXISTS tenants_stripe_account_id_unique;
CREATE UNIQUE INDEX tenants_stripe_account_id_unique
  ON tenants (stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

-- ---------- customers additions ----------
ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS auto_charge_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS default_payment_method_id text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_last4 text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_brand text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_exp_month integer;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_exp_year integer;

DROP INDEX IF EXISTS customers_tenant_stripe_customer_idx;
CREATE INDEX customers_tenant_stripe_customer_idx
  ON customers (tenant_id, stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ---------- payments additions ----------
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_charge_id text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_refund_id text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS platform_margin_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_fee_cents bigint NOT NULL DEFAULT 0;

-- One payment row per Stripe payment-intent: webhooks rely on this for
-- idempotent insertion. Partial unique so manual cash/check rows (which never
-- get a PI) do not collide.
DROP INDEX IF EXISTS payments_tenant_stripe_payment_intent_unique;
CREATE UNIQUE INDEX payments_tenant_stripe_payment_intent_unique
  ON payments (tenant_id, stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL AND deleted_at IS NULL;

DROP INDEX IF EXISTS payments_tenant_stripe_refund_unique;
CREATE UNIQUE INDEX payments_tenant_stripe_refund_unique
  ON payments (tenant_id, stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL AND deleted_at IS NULL;

-- ---------- invoices: public payment token ----------
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_token text;

DROP INDEX IF EXISTS invoices_tenant_payment_token_unique;
CREATE UNIQUE INDEX invoices_tenant_payment_token_unique
  ON invoices (tenant_id, payment_token)
  WHERE payment_token IS NOT NULL;

-- Lookup-by-token (public /pay/[token] route). The token alone is the unit of
-- authorization; we look up under app_admin to find the tenant_id, then
-- perform every other read/write under tenant scope so RLS still applies.
DROP INDEX IF EXISTS invoices_payment_token_unique;
CREATE UNIQUE INDEX invoices_payment_token_unique
  ON invoices (payment_token)
  WHERE payment_token IS NOT NULL;

-- ---------- stripe_events (webhook idempotency) ----------
CREATE TABLE IF NOT EXISTS stripe_events (
  id text PRIMARY KEY,
  tenant_id uuid REFERENCES tenants (id) ON DELETE SET NULL,
  type text NOT NULL,
  livemode boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text
);

CREATE INDEX IF NOT EXISTS stripe_events_type_idx ON stripe_events (type, received_at DESC);
CREATE INDEX IF NOT EXISTS stripe_events_tenant_idx ON stripe_events (tenant_id, received_at DESC);

-- stripe_events is platform-wide (the row may not yet have been associated to
-- a tenant when received). RLS is therefore disabled on this table — the
-- only writers are the webhook controller (admin pool) and the cron sweeper.
ALTER TABLE stripe_events DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON stripe_events TO app_admin;
-- app_user does not need access; webhook handlers use the admin pool because
-- the request arrives without tenant context.

-- ---------- audit triggers on the new columns ----------
-- The trg_audit_tenants / trg_audit_payments / trg_audit_customers /
-- trg_audit_invoices triggers from earlier migrations already capture full-row
-- mutations, so the new columns are picked up automatically.
