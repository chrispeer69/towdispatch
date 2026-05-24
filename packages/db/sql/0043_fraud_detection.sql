-- =====================================================================
-- 0043_fraud_detection.sql  (Fraud Detection on Motor Club Disputes — Session 43)
--
-- Defensive analytics layer that scores each job's fraud / dispute risk
-- BEFORE invoice submission and flags anomalies AFTER a dispute lands. It
-- reads existing job / invoice / evidence / payment data; it does NOT
-- integrate with any motor-club partner (those ingestion sessions —
-- S13/S18-21/S28/S30/S34 — are parked behind partner clocks). When that
-- data lands, the same detectors read it with no schema change.
--
-- IMPORTANT — this module is ADVISORY ONLY (v1). It never blocks invoice
-- submission and never auto-resolves a dispute. The nightly cron
-- (FRAUD_SCORE_CRON_ENABLED) only recomputes scores for jobs invoiced in
-- the last 24h. Every action (hold-invoice, escalate, mark-reviewed) is an
-- explicit operator decision. Signal weights + band thresholds are
-- best-effort heuristics (model_version 'fraud-v1.0') and are documented in
-- SESSION_43_DECISIONS.md; a future session swaps in a trained model.
--
-- Tables added:
--   1. fraud_risk_signals  — one row per detected anomaly on a job.
--   2. fraud_risk_scores   — composite 0-100 score per job (job_id PK).
--   3. dispute_records     — motor-club disputes logged against a job.
--   4. dispute_outcomes    — ground-truth feedback (was it fraud?) used to
--                            tune future model versions.
--
-- Patterns followed (match 0038_lien_processing.sql exactly):
--   * Every table tenant-scoped: tenant_id uuid NOT NULL REFERENCES
--     tenants(id) ON DELETE RESTRICT; ENABLE + FORCE ROW LEVEL SECURITY;
--     policy USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on every table.
--   * Idempotent: CREATE ... IF NOT EXISTS, DROP ... IF EXISTS before
--     every constraint / policy / trigger / index.
--   * Soft delete (deleted_at timestamptz) on every table.
--   * Cross-tenant consistency BEFORE-trigger: signals / scores / disputes
--     verify the referenced job's tenant matches; outcomes verify the
--     referenced dispute's tenant matches (and the optional signal's tenant,
--     when set). RLS hides foreign parents from the trigger's SELECT, so a
--     foreign-id injection fails "does not exist".
--   * Shared BEFORE UPDATE updated_at trigger function across all tables.
--
-- Down (rollback):
--   DROP TABLE IF EXISTS dispute_outcomes;
--   DROP TABLE IF EXISTS dispute_records;
--   DROP TABLE IF EXISTS fraud_risk_scores;
--   DROP TABLE IF EXISTS fraud_risk_signals;
--   DROP FUNCTION IF EXISTS fn_fraud_job_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_fraud_dispute_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_fraud_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper, reused by all fraud-detection tables.
CREATE OR REPLACE FUNCTION fn_fraud_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Tenant-consistency guard for tables that hang directly off a job
-- (signals, scores, disputes). The referenced job's tenant_id must match
-- the row's tenant_id. RLS hides foreign jobs, so a cross-tenant job_id
-- surfaces as "does not exist".
CREATE OR REPLACE FUNCTION fn_fraud_job_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_job_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_job_tenant
  FROM jobs WHERE id = NEW.job_id;

  IF v_job_tenant IS NULL THEN
    RAISE EXCEPTION 'fraud: job_id % does not exist', NEW.job_id;
  END IF;

  IF v_job_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'fraud: tenant_id (%) does not match jobs.tenant_id (%)',
      NEW.tenant_id, v_job_tenant;
  END IF;

  RETURN NEW;
END
$$;

-- Tenant-consistency guard for dispute_outcomes: the referenced dispute's
-- tenant must match, and (when present) the referenced signal's tenant must
-- match too. signal_id is nullable — historical ground truth survives a
-- soft-deleted signal (FK is ON DELETE SET NULL).
CREATE OR REPLACE FUNCTION fn_fraud_dispute_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_dispute_tenant uuid;
  v_signal_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_dispute_tenant
  FROM dispute_records WHERE id = NEW.dispute_id;

  IF v_dispute_tenant IS NULL THEN
    RAISE EXCEPTION 'dispute_outcomes: dispute_id % does not exist', NEW.dispute_id;
  END IF;

  IF v_dispute_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'dispute_outcomes: tenant_id (%) does not match dispute_records.tenant_id (%)',
      NEW.tenant_id, v_dispute_tenant;
  END IF;

  IF NEW.signal_id IS NOT NULL THEN
    SELECT tenant_id INTO v_signal_tenant
    FROM fraud_risk_signals WHERE id = NEW.signal_id;

    IF v_signal_tenant IS NULL THEN
      RAISE EXCEPTION 'dispute_outcomes: signal_id % does not exist', NEW.signal_id;
    END IF;

    IF v_signal_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'dispute_outcomes: tenant_id (%) does not match fraud_risk_signals.tenant_id (%)',
        NEW.tenant_id, v_signal_tenant;
    END IF;
  END IF;

  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. fraud_risk_signals
-- ---------------------------------------------------------------------
-- One row per detected anomaly on a job. signal_type names the detector;
-- severity + confidence_pct describe how strong the hit is; payload carries
-- the detector-specific evidence (the duplicate job id, the mileage ratio,
-- the flip count, etc.). model_version stamps the detector revision.
--
-- Idempotency: scoreJob re-runs cleanly. A job carries at most ONE live
-- (non-deleted) signal of a given signal_type — the partial unique index.
-- Re-scoring soft-deletes the prior signal set and inserts the fresh one.

CREATE TABLE IF NOT EXISTS fraud_risk_signals (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id         uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  signal_type    text NOT NULL,
  severity       text NOT NULL DEFAULT 'info',
  confidence_pct integer NOT NULL DEFAULT 0,
  detected_at    timestamptz NOT NULL DEFAULT now(),
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_version  text NOT NULL DEFAULT 'fraud-v1.0',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

ALTER TABLE fraud_risk_signals DROP CONSTRAINT IF EXISTS fraud_risk_signals_severity_chk;
ALTER TABLE fraud_risk_signals ADD CONSTRAINT fraud_risk_signals_severity_chk
  CHECK (severity IN ('info', 'low', 'medium', 'high'));

ALTER TABLE fraud_risk_signals DROP CONSTRAINT IF EXISTS fraud_risk_signals_type_chk;
ALTER TABLE fraud_risk_signals ADD CONSTRAINT fraud_risk_signals_type_chk
  CHECK (signal_type IN (
    'duplicate_invoice',
    'excessive_mileage',
    'rapid_resequencing',
    'off_hours_dispatch',
    'missing_evidence',
    'driver_anomaly',
    'cash_only_pattern',
    'geofence_violation',
    'bill_to_storage_acceleration'
  ));

ALTER TABLE fraud_risk_signals DROP CONSTRAINT IF EXISTS fraud_risk_signals_confidence_range;
ALTER TABLE fraud_risk_signals ADD CONSTRAINT fraud_risk_signals_confidence_range
  CHECK (confidence_pct >= 0 AND confidence_pct <= 100);

-- One live signal per (job, signal_type): makes re-scoring an upsert.
DROP INDEX IF EXISTS fraud_risk_signals_job_type_unique;
CREATE UNIQUE INDEX fraud_risk_signals_job_type_unique
  ON fraud_risk_signals (job_id, signal_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS fraud_risk_signals_tenant_job_idx
  ON fraud_risk_signals (tenant_id, job_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS fraud_risk_signals_tenant_type_idx
  ON fraud_risk_signals (tenant_id, signal_type, detected_at)
  WHERE deleted_at IS NULL;

ALTER TABLE fraud_risk_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_risk_signals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fraud_risk_signals_tenant_isolation ON fraud_risk_signals;
CREATE POLICY fraud_risk_signals_tenant_isolation ON fraud_risk_signals
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_fraud_risk_signals_tenant_consistency ON fraud_risk_signals;
CREATE TRIGGER trg_fraud_risk_signals_tenant_consistency
  BEFORE INSERT OR UPDATE ON fraud_risk_signals
  FOR EACH ROW EXECUTE FUNCTION fn_fraud_job_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_fraud_risk_signals ON fraud_risk_signals;
CREATE TRIGGER trg_audit_fraud_risk_signals
  AFTER INSERT OR UPDATE OR DELETE ON fraud_risk_signals
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_fraud_risk_signals_set_updated_at ON fraud_risk_signals;
CREATE TRIGGER trg_fraud_risk_signals_set_updated_at
  BEFORE UPDATE ON fraud_risk_signals
  FOR EACH ROW EXECUTE FUNCTION fn_fraud_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. fraud_risk_scores
-- ---------------------------------------------------------------------
-- Composite score per job. job_id is the PRIMARY KEY — one score per job;
-- re-scoring is ON CONFLICT (job_id) DO UPDATE. top_signals snapshots the
-- highest-weight contributing signals (type + severity + points) so the UI
-- can render a breakdown without re-joining.

CREATE TABLE IF NOT EXISTS fraud_risk_scores (
  job_id        uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  score_0_100   integer NOT NULL DEFAULT 0,
  risk_band     text NOT NULL DEFAULT 'low',
  computed_at   timestamptz NOT NULL DEFAULT now(),
  top_signals   jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_version text NOT NULL DEFAULT 'fraud-v1.0',
  reviewed_at   timestamptz,
  reviewed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  review_action text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

ALTER TABLE fraud_risk_scores DROP CONSTRAINT IF EXISTS fraud_risk_scores_score_range;
ALTER TABLE fraud_risk_scores ADD CONSTRAINT fraud_risk_scores_score_range
  CHECK (score_0_100 >= 0 AND score_0_100 <= 100);

ALTER TABLE fraud_risk_scores DROP CONSTRAINT IF EXISTS fraud_risk_scores_band_chk;
ALTER TABLE fraud_risk_scores ADD CONSTRAINT fraud_risk_scores_band_chk
  CHECK (risk_band IN ('low', 'medium', 'high', 'critical'));

ALTER TABLE fraud_risk_scores DROP CONSTRAINT IF EXISTS fraud_risk_scores_review_action_chk;
ALTER TABLE fraud_risk_scores ADD CONSTRAINT fraud_risk_scores_review_action_chk
  CHECK (review_action IS NULL OR review_action IN ('reviewed', 'hold_invoice', 'escalate', 'cleared'));

-- Risk queue: tenant's high/critical jobs, newest first.
CREATE INDEX IF NOT EXISTS fraud_risk_scores_tenant_band_idx
  ON fraud_risk_scores (tenant_id, risk_band, computed_at)
  WHERE deleted_at IS NULL;

ALTER TABLE fraud_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_risk_scores FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fraud_risk_scores_tenant_isolation ON fraud_risk_scores;
CREATE POLICY fraud_risk_scores_tenant_isolation ON fraud_risk_scores
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_fraud_risk_scores_tenant_consistency ON fraud_risk_scores;
CREATE TRIGGER trg_fraud_risk_scores_tenant_consistency
  BEFORE INSERT OR UPDATE ON fraud_risk_scores
  FOR EACH ROW EXECUTE FUNCTION fn_fraud_job_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_fraud_risk_scores ON fraud_risk_scores;
CREATE TRIGGER trg_audit_fraud_risk_scores
  AFTER INSERT OR UPDATE OR DELETE ON fraud_risk_scores
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_fraud_risk_scores_set_updated_at ON fraud_risk_scores;
CREATE TRIGGER trg_fraud_risk_scores_set_updated_at
  BEFORE UPDATE ON fraud_risk_scores
  FOR EACH ROW EXECUTE FUNCTION fn_fraud_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. dispute_records
-- ---------------------------------------------------------------------
-- A dispute a motor club raised against a submitted invoice for a job.
-- amount_disputed_cents is the contested amount; resolution_amount_cents is
-- what the operator actually recovered/lost on close. status walks
-- open → won | lost | partial | withdrawn.

CREATE TABLE IF NOT EXISTS dispute_records (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id                 uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  motor_club_name        text NOT NULL,
  dispute_type           text NOT NULL DEFAULT 'other',
  disputed_at            timestamptz NOT NULL DEFAULT now(),
  amount_disputed_cents  bigint NOT NULL DEFAULT 0,
  status                 text NOT NULL DEFAULT 'open',
  resolution_at          timestamptz,
  resolution_amount_cents bigint,
  notes                  text,
  created_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz
);

ALTER TABLE dispute_records DROP CONSTRAINT IF EXISTS dispute_records_type_chk;
ALTER TABLE dispute_records ADD CONSTRAINT dispute_records_type_chk
  CHECK (dispute_type IN ('pricing', 'service', 'fraud', 'duplicate', 'other'));

ALTER TABLE dispute_records DROP CONSTRAINT IF EXISTS dispute_records_status_chk;
ALTER TABLE dispute_records ADD CONSTRAINT dispute_records_status_chk
  CHECK (status IN ('open', 'won', 'lost', 'withdrawn', 'partial'));

ALTER TABLE dispute_records DROP CONSTRAINT IF EXISTS dispute_records_amount_nonneg;
ALTER TABLE dispute_records ADD CONSTRAINT dispute_records_amount_nonneg
  CHECK (amount_disputed_cents >= 0
    AND (resolution_amount_cents IS NULL OR resolution_amount_cents >= 0));

CREATE INDEX IF NOT EXISTS dispute_records_tenant_status_idx
  ON dispute_records (tenant_id, status, disputed_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS dispute_records_tenant_club_idx
  ON dispute_records (tenant_id, motor_club_name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS dispute_records_tenant_job_idx
  ON dispute_records (tenant_id, job_id)
  WHERE deleted_at IS NULL;

ALTER TABLE dispute_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dispute_records_tenant_isolation ON dispute_records;
CREATE POLICY dispute_records_tenant_isolation ON dispute_records
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_dispute_records_tenant_consistency ON dispute_records;
CREATE TRIGGER trg_dispute_records_tenant_consistency
  BEFORE INSERT OR UPDATE ON dispute_records
  FOR EACH ROW EXECUTE FUNCTION fn_fraud_job_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_dispute_records ON dispute_records;
CREATE TRIGGER trg_audit_dispute_records
  AFTER INSERT OR UPDATE OR DELETE ON dispute_records
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_dispute_records_set_updated_at ON dispute_records;
CREATE TRIGGER trg_dispute_records_set_updated_at
  BEFORE UPDATE ON dispute_records
  FOR EACH ROW EXECUTE FUNCTION fn_fraud_set_updated_at();


-- ---------------------------------------------------------------------
-- 4. dispute_outcomes
-- ---------------------------------------------------------------------
-- Ground-truth feedback closing the loop: once a dispute resolves, the
-- operator records whether it was actually fraud and (optionally) which
-- signal predicted it. A future model-training session reads this to tune
-- signal weights. signal_id is nullable (a dispute may resolve with no
-- predictive signal) and ON DELETE SET NULL (history survives re-scoring).

CREATE TABLE IF NOT EXISTS dispute_outcomes (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  dispute_id      uuid NOT NULL REFERENCES dispute_records(id) ON DELETE CASCADE,
  signal_id       uuid REFERENCES fraud_risk_signals(id) ON DELETE SET NULL,
  was_fraud       boolean NOT NULL DEFAULT false,
  ground_truth_at timestamptz NOT NULL DEFAULT now(),
  notes           text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS dispute_outcomes_tenant_dispute_idx
  ON dispute_outcomes (tenant_id, dispute_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS dispute_outcomes_tenant_signal_idx
  ON dispute_outcomes (tenant_id, signal_id)
  WHERE deleted_at IS NULL;

ALTER TABLE dispute_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_outcomes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dispute_outcomes_tenant_isolation ON dispute_outcomes;
CREATE POLICY dispute_outcomes_tenant_isolation ON dispute_outcomes
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_dispute_outcomes_tenant_consistency ON dispute_outcomes;
CREATE TRIGGER trg_dispute_outcomes_tenant_consistency
  BEFORE INSERT OR UPDATE ON dispute_outcomes
  FOR EACH ROW EXECUTE FUNCTION fn_fraud_dispute_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_dispute_outcomes ON dispute_outcomes;
CREATE TRIGGER trg_audit_dispute_outcomes
  AFTER INSERT OR UPDATE OR DELETE ON dispute_outcomes
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_dispute_outcomes_set_updated_at ON dispute_outcomes;
CREATE TRIGGER trg_dispute_outcomes_set_updated_at
  BEFORE UPDATE ON dispute_outcomes
  FOR EACH ROW EXECUTE FUNCTION fn_fraud_set_updated_at();
