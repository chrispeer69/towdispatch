-- =====================================================================
-- 0041_damage_analysis.sql  (Photo Damage Analysis — Session 42)
--
-- AI vision analysis of pre-tow / post-tow evidence photos to detect
-- existing damage (defends against fraudulent damage claims) and produce
-- a damage report. The vision provider is pluggable (stub | anthropic |
-- openai) at the application layer; this migration only lands the data
-- model the providers and comparison logic write to.
--
-- Tables added:
--   1. damage_analyses     — one analysis run over a set of photos for a
--                            job, in a given phase (pre_tow / post_tow /
--                            claim_review). Holds queue state + raw model
--                            response.
--   2. damage_findings     — per-area damage findings produced by an
--                            analysis. Operators annotate/override
--                            findings (never delete them).
--   3. damage_comparisons  — a pre-vs-post comparison for a job; persists
--                            the new-damage delta and a human summary.
--
-- Patterns followed (match 0036_impound_storage.sql / 0037):
--   * Every table: tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE RESTRICT.
--   * Every table: ENABLE + FORCE ROW LEVEL SECURITY, policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on every table.
--   * Idempotent: CREATE ... IF NOT EXISTS, every constraint preceded by
--     DROP CONSTRAINT IF EXISTS, every policy by DROP POLICY IF EXISTS,
--     every trigger by DROP TRIGGER IF EXISTS.
--   * Soft delete (deleted_at timestamptz) everywhere — damage analyses
--     are evidentiary records (fraud-claim defense).
--   * Cross-tenant consistency BEFORE-trigger on every table: the FKs
--     guarantee the parent row exists but not that its tenant_id matches.
--     RLS hides foreign parents from the trigger's SELECT, so a foreign-id
--     injection fails "does not exist"/"does not match".
--   * One shared BEFORE UPDATE updated_at trigger function reused across
--     all three tables (Drizzle's defaultNow() only fires on INSERT).
--
-- Migration numbering: 0041 (master tops out at 0037; 0038-0040 are
--   reserved by in-flight parallel sessions). 0041 only depends on
--   pre-existing tables (jobs, tenants, users); lexicographic ordering
--   after them is safe.
--
-- Down (rollback):
--   DROP TABLE IF EXISTS damage_comparisons;
--   DROP TABLE IF EXISTS damage_findings;
--   DROP TABLE IF EXISTS damage_analyses;
--   DROP FUNCTION IF EXISTS fn_damage_comparisons_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_damage_findings_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_damage_analyses_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_damage_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper, reused by all three damage tables.
CREATE OR REPLACE FUNCTION fn_damage_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. damage_analyses
-- ---------------------------------------------------------------------
-- One analysis run. photo_keys is the set of evidence object keys handed
-- to the vision provider (snapshotted so the analysis is reproducible
-- even if evidence rows change). provider/model record which engine ran.
-- raw_response keeps the model's structured payload for audit. The queue
-- state machine (enforced in the service + worker):
--   queued -> processing -> complete
--   queued|processing -> failed   (after max retries)
-- retry_count is bumped by the worker on transient failure.

CREATE TABLE IF NOT EXISTS damage_analyses (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id          uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  phase           text NOT NULL,
  photo_keys      text[] NOT NULL DEFAULT '{}',
  -- Non-PII vehicle hints (make/model/year/color) sent to the provider.
  -- VIN/plate/owner are NEVER persisted here or sent to a third party.
  vehicle_context jsonb,
  provider        text NOT NULL,
  model           text,
  status          text NOT NULL DEFAULT 'queued',
  raw_response    jsonb,
  error           text,
  retry_count     integer NOT NULL DEFAULT 0,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

ALTER TABLE damage_analyses DROP CONSTRAINT IF EXISTS damage_analyses_phase_chk;
ALTER TABLE damage_analyses ADD CONSTRAINT damage_analyses_phase_chk
  CHECK (phase IN ('pre_tow', 'post_tow', 'claim_review'));

ALTER TABLE damage_analyses DROP CONSTRAINT IF EXISTS damage_analyses_status_chk;
ALTER TABLE damage_analyses ADD CONSTRAINT damage_analyses_status_chk
  CHECK (status IN ('queued', 'processing', 'complete', 'failed'));

ALTER TABLE damage_analyses DROP CONSTRAINT IF EXISTS damage_analyses_provider_chk;
ALTER TABLE damage_analyses ADD CONSTRAINT damage_analyses_provider_chk
  CHECK (provider IN ('stub', 'anthropic', 'openai'));

ALTER TABLE damage_analyses DROP CONSTRAINT IF EXISTS damage_analyses_retry_nonneg;
ALTER TABLE damage_analyses ADD CONSTRAINT damage_analyses_retry_nonneg
  CHECK (retry_count >= 0);

CREATE INDEX IF NOT EXISTS damage_analyses_tenant_job_idx
  ON damage_analyses (tenant_id, job_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS damage_analyses_tenant_job_phase_idx
  ON damage_analyses (tenant_id, job_id, phase)
  WHERE deleted_at IS NULL;

-- Worker-sweep target: runs still owed processing.
CREATE INDEX IF NOT EXISTS damage_analyses_pending_idx
  ON damage_analyses (status, retry_count)
  WHERE status IN ('queued', 'processing') AND deleted_at IS NULL;

ALTER TABLE damage_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE damage_analyses FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS damage_analyses_tenant_isolation ON damage_analyses;
CREATE POLICY damage_analyses_tenant_isolation ON damage_analyses
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- Cross-tenant consistency: job_id must belong to this row's tenant. RLS
-- hides foreign jobs, so a cross-tenant job_id surfaces as "does not
-- exist".
CREATE OR REPLACE FUNCTION fn_damage_analyses_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_job_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_job_tenant FROM jobs WHERE id = NEW.job_id;
  IF v_job_tenant IS NULL THEN
    RAISE EXCEPTION 'damage_analyses: job_id % does not exist', NEW.job_id;
  END IF;
  IF v_job_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'damage_analyses: tenant_id (%) does not match jobs.tenant_id (%)',
      NEW.tenant_id, v_job_tenant;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_damage_analyses_tenant_consistency ON damage_analyses;
CREATE TRIGGER trg_damage_analyses_tenant_consistency
  BEFORE INSERT OR UPDATE ON damage_analyses
  FOR EACH ROW EXECUTE FUNCTION fn_damage_analyses_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_damage_analyses ON damage_analyses;
CREATE TRIGGER trg_audit_damage_analyses
  AFTER INSERT OR UPDATE OR DELETE ON damage_analyses
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_damage_analyses_set_updated_at ON damage_analyses;
CREATE TRIGGER trg_damage_analyses_set_updated_at
  BEFORE UPDATE ON damage_analyses
  FOR EACH ROW EXECUTE FUNCTION fn_damage_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. damage_findings
-- ---------------------------------------------------------------------
-- Per-area damage findings produced by an analysis. confidence_pct is the
-- model's confidence as a whole percent (0-100). bounding_box is the
-- optional region on the source photo ({photoKey,x,y,w,h} normalised
-- 0..1), NULL when the provider gives none.
--
-- Operator override model: operators ANNOTATE findings, they never delete
-- them (evidentiary integrity). operator_severity overrides the model's
-- severity, operator_note records the operator's comment, is_dismissed
-- flags a false-positive the operator rejects. overridden_by/at record who
-- and when. Comparison logic uses the *effective* severity
-- (COALESCE(operator_severity, severity)) and skips dismissed findings.

CREATE TABLE IF NOT EXISTS damage_findings (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  analysis_id       uuid NOT NULL REFERENCES damage_analyses(id) ON DELETE CASCADE,
  area              text NOT NULL,
  severity          text NOT NULL,
  confidence_pct    integer NOT NULL DEFAULT 0,
  description       text,
  bounding_box      jsonb,
  operator_severity text,
  operator_note     text,
  is_dismissed      boolean NOT NULL DEFAULT false,
  overridden_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  overridden_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

ALTER TABLE damage_findings DROP CONSTRAINT IF EXISTS damage_findings_area_chk;
ALTER TABLE damage_findings ADD CONSTRAINT damage_findings_area_chk
  CHECK (area IN (
    'front_bumper', 'rear_bumper', 'driver_door', 'passenger_door', 'hood',
    'roof', 'trunk', 'wheels', 'windshield', 'other'
  ));

ALTER TABLE damage_findings DROP CONSTRAINT IF EXISTS damage_findings_severity_chk;
ALTER TABLE damage_findings ADD CONSTRAINT damage_findings_severity_chk
  CHECK (severity IN ('none', 'minor', 'moderate', 'severe'));

ALTER TABLE damage_findings DROP CONSTRAINT IF EXISTS damage_findings_operator_severity_chk;
ALTER TABLE damage_findings ADD CONSTRAINT damage_findings_operator_severity_chk
  CHECK (operator_severity IS NULL OR operator_severity IN ('none', 'minor', 'moderate', 'severe'));

ALTER TABLE damage_findings DROP CONSTRAINT IF EXISTS damage_findings_confidence_range;
ALTER TABLE damage_findings ADD CONSTRAINT damage_findings_confidence_range
  CHECK (confidence_pct >= 0 AND confidence_pct <= 100);

CREATE INDEX IF NOT EXISTS damage_findings_tenant_analysis_idx
  ON damage_findings (tenant_id, analysis_id)
  WHERE deleted_at IS NULL;

ALTER TABLE damage_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE damage_findings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS damage_findings_tenant_isolation ON damage_findings;
CREATE POLICY damage_findings_tenant_isolation ON damage_findings
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- Cross-tenant consistency: the analysis the finding hangs off must
-- belong to this row's tenant.
CREATE OR REPLACE FUNCTION fn_damage_findings_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_analysis_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_analysis_tenant
  FROM damage_analyses WHERE id = NEW.analysis_id;
  IF v_analysis_tenant IS NULL THEN
    RAISE EXCEPTION 'damage_findings: analysis_id % does not exist', NEW.analysis_id;
  END IF;
  IF v_analysis_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'damage_findings: tenant_id (%) does not match damage_analyses.tenant_id (%)',
      NEW.tenant_id, v_analysis_tenant;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_damage_findings_tenant_consistency ON damage_findings;
CREATE TRIGGER trg_damage_findings_tenant_consistency
  BEFORE INSERT OR UPDATE ON damage_findings
  FOR EACH ROW EXECUTE FUNCTION fn_damage_findings_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_damage_findings ON damage_findings;
CREATE TRIGGER trg_audit_damage_findings
  AFTER INSERT OR UPDATE OR DELETE ON damage_findings
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_damage_findings_set_updated_at ON damage_findings;
CREATE TRIGGER trg_damage_findings_set_updated_at
  BEFORE UPDATE ON damage_findings
  FOR EACH ROW EXECUTE FUNCTION fn_damage_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. damage_comparisons
-- ---------------------------------------------------------------------
-- A pre-vs-post comparison for a job. new_damage_findings is the JSON
-- array of damage present post-tow that was not present (or less severe)
-- pre-tow — the evidentiary core of a fraud-claim defense.
-- comparison_summary is the human-readable rollup. confidence_threshold
-- records the fraction (0..1, default 0.65) used so the result is
-- reproducible. One live comparison per (job, pre, post) triple.

CREATE TABLE IF NOT EXISTS damage_comparisons (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id                uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  pre_analysis_id       uuid NOT NULL REFERENCES damage_analyses(id) ON DELETE RESTRICT,
  post_analysis_id      uuid NOT NULL REFERENCES damage_analyses(id) ON DELETE RESTRICT,
  new_damage_findings   jsonb NOT NULL DEFAULT '[]',
  comparison_summary    text,
  confidence_threshold  numeric(4, 3) NOT NULL DEFAULT 0.650,
  generated_at          timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

ALTER TABLE damage_comparisons DROP CONSTRAINT IF EXISTS damage_comparisons_threshold_range;
ALTER TABLE damage_comparisons ADD CONSTRAINT damage_comparisons_threshold_range
  CHECK (confidence_threshold >= 0 AND confidence_threshold <= 1);

ALTER TABLE damage_comparisons DROP CONSTRAINT IF EXISTS damage_comparisons_distinct_analyses;
ALTER TABLE damage_comparisons ADD CONSTRAINT damage_comparisons_distinct_analyses
  CHECK (pre_analysis_id <> post_analysis_id);

-- One live comparison per (job, pre, post) triple — re-running compare on
-- the same pair updates the existing row rather than stacking duplicates.
DROP INDEX IF EXISTS damage_comparisons_triple_unique;
CREATE UNIQUE INDEX damage_comparisons_triple_unique
  ON damage_comparisons (job_id, pre_analysis_id, post_analysis_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS damage_comparisons_tenant_job_idx
  ON damage_comparisons (tenant_id, job_id)
  WHERE deleted_at IS NULL;

ALTER TABLE damage_comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE damage_comparisons FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS damage_comparisons_tenant_isolation ON damage_comparisons;
CREATE POLICY damage_comparisons_tenant_isolation ON damage_comparisons
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- Cross-tenant consistency: job + both analyses must all belong to this
-- row's tenant.
CREATE OR REPLACE FUNCTION fn_damage_comparisons_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_job_tenant  uuid;
  v_pre_tenant  uuid;
  v_post_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_job_tenant FROM jobs WHERE id = NEW.job_id;
  IF v_job_tenant IS NULL THEN
    RAISE EXCEPTION 'damage_comparisons: job_id % does not exist', NEW.job_id;
  END IF;
  IF v_job_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'damage_comparisons: tenant_id (%) does not match jobs.tenant_id (%)',
      NEW.tenant_id, v_job_tenant;
  END IF;

  SELECT tenant_id INTO v_pre_tenant FROM damage_analyses WHERE id = NEW.pre_analysis_id;
  IF v_pre_tenant IS NULL THEN
    RAISE EXCEPTION 'damage_comparisons: pre_analysis_id % does not exist', NEW.pre_analysis_id;
  END IF;
  IF v_pre_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'damage_comparisons: tenant_id (%) does not match pre analysis tenant (%)',
      NEW.tenant_id, v_pre_tenant;
  END IF;

  SELECT tenant_id INTO v_post_tenant FROM damage_analyses WHERE id = NEW.post_analysis_id;
  IF v_post_tenant IS NULL THEN
    RAISE EXCEPTION 'damage_comparisons: post_analysis_id % does not exist', NEW.post_analysis_id;
  END IF;
  IF v_post_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'damage_comparisons: tenant_id (%) does not match post analysis tenant (%)',
      NEW.tenant_id, v_post_tenant;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_damage_comparisons_tenant_consistency ON damage_comparisons;
CREATE TRIGGER trg_damage_comparisons_tenant_consistency
  BEFORE INSERT OR UPDATE ON damage_comparisons
  FOR EACH ROW EXECUTE FUNCTION fn_damage_comparisons_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_damage_comparisons ON damage_comparisons;
CREATE TRIGGER trg_audit_damage_comparisons
  AFTER INSERT OR UPDATE OR DELETE ON damage_comparisons
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_damage_comparisons_set_updated_at ON damage_comparisons;
CREATE TRIGGER trg_damage_comparisons_set_updated_at
  BEFORE UPDATE ON damage_comparisons
  FOR EACH ROW EXECUTE FUNCTION fn_damage_set_updated_at();
