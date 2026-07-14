-- =====================================================================
-- 0052_capacity_signaling.sql  (Capacity-Aware Dispatch Signaling — CADS)
--
-- CADS continuously computes the tenant's live dispatch load per duty
-- class (light|medium|heavy) and broadcasts machine-readable availability
-- to motor-club partners, so partner systems can assign jobs with
-- confidence the operator can perform within the contractual window
-- (guideline_minutes, default 60).
--
--   load_ratio = weighted_active_jobs / eligible_signed_in_drivers
--
-- Tables added:
--   1. capacity_settings   — per-tenant thresholds, weights, hysteresis,
--                            broadcast debounce, guideline minutes, zone flag.
--   2. capacity_snapshots  — time-series of computed state per duty class.
--   3. capacity_overrides  — manual dispatcher/admin band overrides
--                            (active + historical; auto-expiring).
--   4. capacity_partners   — registered outbound partners (webhook/pull),
--                            per-partner class visibility + credentials.
--   5. capacity_broadcasts — receipts for every outbound delivery attempt.
--
-- Columns added:
--   * trucks.duty_class  (light|medium|heavy, NOT NULL DEFAULT 'light') —
--     CADS-canonical duty bucket. Backfilled from capacity_class
--     (HD → heavy) and, where capacity_class is NULL, from truck_type.
--   * trucks.is_rotator  (boolean NOT NULL DEFAULT false) — heavy only;
--     backfilled true where 'sliding_rotator' = ANY(equipment).
--   * jobs.duty_class    (light|medium|heavy, NOT NULL DEFAULT 'light') —
--     derived from service type + vehicle at creation, settable by
--     dispatch so a job can be reclassed.
--
-- Patterns followed (match 0045_ai_dispatch.sql exactly):
--   * Every tenant table: tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE RESTRICT; ENABLE + FORCE ROW LEVEL SECURITY; policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on every tenant table.
--   * Soft delete (deleted_at) on every tenant table.
--   * Idempotent: CREATE ... IF NOT EXISTS, DROP ... IF EXISTS before every
--     constraint / policy / trigger / index (runner re-applies every file).
--   * Cross-tenant consistency BEFORE-trigger on the partner-linked table
--     (capacity_broadcasts → capacity_partners), mirroring the job-link
--     guard precedent from 0045.
--   * Shared BEFORE UPDATE updated_at trigger function across all tables.
--   * Duty-class/bands are text + CHECK, not pg enums (repo convention;
--     see 0030_drivetrain_enum_rewrite for why enums are avoided).
--
-- Migration number: 0052. The chain tops out at the five parallel 0051_*
-- files; 0052 depends only on pre-existing tables (tenants, users, trucks,
-- jobs, yard_facilities).
--
-- Down (rollback):
--   DROP TABLE IF EXISTS capacity_broadcasts;
--   DROP TABLE IF EXISTS capacity_partners;
--   DROP TABLE IF EXISTS capacity_overrides;
--   DROP TABLE IF EXISTS capacity_snapshots;
--   DROP TABLE IF EXISTS capacity_settings;
--   ALTER TABLE trucks DROP COLUMN IF EXISTS duty_class;
--   ALTER TABLE trucks DROP COLUMN IF EXISTS is_rotator;
--   ALTER TABLE jobs   DROP COLUMN IF EXISTS duty_class;
--   DROP FUNCTION IF EXISTS fn_capacity_partner_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_capacity_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper, reused by all capacity tables.
CREATE OR REPLACE FUNCTION fn_capacity_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Tenant-consistency guard for partner-linked rows: the referenced
-- partner's tenant_id must match the row's tenant_id. RLS hides foreign
-- partners, so a cross-tenant partner_id surfaces as "does not exist".
CREATE OR REPLACE FUNCTION fn_capacity_partner_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_partner_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_partner_tenant
  FROM capacity_partners WHERE id = NEW.partner_id;

  IF v_partner_tenant IS NULL THEN
    RAISE EXCEPTION 'capacity: partner_id % does not exist', NEW.partner_id;
  END IF;

  IF v_partner_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'capacity: tenant_id (%) does not match capacity_partners.tenant_id (%)',
      NEW.tenant_id, v_partner_tenant;
  END IF;

  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- trucks.duty_class + trucks.is_rotator
-- ---------------------------------------------------------------------
-- duty_class is the CADS-canonical bucket. capacity_class (nullable,
-- light|medium|heavy|HD) predates it and stays untouched for fleet
-- reporting; duty_class collapses HD into heavy and is NOT NULL so the
-- compute path never branches on missing data.

ALTER TABLE trucks ADD COLUMN IF NOT EXISTS duty_class text NOT NULL DEFAULT 'light';
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS is_rotator boolean NOT NULL DEFAULT false;

ALTER TABLE trucks DROP CONSTRAINT IF EXISTS trucks_duty_class_chk;
ALTER TABLE trucks ADD CONSTRAINT trucks_duty_class_chk
  CHECK (duty_class IN ('light', 'medium', 'heavy'));

-- Backfill once: rows still on the column default get their class from
-- capacity_class first, then truck_type. Idempotent — reruns only touch
-- rows that would change, and the expression is stable.
UPDATE trucks SET duty_class =
  CASE
    WHEN capacity_class IN ('light', 'medium', 'heavy') THEN capacity_class
    WHEN capacity_class = 'HD' THEN 'heavy'
    WHEN truck_type = 'heavy_duty' THEN 'heavy'
    WHEN truck_type = 'medium_duty' THEN 'medium'
    ELSE 'light'
  END
WHERE duty_class <> CASE
    WHEN capacity_class IN ('light', 'medium', 'heavy') THEN capacity_class
    WHEN capacity_class = 'HD' THEN 'heavy'
    WHEN truck_type = 'heavy_duty' THEN 'heavy'
    WHEN truck_type = 'medium_duty' THEN 'medium'
    ELSE 'light'
  END;

UPDATE trucks SET is_rotator = true
WHERE is_rotator = false
  AND equipment IS NOT NULL
  AND 'sliding_rotator' = ANY(equipment);

CREATE INDEX IF NOT EXISTS trucks_tenant_duty_class_idx
  ON trucks (tenant_id, duty_class)
  WHERE deleted_at IS NULL;


-- ---------------------------------------------------------------------
-- jobs.duty_class
-- ---------------------------------------------------------------------
-- Derived from service type + vehicle data at creation; settable by
-- dispatch afterwards so a misclassed job can be corrected.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS duty_class text NOT NULL DEFAULT 'light';

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_duty_class_chk;
ALTER TABLE jobs ADD CONSTRAINT jobs_duty_class_chk
  CHECK (duty_class IN ('light', 'medium', 'heavy'));

-- Backfill once: mirror deriveJobDutyClass (vehicle class wins; recovery/
-- winch with no usable vehicle class run medium; everything else light) so
-- in-flight pre-CADS jobs land in the right capacity bucket at deploy.
-- Idempotent like the trucks backfill above.
UPDATE jobs j SET duty_class = d.duty_class
FROM (
  SELECT j2.id,
    CASE
      WHEN v.vehicle_class = 'heavy_duty' THEN 'heavy'
      WHEN v.vehicle_class IN ('medium_duty', 'commercial', 'rv') THEN 'medium'
      WHEN v.vehicle_class IN ('light_duty', 'motorcycle') THEN 'light'
      WHEN j2.service_type IN ('recovery', 'winch') THEN 'medium'
      ELSE 'light'
    END AS duty_class
  FROM jobs j2
  LEFT JOIN vehicles v ON v.id = j2.vehicle_id
) d
WHERE d.id = j.id AND j.duty_class <> d.duty_class;

-- Partial index for the CADS hot path: active jobs per (tenant, class).
CREATE INDEX IF NOT EXISTS jobs_tenant_duty_class_active_idx
  ON jobs (tenant_id, duty_class, status)
  WHERE deleted_at IS NULL
    AND status IN ('dispatched', 'enroute', 'on_scene', 'in_progress');


-- ---------------------------------------------------------------------
-- 1. capacity_settings
-- ---------------------------------------------------------------------
-- One live row per tenant (partial unique). Thresholds are the upper
-- bound of each band; ratio <= available_max → AVAILABLE_NOW, etc.;
-- above constrained_max → AT_CAPACITY. job_weights maps job status →
-- weight; statuses absent from the map count 0.

CREATE TABLE IF NOT EXISTS capacity_settings (
  id                               uuid PRIMARY KEY,
  tenant_id                        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,

  available_max_ratio              numeric(6, 3) NOT NULL DEFAULT 0.75,
  limited_max_ratio                numeric(6, 3) NOT NULL DEFAULT 1.50,
  constrained_max_ratio            numeric(6, 3) NOT NULL DEFAULT 2.00,

  job_weights                      jsonb NOT NULL DEFAULT
    '{"dispatched": 1.0, "enroute": 1.0, "on_scene": 1.0, "in_progress": 1.0}'::jsonb,

  hysteresis_buffer                numeric(6, 3) NOT NULL DEFAULT 0.05,
  hysteresis_dwell_seconds         integer NOT NULL DEFAULT 60,
  min_broadcast_interval_seconds   integer NOT NULL DEFAULT 60,
  guideline_minutes                integer NOT NULL DEFAULT 60,

  override_default_expiry_minutes  integer NOT NULL DEFAULT 240,

  -- v1 computes company-wide only; per-yard compute is stubbed behind
  -- this flag (default off). No zone UI in v1.
  per_yard_enabled                 boolean NOT NULL DEFAULT false,

  created_at                       timestamptz NOT NULL DEFAULT now(),
  updated_at                       timestamptz NOT NULL DEFAULT now(),
  deleted_at                       timestamptz,
  created_by                       uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE capacity_settings DROP CONSTRAINT IF EXISTS capacity_settings_bands_ordered;
ALTER TABLE capacity_settings ADD CONSTRAINT capacity_settings_bands_ordered
  CHECK (available_max_ratio > 0
     AND limited_max_ratio > available_max_ratio
     AND constrained_max_ratio > limited_max_ratio);

ALTER TABLE capacity_settings DROP CONSTRAINT IF EXISTS capacity_settings_hysteresis_nonneg;
ALTER TABLE capacity_settings ADD CONSTRAINT capacity_settings_hysteresis_nonneg
  CHECK (hysteresis_buffer >= 0 AND hysteresis_dwell_seconds >= 0);

ALTER TABLE capacity_settings DROP CONSTRAINT IF EXISTS capacity_settings_debounce_nonneg;
ALTER TABLE capacity_settings ADD CONSTRAINT capacity_settings_debounce_nonneg
  CHECK (min_broadcast_interval_seconds >= 0);

ALTER TABLE capacity_settings DROP CONSTRAINT IF EXISTS capacity_settings_guideline_positive;
ALTER TABLE capacity_settings ADD CONSTRAINT capacity_settings_guideline_positive
  CHECK (guideline_minutes > 0);

-- Overrides auto-expire; default 4h, hard max 24h.
ALTER TABLE capacity_settings DROP CONSTRAINT IF EXISTS capacity_settings_override_expiry_chk;
ALTER TABLE capacity_settings ADD CONSTRAINT capacity_settings_override_expiry_chk
  CHECK (override_default_expiry_minutes > 0 AND override_default_expiry_minutes <= 1440);

DROP INDEX IF EXISTS capacity_settings_tenant_unique;
CREATE UNIQUE INDEX capacity_settings_tenant_unique
  ON capacity_settings (tenant_id)
  WHERE deleted_at IS NULL;

ALTER TABLE capacity_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS capacity_settings_tenant_isolation ON capacity_settings;
CREATE POLICY capacity_settings_tenant_isolation ON capacity_settings
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_capacity_settings ON capacity_settings;
CREATE TRIGGER trg_audit_capacity_settings
  AFTER INSERT OR UPDATE OR DELETE ON capacity_settings
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_capacity_settings_set_updated_at ON capacity_settings;
CREATE TRIGGER trg_capacity_settings_set_updated_at
  BEFORE UPDATE ON capacity_settings
  FOR EACH ROW EXECUTE FUNCTION fn_capacity_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. capacity_snapshots
-- ---------------------------------------------------------------------
-- Time-series of computed state. One row per (recompute, duty class) on
-- band transitions, and at most every 5 minutes during steady state.
-- ratio is NULL when the class is OFFLINE (no eligible drivers) — never
-- a divide-by-zero sentinel. yard_id is the v1 zone-awareness hook:
-- company-wide rows carry NULL; per-yard rows are gated behind
-- capacity_settings.per_yard_enabled.

CREATE TABLE IF NOT EXISTS capacity_snapshots (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,

  duty_class            text NOT NULL,
  band                  text NOT NULL,
  ratio                 numeric(8, 3),
  eligible_drivers      integer NOT NULL DEFAULT 0,
  weighted_active_jobs  numeric(8, 3) NOT NULL DEFAULT 0,
  override_active       boolean NOT NULL DEFAULT false,
  yard_id               uuid REFERENCES yard_facilities(id) ON DELETE SET NULL,

  computed_at           timestamptz NOT NULL DEFAULT now(),

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

ALTER TABLE capacity_snapshots DROP CONSTRAINT IF EXISTS capacity_snapshots_duty_class_chk;
ALTER TABLE capacity_snapshots ADD CONSTRAINT capacity_snapshots_duty_class_chk
  CHECK (duty_class IN ('light', 'medium', 'heavy', 'all'));

ALTER TABLE capacity_snapshots DROP CONSTRAINT IF EXISTS capacity_snapshots_band_chk;
ALTER TABLE capacity_snapshots ADD CONSTRAINT capacity_snapshots_band_chk
  CHECK (band IN ('available_now', 'limited', 'constrained', 'at_capacity', 'offline'));

ALTER TABLE capacity_snapshots DROP CONSTRAINT IF EXISTS capacity_snapshots_counts_nonneg;
ALTER TABLE capacity_snapshots ADD CONSTRAINT capacity_snapshots_counts_nonneg
  CHECK (eligible_drivers >= 0 AND weighted_active_jobs >= 0
     AND (ratio IS NULL OR ratio >= 0));

CREATE INDEX IF NOT EXISTS capacity_snapshots_tenant_class_computed_idx
  ON capacity_snapshots (tenant_id, duty_class, computed_at)
  WHERE deleted_at IS NULL;

ALTER TABLE capacity_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_snapshots FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS capacity_snapshots_tenant_isolation ON capacity_snapshots;
CREATE POLICY capacity_snapshots_tenant_isolation ON capacity_snapshots
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_capacity_snapshots ON capacity_snapshots;
CREATE TRIGGER trg_audit_capacity_snapshots
  AFTER INSERT OR UPDATE OR DELETE ON capacity_snapshots
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_capacity_snapshots_set_updated_at ON capacity_snapshots;
CREATE TRIGGER trg_capacity_snapshots_set_updated_at
  BEFORE UPDATE ON capacity_snapshots
  FOR EACH ROW EXECUTE FUNCTION fn_capacity_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. capacity_overrides
-- ---------------------------------------------------------------------
-- Manual band force (e.g. storm mode → AT_CAPACITY). duty_class 'all'
-- forces every class. Requires a reason; auto-expires (expires_at set by
-- the service from settings, hard max 24h). cleared_at is stamped on
-- manual clear; historical rows are never deleted. Computed status keeps
-- calculating underneath and resumes on expiry/clear.

CREATE TABLE IF NOT EXISTS capacity_overrides (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,

  duty_class   text NOT NULL DEFAULT 'all',
  forced_band  text NOT NULL,
  reason       text NOT NULL,

  expires_at   timestamptz NOT NULL,
  cleared_at   timestamptz,
  cleared_by   uuid REFERENCES users(id) ON DELETE SET NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  created_by   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT
);

ALTER TABLE capacity_overrides DROP CONSTRAINT IF EXISTS capacity_overrides_duty_class_chk;
ALTER TABLE capacity_overrides ADD CONSTRAINT capacity_overrides_duty_class_chk
  CHECK (duty_class IN ('light', 'medium', 'heavy', 'all'));

ALTER TABLE capacity_overrides DROP CONSTRAINT IF EXISTS capacity_overrides_band_chk;
ALTER TABLE capacity_overrides ADD CONSTRAINT capacity_overrides_band_chk
  CHECK (forced_band IN ('available_now', 'limited', 'constrained', 'at_capacity', 'offline'));

ALTER TABLE capacity_overrides DROP CONSTRAINT IF EXISTS capacity_overrides_reason_nonempty;
ALTER TABLE capacity_overrides ADD CONSTRAINT capacity_overrides_reason_nonempty
  CHECK (length(trim(reason)) > 0);

-- One live override per (tenant, duty_class).
DROP INDEX IF EXISTS capacity_overrides_tenant_class_active_unique;
CREATE UNIQUE INDEX capacity_overrides_tenant_class_active_unique
  ON capacity_overrides (tenant_id, duty_class)
  WHERE cleared_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS capacity_overrides_tenant_expires_idx
  ON capacity_overrides (tenant_id, expires_at)
  WHERE cleared_at IS NULL AND deleted_at IS NULL;

ALTER TABLE capacity_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_overrides FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS capacity_overrides_tenant_isolation ON capacity_overrides;
CREATE POLICY capacity_overrides_tenant_isolation ON capacity_overrides
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_capacity_overrides ON capacity_overrides;
CREATE TRIGGER trg_audit_capacity_overrides
  AFTER INSERT OR UPDATE OR DELETE ON capacity_overrides
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_capacity_overrides_set_updated_at ON capacity_overrides;
CREATE TRIGGER trg_capacity_overrides_set_updated_at
  BEFORE UPDATE ON capacity_overrides
  FOR EACH ROW EXECUTE FUNCTION fn_capacity_set_updated_at();


-- ---------------------------------------------------------------------
-- 4. capacity_partners
-- ---------------------------------------------------------------------
-- Registered outbound partners. network_code follows the accounts
-- motor_club_network_code convention (text code resolved against the
-- MotorClubProvider registry; 'generic' for anyone else). Credential
-- storage: api_key_hash is a one-way hash (inbound pull-API auth —
-- verify only, matching public-api api-key.util); webhook_secret must
-- be recoverable to SIGN outbound payloads, so it is AES-256-GCM
-- encrypted at rest (same WebhookSecretCipher as webhook_endpoints)
-- and the plaintext is returned only once at creation/rotation.

CREATE TABLE IF NOT EXISTS capacity_partners (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,

  name               text NOT NULL,
  network_code       text NOT NULL DEFAULT 'generic',
  delivery_mode      text NOT NULL DEFAULT 'webhook',

  webhook_url              text,
  webhook_secret_encrypted text,

  api_key_prefix     text,
  api_key_hash       text,

  enabled            boolean NOT NULL DEFAULT true,

  -- Which duty classes this partner receives ('all' plus/or specific).
  class_visibility   text[] NOT NULL DEFAULT ARRAY['light', 'medium', 'heavy']::text[],

  last_broadcast_at  timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE capacity_partners DROP CONSTRAINT IF EXISTS capacity_partners_name_nonempty;
ALTER TABLE capacity_partners ADD CONSTRAINT capacity_partners_name_nonempty
  CHECK (length(trim(name)) > 0);

ALTER TABLE capacity_partners DROP CONSTRAINT IF EXISTS capacity_partners_delivery_mode_chk;
ALTER TABLE capacity_partners ADD CONSTRAINT capacity_partners_delivery_mode_chk
  CHECK (delivery_mode IN ('webhook', 'pull_only'));

-- Webhook partners must have a URL + secret to sign with.
ALTER TABLE capacity_partners DROP CONSTRAINT IF EXISTS capacity_partners_webhook_complete;
ALTER TABLE capacity_partners ADD CONSTRAINT capacity_partners_webhook_complete
  CHECK (delivery_mode <> 'webhook'
      OR (webhook_url IS NOT NULL AND webhook_secret_encrypted IS NOT NULL));

ALTER TABLE capacity_partners DROP CONSTRAINT IF EXISTS capacity_partners_class_visibility_chk;
ALTER TABLE capacity_partners ADD CONSTRAINT capacity_partners_class_visibility_chk
  CHECK (class_visibility <@ ARRAY['light', 'medium', 'heavy']::text[]
     AND array_length(class_visibility, 1) >= 1);

DROP INDEX IF EXISTS capacity_partners_tenant_name_unique;
CREATE UNIQUE INDEX capacity_partners_tenant_name_unique
  ON capacity_partners (tenant_id, name)
  WHERE deleted_at IS NULL;

-- Pull-API key lookup: prefix is indexed globally (the guard resolves
-- the tenant FROM the key, so this index is intentionally not
-- tenant-prefixed; uniqueness keeps prefixes unambiguous).
DROP INDEX IF EXISTS capacity_partners_api_key_prefix_unique;
CREATE UNIQUE INDEX capacity_partners_api_key_prefix_unique
  ON capacity_partners (api_key_prefix)
  WHERE api_key_prefix IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE capacity_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_partners FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS capacity_partners_tenant_isolation ON capacity_partners;
CREATE POLICY capacity_partners_tenant_isolation ON capacity_partners
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_capacity_partners ON capacity_partners;
CREATE TRIGGER trg_audit_capacity_partners
  AFTER INSERT OR UPDATE OR DELETE ON capacity_partners
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_capacity_partners_set_updated_at ON capacity_partners;
CREATE TRIGGER trg_capacity_partners_set_updated_at
  BEFORE UPDATE ON capacity_partners
  FOR EACH ROW EXECUTE FUNCTION fn_capacity_set_updated_at();


-- ---------------------------------------------------------------------
-- 5. capacity_broadcasts
-- ---------------------------------------------------------------------
-- The receipts table: one row per outbound delivery attempt lifecycle
-- ("you said you were available" disputes are settled here). Retries
-- update the same row (retry_count, next attempt bookkeeping) until
-- delivered or dead_letter.

CREATE TABLE IF NOT EXISTS capacity_broadcasts (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  partner_id     uuid NOT NULL REFERENCES capacity_partners(id) ON DELETE RESTRICT,

  payload        jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'pending',

  http_status    integer,
  latency_ms     integer,
  retry_count    integer NOT NULL DEFAULT 0,
  next_retry_at  timestamptz,
  delivered_at   timestamptz,
  last_error     text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

-- 'delivering' marks a row leased by the worker while its POST is in
-- flight, so payload coalescing (which only touches 'pending' rows) can
-- never overwrite a payload that is mid-delivery.
ALTER TABLE capacity_broadcasts DROP CONSTRAINT IF EXISTS capacity_broadcasts_status_chk;
ALTER TABLE capacity_broadcasts ADD CONSTRAINT capacity_broadcasts_status_chk
  CHECK (status IN ('pending', 'delivering', 'delivered', 'failed', 'dead_letter'));

ALTER TABLE capacity_broadcasts DROP CONSTRAINT IF EXISTS capacity_broadcasts_retry_nonneg;
ALTER TABLE capacity_broadcasts ADD CONSTRAINT capacity_broadcasts_retry_nonneg
  CHECK (retry_count >= 0 AND (latency_ms IS NULL OR latency_ms >= 0));

CREATE INDEX IF NOT EXISTS capacity_broadcasts_tenant_created_idx
  ON capacity_broadcasts (tenant_id, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS capacity_broadcasts_tenant_partner_idx
  ON capacity_broadcasts (tenant_id, partner_id, created_at)
  WHERE deleted_at IS NULL;

-- Serves the every-minute delivery sweep: due rows regardless of tenant
-- ('delivering' included so crashed leases are re-claimed after expiry).
DROP INDEX IF EXISTS capacity_broadcasts_pending_retry_idx;
CREATE INDEX capacity_broadcasts_pending_retry_idx
  ON capacity_broadcasts (next_retry_at)
  WHERE status IN ('pending', 'delivering') AND deleted_at IS NULL;

ALTER TABLE capacity_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_broadcasts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS capacity_broadcasts_tenant_isolation ON capacity_broadcasts;
CREATE POLICY capacity_broadcasts_tenant_isolation ON capacity_broadcasts
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_capacity_broadcasts_tenant_consistency ON capacity_broadcasts;
CREATE TRIGGER trg_capacity_broadcasts_tenant_consistency
  BEFORE INSERT OR UPDATE ON capacity_broadcasts
  FOR EACH ROW EXECUTE FUNCTION fn_capacity_partner_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_capacity_broadcasts ON capacity_broadcasts;
CREATE TRIGGER trg_audit_capacity_broadcasts
  AFTER INSERT OR UPDATE OR DELETE ON capacity_broadcasts
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_capacity_broadcasts_set_updated_at ON capacity_broadcasts;
CREATE TRIGGER trg_capacity_broadcasts_set_updated_at
  BEFORE UPDATE ON capacity_broadcasts
  FOR EACH ROW EXECUTE FUNCTION fn_capacity_set_updated_at();
