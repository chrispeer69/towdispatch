-- =====================================================================
-- 0008_jobs_rate_sheets.sql
--
-- RLS, partial unique indexes, and audit triggers for Session 4 — call
-- intake. Adds: rate_sheets, tenant_default_rate_sheets, job_number_sequences,
-- jobs.
--
-- Invariants:
--   * Every new tenant-scoped table is FORCE RLS.
--   * Soft-deleted rate sheets must not collide on (tenant, name) — partial
--     unique index excludes deleted rows.
--   * Job numbers are unique per tenant (full unique index — they are stable
--     identifiers and we never recycle them, even after a soft delete).
--   * job_number_sequences is also tenant-scoped under RLS so the per-tenant
--     allocation row cannot be peeked at across tenants.
--   * The accounts.default_rate_sheet_id column has been around since
--     migration 0002 but had no FK target; wire it now that rate_sheets
--     exists. Same for customers.default_rate_sheet_id.
-- =====================================================================

-- ---------- rate_sheets ----------
ALTER TABLE rate_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_sheets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_sheets_tenant_isolation ON rate_sheets;
CREATE POLICY rate_sheets_tenant_isolation ON rate_sheets
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP INDEX IF EXISTS rate_sheets_tenant_name_unique;
CREATE UNIQUE INDEX rate_sheets_tenant_name_unique
  ON rate_sheets (tenant_id, name)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_audit_rate_sheets ON rate_sheets;
CREATE TRIGGER trg_audit_rate_sheets
  AFTER INSERT OR UPDATE OR DELETE ON rate_sheets
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- tenant_default_rate_sheets ----------
ALTER TABLE tenant_default_rate_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_default_rate_sheets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_default_rate_sheets_isolation ON tenant_default_rate_sheets;
CREATE POLICY tenant_default_rate_sheets_isolation ON tenant_default_rate_sheets
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- No audit trigger here — this is a tiny pointer table; changes are visible
-- via rate_sheets audit + tenant settings UI.

-- Now wire the historical orphan FK columns to rate_sheets.
DO $$ BEGIN
  ALTER TABLE accounts
    ADD CONSTRAINT accounts_default_rate_sheet_fk
    FOREIGN KEY (default_rate_sheet_id) REFERENCES rate_sheets(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE customers
    ADD CONSTRAINT customers_default_rate_sheet_fk
    FOREIGN KEY (default_rate_sheet_id) REFERENCES rate_sheets(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------- job_number_sequences ----------
ALTER TABLE job_number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_number_sequences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_number_sequences_isolation ON job_number_sequences;
CREATE POLICY job_number_sequences_isolation ON job_number_sequences
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- ---------- jobs ----------
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jobs_tenant_isolation ON jobs;
CREATE POLICY jobs_tenant_isolation ON jobs
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- Job number format: YYYYMMDD-NNNN. Validate at the DB layer too.
ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_job_number_format;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_job_number_format
  CHECK (job_number ~ '^[0-9]{8}-[0-9]{4,}$');

ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_rate_quoted_nonnegative;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_rate_quoted_nonnegative
  CHECK (rate_quoted_cents >= 0);

DROP TRIGGER IF EXISTS trg_audit_jobs ON jobs;
CREATE TRIGGER trg_audit_jobs
  AFTER INSERT OR UPDATE OR DELETE ON jobs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
