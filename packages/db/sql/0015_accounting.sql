-- =====================================================================
-- 0015_accounting.sql  (Session 12)
--
-- Wires the three new accounting-integration tables into the platform's
-- security model: RLS, FORCE RLS, audit triggers, and the partial uniqueness
-- guarantees the sync engine relies on for idempotency.
--
-- New tables (added in drizzle/0010_accounting.sql):
--   * accounting_connections  — one row per (tenant_id, provider)
--   * account_mappings        — one row per (tenant_id, provider, internal_category)
--   * sync_jobs               — many rows per entity; idempotency below
--
-- Invariants enforced here:
--   * accounting_connections.status ∈ ('pending','connected','disconnected','error')
--   * one ACTIVE connection per (tenant_id, provider): partial unique on
--     status='connected' or 'pending' rows.
--   * account_mappings: one row per (tenant_id, provider, internal_category)
--   * sync_jobs: at most one row per (tenant_id, provider, entity_type,
--     entity_id, direction) in a non-terminal state. Idempotent enqueue
--     relies on this UPSERT target.
-- =====================================================================

-- ---------- accounting_connections ----------
ALTER TABLE accounting_connections
  DROP CONSTRAINT IF EXISTS accounting_connections_status_chk;
ALTER TABLE accounting_connections
  ADD CONSTRAINT accounting_connections_status_chk
  CHECK (status IN ('pending', 'connected', 'disconnected', 'error'));

ALTER TABLE accounting_connections
  DROP CONSTRAINT IF EXISTS accounting_connections_provider_chk;
ALTER TABLE accounting_connections
  ADD CONSTRAINT accounting_connections_provider_chk
  CHECK (provider IN ('quickbooks-online', 'quickbooks-online-stub'));

DROP INDEX IF EXISTS accounting_connections_tenant_provider_active_unique;
CREATE UNIQUE INDEX accounting_connections_tenant_provider_active_unique
  ON accounting_connections (tenant_id, provider)
  WHERE status IN ('connected', 'pending');

CREATE INDEX IF NOT EXISTS accounting_connections_tenant_provider_idx
  ON accounting_connections (tenant_id, provider);

ALTER TABLE accounting_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_connections FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounting_connections_tenant_isolation ON accounting_connections;
CREATE POLICY accounting_connections_tenant_isolation ON accounting_connections
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_accounting_connections ON accounting_connections;
CREATE TRIGGER trg_audit_accounting_connections
  AFTER INSERT OR UPDATE OR DELETE ON accounting_connections
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

GRANT SELECT, INSERT, UPDATE ON accounting_connections TO app_user;

-- ---------- account_mappings ----------
DROP INDEX IF EXISTS account_mappings_tenant_provider_category_unique;
CREATE UNIQUE INDEX account_mappings_tenant_provider_category_unique
  ON account_mappings (tenant_id, provider, internal_category);

CREATE INDEX IF NOT EXISTS account_mappings_tenant_provider_idx
  ON account_mappings (tenant_id, provider);

ALTER TABLE account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_mappings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_mappings_tenant_isolation ON account_mappings;
CREATE POLICY account_mappings_tenant_isolation ON account_mappings
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_account_mappings ON account_mappings;
CREATE TRIGGER trg_audit_account_mappings
  AFTER INSERT OR UPDATE OR DELETE ON account_mappings
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

GRANT SELECT, INSERT, UPDATE ON account_mappings TO app_user;

-- ---------- sync_jobs ----------
ALTER TABLE sync_jobs
  DROP CONSTRAINT IF EXISTS sync_jobs_status_chk;
ALTER TABLE sync_jobs
  ADD CONSTRAINT sync_jobs_status_chk
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter'));

ALTER TABLE sync_jobs
  DROP CONSTRAINT IF EXISTS sync_jobs_direction_chk;
ALTER TABLE sync_jobs
  ADD CONSTRAINT sync_jobs_direction_chk
  CHECK (direction IN ('push', 'pull'));

ALTER TABLE sync_jobs
  DROP CONSTRAINT IF EXISTS sync_jobs_entity_type_chk;
ALTER TABLE sync_jobs
  ADD CONSTRAINT sync_jobs_entity_type_chk
  CHECK (entity_type IN ('customer', 'invoice', 'payment', 'refund'));

-- One in-flight job per (tenant, provider, entity_type, entity_id, direction).
-- Once it terminates (completed/failed/dead_letter) the row is no longer
-- "active" and a fresh job can be enqueued. This is the idempotency lock.
DROP INDEX IF EXISTS sync_jobs_active_entity_unique;
CREATE UNIQUE INDEX sync_jobs_active_entity_unique
  ON sync_jobs (tenant_id, provider, entity_type, entity_id, direction)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS sync_jobs_tenant_status_next_idx
  ON sync_jobs (tenant_id, status, next_attempt_at);

CREATE INDEX IF NOT EXISTS sync_jobs_status_next_idx
  ON sync_jobs (status, next_attempt_at);

CREATE INDEX IF NOT EXISTS sync_jobs_tenant_entity_idx
  ON sync_jobs (tenant_id, entity_type, entity_id);

ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_jobs_tenant_isolation ON sync_jobs;
CREATE POLICY sync_jobs_tenant_isolation ON sync_jobs
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_sync_jobs ON sync_jobs;
CREATE TRIGGER trg_audit_sync_jobs
  AFTER INSERT OR UPDATE OR DELETE ON sync_jobs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

GRANT SELECT, INSERT, UPDATE ON sync_jobs TO app_user;
