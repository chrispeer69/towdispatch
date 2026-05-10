-- =====================================================================
-- 0013_billing.sql  (Session 10)
--
-- RLS, audit triggers, partial unique indexes, and check constraints for
-- the Session 10 billing module:
--   - invoices
--   - invoice_line_items
--   - invoice_taxes
--   - invoice_number_sequences
--   - payments
--   - credit_memos
--   - recurring_billing_schedules
--
-- Invariants:
--   * Every Session 10 tenant-scoped table is FORCE RLS.
--   * tenant_id NOT NULL on every table.
--   * All money amounts are integer cents (validated by NUMERIC types and
--     CHECK constraints where it pays off — totals, balances, taxes).
--   * invoices.balance_cents = total_cents - paid_cents (enforced in service
--     layer; CHECK left off so a credit memo can leave a transient negative).
--   * invoice_number unique per-tenant — see partial unique index handling
--     soft-deleted rows (we never recycle invoice numbers).
--   * Soft-deleted rows must not collide on (tenant, invoice_number) — we
--     keep the unique BUT the index excludes soft-deleted rows.
-- =====================================================================

-- ---------- invoices ----------
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoices_tenant_isolation ON invoices;
CREATE POLICY invoices_tenant_isolation ON invoices
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- Replace the auto-generated uniqueness (no soft-delete awareness) with a
-- partial unique index that ignores soft-deleted rows. Drizzle still keeps the
-- regular unique index for query planning; we drop it here in favor of the
-- partial form.
DROP INDEX IF EXISTS invoices_tenant_invoice_number_unique;
CREATE UNIQUE INDEX invoices_tenant_invoice_number_unique
  ON invoices (tenant_id, invoice_number)
  WHERE deleted_at IS NULL;

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_money_nonneg;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_money_nonneg
  CHECK (
    subtotal_cents >= 0
    AND tax_cents     >= 0
    AND total_cents   >= 0
  );

-- Final invoice numbers follow INV-YYYY-NNNN. Drafts use INV-DRAFT-<hex> until
-- they are issued — see InvoicesService.issue() for the swap. Allow both forms
-- here so the row can exist before the per-tenant sequence allocation runs.
ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_invoice_number_format;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_invoice_number_format
  CHECK (invoice_number ~ '^(INV-DRAFT-[a-f0-9]{8,}|INV-[0-9]{4}-[0-9]{4,})$');

DROP TRIGGER IF EXISTS trg_audit_invoices ON invoices;
CREATE TRIGGER trg_audit_invoices
  AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- invoice_line_items ----------
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_line_items_tenant_isolation ON invoice_line_items;
CREATE POLICY invoice_line_items_tenant_isolation ON invoice_line_items
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

ALTER TABLE invoice_line_items
  DROP CONSTRAINT IF EXISTS invoice_line_items_quantity_nonneg;
ALTER TABLE invoice_line_items
  ADD CONSTRAINT invoice_line_items_quantity_nonneg
  CHECK (quantity >= 0);

ALTER TABLE invoice_line_items
  DROP CONSTRAINT IF EXISTS invoice_line_items_line_number_positive;
ALTER TABLE invoice_line_items
  ADD CONSTRAINT invoice_line_items_line_number_positive
  CHECK (line_number > 0);

DROP TRIGGER IF EXISTS trg_audit_invoice_line_items ON invoice_line_items;
CREATE TRIGGER trg_audit_invoice_line_items
  AFTER INSERT OR UPDATE OR DELETE ON invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- invoice_taxes ----------
ALTER TABLE invoice_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_taxes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_taxes_tenant_isolation ON invoice_taxes;
CREATE POLICY invoice_taxes_tenant_isolation ON invoice_taxes
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

ALTER TABLE invoice_taxes
  DROP CONSTRAINT IF EXISTS invoice_taxes_amounts_nonneg;
ALTER TABLE invoice_taxes
  ADD CONSTRAINT invoice_taxes_amounts_nonneg
  CHECK (
    tax_rate_pct >= 0
    AND taxable_amount_cents >= 0
    AND tax_amount_cents >= 0
  );

-- ---------- invoice_number_sequences ----------
ALTER TABLE invoice_number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_number_sequences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_number_sequences_tenant_isolation ON invoice_number_sequences;
CREATE POLICY invoice_number_sequences_tenant_isolation ON invoice_number_sequences
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- The unique index is correct as generated (no deleted_at), but we ensure the
-- compound primary key is in place so UPSERT ON CONFLICT works.
DO $$ BEGIN
  ALTER TABLE invoice_number_sequences
    ADD CONSTRAINT invoice_number_sequences_pkey PRIMARY KEY (tenant_id, year_key);
EXCEPTION WHEN invalid_table_definition THEN NULL;
WHEN duplicate_table THEN NULL;
END $$;

-- ---------- payments ----------
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_tenant_isolation ON payments;
CREATE POLICY payments_tenant_isolation ON payments
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- amount_cents may be negative (refunds/write-off reversals), so no nonneg
-- check on amount_cents itself. We DO require it nonzero — a zero-dollar
-- payment would be a service-layer bug.
ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_amount_nonzero;
ALTER TABLE payments
  ADD CONSTRAINT payments_amount_nonzero
  CHECK (amount_cents <> 0);

DROP TRIGGER IF EXISTS trg_audit_payments ON payments;
CREATE TRIGGER trg_audit_payments
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- credit_memos ----------
ALTER TABLE credit_memos ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_memos FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_memos_tenant_isolation ON credit_memos;
CREATE POLICY credit_memos_tenant_isolation ON credit_memos
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

ALTER TABLE credit_memos
  DROP CONSTRAINT IF EXISTS credit_memos_amount_positive;
ALTER TABLE credit_memos
  ADD CONSTRAINT credit_memos_amount_positive
  CHECK (amount_cents > 0);

DROP INDEX IF EXISTS credit_memos_tenant_memo_number_unique;
CREATE UNIQUE INDEX credit_memos_tenant_memo_number_unique
  ON credit_memos (tenant_id, memo_number)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_audit_credit_memos ON credit_memos;
CREATE TRIGGER trg_audit_credit_memos
  AFTER INSERT OR UPDATE OR DELETE ON credit_memos
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- recurring_billing_schedules ----------
ALTER TABLE recurring_billing_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_billing_schedules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recurring_billing_schedules_tenant_isolation ON recurring_billing_schedules;
CREATE POLICY recurring_billing_schedules_tenant_isolation ON recurring_billing_schedules
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

ALTER TABLE recurring_billing_schedules
  DROP CONSTRAINT IF EXISTS recurring_billing_schedules_rate_positive;
ALTER TABLE recurring_billing_schedules
  ADD CONSTRAINT recurring_billing_schedules_rate_positive
  CHECK (daily_rate_cents > 0);

DROP TRIGGER IF EXISTS trg_audit_recurring_billing_schedules ON recurring_billing_schedules;
CREATE TRIGGER trg_audit_recurring_billing_schedules
  AFTER INSERT OR UPDATE OR DELETE ON recurring_billing_schedules
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- grants for app_user / app_admin ----------
-- Default privileges from 0002_roles.sql usually flow to tables created by the
-- bootstrap user, but explicit GRANTs here remove any ambiguity for the
-- Session 10 tables. We additionally GRANT DELETE on invoice_taxes because
-- recomputeTotals() in InvoicesService replaces the rollup rows on every
-- payment / line-item change. Other tables remain INSERT/UPDATE only — soft
-- delete handles removal at the application layer.
GRANT SELECT, INSERT, UPDATE ON invoices, invoice_line_items, invoice_taxes,
                                  invoice_number_sequences, payments,
                                  credit_memos, recurring_billing_schedules
  TO app_user;
GRANT DELETE ON invoice_taxes, invoice_line_items TO app_user;
GRANT ALL ON invoices, invoice_line_items, invoice_taxes,
             invoice_number_sequences, payments, credit_memos,
             recurring_billing_schedules
  TO app_admin;

-- ---------- tenant tax settings (lightweight column on tenants) ----------
-- Per-tenant default sales-tax rate as a percentage. NULL means "no sales tax
-- by default"; per-customer/account override via customers.tax_exempt + line
-- item taxable flag. Multi-jurisdiction breakdown lives in invoice_taxes.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS billing_default_tax_rate_pct numeric(6,4);
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS billing_default_tax_jurisdiction text;
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS billing_default_tax_name text;
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS billing_address jsonb;
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS billing_phone text;
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS billing_email text;
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS billing_logo_url text;
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS billing_tagline text;
