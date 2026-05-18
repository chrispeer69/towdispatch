-- Migration 0033 — Driver Experience tables
--
-- Foundation for the in-truck driver application (web today, mobile next).
-- Eight new tables, all multi-tenant + RLS-isolated + audit-triggered.
--
-- Tables introduced:
--   driver_pins                       — bcrypt 4-digit PIN credentials
--   driver_daily_briefings            — admin-authored daily message + video URL per tenant
--   driver_briefing_acknowledgments   — per-driver-per-day record of "read + viewed"
--   driver_pretrip_inspections        — DVIR records (vehicle inspection forms)
--   driver_telemetry_events           — high-frequency GPS + status pings (write-heavy)
--   job_evidence                      — photo + video + signature attachments per job
--   job_field_payments                — Stripe Terminal payment-intent records
--   driver_offline_actions            — server-side ledger of offline-queued actions for audit
--
-- Idempotent: every CREATE TABLE uses IF NOT EXISTS, every CREATE POLICY is
-- preceded by DROP POLICY IF EXISTS, every CREATE TRIGGER is preceded by
-- DROP TRIGGER IF EXISTS.

-- =====================================================================
-- 1. driver_pins
-- =====================================================================
-- One row per driver. PIN is a bcrypt hash (cost 10) — never the raw 4 digits.
-- last_pin_attempt_at + failed_attempts gate brute-force; after 5 fails in
-- 15 minutes, the PIN auto-locks and a tenant admin must reset it.

CREATE TABLE IF NOT EXISTS driver_pins (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS driver_pins_driver_unique
  ON driver_pins (driver_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS driver_pins_tenant_idx
  ON driver_pins (tenant_id, driver_id) WHERE deleted_at IS NULL;

ALTER TABLE driver_pins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_pins_tenant_isolation ON driver_pins;
CREATE POLICY driver_pins_tenant_isolation ON driver_pins
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP TRIGGER IF EXISTS trg_audit_driver_pins ON driver_pins;
CREATE TRIGGER trg_audit_driver_pins
  AFTER INSERT OR UPDATE OR DELETE ON driver_pins
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- =====================================================================
-- 2. driver_daily_briefings
-- =====================================================================
-- A tenant has at most one ACTIVE briefing at a time (others are archived).
-- The active row is what every driver sees on first sign-in of the day.
-- Video URL is optional; some tenants may only want a text message.

CREATE TABLE IF NOT EXISTS driver_daily_briefings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  title text,
  message text NOT NULL,
  video_url text,
  video_min_duration_seconds integer NOT NULL DEFAULT 60,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Only one active briefing per tenant at a time
CREATE UNIQUE INDEX IF NOT EXISTS driver_daily_briefings_active_unique
  ON driver_daily_briefings (tenant_id) WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS driver_daily_briefings_tenant_idx
  ON driver_daily_briefings (tenant_id, created_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE driver_daily_briefings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_daily_briefings_tenant_isolation ON driver_daily_briefings;
CREATE POLICY driver_daily_briefings_tenant_isolation ON driver_daily_briefings
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP TRIGGER IF EXISTS trg_audit_driver_daily_briefings ON driver_daily_briefings;
CREATE TRIGGER trg_audit_driver_daily_briefings
  AFTER INSERT OR UPDATE OR DELETE ON driver_daily_briefings
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- =====================================================================
-- 3. driver_briefing_acknowledgments
-- =====================================================================
-- One row per (driver, briefing, calendar_date_local). Driver acknowledges
-- once per day; subsequent logins on the same day skip the briefing UI.

CREATE TABLE IF NOT EXISTS driver_briefing_acknowledgments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  briefing_id uuid NOT NULL REFERENCES driver_daily_briefings(id) ON DELETE RESTRICT,
  acknowledged_date date NOT NULL,
  message_read_at timestamptz NOT NULL,
  video_completed_at timestamptz,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS driver_briefing_ack_unique
  ON driver_briefing_acknowledgments (driver_id, briefing_id, acknowledged_date);
CREATE INDEX IF NOT EXISTS driver_briefing_ack_tenant_date_idx
  ON driver_briefing_acknowledgments (tenant_id, acknowledged_date DESC);

ALTER TABLE driver_briefing_acknowledgments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_briefing_ack_tenant_isolation ON driver_briefing_acknowledgments;
CREATE POLICY driver_briefing_ack_tenant_isolation ON driver_briefing_acknowledgments
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP TRIGGER IF EXISTS trg_audit_driver_briefing_ack ON driver_briefing_acknowledgments;
CREATE TRIGGER trg_audit_driver_briefing_ack
  AFTER INSERT OR UPDATE OR DELETE ON driver_briefing_acknowledgments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- =====================================================================
-- 4. driver_pretrip_inspections
-- =====================================================================
-- DVIR — Driver Vehicle Inspection Report. Submitted at shift start; a
-- failing inspection blocks shift creation until resolved. Items is a
-- JSONB array of { code, label, status, note?, photoUrl? }.

CREATE TABLE IF NOT EXISTS driver_pretrip_inspections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  truck_id uuid REFERENCES trucks(id) ON DELETE SET NULL,
  shift_id uuid REFERENCES driver_shifts(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pass', 'fail_safe_to_drive', 'fail_unsafe')),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  odometer_miles bigint,
  notes text,
  signature_data_url text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_pretrip_tenant_driver_idx
  ON driver_pretrip_inspections (tenant_id, driver_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS driver_pretrip_tenant_truck_idx
  ON driver_pretrip_inspections (tenant_id, truck_id, submitted_at DESC)
  WHERE truck_id IS NOT NULL;

ALTER TABLE driver_pretrip_inspections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_pretrip_tenant_isolation ON driver_pretrip_inspections;
CREATE POLICY driver_pretrip_tenant_isolation ON driver_pretrip_inspections
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP TRIGGER IF EXISTS trg_audit_driver_pretrip ON driver_pretrip_inspections;
CREATE TRIGGER trg_audit_driver_pretrip
  AFTER INSERT OR UPDATE OR DELETE ON driver_pretrip_inspections
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- =====================================================================
-- 5. driver_telemetry_events
-- =====================================================================
-- Append-only high-frequency telemetry. At 100k drivers × 10s GPS that's
-- 10k RPS sustained. Phase 1 writes directly to this table; Phase 2 will
-- introduce an async ingest pipeline (Redis Streams → bulk insert) and
-- keep this table as the durable archive.
--
-- No audit trigger here — too hot. The audit log captures higher-level
-- state changes; raw telemetry is its own audit.

CREATE TABLE IF NOT EXISTS driver_telemetry_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES driver_shifts(id) ON DELETE SET NULL,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL,
  lat numeric(10,7),
  lng numeric(10,7),
  speed_mph numeric(6,2),
  heading_degrees integer,
  accuracy_meters numeric(6,1),
  battery_pct integer,
  network_kind text,
  event_kind text NOT NULL DEFAULT 'gps_ping',
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_telemetry_tenant_driver_idx
  ON driver_telemetry_events (tenant_id, driver_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS driver_telemetry_shift_idx
  ON driver_telemetry_events (shift_id, recorded_at DESC) WHERE shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS driver_telemetry_job_idx
  ON driver_telemetry_events (job_id, recorded_at DESC) WHERE job_id IS NOT NULL;

ALTER TABLE driver_telemetry_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_telemetry_tenant_isolation ON driver_telemetry_events;
CREATE POLICY driver_telemetry_tenant_isolation ON driver_telemetry_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- =====================================================================
-- 6. job_evidence
-- =====================================================================
-- Photo / video / signature / BOL attachments per job. Stores S3 keys —
-- the actual binary lives in S3, never in PG. Captured by the driver
-- in-field; can also be uploaded by dispatch from the back office.

CREATE TABLE IF NOT EXISTS job_evidence (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN (
    'photo_pickup', 'photo_dropoff', 'photo_damage', 'photo_hookup',
    'photo_paperwork', 'video_walkaround', 'signature_customer',
    'signature_driver', 'document_bol', 'document_other'
  )),
  s3_key text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint,
  duration_seconds numeric(8,2),
  width_pixels integer,
  height_pixels integer,
  captured_lat numeric(10,7),
  captured_lng numeric(10,7),
  captured_at timestamptz,
  caption text,
  meta jsonb,
  upload_status text NOT NULL DEFAULT 'pending'
    CHECK (upload_status IN ('pending', 'uploaded', 'failed')),
  uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS job_evidence_tenant_job_idx
  ON job_evidence (tenant_id, job_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS job_evidence_tenant_driver_idx
  ON job_evidence (tenant_id, driver_id, created_at DESC)
  WHERE driver_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS job_evidence_pending_idx
  ON job_evidence (tenant_id, upload_status, created_at)
  WHERE upload_status = 'pending' AND deleted_at IS NULL;

ALTER TABLE job_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_evidence_tenant_isolation ON job_evidence;
CREATE POLICY job_evidence_tenant_isolation ON job_evidence
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP TRIGGER IF EXISTS trg_audit_job_evidence ON job_evidence;
CREATE TRIGGER trg_audit_job_evidence
  AFTER INSERT OR UPDATE OR DELETE ON job_evidence
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- Cross-tenant integrity: job_id must belong to the same tenant.
CREATE OR REPLACE FUNCTION fn_job_evidence_tenant_consistency()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF NEW.job_id IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant FROM jobs WHERE id = NEW.job_id;
    IF v_tenant IS NULL OR v_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'cross-tenant job in job_evidence' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_job_evidence_tenant_consistency ON job_evidence;
CREATE TRIGGER trg_job_evidence_tenant_consistency
  BEFORE INSERT OR UPDATE OF job_id, tenant_id ON job_evidence
  FOR EACH ROW EXECUTE FUNCTION fn_job_evidence_tenant_consistency();

-- =====================================================================
-- 7. job_field_payments
-- =====================================================================
-- Stripe Terminal payment intents for in-field card processing. Receives
-- webhook events to flip status. The platform's main invoices/payments
-- tables remain the source of truth for accrual; this table is the
-- field-capture-side record of the transaction.

CREATE TABLE IF NOT EXISTS job_field_payments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  tip_cents bigint NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  payment_method text NOT NULL
    CHECK (payment_method IN ('card_present_chip', 'card_present_tap', 'card_keyed', 'cash', 'check', 'apple_pay', 'google_pay')),
  stripe_payment_intent_id text,
  stripe_charge_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'authorized', 'captured', 'refunded', 'failed', 'cancelled', 'voided')),
  failure_reason text,
  captured_at timestamptz,
  refunded_at timestamptz,
  receipt_email text,
  receipt_phone text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS job_field_payments_tenant_job_idx
  ON job_field_payments (tenant_id, job_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS job_field_payments_stripe_pi_unique
  ON job_field_payments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

ALTER TABLE job_field_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_field_payments_tenant_isolation ON job_field_payments;
CREATE POLICY job_field_payments_tenant_isolation ON job_field_payments
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP TRIGGER IF EXISTS trg_audit_job_field_payments ON job_field_payments;
CREATE TRIGGER trg_audit_job_field_payments
  AFTER INSERT OR UPDATE OR DELETE ON job_field_payments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- =====================================================================
-- 8. driver_offline_actions
-- =====================================================================
-- When a driver was offline and queued status updates / photos / signatures
-- on the device, this table is the server-side record of what was actually
-- synced when service returned. Includes the original device-side timestamp
-- (before sync) and the server-receipt timestamp. Used for forensics and
-- conflict resolution when two offline-queued changes collide.

CREATE TABLE IF NOT EXISTS driver_offline_actions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  action_kind text NOT NULL,
  payload jsonb NOT NULL,
  client_timestamp timestamptz NOT NULL,
  client_event_uuid uuid NOT NULL,
  applied_at timestamptz,
  apply_error text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'failed', 'rejected_conflict')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS driver_offline_actions_event_unique
  ON driver_offline_actions (driver_id, client_event_uuid);
CREATE INDEX IF NOT EXISTS driver_offline_actions_tenant_idx
  ON driver_offline_actions (tenant_id, status, created_at DESC);

ALTER TABLE driver_offline_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS driver_offline_actions_tenant_isolation ON driver_offline_actions;
CREATE POLICY driver_offline_actions_tenant_isolation ON driver_offline_actions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP TRIGGER IF EXISTS trg_audit_driver_offline_actions ON driver_offline_actions;
CREATE TRIGGER trg_audit_driver_offline_actions
  AFTER INSERT OR UPDATE OR DELETE ON driver_offline_actions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
