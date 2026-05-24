-- =====================================================================
-- 0037_compliance_audit_backfill.sql
-- SOC 2 (Session 31) — close audit-trigger coverage gaps.
--
-- Audit of packages/db/sql/ found 66 tenant tables already wired to
-- fn_audit_log() (0004 + per-module migrations). This migration attaches
-- the same generic trigger to four tenant tables that were missing it,
-- so that every business / financial / config record carries an
-- INSERT/UPDATE/DELETE trail in audit_log:
--
--   invoice_taxes               financial — tax lines on invoices
--   job_ratings                 business  — customer satisfaction ratings
--   tenant_default_rate_sheets  config    — default rate-sheet mapping
--   tracking_messages           comms     — customer-facing tracking messages
--                                           (mirrors tracking_links, already audited)
--
-- DELIBERATE EXCLUSIONS (the remaining six un-triggered tables). The same
-- rationale is mirrored in compliance/controls/audit-logging.md so the
-- auditor sees one answer in two places:
--
--   driver_telemetry_events   High-volume, append-only GPS stream. The row
--                             *is* the record; auditing doubles write volume
--                             with zero integrity benefit.
--   job_status_transitions    Purpose-built, append-only state-change log —
--                             already an audit trail. Auditing its inserts
--                             would duplicate the record.
--   invoice_number_sequences  Mechanical monotonic counters. The allocated
--   job_number_sequences      number is captured on the audited invoices /
--                             jobs row. (Also allow-listed in check-migrations.sh.)
--   sessions                  Auth surface. Refresh-token rotation churns this
--                             table on every request and auth already has
--                             dedicated security logging (login_attempts,
--                             token-reuse → Sentry). Excluded to honor the
--                             Session 31 "do not modify auth flows" boundary;
--                             revisit in S40.
--   stripe_events             Stripe / PCI surface (deferred to S40) and itself
--                             an append-only webhook idempotency ledger.
--
-- Note: tenant_default_rate_sheets has no `id` column (PK is tenant_id), so
-- fn_audit_log() records resource_id = NULL for it. audit_log.resource_id is
-- nullable, so this is expected — not a bug.
--
-- Idempotent: every trigger is dropped-if-exists before create, so re-running
-- is safe. Forward-only per docs/runbooks/database-restore.md §4.
-- =====================================================================

DROP TRIGGER IF EXISTS trg_audit_invoice_taxes ON invoice_taxes;
CREATE TRIGGER trg_audit_invoice_taxes
  AFTER INSERT OR UPDATE OR DELETE ON invoice_taxes
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_audit_job_ratings ON job_ratings;
CREATE TRIGGER trg_audit_job_ratings
  AFTER INSERT OR UPDATE OR DELETE ON job_ratings
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_audit_tenant_default_rate_sheets ON tenant_default_rate_sheets;
CREATE TRIGGER trg_audit_tenant_default_rate_sheets
  AFTER INSERT OR UPDATE OR DELETE ON tenant_default_rate_sheets
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_audit_tracking_messages ON tracking_messages;
CREATE TRIGGER trg_audit_tracking_messages
  AFTER INSERT OR UPDATE OR DELETE ON tracking_messages
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- Down (rollback):
--   DROP TRIGGER IF EXISTS trg_audit_invoice_taxes ON invoice_taxes;
--   DROP TRIGGER IF EXISTS trg_audit_job_ratings ON job_ratings;
--   DROP TRIGGER IF EXISTS trg_audit_tenant_default_rate_sheets ON tenant_default_rate_sheets;
--   DROP TRIGGER IF EXISTS trg_audit_tracking_messages ON tracking_messages;
