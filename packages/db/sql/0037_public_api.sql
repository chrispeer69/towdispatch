-- =====================================================================
-- 0037_public_api.sql  (Public REST API + Webhooks — Session 29)
--
-- The tenant-facing programmable surface: API keys (Bearer auth for the
-- /v1 REST API), webhook endpoints, the delivery ledger, and an
-- idempotency-replay cache for writes.
--
-- Tables added:
--   1. api_keys                     — Bearer credentials (prefix + SHA-256 hash)
--   2. webhook_endpoints            — tenant HTTPS sinks (AES-GCM signing secret)
--   3. webhook_deliveries           — per-(event,endpoint) attempt ledger
--   4. public_api_idempotency_keys  — write-replay cache (Idempotency-Key)
--
-- Patterns followed (match 0036_impound_storage.sql):
--   * Every table: tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE RESTRICT.
--   * Every table: ENABLE + FORCE ROW LEVEL SECURITY, policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * Audit trigger fn_audit_log() on every table.
--   * Idempotent: CREATE ... IF NOT EXISTS, DROP ... IF EXISTS guards.
--   * Soft delete (deleted_at timestamptz) everywhere.
--   * Cross-tenant consistency BEFORE-trigger on child tables (deliveries,
--     idempotency keys) so a foreign parent id surfaces as "does not exist".
--   * One shared BEFORE UPDATE updated_at trigger function across all four.
--
-- Down (rollback):
--   DROP TABLE IF EXISTS public_api_idempotency_keys;
--   DROP TABLE IF EXISTS webhook_deliveries;
--   DROP TABLE IF EXISTS webhook_endpoints;
--   DROP TABLE IF EXISTS api_keys;
--   DROP FUNCTION IF EXISTS fn_public_api_child_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_public_api_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_public_api_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Generic parent-tenant consistency guard. The child row names its parent
-- via a column whose name varies (endpoint_id / api_key_id); each trigger
-- passes the parent table + column as arguments so one function serves all
-- children. RLS hides foreign parents, so a cross-tenant parent id surfaces
-- as "does not exist".
CREATE OR REPLACE FUNCTION fn_public_api_child_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_table text := TG_ARGV[0];
  v_parent_col   text := TG_ARGV[1];
  v_parent_id    uuid;
  v_parent_tenant uuid;
BEGIN
  -- Read the (dynamically-named) parent id off the row via jsonb — the same
  -- bulletproof idiom fn_audit_log() uses — rather than dynamic composite-type
  -- field access, which can lose the row type under EXECUTE ... USING NEW.
  v_parent_id := (to_jsonb(NEW)->>v_parent_col)::uuid;
  EXECUTE format('SELECT tenant_id FROM %I WHERE id = $1', v_parent_table)
    INTO v_parent_tenant USING v_parent_id;

  IF v_parent_tenant IS NULL THEN
    RAISE EXCEPTION 'public_api child: %.% % does not exist',
      v_parent_table, v_parent_col, v_parent_id;
  END IF;

  IF v_parent_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'public_api child: tenant_id (%) does not match %.tenant_id (%)',
      NEW.tenant_id, v_parent_table, v_parent_tenant;
  END IF;

  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. api_keys
-- ---------------------------------------------------------------------
-- Bearer credentials for the /v1 REST API. The full key (tc_live_<prefix>_
-- <secret>) is shown once at creation; we keep only the public prefix (for
-- lookup + display) and a SHA-256 hash of the whole key. created_by is NOT
-- NULL — a key is always minted by an authenticated operator, who becomes
-- the audit actor for every write made with the key.

CREATE TABLE IF NOT EXISTS api_keys (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name               text NOT NULL,
  prefix             text NOT NULL,
  key_hash           text NOT NULL,
  scopes             jsonb NOT NULL DEFAULT '[]'::jsonb,
  rate_limit_per_min integer NOT NULL DEFAULT 60,
  created_by         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  last_used_at       timestamptz,
  expires_at         timestamptz,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_name_nonempty;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_name_nonempty
  CHECK (length(trim(name)) > 0);

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_prefix_nonempty;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_prefix_nonempty
  CHECK (length(trim(prefix)) > 0);

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_scopes_is_array;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_scopes_is_array
  CHECK (jsonb_typeof(scopes) = 'array');

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_rate_limit_positive;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_rate_limit_positive
  CHECK (rate_limit_per_min > 0);

-- The prefix is the global lookup handle on every authenticated request.
DROP INDEX IF EXISTS api_keys_prefix_unique;
CREATE UNIQUE INDEX api_keys_prefix_unique
  ON api_keys (prefix)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS api_keys_tenant_idx
  ON api_keys (tenant_id)
  WHERE deleted_at IS NULL;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_keys_tenant_isolation ON api_keys;
CREATE POLICY api_keys_tenant_isolation ON api_keys
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_api_keys ON api_keys;
CREATE TRIGGER trg_audit_api_keys
  AFTER INSERT OR UPDATE OR DELETE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_api_keys_set_updated_at ON api_keys;
CREATE TRIGGER trg_api_keys_set_updated_at
  BEFORE UPDATE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION fn_public_api_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. webhook_endpoints
-- ---------------------------------------------------------------------
-- Tenant-registered HTTPS sinks. secret_encrypted is the per-endpoint
-- signing secret, AES-256-GCM-encrypted at rest (the worker decrypts it to
-- HMAC-sign each delivery). events is the subscription filter.

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  url              text NOT NULL,
  description      text,
  secret_encrypted text NOT NULL,
  events           text[] NOT NULL DEFAULT '{}',
  active           boolean NOT NULL DEFAULT true,
  created_by       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  last_success_at  timestamptz,
  last_failure_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

ALTER TABLE webhook_endpoints DROP CONSTRAINT IF EXISTS webhook_endpoints_url_https;
ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoints_url_https
  CHECK (url ~* '^https://');

CREATE INDEX IF NOT EXISTS webhook_endpoints_tenant_idx
  ON webhook_endpoints (tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS webhook_endpoints_tenant_active_idx
  ON webhook_endpoints (tenant_id, active)
  WHERE deleted_at IS NULL;

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_endpoints_tenant_isolation ON webhook_endpoints;
CREATE POLICY webhook_endpoints_tenant_isolation ON webhook_endpoints
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_webhook_endpoints ON webhook_endpoints;
CREATE TRIGGER trg_audit_webhook_endpoints
  AFTER INSERT OR UPDATE OR DELETE ON webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_webhook_endpoints_set_updated_at ON webhook_endpoints;
CREATE TRIGGER trg_webhook_endpoints_set_updated_at
  BEFORE UPDATE ON webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION fn_public_api_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. webhook_deliveries
-- ---------------------------------------------------------------------
-- One row per (event, endpoint) attempt set. The cron sweeps status='pending'
-- rows whose next_retry_at has passed. id doubles as the consumer-facing
-- idempotency key (payload.id + X-TowCommand-Delivery-Id header).

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  endpoint_id   uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type    text NOT NULL,
  event_id      uuid,
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'pending',
  attempt       integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5,
  next_retry_at timestamptz,
  response_code integer,
  response_body text,
  last_error    text,
  delivered_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- The S29 status vocabulary ('pending'/'delivering'/'delivered'/'failed')
-- differs from the Session 15 notifications module, which shares this physical
-- table name (created first by drizzle/0011_notifications.sql) but uses the
-- 'queued'/'sent'/'bounced'/... vocabulary with a 'queued' default. Apply the
-- S29 CHECK only when this is genuinely the S29 table (endpoint_id present).
-- On the notifications-shaped table the ADD CONSTRAINT would be validated
-- against existing rows (status='queued') and crash the migration → boot loop.
-- NOTE: `status` is shared by both shapes, so — unlike the other guarded
-- blocks below — this one keys on endpoint_id (an S29-only column) rather than
-- on the column it references.
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_deliveries' AND column_name = 'endpoint_id') THEN
  ALTER TABLE webhook_deliveries DROP CONSTRAINT IF EXISTS webhook_deliveries_status_chk;
  ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_status_chk
    CHECK (status IN ('pending', 'delivering', 'delivered', 'failed'));
END IF;
END $$;

-- Constraint only applies if the "attempt" column exists (S29 schema).
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_deliveries' AND column_name = 'attempt') THEN
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_attempt_nonneg
  CHECK (attempt >= 0 AND attempt <= max_attempts);
END IF;
END $$;
-- Indexes only apply if S29 schema columns exist (endpoint_id, deleted_at).
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_deliveries' AND column_name = 'endpoint_id') THEN
  EXECUTE 'CREATE INDEX IF NOT EXISTS webhook_deliveries_tenant_endpoint_idx ON webhook_deliveries (tenant_id, endpoint_id, created_at) WHERE deleted_at IS NULL';
  EXECUTE 'CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx ON webhook_deliveries (next_retry_at) WHERE status = ''pending'' AND deleted_at IS NULL';
END IF;
END $$;

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_deliveries_tenant_isolation ON webhook_deliveries;
CREATE POLICY webhook_deliveries_tenant_isolation ON webhook_deliveries
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- Trigger only applies if S29 schema (endpoint_id FK to webhook_endpoints)
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_deliveries' AND column_name = 'endpoint_id') THEN
  DROP TRIGGER IF EXISTS trg_webhook_deliveries_tenant_consistency ON webhook_deliveries;
  CREATE TRIGGER trg_webhook_deliveries_tenant_consistency
    BEFORE INSERT OR UPDATE ON webhook_deliveries
    FOR EACH ROW EXECUTE FUNCTION
      fn_public_api_child_tenant_consistency('webhook_endpoints', 'endpoint_id');
END IF;
END $$;

DROP TRIGGER IF EXISTS trg_audit_webhook_deliveries ON webhook_deliveries;
CREATE TRIGGER trg_audit_webhook_deliveries
  AFTER INSERT OR UPDATE OR DELETE ON webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- updated_at trigger only if fn_public_api_set_updated_at exists
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_public_api_set_updated_at') THEN
  DROP TRIGGER IF EXISTS trg_webhook_deliveries_set_updated_at ON webhook_deliveries;
  CREATE TRIGGER trg_webhook_deliveries_set_updated_at
    BEFORE UPDATE ON webhook_deliveries
    FOR EACH ROW EXECUTE FUNCTION fn_public_api_set_updated_at();
END IF;
END $$;


-- ---------------------------------------------------------------------
-- 4. public_api_idempotency_keys
-- ---------------------------------------------------------------------
-- Write-replay cache. A repeat Idempotency-Key with the same request
-- fingerprint replays the stored response; a different fingerprint is a 409.

CREATE TABLE IF NOT EXISTS public_api_idempotency_keys (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  api_key_id          uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  idempotency_key     text NOT NULL,
  request_fingerprint text NOT NULL,
  response_status     integer NOT NULL,
  response_body       jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE public_api_idempotency_keys DROP CONSTRAINT IF EXISTS public_api_idempotency_key_nonempty;
ALTER TABLE public_api_idempotency_keys ADD CONSTRAINT public_api_idempotency_key_nonempty
  CHECK (length(trim(idempotency_key)) > 0);

-- One live row per (tenant, key) — the replay anchor.
DROP INDEX IF EXISTS public_api_idempotency_tenant_key_unique;
CREATE UNIQUE INDEX public_api_idempotency_tenant_key_unique
  ON public_api_idempotency_keys (tenant_id, idempotency_key)
  WHERE deleted_at IS NULL;

ALTER TABLE public_api_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_api_idempotency_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_api_idempotency_keys_tenant_isolation ON public_api_idempotency_keys;
CREATE POLICY public_api_idempotency_keys_tenant_isolation ON public_api_idempotency_keys
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_public_api_idempotency_tenant_consistency ON public_api_idempotency_keys;
CREATE TRIGGER trg_public_api_idempotency_tenant_consistency
  BEFORE INSERT OR UPDATE ON public_api_idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION
    fn_public_api_child_tenant_consistency('api_keys', 'api_key_id');

DROP TRIGGER IF EXISTS trg_audit_public_api_idempotency_keys ON public_api_idempotency_keys;
CREATE TRIGGER trg_audit_public_api_idempotency_keys
  AFTER INSERT OR UPDATE OR DELETE ON public_api_idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_public_api_idempotency_set_updated_at ON public_api_idempotency_keys;
CREATE TRIGGER trg_public_api_idempotency_set_updated_at
  BEFORE UPDATE ON public_api_idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION fn_public_api_set_updated_at();
