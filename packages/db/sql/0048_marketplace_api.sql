-- =====================================================================
-- 0048_marketplace_api.sql  (Public Marketplace API — Session 46)
--
-- Third-party developer ecosystem: developers register apps, tenants install
-- them via an OAuth2 authorization-code-with-PKCE flow, and apps act on a
-- tenant's behalf within the granted scopes (never tenant-elevated).
--
-- Tables added:
--   GLOBAL reference (no tenant_id, no RLS, no audit trigger — app_user reads
--   via the 0002_roles.sql default-privilege GRANT; writes go through the
--   admin pool, exactly like ev_oem_procedures in 0042):
--     1. developer_accounts      — a person/company that builds apps.
--     2. marketplace_apps        — a listing owned by a developer.
--     5. marketplace_oauth_codes — short-lived single-use PKCE auth codes,
--          consumed by the public /oauth/token endpoint (no tenant context),
--          so admin-pool-only like stripe_events in 0014.
--
--   TENANT-scoped (FORCE RLS + audit trigger, matching 0046_voice_commands):
--     3. marketplace_app_installs — binds a tenant to an app + granted scopes
--          + hashed OAuth tokens. Soft delete + uninstall both supported.
--     4. marketplace_app_events   — append-only app-lifecycle log
--          (install/uninstall/reauth/scope_change/error); doubles as the
--          webhook delivery record.
--
-- Why global tables get NO fn_audit_log() trigger: that function fails closed
-- when it can't resolve a tenant_id (0004_audit_trigger.sql), so it CANNOT be
-- attached to a tenant-less table. The app catalog's lifecycle is captured in
-- marketplace_app_events instead. See SESSION_46_DECISIONS.md.
--
-- Down (rollback):
--   DROP TABLE IF EXISTS marketplace_app_events;
--   DROP TABLE IF EXISTS marketplace_app_installs;
--   DROP TABLE IF EXISTS marketplace_oauth_codes;
--   DROP TABLE IF EXISTS marketplace_apps;
--   DROP TABLE IF EXISTS developer_accounts;
--   DROP FUNCTION IF EXISTS fn_marketplace_install_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_marketplace_set_updated_at();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper for every marketplace table.
CREATE OR REPLACE FUNCTION fn_marketplace_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Tenant-consistency guard for installs: when installed_by_user_id is set it
-- must belong to the install's tenant. Unlike the RLS-hiding trick used on
-- app_user-written tables, this checks tenant_id directly so it also holds
-- when the row is written by the admin pool (token exchange) where RLS is
-- bypassed. The referenced app is GLOBAL, so there is nothing to check there.
CREATE OR REPLACE FUNCTION fn_marketplace_install_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_tenant uuid;
BEGIN
  IF NEW.installed_by_user_id IS NOT NULL THEN
    SELECT tenant_id INTO v_user_tenant
    FROM users WHERE id = NEW.installed_by_user_id;

    IF v_user_tenant IS NULL THEN
      RAISE EXCEPTION 'marketplace_app_installs: installed_by_user_id % does not exist',
        NEW.installed_by_user_id;
    END IF;

    IF v_user_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'marketplace_app_installs: tenant_id (%) does not match users.tenant_id (%)',
        NEW.tenant_id, v_user_tenant;
    END IF;
  END IF;

  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. developer_accounts  (GLOBAL reference — NOT tenant-scoped)
-- ---------------------------------------------------------------------
-- A developer account is its own auth realm (audience `…-developer`). Email
-- verification is required before apps can be published. password_hash is an
-- argon2id digest (PasswordService) — the spec was silent on auth; a portal
-- login needs a credential. See SESSION_46_DECISIONS.md.
CREATE TABLE IF NOT EXISTS developer_accounts (
  id                            uuid PRIMARY KEY,
  owner_user_email              text NOT NULL,
  company_name                  text NOT NULL,
  password_hash                 text NOT NULL,
  verified                      boolean NOT NULL DEFAULT false,
  email_verification_token_hash text,
  email_verified_at             timestamptz,
  status                        text NOT NULL DEFAULT 'active',
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  deleted_at                    timestamptz
);

ALTER TABLE developer_accounts DROP CONSTRAINT IF EXISTS developer_accounts_status_chk;
ALTER TABLE developer_accounts ADD CONSTRAINT developer_accounts_status_chk
  CHECK (status IN ('active', 'suspended'));

-- Case-insensitive unique email among live accounts.
DROP INDEX IF EXISTS developer_accounts_email_unique;
CREATE UNIQUE INDEX developer_accounts_email_unique
  ON developer_accounts (lower(owner_user_email))
  WHERE deleted_at IS NULL;

-- Email-verification token lookup (single equality on the sha256 hash).
CREATE INDEX IF NOT EXISTS developer_accounts_verif_token_idx
  ON developer_accounts (email_verification_token_hash)
  WHERE email_verification_token_hash IS NOT NULL;

DROP TRIGGER IF EXISTS trg_developer_accounts_set_updated_at ON developer_accounts;
CREATE TRIGGER trg_developer_accounts_set_updated_at
  BEFORE UPDATE ON developer_accounts
  FOR EACH ROW EXECUTE FUNCTION fn_marketplace_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. marketplace_apps  (GLOBAL reference — NOT tenant-scoped)
-- ---------------------------------------------------------------------
-- A listing owned by a developer. The app id IS the OAuth client_id;
-- client_secret_hash is the sha256 of the secret shown once at creation.
-- scopes / oauth_redirect_urls are jsonb arrays of strings. Lifecycle:
-- draft → review → listed → suspended (manual admin review, no auto-approve).
CREATE TABLE IF NOT EXISTS marketplace_apps (
  id                  uuid PRIMARY KEY,
  developer_id        uuid NOT NULL REFERENCES developer_accounts(id) ON DELETE RESTRICT,
  slug                text NOT NULL,
  name                text NOT NULL,
  description         text NOT NULL DEFAULT '',
  category            text NOT NULL DEFAULT 'other',
  logo_url            text,
  scopes              jsonb NOT NULL DEFAULT '[]'::jsonb,
  oauth_redirect_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  webhook_url         text,
  webhook_secret      text,
  client_secret_hash  text NOT NULL,
  status              text NOT NULL DEFAULT 'draft',
  review_notes        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE marketplace_apps DROP CONSTRAINT IF EXISTS marketplace_apps_status_chk;
ALTER TABLE marketplace_apps ADD CONSTRAINT marketplace_apps_status_chk
  CHECK (status IN ('draft', 'review', 'listed', 'suspended'));

ALTER TABLE marketplace_apps DROP CONSTRAINT IF EXISTS marketplace_apps_category_chk;
ALTER TABLE marketplace_apps ADD CONSTRAINT marketplace_apps_category_chk
  CHECK (category IN (
    'accounting', 'analytics', 'crm', 'dispatch',
    'fleet', 'integration', 'marketing', 'other'
  ));

ALTER TABLE marketplace_apps DROP CONSTRAINT IF EXISTS marketplace_apps_scopes_arr_chk;
ALTER TABLE marketplace_apps ADD CONSTRAINT marketplace_apps_scopes_arr_chk
  CHECK (jsonb_typeof(scopes) = 'array');

ALTER TABLE marketplace_apps DROP CONSTRAINT IF EXISTS marketplace_apps_redirects_arr_chk;
ALTER TABLE marketplace_apps ADD CONSTRAINT marketplace_apps_redirects_arr_chk
  CHECK (jsonb_typeof(oauth_redirect_urls) = 'array');

-- Globally-unique slug among live apps (the directory + install path key on it).
DROP INDEX IF EXISTS marketplace_apps_slug_unique;
CREATE UNIQUE INDEX marketplace_apps_slug_unique
  ON marketplace_apps (lower(slug))
  WHERE deleted_at IS NULL;

-- Public directory scan: listed apps by category, newest first.
CREATE INDEX IF NOT EXISTS marketplace_apps_listed_idx
  ON marketplace_apps (category, created_at DESC)
  WHERE status = 'listed' AND deleted_at IS NULL;

-- Developer's own apps; admin review queue.
CREATE INDEX IF NOT EXISTS marketplace_apps_developer_idx
  ON marketplace_apps (developer_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS marketplace_apps_status_idx
  ON marketplace_apps (status, created_at DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_marketplace_apps_set_updated_at ON marketplace_apps;
CREATE TRIGGER trg_marketplace_apps_set_updated_at
  BEFORE UPDATE ON marketplace_apps
  FOR EACH ROW EXECUTE FUNCTION fn_marketplace_set_updated_at();


-- ---------------------------------------------------------------------
-- 5. marketplace_oauth_codes  (admin-pool only — NOT tenant-scoped, no RLS)
-- ---------------------------------------------------------------------
-- Short-lived single-use authorization codes. Written when an operator
-- approves an install (/oauth/authorize) and read at /oauth/token, which is a
-- PUBLIC endpoint with no operator session — so, like stripe_events, this is
-- accessed only through the admin pool. tenant_id / user_id are stored for
-- auditability and to seed the resulting install row.
CREATE TABLE IF NOT EXISTS marketplace_oauth_codes (
  id                    uuid PRIMARY KEY,
  code_hash             text NOT NULL,
  app_id                uuid NOT NULL REFERENCES marketplace_apps(id) ON DELETE CASCADE,
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id               uuid REFERENCES users(id) ON DELETE SET NULL,
  scopes                jsonb NOT NULL DEFAULT '[]'::jsonb,
  code_challenge        text NOT NULL,
  code_challenge_method text NOT NULL DEFAULT 'S256',
  redirect_uri          text NOT NULL,
  expires_at            timestamptz NOT NULL,
  consumed_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE marketplace_oauth_codes DROP CONSTRAINT IF EXISTS marketplace_oauth_codes_method_chk;
ALTER TABLE marketplace_oauth_codes ADD CONSTRAINT marketplace_oauth_codes_method_chk
  CHECK (code_challenge_method IN ('S256'));

DROP INDEX IF EXISTS marketplace_oauth_codes_hash_unique;
CREATE UNIQUE INDEX marketplace_oauth_codes_hash_unique
  ON marketplace_oauth_codes (code_hash);

CREATE INDEX IF NOT EXISTS marketplace_oauth_codes_expiry_idx
  ON marketplace_oauth_codes (expires_at);

ALTER TABLE marketplace_oauth_codes DISABLE ROW LEVEL SECURITY;
-- Default privileges grant app_user SELECT/INSERT/UPDATE; the exchange path
-- never uses app_user. Be explicit that the admin pool owns this table.
GRANT SELECT, INSERT, UPDATE, DELETE ON marketplace_oauth_codes TO app_admin;


-- ---------------------------------------------------------------------
-- 3. marketplace_app_installs  (TENANT-scoped — FORCE RLS + audit)
-- ---------------------------------------------------------------------
-- One row per (tenant, app) install. oauth_*_token_hash are sha256 digests of
-- the opaque tokens we issue; access_token_expires_at bounds the access token.
-- Uninstall sets status='uninstalled', uninstalled_at, and nulls both hashes
-- (revocation). Per-request auth hashes the presented bearer and looks the row
-- up via the admin pool (no tenant context yet), then establishes RLS context.
CREATE TABLE IF NOT EXISTS marketplace_app_installs (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  app_id                   uuid NOT NULL REFERENCES marketplace_apps(id) ON DELETE RESTRICT,
  installed_by_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  scopes_granted           jsonb NOT NULL DEFAULT '[]'::jsonb,
  oauth_access_token_hash  text,
  oauth_refresh_token_hash text,
  access_token_expires_at  timestamptz,
  status                   text NOT NULL DEFAULT 'active',
  installed_at             timestamptz NOT NULL DEFAULT now(),
  uninstalled_at           timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

ALTER TABLE marketplace_app_installs DROP CONSTRAINT IF EXISTS marketplace_app_installs_status_chk;
ALTER TABLE marketplace_app_installs ADD CONSTRAINT marketplace_app_installs_status_chk
  CHECK (status IN ('active', 'uninstalled'));

ALTER TABLE marketplace_app_installs DROP CONSTRAINT IF EXISTS marketplace_app_installs_scopes_arr_chk;
ALTER TABLE marketplace_app_installs ADD CONSTRAINT marketplace_app_installs_scopes_arr_chk
  CHECK (jsonb_typeof(scopes_granted) = 'array');

-- At most one ACTIVE install per (tenant, app). Re-install after uninstall is
-- allowed because the partial predicate excludes uninstalled/deleted rows.
DROP INDEX IF EXISTS marketplace_app_installs_active_unique;
CREATE UNIQUE INDEX marketplace_app_installs_active_unique
  ON marketplace_app_installs (tenant_id, app_id)
  WHERE status = 'active' AND deleted_at IS NULL;

-- Per-request token resolution: O(1) by access-token hash, refresh by refresh
-- hash. Unique so a hash collision (or token reuse across installs) is impossible.
DROP INDEX IF EXISTS marketplace_app_installs_access_hash_idx;
CREATE UNIQUE INDEX marketplace_app_installs_access_hash_idx
  ON marketplace_app_installs (oauth_access_token_hash)
  WHERE oauth_access_token_hash IS NOT NULL;
DROP INDEX IF EXISTS marketplace_app_installs_refresh_hash_idx;
CREATE UNIQUE INDEX marketplace_app_installs_refresh_hash_idx
  ON marketplace_app_installs (oauth_refresh_token_hash)
  WHERE oauth_refresh_token_hash IS NOT NULL;

-- Tenant's installed-apps list + per-app install metrics.
CREATE INDEX IF NOT EXISTS marketplace_app_installs_tenant_idx
  ON marketplace_app_installs (tenant_id, installed_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS marketplace_app_installs_app_idx
  ON marketplace_app_installs (app_id, installed_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE marketplace_app_installs ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_app_installs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketplace_app_installs_tenant_isolation ON marketplace_app_installs;
CREATE POLICY marketplace_app_installs_tenant_isolation ON marketplace_app_installs
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_marketplace_app_installs_tenant_consistency ON marketplace_app_installs;
CREATE TRIGGER trg_marketplace_app_installs_tenant_consistency
  BEFORE INSERT OR UPDATE ON marketplace_app_installs
  FOR EACH ROW EXECUTE FUNCTION fn_marketplace_install_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_marketplace_app_installs ON marketplace_app_installs;
CREATE TRIGGER trg_audit_marketplace_app_installs
  AFTER INSERT OR UPDATE OR DELETE ON marketplace_app_installs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_marketplace_app_installs_set_updated_at ON marketplace_app_installs;
CREATE TRIGGER trg_marketplace_app_installs_set_updated_at
  BEFORE UPDATE ON marketplace_app_installs
  FOR EACH ROW EXECUTE FUNCTION fn_marketplace_set_updated_at();


-- ---------------------------------------------------------------------
-- 4. marketplace_app_events  (TENANT-scoped — FORCE RLS + audit)
-- ---------------------------------------------------------------------
-- Append-only app-lifecycle log; one row per install/uninstall/reauth/
-- scope_change/error. Doubles as the outbound-webhook delivery record (the
-- payload column is what we POST to the app's webhook_url).
CREATE TABLE IF NOT EXISTS marketplace_app_events (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  app_id      uuid NOT NULL REFERENCES marketplace_apps(id) ON DELETE RESTRICT,
  install_id  uuid REFERENCES marketplace_app_installs(id) ON DELETE SET NULL,
  event_type  text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

ALTER TABLE marketplace_app_events DROP CONSTRAINT IF EXISTS marketplace_app_events_type_chk;
ALTER TABLE marketplace_app_events ADD CONSTRAINT marketplace_app_events_type_chk
  CHECK (event_type IN ('install', 'uninstall', 'reauth', 'scope_change', 'error'));

CREATE INDEX IF NOT EXISTS marketplace_app_events_tenant_idx
  ON marketplace_app_events (tenant_id, occurred_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS marketplace_app_events_app_idx
  ON marketplace_app_events (app_id, event_type, occurred_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE marketplace_app_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_app_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketplace_app_events_tenant_isolation ON marketplace_app_events;
CREATE POLICY marketplace_app_events_tenant_isolation ON marketplace_app_events
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_marketplace_app_events ON marketplace_app_events;
CREATE TRIGGER trg_audit_marketplace_app_events
  AFTER INSERT OR UPDATE OR DELETE ON marketplace_app_events
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_marketplace_app_events_set_updated_at ON marketplace_app_events;
CREATE TRIGGER trg_marketplace_app_events_set_updated_at
  BEFORE UPDATE ON marketplace_app_events
  FOR EACH ROW EXECUTE FUNCTION fn_marketplace_set_updated_at();
