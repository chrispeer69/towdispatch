-- =====================================================================
-- 0048_ai_dispatch_retention.sql  (AI Smart Dispatch — retention indexes)
--
-- Pure index migration. NO schema changes. Adds the partial indexes the
-- retention sweep (RetentionService) scans, for the three high-volume
-- ai-dispatch tables shipped in 0045_ai_dispatch.sql:
--   dispatch_recommendations · dispatch_outcomes · eta_predictions
--
-- Retention is two-phase and age-based on created_at:
--   * SOFT phase — live rows (deleted_at IS NULL) older than the soft window
--                  get deleted_at stamped.   Scan: (tenant_id, created_at)
--                                             WHERE deleted_at IS NULL.
--   * HARD phase — already-soft-deleted rows (deleted_at IS NOT NULL) older
--                  than the hard window are purged. Scan: (tenant_id,
--                  created_at) WHERE deleted_at IS NOT NULL.
-- Every scan runs inside a tenant RLS context, so leading with tenant_id keeps
-- the partial index aligned with the row-level-security predicate.
--
-- Index inventory (idempotent — CREATE INDEX IF NOT EXISTS, matches the
-- migrate runner re-applying every file each boot):
--   dispatch_recommendations  → _retention_active_idx (NULL)  + _retention_purge_idx (NOT NULL)
--   eta_predictions           → _retention_active_idx (NULL)  + _retention_purge_idx (NOT NULL)
--   dispatch_outcomes         → _retention_purge_idx (NOT NULL) ONLY
--       (the SOFT-phase scan is already served by the pre-existing
--        dispatch_outcomes_tenant_created_idx — (tenant_id, created_at)
--        WHERE deleted_at IS NULL — from 0045; a duplicate is intentionally
--        omitted. The HARD-phase NOT-NULL partial is new.)
--
-- The task brief named only the `deleted_at IS NULL` indexes; the matching
-- `deleted_at IS NOT NULL` partials are added so the HARD purge scan is also
-- index-backed rather than seq-scanning each tenant daily (these are
-- explicitly high-volume tables). Rationale: AI_DISPATCH_RETENTION_DECISIONS.md.
--
-- Migration number: 0048. Master tops out at 0042_ev_recovery.sql on origin;
-- 0043–0047 are claimed by parallel feature sessions, 0045 is the ai-dispatch
-- tables this depends on. 0048 is the lowest free slot. Indexes only depend on
-- the 0045 tables already existing.
--
-- Down (rollback):
--   DROP INDEX IF EXISTS dispatch_recommendations_retention_active_idx;
--   DROP INDEX IF EXISTS dispatch_recommendations_retention_purge_idx;
--   DROP INDEX IF EXISTS eta_predictions_retention_active_idx;
--   DROP INDEX IF EXISTS eta_predictions_retention_purge_idx;
--   DROP INDEX IF EXISTS dispatch_outcomes_retention_purge_idx;
-- =====================================================================

-- ---------------------------------------------------------------------
-- dispatch_recommendations
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS dispatch_recommendations_retention_active_idx
  ON dispatch_recommendations (tenant_id, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS dispatch_recommendations_retention_purge_idx
  ON dispatch_recommendations (tenant_id, created_at)
  WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------
-- eta_predictions
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS eta_predictions_retention_active_idx
  ON eta_predictions (tenant_id, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS eta_predictions_retention_purge_idx
  ON eta_predictions (tenant_id, created_at)
  WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------
-- dispatch_outcomes  (SOFT-phase scan already covered by
-- dispatch_outcomes_tenant_created_idx from 0045 — add only the purge scan)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS dispatch_outcomes_retention_purge_idx
  ON dispatch_outcomes (tenant_id, created_at)
  WHERE deleted_at IS NOT NULL;
