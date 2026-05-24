-- =====================================================================
-- 0045_ai_dispatch.sql  (AI Smart Dispatch + Predictive ETAs — Session 41)
--
-- Advisory candidate scoring + predictive ETA, layered over the dispatch
-- (jobs) module WITHOUT touching dispatch core. The engine recommends a
-- ranked truck/driver shortlist and a projected ETA; it NEVER auto-assigns.
-- A feedback loop records what the dispatcher actually chose + the realised
-- ETA so a future ML model can be trained — v1 only collects.
--
-- Tables added:
--   1. dispatch_recommendations — one row per recompute; the top-N candidates
--                                 as a jsonb array (RecommendationItem[]).
--   2. dispatch_outcomes        — feedback: chosen truck/driver, whether it was
--                                 the #1 rec, predicted vs realised ETA + error.
--   3. eta_predictions          — every predictive-ETA computation + its inputs.
--
-- Patterns followed (match 0042_ev_recovery.sql exactly):
--   * Every tenant table: tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE RESTRICT; ENABLE + FORCE ROW LEVEL SECURITY; policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on every tenant table.
--   * Soft delete (deleted_at) on every tenant table.
--   * Idempotent: CREATE ... IF NOT EXISTS, DROP ... IF EXISTS before every
--     constraint / policy / trigger / index. The migrate runner re-applies
--     every SQL file on each run (no tracking table).
--   * Cross-tenant consistency BEFORE-trigger: each job-linked table verifies
--     the referenced job's tenant matches the row's tenant. RLS hides foreign
--     jobs from the trigger's SELECT, so a foreign job_id surfaces as "does
--     not exist". (Matches the ev-recovery precedent — only the job link is
--     checked; truck/driver ids are always read within tenant context by the
--     service before insert.)
--   * Shared BEFORE UPDATE updated_at trigger function across all tables.
--
-- Migration number: 0045. Master tops out at 0042_ev_recovery.sql; 0043/0044
-- are claimed by parallel feature sessions. 0045 depends only on pre-existing
-- tables (jobs, tenants, trucks, drivers), so lexicographic ordering with the
-- gap is safe. scripts/check-migrations.sh is not touched.
--
-- Down (rollback):
--   DROP TABLE IF EXISTS eta_predictions;
--   DROP TABLE IF EXISTS dispatch_outcomes;
--   DROP TABLE IF EXISTS dispatch_recommendations;
--   DROP FUNCTION IF EXISTS fn_ai_dispatch_job_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_ai_dispatch_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper, reused by all ai-dispatch tables.
CREATE OR REPLACE FUNCTION fn_ai_dispatch_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Tenant-consistency guard for the job-linked tables: the referenced job's
-- tenant_id must match the row's tenant_id. RLS hides foreign jobs, so a
-- cross-tenant job_id surfaces as "does not exist".
CREATE OR REPLACE FUNCTION fn_ai_dispatch_job_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_job_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_job_tenant
  FROM jobs WHERE id = NEW.job_id;

  IF v_job_tenant IS NULL THEN
    RAISE EXCEPTION 'ai_dispatch: job_id % does not exist', NEW.job_id;
  END IF;

  IF v_job_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'ai_dispatch: tenant_id (%) does not match jobs.tenant_id (%)',
      NEW.tenant_id, v_job_tenant;
  END IF;

  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. dispatch_recommendations
-- ---------------------------------------------------------------------
-- One row per recompute. recommendations holds the ranked top-N candidates as
-- a jsonb array of RecommendationItem (truck/driver/score/factors/eta). Read
-- constantly by the job-detail panel and by recordOutcome (to resolve the #1).

CREATE TABLE IF NOT EXISTS dispatch_recommendations (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id          uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  model_version   text NOT NULL,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS dispatch_recommendations_tenant_job_computed_idx
  ON dispatch_recommendations (tenant_id, job_id, computed_at)
  WHERE deleted_at IS NULL;

ALTER TABLE dispatch_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_recommendations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dispatch_recommendations_tenant_isolation ON dispatch_recommendations;
CREATE POLICY dispatch_recommendations_tenant_isolation ON dispatch_recommendations
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_dispatch_recommendations_tenant_consistency ON dispatch_recommendations;
CREATE TRIGGER trg_dispatch_recommendations_tenant_consistency
  BEFORE INSERT OR UPDATE ON dispatch_recommendations
  FOR EACH ROW EXECUTE FUNCTION fn_ai_dispatch_job_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_dispatch_recommendations ON dispatch_recommendations;
CREATE TRIGGER trg_audit_dispatch_recommendations
  AFTER INSERT OR UPDATE OR DELETE ON dispatch_recommendations
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_dispatch_recommendations_set_updated_at ON dispatch_recommendations;
CREATE TRIGGER trg_dispatch_recommendations_set_updated_at
  BEFORE UPDATE ON dispatch_recommendations
  FOR EACH ROW EXECUTE FUNCTION fn_ai_dispatch_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. dispatch_outcomes
-- ---------------------------------------------------------------------
-- The feedback loop. recommendation_id is nullable (assignment may precede any
-- recommendation). chosen_truck_id / chosen_driver_id RESTRICT — we never hard
-- delete trucks/drivers, so the historical record stays intact.

CREATE TABLE IF NOT EXISTS dispatch_outcomes (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id                 uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  recommendation_id      uuid REFERENCES dispatch_recommendations(id) ON DELETE SET NULL,
  chosen_truck_id        uuid NOT NULL REFERENCES trucks(id) ON DELETE RESTRICT,
  chosen_driver_id       uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  was_top_recommendation boolean NOT NULL DEFAULT false,
  predicted_eta_minutes  integer,
  actual_eta_minutes     integer,
  eta_error_minutes      integer,
  completed_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);

ALTER TABLE dispatch_outcomes DROP CONSTRAINT IF EXISTS dispatch_outcomes_predicted_nonneg;
ALTER TABLE dispatch_outcomes ADD CONSTRAINT dispatch_outcomes_predicted_nonneg
  CHECK (predicted_eta_minutes IS NULL OR predicted_eta_minutes >= 0);

ALTER TABLE dispatch_outcomes DROP CONSTRAINT IF EXISTS dispatch_outcomes_actual_nonneg;
ALTER TABLE dispatch_outcomes ADD CONSTRAINT dispatch_outcomes_actual_nonneg
  CHECK (actual_eta_minutes IS NULL OR actual_eta_minutes >= 0);

-- One live outcome row per job (a job is assigned once for ETA-accuracy
-- purposes; reassignment updates the same row).
DROP INDEX IF EXISTS dispatch_outcomes_job_unique;
CREATE UNIQUE INDEX dispatch_outcomes_job_unique
  ON dispatch_outcomes (job_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS dispatch_outcomes_tenant_driver_idx
  ON dispatch_outcomes (tenant_id, chosen_driver_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS dispatch_outcomes_tenant_created_idx
  ON dispatch_outcomes (tenant_id, created_at)
  WHERE deleted_at IS NULL;

ALTER TABLE dispatch_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_outcomes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dispatch_outcomes_tenant_isolation ON dispatch_outcomes;
CREATE POLICY dispatch_outcomes_tenant_isolation ON dispatch_outcomes
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_dispatch_outcomes_tenant_consistency ON dispatch_outcomes;
CREATE TRIGGER trg_dispatch_outcomes_tenant_consistency
  BEFORE INSERT OR UPDATE ON dispatch_outcomes
  FOR EACH ROW EXECUTE FUNCTION fn_ai_dispatch_job_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_dispatch_outcomes ON dispatch_outcomes;
CREATE TRIGGER trg_audit_dispatch_outcomes
  AFTER INSERT OR UPDATE OR DELETE ON dispatch_outcomes
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_dispatch_outcomes_set_updated_at ON dispatch_outcomes;
CREATE TRIGGER trg_dispatch_outcomes_set_updated_at
  BEFORE UPDATE ON dispatch_outcomes
  FOR EACH ROW EXECUTE FUNCTION fn_ai_dispatch_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. eta_predictions
-- ---------------------------------------------------------------------
-- Append-style log of every predictive-ETA computation + its inputs, kept to
-- compare against the realised ETA and to retrain a future model.

CREATE TABLE IF NOT EXISTS eta_predictions (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id            uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  predicted_at      timestamptz NOT NULL DEFAULT now(),
  origin_lat        numeric(9, 6),
  origin_lng        numeric(9, 6),
  dest_lat          numeric(9, 6),
  dest_lng          numeric(9, 6),
  time_of_day       integer NOT NULL,
  day_of_week       integer NOT NULL,
  predicted_minutes integer NOT NULL,
  model_version     text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

ALTER TABLE eta_predictions DROP CONSTRAINT IF EXISTS eta_predictions_time_of_day_chk;
ALTER TABLE eta_predictions ADD CONSTRAINT eta_predictions_time_of_day_chk
  CHECK (time_of_day >= 0 AND time_of_day <= 23);

ALTER TABLE eta_predictions DROP CONSTRAINT IF EXISTS eta_predictions_day_of_week_chk;
ALTER TABLE eta_predictions ADD CONSTRAINT eta_predictions_day_of_week_chk
  CHECK (day_of_week >= 0 AND day_of_week <= 6);

ALTER TABLE eta_predictions DROP CONSTRAINT IF EXISTS eta_predictions_minutes_nonneg;
ALTER TABLE eta_predictions ADD CONSTRAINT eta_predictions_minutes_nonneg
  CHECK (predicted_minutes >= 0);

CREATE INDEX IF NOT EXISTS eta_predictions_tenant_job_idx
  ON eta_predictions (tenant_id, job_id, predicted_at)
  WHERE deleted_at IS NULL;

ALTER TABLE eta_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE eta_predictions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eta_predictions_tenant_isolation ON eta_predictions;
CREATE POLICY eta_predictions_tenant_isolation ON eta_predictions
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_eta_predictions_tenant_consistency ON eta_predictions;
CREATE TRIGGER trg_eta_predictions_tenant_consistency
  BEFORE INSERT OR UPDATE ON eta_predictions
  FOR EACH ROW EXECUTE FUNCTION fn_ai_dispatch_job_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_eta_predictions ON eta_predictions;
CREATE TRIGGER trg_audit_eta_predictions
  AFTER INSERT OR UPDATE OR DELETE ON eta_predictions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_eta_predictions_set_updated_at ON eta_predictions;
CREATE TRIGGER trg_eta_predictions_set_updated_at
  BEFORE UPDATE ON eta_predictions
  FOR EACH ROW EXECUTE FUNCTION fn_ai_dispatch_set_updated_at();
