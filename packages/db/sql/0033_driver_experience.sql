-- =====================================================================
-- 0033_driver_experience.sql  (Driver Experience — Session 1)
--
-- Data foundation for the in-truck driver application. Eight new tables
-- powering DVIR submissions, daily briefings, GPS telemetry, field
-- payment capture, evidence uploads, an offline-action ledger, and the
-- short PIN used for in-truck "switch driver" handoffs.
--
-- Tables added:
--   1. driver_pins                       — one bcrypt PIN per driver
--   2. driver_daily_briefings            — admin-authored daily message
--   3. driver_briefing_acknowledgments   — per-driver acks (append-only)
--   4. driver_pretrip_inspections        — DVIR submissions
--   5. driver_telemetry_events           — GPS/status pings (hot path,
--                                          no audit trigger)
--   6. job_evidence                      — photo/video/sig attachments
--   7. job_field_payments                — Stripe Terminal intents
--   8. driver_offline_actions            — offline-queue replay ledger
--
-- Patterns followed (all match the existing codebase):
--   * Every tenant table: tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE RESTRICT.
--   * Every tenant table: ENABLE + FORCE ROW LEVEL SECURITY, policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on every table except
--     driver_telemetry_events (too high write volume).
--   * Idempotent: CREATE TABLE / CREATE INDEX IF NOT EXISTS, every
--     constraint preceded by DROP CONSTRAINT IF EXISTS, every policy by
--     DROP POLICY IF EXISTS, every trigger by DROP TRIGGER IF EXISTS.
--   * Soft delete (deleted_at timestamptz) only on long-lived business
--     tables (driver_pins, driver_daily_briefings, job_evidence,
--     job_field_payments). Append-only ledgers omit it.
--   * Heavy tenant-prefixed composite indexes for read paths.
--   * Cross-tenant consistency BEFORE-trigger on job_evidence and
--     job_field_payments — the jobs FK + RLS alone wouldn't catch an
--     attacker who supplied a foreign-tenant job_id under their own
--     tenant GUC; the trigger raises on mismatch.
--
-- Down (rollback):
--   DROP TRIGGER IF EXISTS trg_jfp_tenant_consistency  ON job_field_payments;
--   DROP TRIGGER IF EXISTS trg_je_tenant_consistency   ON job_evidence;
--   DROP FUNCTION IF EXISTS fn_job_field_payments_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_job_evidence_tenant_consistency();
--   DROP TRIGGER IF EXISTS trg_audit_driver_offline_actions ON driver_offline_actions;
--   DROP TRIGGER IF EXISTS trg_audit_job_field_payments    ON job_field_payments;
--   DROP TRIGGER IF EXISTS trg_audit_job_evidence          ON job_evidence;
--   DROP TRIGGER IF EXISTS trg_audit_driver_pretrip_inspections        ON driver_pretrip_inspections;
--   DROP TRIGGER IF EXISTS trg_audit_driver_briefing_acknowledgments   ON driver_briefing_acknowledgments;
--   DROP TRIGGER IF EXISTS trg_audit_driver_daily_briefings            ON driver_daily_briefings;
--   DROP TRIGGER IF EXISTS trg_audit_driver_pins                       ON driver_pins;
--   DROP TABLE IF EXISTS driver_offline_actions;
--   DROP TABLE IF EXISTS job_field_payments;
--   DROP TABLE IF EXISTS job_evidence;
--   DROP TABLE IF EXISTS driver_telemetry_events;
--   DROP TABLE IF EXISTS driver_pretrip_inspections;
--   DROP TABLE IF EXISTS driver_briefing_acknowledgments;
--   DROP TABLE IF EXISTS driver_daily_briefings;
--   DROP TABLE IF EXISTS driver_pins;
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. driver_pins
-- ---------------------------------------------------------------------
-- One PIN per driver. Used for in-truck driver-switch on a single truck:
-- the outgoing driver clocks off, the incoming driver enters their PIN
-- and bcrypt-verifies without re-typing their full app password. PINs
-- live in their own table (not on drivers) because they have their own
-- failure-counter, lockout, and rotation cadence that we want to audit
-- as a distinct resource.
--
-- pin_hash is bcrypt(plain). failed_attempts is reset on success.
-- locked_until null means "not locked". A driver can have zero or one
-- live PIN row (partial unique on (tenant_id, driver_id)).

CREATE TABLE IF NOT EXISTS driver_pins (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  driver_id        uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  pin_hash         text NOT NULL,
  failed_attempts  integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  last_used_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE driver_pins
  DROP CONSTRAINT IF EXISTS driver_pins_failed_attempts_nonneg;
ALTER TABLE driver_pins
  ADD CONSTRAINT driver_pins_failed_attempts_nonneg
  CHECK (failed_attempts >= 0);

DROP INDEX IF EXISTS driver_pins_tenant_driver_live_unique;
CREATE UNIQUE INDEX driver_pins_tenant_driver_live_unique
  ON driver_pins (tenant_id, driver_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS driver_pins_tenant_driver_idx
  ON driver_pins (tenant_id, driver_id);

ALTER TABLE driver_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_pins FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_pins_tenant_isolation ON driver_pins;
CREATE POLICY driver_pins_tenant_isolation ON driver_pins
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_driver_pins ON driver_pins;
CREATE TRIGGER trg_audit_driver_pins
  AFTER INSERT OR UPDATE OR DELETE ON driver_pins
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE OR REPLACE FUNCTION fn_driver_pins_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_driver_pins_set_updated_at ON driver_pins;
CREATE TRIGGER trg_driver_pins_set_updated_at
  BEFORE UPDATE ON driver_pins
  FOR EACH ROW EXECUTE FUNCTION fn_driver_pins_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. driver_daily_briefings
-- ---------------------------------------------------------------------
-- Admin-authored daily message every driver sees and acknowledges before
-- the first job of their shift. Optional video attachment with a minimum
-- watch-duration before the ack button enables. Exactly one row per
-- tenant is "active" at any time — partial unique enforces that and
-- avoids the "two competing announcements" race.

CREATE TABLE IF NOT EXISTS driver_daily_briefings (
  id                          uuid PRIMARY KEY,
  tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  title                       text NOT NULL,
  message                     text NOT NULL,
  video_url                   text,
  video_min_duration_seconds  integer NOT NULL DEFAULT 60,
  is_active                   boolean NOT NULL DEFAULT false,
  published_at                timestamptz,
  expires_at                  timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  deleted_at                  timestamptz,
  created_by                  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by                  uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE driver_daily_briefings
  DROP CONSTRAINT IF EXISTS driver_daily_briefings_title_nonempty;
ALTER TABLE driver_daily_briefings
  ADD CONSTRAINT driver_daily_briefings_title_nonempty
  CHECK (length(trim(title)) > 0);

ALTER TABLE driver_daily_briefings
  DROP CONSTRAINT IF EXISTS driver_daily_briefings_message_nonempty;
ALTER TABLE driver_daily_briefings
  ADD CONSTRAINT driver_daily_briefings_message_nonempty
  CHECK (length(trim(message)) > 0);

ALTER TABLE driver_daily_briefings
  DROP CONSTRAINT IF EXISTS driver_daily_briefings_video_min_duration_nonneg;
ALTER TABLE driver_daily_briefings
  ADD CONSTRAINT driver_daily_briefings_video_min_duration_nonneg
  CHECK (video_min_duration_seconds >= 0);

DROP INDEX IF EXISTS driver_daily_briefings_tenant_active_unique;
CREATE UNIQUE INDEX driver_daily_briefings_tenant_active_unique
  ON driver_daily_briefings (tenant_id)
  WHERE is_active = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS driver_daily_briefings_tenant_created_idx
  ON driver_daily_briefings (tenant_id, created_at DESC);

ALTER TABLE driver_daily_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_daily_briefings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_daily_briefings_tenant_isolation ON driver_daily_briefings;
CREATE POLICY driver_daily_briefings_tenant_isolation ON driver_daily_briefings
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_driver_daily_briefings ON driver_daily_briefings;
CREATE TRIGGER trg_audit_driver_daily_briefings
  AFTER INSERT OR UPDATE OR DELETE ON driver_daily_briefings
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE OR REPLACE FUNCTION fn_driver_daily_briefings_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_driver_daily_briefings_set_updated_at ON driver_daily_briefings;
CREATE TRIGGER trg_driver_daily_briefings_set_updated_at
  BEFORE UPDATE ON driver_daily_briefings
  FOR EACH ROW EXECUTE FUNCTION fn_driver_daily_briefings_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. driver_briefing_acknowledgments
-- ---------------------------------------------------------------------
-- Append-only ledger of (driver, briefing, calendar-date) acks. The
-- date column lets the same briefing be re-acknowledged on a new day
-- (it's a "daily" briefing — drivers see it once per shift-day). The
-- unique constraint enforces one ack per driver per briefing per day.

CREATE TABLE IF NOT EXISTS driver_briefing_acknowledgments (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  driver_id           uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  briefing_id         uuid NOT NULL REFERENCES driver_daily_briefings(id) ON DELETE RESTRICT,
  acknowledged_date   date NOT NULL,
  message_read_at     timestamptz,
  video_completed_at  timestamptz,
  acknowledged_at     timestamptz NOT NULL DEFAULT now(),
  ip_address          text,
  user_agent          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS dba_tenant_driver_briefing_date_unique;
CREATE UNIQUE INDEX dba_tenant_driver_briefing_date_unique
  ON driver_briefing_acknowledgments (tenant_id, driver_id, briefing_id, acknowledged_date);

CREATE INDEX IF NOT EXISTS dba_tenant_briefing_idx
  ON driver_briefing_acknowledgments (tenant_id, briefing_id, acknowledged_date);

CREATE INDEX IF NOT EXISTS dba_tenant_driver_idx
  ON driver_briefing_acknowledgments (tenant_id, driver_id, acknowledged_date);

ALTER TABLE driver_briefing_acknowledgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_briefing_acknowledgments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dba_tenant_isolation ON driver_briefing_acknowledgments;
CREATE POLICY dba_tenant_isolation ON driver_briefing_acknowledgments
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_driver_briefing_acknowledgments ON driver_briefing_acknowledgments;
CREATE TRIGGER trg_audit_driver_briefing_acknowledgments
  AFTER INSERT OR UPDATE OR DELETE ON driver_briefing_acknowledgments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();


-- ---------------------------------------------------------------------
-- 4. driver_pretrip_inspections
-- ---------------------------------------------------------------------
-- DVIR records submitted from the truck app. We keep a separate table
-- from the existing `dvirs` (which is the Session-8 dispatcher-facing
-- pre/post-trip table) because the truck-app workflow is opinionated
-- about its own item set (hard-coded checklist, three-state status,
-- on-device signature capture). Both tables coexist for the build-1
-- session; consolidation/cross-link is a later session call.
--
-- status:
--   pass         — every item is "ok"
--   fail_safe    — at least one item failed but truck is safe to roll
--   fail_unsafe  — at least one item failed AND truck is unsafe — must
--                  not move; service-layer flips trucks.status.
--
-- items jsonb shape (validated at Zod layer):
--   [
--     { key: 'lights', label: 'Lights', state: 'ok'|'attention'|'fail',
--       note?: string, photo_keys?: string[] },
--     ...
--   ]

CREATE TABLE IF NOT EXISTS driver_pretrip_inspections (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  driver_id           uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  truck_id            uuid NOT NULL REFERENCES trucks(id) ON DELETE RESTRICT,
  shift_id            uuid REFERENCES driver_shifts(id) ON DELETE SET NULL,
  status              text NOT NULL,
  items               jsonb NOT NULL DEFAULT '[]'::jsonb,
  odometer_miles      bigint,
  signature_data_url  text,
  notes               text,
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  ip_address          text,
  user_agent          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE driver_pretrip_inspections
  DROP CONSTRAINT IF EXISTS driver_pretrip_inspections_status_chk;
ALTER TABLE driver_pretrip_inspections
  ADD CONSTRAINT driver_pretrip_inspections_status_chk
  CHECK (status IN ('pass', 'fail_safe', 'fail_unsafe'));

ALTER TABLE driver_pretrip_inspections
  DROP CONSTRAINT IF EXISTS driver_pretrip_inspections_odometer_nonneg;
ALTER TABLE driver_pretrip_inspections
  ADD CONSTRAINT driver_pretrip_inspections_odometer_nonneg
  CHECK (odometer_miles IS NULL OR odometer_miles >= 0);

CREATE INDEX IF NOT EXISTS dpi_tenant_driver_submitted_idx
  ON driver_pretrip_inspections (tenant_id, driver_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS dpi_tenant_truck_submitted_idx
  ON driver_pretrip_inspections (tenant_id, truck_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS dpi_tenant_shift_idx
  ON driver_pretrip_inspections (tenant_id, shift_id)
  WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS dpi_tenant_status_submitted_idx
  ON driver_pretrip_inspections (tenant_id, status, submitted_at DESC);

ALTER TABLE driver_pretrip_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_pretrip_inspections FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dpi_tenant_isolation ON driver_pretrip_inspections;
CREATE POLICY dpi_tenant_isolation ON driver_pretrip_inspections
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_driver_pretrip_inspections ON driver_pretrip_inspections;
CREATE TRIGGER trg_audit_driver_pretrip_inspections
  AFTER INSERT OR UPDATE OR DELETE ON driver_pretrip_inspections
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();


-- ---------------------------------------------------------------------
-- 5. driver_telemetry_events
-- ---------------------------------------------------------------------
-- High-frequency GPS/status pings. By design no audit trigger — a row
-- per ping at 1-5 Hz across 100k drivers would crater audit_log. The
-- table itself IS the audit trail for movement.
--
-- event_kind disambiguates "regular ping" vs. semantic transitions
-- (shift_start, status_change, geofence_enter, geofence_exit). It is
-- text + CHECK rather than an enum so future kinds can be added without
-- ALTER TYPE migrations on a hot table.
--
-- Append-only — no soft delete, no updated_at, no created_by (driver_id
-- IS the actor).

CREATE TABLE IF NOT EXISTS driver_telemetry_events (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  driver_id         uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  shift_id          uuid REFERENCES driver_shifts(id) ON DELETE SET NULL,
  job_id            uuid REFERENCES jobs(id) ON DELETE SET NULL,
  recorded_at       timestamptz NOT NULL,
  lat               numeric(9, 6),
  lng               numeric(9, 6),
  speed_mph         numeric(6, 2),
  heading_degrees   numeric(5, 2),
  accuracy_meters   numeric(8, 2),
  battery_pct       integer,
  event_kind        text NOT NULL DEFAULT 'ping',
  payload           jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE driver_telemetry_events
  DROP CONSTRAINT IF EXISTS driver_telemetry_events_event_kind_chk;
ALTER TABLE driver_telemetry_events
  ADD CONSTRAINT driver_telemetry_events_event_kind_chk
  CHECK (event_kind IN (
    'ping',
    'shift_start',
    'shift_end',
    'status_change',
    'geofence_enter',
    'geofence_exit',
    'low_battery',
    'manual'
  ));

ALTER TABLE driver_telemetry_events
  DROP CONSTRAINT IF EXISTS driver_telemetry_events_lat_range;
ALTER TABLE driver_telemetry_events
  ADD CONSTRAINT driver_telemetry_events_lat_range
  CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90));

ALTER TABLE driver_telemetry_events
  DROP CONSTRAINT IF EXISTS driver_telemetry_events_lng_range;
ALTER TABLE driver_telemetry_events
  ADD CONSTRAINT driver_telemetry_events_lng_range
  CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180));

ALTER TABLE driver_telemetry_events
  DROP CONSTRAINT IF EXISTS driver_telemetry_events_battery_pct_range;
ALTER TABLE driver_telemetry_events
  ADD CONSTRAINT driver_telemetry_events_battery_pct_range
  CHECK (battery_pct IS NULL OR (battery_pct >= 0 AND battery_pct <= 100));

ALTER TABLE driver_telemetry_events
  DROP CONSTRAINT IF EXISTS driver_telemetry_events_heading_range;
ALTER TABLE driver_telemetry_events
  ADD CONSTRAINT driver_telemetry_events_heading_range
  CHECK (heading_degrees IS NULL OR (heading_degrees >= 0 AND heading_degrees < 360));

-- Primary read paths: (a) "last N positions for driver", (b) "what was
-- driver X doing at time T", (c) "all positions during job Z". A
-- composite (tenant, driver, recorded_at DESC) index serves the first
-- two; (tenant, job, recorded_at) the third. No created_at index — a
-- hot append-only table doesn't need two timestamps indexed.
CREATE INDEX IF NOT EXISTS dte_tenant_driver_recorded_idx
  ON driver_telemetry_events (tenant_id, driver_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS dte_tenant_shift_recorded_idx
  ON driver_telemetry_events (tenant_id, shift_id, recorded_at DESC)
  WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS dte_tenant_job_recorded_idx
  ON driver_telemetry_events (tenant_id, job_id, recorded_at DESC)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS dte_tenant_event_kind_idx
  ON driver_telemetry_events (tenant_id, event_kind, recorded_at DESC)
  WHERE event_kind <> 'ping';

ALTER TABLE driver_telemetry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_telemetry_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_telemetry_events_tenant_isolation ON driver_telemetry_events;
CREATE POLICY driver_telemetry_events_tenant_isolation ON driver_telemetry_events
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- No audit trigger on driver_telemetry_events by design.


-- ---------------------------------------------------------------------
-- 6. job_evidence
-- ---------------------------------------------------------------------
-- Photo / video / signature attachments captured by drivers in the
-- field. The actual binary lives in S3; this table tracks the upload
-- record and serves as the audited handle.
--
-- kind values cover the spec's pickup/dropoff/damage walkaround flows
-- plus the customer signature capture and a generic 'other' escape
-- hatch. content_type / size_bytes are mirrored from the upload so the
-- API can validate without re-reading S3.
--
-- upload_status is the lifecycle of the upload itself, distinct from
-- the evidence's semantic meaning:
--   pending   — presigned URL issued, client uploading
--   uploaded  — S3 confirmed (HEAD ok)
--   failed    — gave up after retries

CREATE TABLE IF NOT EXISTS job_evidence (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id          uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  driver_id       uuid REFERENCES drivers(id) ON DELETE SET NULL,
  shift_id        uuid REFERENCES driver_shifts(id) ON DELETE SET NULL,
  kind            text NOT NULL,
  s3_key          text NOT NULL,
  content_type    text,
  size_bytes      bigint,
  width_px        integer,
  height_px       integer,
  duration_seconds numeric(8, 2),
  captured_at     timestamptz,
  upload_status   text NOT NULL DEFAULT 'pending',
  uploaded_at     timestamptz,
  failure_reason  text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE job_evidence
  DROP CONSTRAINT IF EXISTS job_evidence_kind_chk;
ALTER TABLE job_evidence
  ADD CONSTRAINT job_evidence_kind_chk
  CHECK (kind IN (
    'photo_pickup',
    'photo_dropoff',
    'photo_damage',
    'photo_hookup',
    'photo_release',
    'photo_other',
    'video_walkaround',
    'video_other',
    'signature_customer',
    'signature_driver',
    'document_scan',
    'other'
  ));

ALTER TABLE job_evidence
  DROP CONSTRAINT IF EXISTS job_evidence_upload_status_chk;
ALTER TABLE job_evidence
  ADD CONSTRAINT job_evidence_upload_status_chk
  CHECK (upload_status IN ('pending', 'uploaded', 'failed'));

ALTER TABLE job_evidence
  DROP CONSTRAINT IF EXISTS job_evidence_size_nonneg;
ALTER TABLE job_evidence
  ADD CONSTRAINT job_evidence_size_nonneg
  CHECK (size_bytes IS NULL OR size_bytes >= 0);

ALTER TABLE job_evidence
  DROP CONSTRAINT IF EXISTS job_evidence_s3_key_nonempty;
ALTER TABLE job_evidence
  ADD CONSTRAINT job_evidence_s3_key_nonempty
  CHECK (length(trim(s3_key)) > 0);

DROP INDEX IF EXISTS job_evidence_tenant_s3_key_unique;
CREATE UNIQUE INDEX job_evidence_tenant_s3_key_unique
  ON job_evidence (tenant_id, s3_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS job_evidence_tenant_job_created_idx
  ON job_evidence (tenant_id, job_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS job_evidence_tenant_driver_created_idx
  ON job_evidence (tenant_id, driver_id, created_at DESC)
  WHERE deleted_at IS NULL AND driver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_evidence_tenant_kind_idx
  ON job_evidence (tenant_id, kind, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS job_evidence_tenant_upload_status_idx
  ON job_evidence (tenant_id, upload_status)
  WHERE upload_status <> 'uploaded' AND deleted_at IS NULL;

ALTER TABLE job_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_evidence FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_evidence_tenant_isolation ON job_evidence;
CREATE POLICY job_evidence_tenant_isolation ON job_evidence
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- Cross-tenant consistency: the FK guarantees job_id is a real jobs row
-- but not that the row's tenant matches. RLS makes the foreign row
-- invisible to this trigger's SELECT, so an injection attempt fails on
-- "does not exist" or "does not match" — both reject the write.
CREATE OR REPLACE FUNCTION fn_job_evidence_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_job_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_job_tenant FROM jobs WHERE id = NEW.job_id;

  IF v_job_tenant IS NULL THEN
    RAISE EXCEPTION 'job_evidence: job_id % does not exist', NEW.job_id;
  END IF;

  IF v_job_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'job_evidence: tenant_id (%) does not match jobs.tenant_id (%)',
      NEW.tenant_id, v_job_tenant;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_je_tenant_consistency ON job_evidence;
CREATE TRIGGER trg_je_tenant_consistency
  BEFORE INSERT OR UPDATE ON job_evidence
  FOR EACH ROW EXECUTE FUNCTION fn_job_evidence_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_job_evidence ON job_evidence;
CREATE TRIGGER trg_audit_job_evidence
  AFTER INSERT OR UPDATE OR DELETE ON job_evidence
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE OR REPLACE FUNCTION fn_job_evidence_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_job_evidence_set_updated_at ON job_evidence;
CREATE TRIGGER trg_job_evidence_set_updated_at
  BEFORE UPDATE ON job_evidence
  FOR EACH ROW EXECUTE FUNCTION fn_job_evidence_set_updated_at();


-- ---------------------------------------------------------------------
-- 7. job_field_payments
-- ---------------------------------------------------------------------
-- Stripe Terminal payments captured by the driver on-scene. We keep a
-- dedicated table (rather than reusing the existing `payments` row used
-- by the office cashier and the Stripe Connect webhook flow) because
-- the field-payment lifecycle is its own animal: the driver creates an
-- intent on the phone, swipes/taps, captures (or fails), and the office
-- ledger picks the row up after the fact for invoice reconciliation.
-- Once the office reconciliation lands, the consolidation question is
-- a later-session call.

CREATE TABLE IF NOT EXISTS job_field_payments (
  id                            uuid PRIMARY KEY,
  tenant_id                     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id                        uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  driver_id                     uuid REFERENCES drivers(id) ON DELETE SET NULL,
  shift_id                      uuid REFERENCES driver_shifts(id) ON DELETE SET NULL,
  amount_cents                  bigint NOT NULL,
  tip_cents                     bigint NOT NULL DEFAULT 0,
  currency                      text NOT NULL DEFAULT 'usd',
  payment_method                text NOT NULL,
  stripe_payment_intent_id      text,
  stripe_terminal_reader_id     text,
  card_brand                    text,
  card_last4                    text,
  status                        text NOT NULL DEFAULT 'pending',
  authorized_at                 timestamptz,
  captured_at                   timestamptz,
  failed_at                     timestamptz,
  failure_reason                text,
  receipt_email                 text,
  receipt_url                   text,
  client_idempotency_key        text,
  notes                         text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  deleted_at                    timestamptz,
  created_by                    uuid REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE job_field_payments
  DROP CONSTRAINT IF EXISTS job_field_payments_amount_nonneg;
ALTER TABLE job_field_payments
  ADD CONSTRAINT job_field_payments_amount_nonneg
  CHECK (amount_cents >= 0);

ALTER TABLE job_field_payments
  DROP CONSTRAINT IF EXISTS job_field_payments_tip_nonneg;
ALTER TABLE job_field_payments
  ADD CONSTRAINT job_field_payments_tip_nonneg
  CHECK (tip_cents >= 0);

ALTER TABLE job_field_payments
  DROP CONSTRAINT IF EXISTS job_field_payments_payment_method_chk;
ALTER TABLE job_field_payments
  ADD CONSTRAINT job_field_payments_payment_method_chk
  CHECK (payment_method IN (
    'card_present_tap',
    'card_present_chip',
    'card_present_swipe',
    'card_present_manual',
    'cash',
    'check',
    'other'
  ));

ALTER TABLE job_field_payments
  DROP CONSTRAINT IF EXISTS job_field_payments_status_chk;
ALTER TABLE job_field_payments
  ADD CONSTRAINT job_field_payments_status_chk
  CHECK (status IN ('pending', 'authorized', 'captured', 'failed', 'refunded', 'canceled'));

-- One field-payment row per Stripe PI. Webhooks key off this in the
-- office reconciliation flow.
DROP INDEX IF EXISTS job_field_payments_stripe_pi_unique;
CREATE UNIQUE INDEX job_field_payments_stripe_pi_unique
  ON job_field_payments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- Client idempotency: drivers retrying a flaky tap shouldn't double-charge.
DROP INDEX IF EXISTS jfp_tenant_idempotency_unique;
CREATE UNIQUE INDEX jfp_tenant_idempotency_unique
  ON job_field_payments (tenant_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS jfp_tenant_job_created_idx
  ON job_field_payments (tenant_id, job_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS jfp_tenant_driver_created_idx
  ON job_field_payments (tenant_id, driver_id, created_at DESC)
  WHERE deleted_at IS NULL AND driver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS jfp_tenant_status_idx
  ON job_field_payments (tenant_id, status)
  WHERE deleted_at IS NULL;

ALTER TABLE job_field_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_field_payments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_field_payments_tenant_isolation ON job_field_payments;
CREATE POLICY job_field_payments_tenant_isolation ON job_field_payments
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- Same cross-tenant guard as job_evidence — job_id's tenant must match
-- the row's tenant_id.
CREATE OR REPLACE FUNCTION fn_job_field_payments_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_job_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_job_tenant FROM jobs WHERE id = NEW.job_id;

  IF v_job_tenant IS NULL THEN
    RAISE EXCEPTION 'job_field_payments: job_id % does not exist', NEW.job_id;
  END IF;

  IF v_job_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'job_field_payments: tenant_id (%) does not match jobs.tenant_id (%)',
      NEW.tenant_id, v_job_tenant;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_jfp_tenant_consistency ON job_field_payments;
CREATE TRIGGER trg_jfp_tenant_consistency
  BEFORE INSERT OR UPDATE ON job_field_payments
  FOR EACH ROW EXECUTE FUNCTION fn_job_field_payments_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_job_field_payments ON job_field_payments;
CREATE TRIGGER trg_audit_job_field_payments
  AFTER INSERT OR UPDATE OR DELETE ON job_field_payments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE OR REPLACE FUNCTION fn_job_field_payments_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_job_field_payments_set_updated_at ON job_field_payments;
CREATE TRIGGER trg_job_field_payments_set_updated_at
  BEFORE UPDATE ON job_field_payments
  FOR EACH ROW EXECUTE FUNCTION fn_job_field_payments_set_updated_at();


-- ---------------------------------------------------------------------
-- 8. driver_offline_actions
-- ---------------------------------------------------------------------
-- Server-side ledger of actions the driver app queued while offline and
-- replayed when reconnected. We store the raw payload so replay-failure
-- triage doesn't depend on client logs.
--
-- client_event_uuid is the idempotency key: the client generates one
-- per logical action and retries with the same UUID. A unique
-- (tenant_id, driver_id, client_event_uuid) makes "did this already
-- run" a single index lookup.
--
-- Append-only — once a row lands, status updates are the only mutation
-- and they're for the audit log to see, not for re-deriving truth.

CREATE TABLE IF NOT EXISTS driver_offline_actions (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  driver_id           uuid NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  job_id              uuid REFERENCES jobs(id) ON DELETE SET NULL,
  shift_id            uuid REFERENCES driver_shifts(id) ON DELETE SET NULL,
  action_kind         text NOT NULL,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_timestamp    timestamptz NOT NULL,
  client_event_uuid   uuid NOT NULL,
  status              text NOT NULL DEFAULT 'pending',
  applied_at          timestamptz,
  failed_at           timestamptz,
  failure_reason      text,
  attempt_count       integer NOT NULL DEFAULT 0,
  received_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE driver_offline_actions
  DROP CONSTRAINT IF EXISTS driver_offline_actions_status_chk;
ALTER TABLE driver_offline_actions
  ADD CONSTRAINT driver_offline_actions_status_chk
  CHECK (status IN ('pending', 'applied', 'failed', 'skipped'));

ALTER TABLE driver_offline_actions
  DROP CONSTRAINT IF EXISTS driver_offline_actions_action_kind_nonempty;
ALTER TABLE driver_offline_actions
  ADD CONSTRAINT driver_offline_actions_action_kind_nonempty
  CHECK (length(trim(action_kind)) > 0);

ALTER TABLE driver_offline_actions
  DROP CONSTRAINT IF EXISTS driver_offline_actions_attempt_count_nonneg;
ALTER TABLE driver_offline_actions
  ADD CONSTRAINT driver_offline_actions_attempt_count_nonneg
  CHECK (attempt_count >= 0);

DROP INDEX IF EXISTS doa_tenant_driver_client_event_unique;
CREATE UNIQUE INDEX doa_tenant_driver_client_event_unique
  ON driver_offline_actions (tenant_id, driver_id, client_event_uuid);

CREATE INDEX IF NOT EXISTS doa_tenant_driver_received_idx
  ON driver_offline_actions (tenant_id, driver_id, received_at DESC);

CREATE INDEX IF NOT EXISTS doa_tenant_status_received_idx
  ON driver_offline_actions (tenant_id, status, received_at DESC)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS doa_tenant_job_idx
  ON driver_offline_actions (tenant_id, job_id)
  WHERE job_id IS NOT NULL;

ALTER TABLE driver_offline_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_offline_actions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_offline_actions_tenant_isolation ON driver_offline_actions;
CREATE POLICY driver_offline_actions_tenant_isolation ON driver_offline_actions
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_driver_offline_actions ON driver_offline_actions;
CREATE TRIGGER trg_audit_driver_offline_actions
  AFTER INSERT OR UPDATE OR DELETE ON driver_offline_actions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
