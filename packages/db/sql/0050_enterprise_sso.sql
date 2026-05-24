-- =====================================================================
-- 0050_enterprise_sso.sql  (Enterprise SSO — Session 38)
--
-- Additive enterprise identity layer: per-tenant SAML 2.0 / OIDC login
-- connections, SCIM 2.0 provisioning tokens + group mirrors, and a
-- forensic login-audit trail. NONE of this replaces password auth — the
-- existing users/sessions/jwt path is untouched. An SSO login mints the
-- SAME access token shape (JwtService.signAccess) so there is no second
-- auth realm.
--
-- Tables added:
--   1. sso_connections    — one IdP binding per (tenant, provider)
--   2. scim_tokens        — bearer tokens for the SCIM 2.0 surface
--   3. sso_login_audit    — append-only login outcome trail
--   4. scim_groups        — SCIM Group mirror (per tenant)
--   5. scim_group_members — group membership (group <-> user)
--
-- users table (additive, nullable — no behavior change for non-SSO rows):
--   * external_id        — the IdP-assigned externalId (SCIM idempotency)
--   * sso_connection_id  — the connection that provisioned the row
--   plus a partial unique index for SCIM re-POST idempotency.
--
-- Patterns followed (match 0036_impound_storage.sql):
--   * Every tenant table: tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE RESTRICT.
--   * ENABLE + FORCE ROW LEVEL SECURITY; policy USING/WITH CHECK
--     (tenant_id = fn_current_tenant_id()).
--   * Audit trigger fn_audit_log() on every state-changing table
--     (sso_login_audit is itself an audit trail — no second audit on it).
--   * Idempotent: CREATE ... IF NOT EXISTS, DROP ... IF EXISTS before
--     every constraint / policy / trigger / index.
--   * Soft delete (deleted_at) on the long-lived config tables.
--   * Cross-tenant consistency BEFORE-trigger on child tables: the FK
--     guarantees the parent exists but not that its tenant_id matches.
--     RLS hides foreign parents from the trigger SELECT, so a foreign-id
--     injection fails "does not exist".
--   * One shared BEFORE UPDATE updated_at trigger reused across tables.
--
-- Down (rollback):
--   ALTER TABLE users DROP COLUMN IF EXISTS sso_connection_id;
--   ALTER TABLE users DROP COLUMN IF EXISTS external_id;
--   DROP TABLE IF EXISTS scim_group_members;
--   DROP TABLE IF EXISTS scim_groups;
--   DROP TABLE IF EXISTS sso_login_audit;
--   DROP TABLE IF EXISTS scim_tokens;
--   DROP TABLE IF EXISTS sso_connections;
--   DROP FUNCTION IF EXISTS fn_sso_child_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_sso_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper, reused by every SSO config table.
CREATE OR REPLACE FUNCTION fn_sso_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Tenant-consistency guard for child tables that reference a
-- sso_connections row. Verifies the connection's tenant_id matches the
-- child row's tenant_id. RLS hides foreign connections, so a cross-tenant
-- connection_id surfaces as "does not exist".
CREATE OR REPLACE FUNCTION fn_sso_connection_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_conn_tenant uuid;
BEGIN
  IF NEW.connection_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT tenant_id INTO v_conn_tenant
  FROM sso_connections WHERE id = NEW.connection_id;
  IF v_conn_tenant IS NULL THEN
    RAISE EXCEPTION 'sso child: connection_id % does not exist', NEW.connection_id;
  END IF;
  IF v_conn_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'sso child: tenant_id (%) does not match sso_connections.tenant_id (%)',
      NEW.tenant_id, v_conn_tenant;
  END IF;
  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. sso_connections
-- ---------------------------------------------------------------------
-- One IdP binding per (tenant, provider). `provider` selects SAML vs OIDC.
-- SAML uses x509_cert (pinned signing cert — NO metadata trust-on-first-
-- use), sso_url (IdP SSO entryPoint) and slo_url. OIDC uses issuer
-- (discovery base), oidc_client_id and oidc_client_secret_encrypted
-- (AES-256-GCM at rest). attribute_mapping maps IdP claim names onto our
-- {email,firstName,lastName,role} fields. default_role is the role a
-- JIT-provisioned user receives. `enabled` is the per-connection switch;
-- the env gate (ENTERPRISE_SSO_ENABLED / _TENANTS) is the global one.

CREATE TABLE IF NOT EXISTS sso_connections (
  id                            uuid PRIMARY KEY,
  tenant_id                     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  provider                      text NOT NULL,
  display_name                  text NOT NULL,
  issuer                        text,
  metadata_url                  text,
  x509_cert                     text,
  sso_url                       text,
  slo_url                       text,
  audience                      text,
  oidc_client_id                text,
  oidc_client_secret_encrypted  text,
  oidc_scopes                   text NOT NULL DEFAULT 'openid email profile',
  attribute_mapping             jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_role                  text NOT NULL DEFAULT 'dispatcher',
  enabled                       boolean NOT NULL DEFAULT false,
  created_by                    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  deleted_at                    timestamptz
);

ALTER TABLE sso_connections DROP CONSTRAINT IF EXISTS sso_connections_provider_chk;
ALTER TABLE sso_connections ADD CONSTRAINT sso_connections_provider_chk
  CHECK (provider IN ('saml', 'oidc'));

ALTER TABLE sso_connections DROP CONSTRAINT IF EXISTS sso_connections_display_name_nonempty;
ALTER TABLE sso_connections ADD CONSTRAINT sso_connections_display_name_nonempty
  CHECK (length(trim(display_name)) > 0);

ALTER TABLE sso_connections DROP CONSTRAINT IF EXISTS sso_connections_default_role_chk;
ALTER TABLE sso_connections ADD CONSTRAINT sso_connections_default_role_chk
  CHECK (default_role IN ('owner','admin','manager','dispatcher','driver','accounting','auditor'));

-- At most one live connection per (tenant, provider): a tenant may run one
-- SAML + one OIDC binding simultaneously, never two of a kind.
DROP INDEX IF EXISTS sso_connections_tenant_provider_unique;
CREATE UNIQUE INDEX sso_connections_tenant_provider_unique
  ON sso_connections (tenant_id, provider)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS sso_connections_tenant_enabled_idx
  ON sso_connections (tenant_id, enabled)
  WHERE deleted_at IS NULL;

ALTER TABLE sso_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_connections FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sso_connections_tenant_isolation ON sso_connections;
CREATE POLICY sso_connections_tenant_isolation ON sso_connections
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_sso_connections ON sso_connections;
CREATE TRIGGER trg_audit_sso_connections
  AFTER INSERT OR UPDATE OR DELETE ON sso_connections
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_sso_connections_set_updated_at ON sso_connections;
CREATE TRIGGER trg_sso_connections_set_updated_at
  BEFORE UPDATE ON sso_connections
  FOR EACH ROW EXECUTE FUNCTION fn_sso_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. scim_tokens
-- ---------------------------------------------------------------------
-- Bearer tokens for the SCIM 2.0 surface. The plaintext is shown once at
-- mint; only sha256(plain) is stored (token_hash), mirroring the
-- one-shot email/reset token pattern (high-entropy random => SHA is
-- sufficient, no argon2). token_prefix is the human-readable first chunk
-- for the admin list. Lookup is by globally-unique token_hash via the
-- admin pool (RLS-bypassing) since the SCIM request arrives with no
-- tenant context — the hash resolves the tenant.

CREATE TABLE IF NOT EXISTS scim_tokens (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  connection_id uuid REFERENCES sso_connections(id) ON DELETE SET NULL,
  name          text NOT NULL,
  token_hash    text NOT NULL,
  token_prefix  text NOT NULL,
  scopes        jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

ALTER TABLE scim_tokens DROP CONSTRAINT IF EXISTS scim_tokens_name_nonempty;
ALTER TABLE scim_tokens ADD CONSTRAINT scim_tokens_name_nonempty
  CHECK (length(trim(name)) > 0);

-- Idempotency / collision guard: a SCIM token hash is globally unique
-- among live, non-revoked rows.
DROP INDEX IF EXISTS scim_tokens_token_hash_unique;
CREATE UNIQUE INDEX scim_tokens_token_hash_unique
  ON scim_tokens (token_hash)
  WHERE deleted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS scim_tokens_tenant_idx
  ON scim_tokens (tenant_id)
  WHERE deleted_at IS NULL;

ALTER TABLE scim_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE scim_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scim_tokens_tenant_isolation ON scim_tokens;
CREATE POLICY scim_tokens_tenant_isolation ON scim_tokens
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_scim_tokens_tenant_consistency ON scim_tokens;
CREATE TRIGGER trg_scim_tokens_tenant_consistency
  BEFORE INSERT OR UPDATE ON scim_tokens
  FOR EACH ROW EXECUTE FUNCTION fn_sso_connection_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_scim_tokens ON scim_tokens;
CREATE TRIGGER trg_audit_scim_tokens
  AFTER INSERT OR UPDATE OR DELETE ON scim_tokens
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_scim_tokens_set_updated_at ON scim_tokens;
CREATE TRIGGER trg_scim_tokens_set_updated_at
  BEFORE UPDATE ON scim_tokens
  FOR EACH ROW EXECUTE FUNCTION fn_sso_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. sso_login_audit
-- ---------------------------------------------------------------------
-- Append-only forensic trail of every SSO login attempt. user_id is
-- nullable (a failed/denied attempt may never resolve to a user).
-- subject captures the IdP nameID/sub even when no user matched. This
-- table IS the audit record, so it carries no fn_audit_log trigger and
-- no soft-delete — rows are immutable history.

CREATE TABLE IF NOT EXISTS sso_login_audit (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  connection_id   uuid REFERENCES sso_connections(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  provider        text,
  outcome         text NOT NULL,
  failure_reason  text,
  subject         text,
  ip              text,
  user_agent      text,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sso_login_audit DROP CONSTRAINT IF EXISTS sso_login_audit_outcome_chk;
ALTER TABLE sso_login_audit ADD CONSTRAINT sso_login_audit_outcome_chk
  CHECK (outcome IN ('success', 'fail', 'denied'));

ALTER TABLE sso_login_audit DROP CONSTRAINT IF EXISTS sso_login_audit_provider_chk;
ALTER TABLE sso_login_audit ADD CONSTRAINT sso_login_audit_provider_chk
  CHECK (provider IS NULL OR provider IN ('saml', 'oidc'));

CREATE INDEX IF NOT EXISTS sso_login_audit_tenant_time_idx
  ON sso_login_audit (tenant_id, occurred_at DESC);

ALTER TABLE sso_login_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_login_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sso_login_audit_tenant_isolation ON sso_login_audit;
CREATE POLICY sso_login_audit_tenant_isolation ON sso_login_audit
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_sso_login_audit_tenant_consistency ON sso_login_audit;
CREATE TRIGGER trg_sso_login_audit_tenant_consistency
  BEFORE INSERT OR UPDATE ON sso_login_audit
  FOR EACH ROW EXECUTE FUNCTION fn_sso_connection_tenant_consistency();


-- ---------------------------------------------------------------------
-- 4. scim_groups
-- ---------------------------------------------------------------------
-- SCIM 2.0 Group mirror. external_id is the IdP-assigned id (idempotency
-- anchor for re-POST). display_name is unique per tenant among live rows.

CREATE TABLE IF NOT EXISTS scim_groups (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  connection_id uuid REFERENCES sso_connections(id) ON DELETE SET NULL,
  external_id   text,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

ALTER TABLE scim_groups DROP CONSTRAINT IF EXISTS scim_groups_display_name_nonempty;
ALTER TABLE scim_groups ADD CONSTRAINT scim_groups_display_name_nonempty
  CHECK (length(trim(display_name)) > 0);

-- Re-POST idempotency: one live group per (tenant, externalId).
DROP INDEX IF EXISTS scim_groups_tenant_external_unique;
CREATE UNIQUE INDEX scim_groups_tenant_external_unique
  ON scim_groups (tenant_id, external_id)
  WHERE deleted_at IS NULL AND external_id IS NOT NULL;

DROP INDEX IF EXISTS scim_groups_tenant_displayname_unique;
CREATE UNIQUE INDEX scim_groups_tenant_displayname_unique
  ON scim_groups (tenant_id, lower(display_name))
  WHERE deleted_at IS NULL;

ALTER TABLE scim_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE scim_groups FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scim_groups_tenant_isolation ON scim_groups;
CREATE POLICY scim_groups_tenant_isolation ON scim_groups
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_scim_groups_tenant_consistency ON scim_groups;
CREATE TRIGGER trg_scim_groups_tenant_consistency
  BEFORE INSERT OR UPDATE ON scim_groups
  FOR EACH ROW EXECUTE FUNCTION fn_sso_connection_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_scim_groups ON scim_groups;
CREATE TRIGGER trg_audit_scim_groups
  AFTER INSERT OR UPDATE OR DELETE ON scim_groups
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_scim_groups_set_updated_at ON scim_groups;
CREATE TRIGGER trg_scim_groups_set_updated_at
  BEFORE UPDATE ON scim_groups
  FOR EACH ROW EXECUTE FUNCTION fn_sso_set_updated_at();


-- ---------------------------------------------------------------------
-- 5. scim_group_members
-- ---------------------------------------------------------------------
-- Membership edges. Both the group and the user must belong to the same
-- tenant as the edge — enforced by fn_scim_group_member_tenant_consistency
-- (the connection-consistency helper does not cover group_id/user_id).

CREATE TABLE IF NOT EXISTS scim_group_members (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  group_id    uuid NOT NULL REFERENCES scim_groups(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One membership edge per (group, user).
DROP INDEX IF EXISTS scim_group_members_group_user_unique;
CREATE UNIQUE INDEX scim_group_members_group_user_unique
  ON scim_group_members (group_id, user_id);

CREATE INDEX IF NOT EXISTS scim_group_members_tenant_group_idx
  ON scim_group_members (tenant_id, group_id);

ALTER TABLE scim_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE scim_group_members FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scim_group_members_tenant_isolation ON scim_group_members;
CREATE POLICY scim_group_members_tenant_isolation ON scim_group_members
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

CREATE OR REPLACE FUNCTION fn_scim_group_member_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_group_tenant uuid;
  v_user_tenant  uuid;
BEGIN
  SELECT tenant_id INTO v_group_tenant FROM scim_groups WHERE id = NEW.group_id;
  IF v_group_tenant IS NULL THEN
    RAISE EXCEPTION 'scim_group_members: group_id % does not exist', NEW.group_id;
  END IF;
  IF v_group_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'scim_group_members: tenant_id (%) does not match scim_groups.tenant_id (%)',
      NEW.tenant_id, v_group_tenant;
  END IF;

  SELECT tenant_id INTO v_user_tenant FROM users WHERE id = NEW.user_id;
  IF v_user_tenant IS NULL THEN
    RAISE EXCEPTION 'scim_group_members: user_id % does not exist', NEW.user_id;
  END IF;
  IF v_user_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'scim_group_members: tenant_id (%) does not match users.tenant_id (%)',
      NEW.tenant_id, v_user_tenant;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_scim_group_members_tenant_consistency ON scim_group_members;
CREATE TRIGGER trg_scim_group_members_tenant_consistency
  BEFORE INSERT OR UPDATE ON scim_group_members
  FOR EACH ROW EXECUTE FUNCTION fn_scim_group_member_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_scim_group_members ON scim_group_members;
CREATE TRIGGER trg_audit_scim_group_members
  AFTER INSERT OR UPDATE OR DELETE ON scim_group_members
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();


-- ---------------------------------------------------------------------
-- 6. users — additive SCIM provisioning columns
-- ---------------------------------------------------------------------
-- Nullable, default NULL — every existing row is unaffected and the
-- password-auth path never reads these. external_id is the IdP-assigned
-- SCIM externalId; sso_connection_id ties the row to the connection that
-- provisioned it. Both are set only by the SCIM service, which runs
-- inside the resolved tenant's RLS context — so cross-tenant consistency
-- is guaranteed by construction (no extra trigger on the core table).

ALTER TABLE users ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_connection_id uuid
  REFERENCES sso_connections(id) ON DELETE SET NULL;

-- SCIM re-POST idempotency: one live user per (tenant, connection,
-- externalId). Partial so the millions of password users (NULL
-- external_id) are exempt.
DROP INDEX IF EXISTS users_tenant_connection_external_unique;
CREATE UNIQUE INDEX users_tenant_connection_external_unique
  ON users (tenant_id, sso_connection_id, external_id)
  WHERE deleted_at IS NULL AND external_id IS NOT NULL;
