-- =====================================================================
-- 0037_white_label_portal.sql  (White-Label Customer Portal — Session 32)
--
-- Lets a tenant put a branded, customer-facing portal on its own domain.
-- A customer (the person whose vehicle was towed) signs in, sees their
-- jobs and invoices, and pays online — all under the tow company's logo,
-- colors, and support contact, never under the US Tow DISPATCH brand.
--
-- Tables added:
--   1. tenant_branding              — one row per tenant (logo, colors,
--                                     support contact, terms/privacy URLs,
--                                     custom domain + verification stamp).
--                                     tenant_id IS the primary key.
--   2. customer_portal_users        — portal logins, SEPARATE from staff
--                                     `users`. One per (tenant, customer,
--                                     email). Never grants staff access.
--   3. customer_portal_auth_tokens  — email-verification + password-reset
--                                     tokens for portal users (sha256 at
--                                     rest, single-use, short TTL).
--
-- Patterns followed (match 0036_impound_storage.sql):
--   * tenant-scoped tables: tenant_id uuid NOT NULL REFERENCES tenants(id)
--     ON DELETE RESTRICT; ENABLE + FORCE ROW LEVEL SECURITY; policy
--     USING (tenant_id = fn_current_tenant_id()) WITH CHECK (...).
--   * fn_audit_log() AFTER trigger on every table.
--   * Idempotent: CREATE ... IF NOT EXISTS, DROP ... IF EXISTS guards.
--   * Cross-tenant consistency BEFORE-trigger: FKs prove the parent row
--     exists but not that its tenant_id matches; RLS hides foreign parents
--     from the trigger SELECT, so an injected foreign id fails
--     "does not exist" / "does not match".
--   * Shared BEFORE UPDATE updated_at stamper (Drizzle defaultNow() only
--     fires on INSERT).
--
-- NOTE — cross-CUSTOMER isolation is enforced in the service layer
-- (WHERE customer_id = portal_user.customer_id), NOT by RLS. RLS only
-- isolates by tenant; two portal users in the same tenant share the same
-- RLS scope. See PortalAccountService + the cross-customer service test.
--
-- NOTE — tenant_branding.custom_domain is GLOBALLY unique and is resolved
-- by the admin pool (RLS-bypassing) on an unauthenticated request, so the
-- portal can map portal.acme-towing.com -> tenant before any login.
--
-- Down (rollback):
--   DROP TABLE IF EXISTS customer_portal_auth_tokens;
--   DROP TABLE IF EXISTS customer_portal_users;
--   DROP TABLE IF EXISTS tenant_branding;
--   DROP FUNCTION IF EXISTS fn_portal_set_updated_at();
--   DROP FUNCTION IF EXISTS fn_customer_portal_users_tenant_consistency();
--   DROP FUNCTION IF EXISTS fn_customer_portal_tokens_tenant_consistency();
-- =====================================================================


-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Generic updated_at stamper, reused by the white-label tables.
CREATE OR REPLACE FUNCTION fn_portal_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------
-- 1. tenant_branding
-- ---------------------------------------------------------------------
-- One row per tenant. tenant_id is both PK and FK. Colors are stored as
-- 7-char hex (#RRGGBB); the web layer injects them as CSS variables.
-- custom_domain is the operator's vanity host (portal.acme-towing.com);
-- custom_domain_verified_at is stamped once DNS + Railway routing is
-- confirmed (manual for now — see CUSTOM_DOMAIN_RUNBOOK.md).

CREATE TABLE IF NOT EXISTS tenant_branding (
  tenant_id                  uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  logo_url                   text,
  primary_color              text,
  accent_color               text,
  support_email              text,
  support_phone              text,
  terms_url                  text,
  privacy_url                text,
  custom_domain              text,
  custom_domain_verified_at  timestamptz,
  updated_by                 uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- Hex color guard (#RRGGBB), nullable.
ALTER TABLE tenant_branding DROP CONSTRAINT IF EXISTS tenant_branding_primary_color_hex;
ALTER TABLE tenant_branding ADD CONSTRAINT tenant_branding_primary_color_hex
  CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE tenant_branding DROP CONSTRAINT IF EXISTS tenant_branding_accent_color_hex;
ALTER TABLE tenant_branding ADD CONSTRAINT tenant_branding_accent_color_hex
  CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9A-Fa-f]{6}$');

-- A custom domain belongs to exactly one tenant, globally. Stored/compared
-- lower-case; partial so multiple tenants with NULL domains coexist.
DROP INDEX IF EXISTS tenant_branding_custom_domain_unique;
CREATE UNIQUE INDEX tenant_branding_custom_domain_unique
  ON tenant_branding (lower(custom_domain))
  WHERE custom_domain IS NOT NULL;

ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_branding FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_branding_tenant_isolation ON tenant_branding;
CREATE POLICY tenant_branding_tenant_isolation ON tenant_branding
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_tenant_branding ON tenant_branding;
CREATE TRIGGER trg_audit_tenant_branding
  AFTER INSERT OR UPDATE OR DELETE ON tenant_branding
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_tenant_branding_set_updated_at ON tenant_branding;
CREATE TRIGGER trg_tenant_branding_set_updated_at
  BEFORE UPDATE ON tenant_branding
  FOR EACH ROW EXECUTE FUNCTION fn_portal_set_updated_at();


-- ---------------------------------------------------------------------
-- 2. customer_portal_users
-- ---------------------------------------------------------------------
-- Portal logins, deliberately separate from the staff `users` table. A
-- portal user is always bound to exactly one customer (customer_id NOT
-- NULL); signup is email-gated against the tenant's customer book (a
-- portal account is only created when a matching customer exists). The
-- password is argon2id-hashed (PasswordService, reused from staff auth).

CREATE TABLE IF NOT EXISTS customer_portal_users (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id         uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  email               text NOT NULL,
  password_hash       text NOT NULL,
  email_verified_at   timestamptz,
  last_login_at       timestamptz,
  failed_login_count  integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

ALTER TABLE customer_portal_users DROP CONSTRAINT IF EXISTS customer_portal_users_email_nonempty;
ALTER TABLE customer_portal_users ADD CONSTRAINT customer_portal_users_email_nonempty
  CHECK (length(trim(email)) > 0);

-- One live portal login per (tenant, email), case-insensitive.
DROP INDEX IF EXISTS customer_portal_users_tenant_email_unique;
CREATE UNIQUE INDEX customer_portal_users_tenant_email_unique
  ON customer_portal_users (tenant_id, lower(email))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_portal_users_tenant_customer_idx
  ON customer_portal_users (tenant_id, customer_id)
  WHERE deleted_at IS NULL;

ALTER TABLE customer_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_portal_users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_portal_users_tenant_isolation ON customer_portal_users;
CREATE POLICY customer_portal_users_tenant_isolation ON customer_portal_users
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- customer_id must belong to the same tenant as the portal user.
CREATE OR REPLACE FUNCTION fn_customer_portal_users_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_customer_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_customer_tenant FROM customers WHERE id = NEW.customer_id;
  IF v_customer_tenant IS NULL THEN
    RAISE EXCEPTION 'customer_portal_users: customer_id % does not exist', NEW.customer_id;
  END IF;
  IF v_customer_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'customer_portal_users: tenant_id (%) does not match customers.tenant_id (%)',
      NEW.tenant_id, v_customer_tenant;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_customer_portal_users_tenant_consistency ON customer_portal_users;
CREATE TRIGGER trg_customer_portal_users_tenant_consistency
  BEFORE INSERT OR UPDATE ON customer_portal_users
  FOR EACH ROW EXECUTE FUNCTION fn_customer_portal_users_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_customer_portal_users ON customer_portal_users;
CREATE TRIGGER trg_audit_customer_portal_users
  AFTER INSERT OR UPDATE OR DELETE ON customer_portal_users
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_customer_portal_users_set_updated_at ON customer_portal_users;
CREATE TRIGGER trg_customer_portal_users_set_updated_at
  BEFORE UPDATE ON customer_portal_users
  FOR EACH ROW EXECUTE FUNCTION fn_portal_set_updated_at();


-- ---------------------------------------------------------------------
-- 3. customer_portal_auth_tokens
-- ---------------------------------------------------------------------
-- Email-verification and password-reset tokens for portal users. We store
-- sha256(token) only; the plaintext is emailed once. Single-use
-- (consumed_at) with a short TTL. `purpose` keeps both flows in one table.

CREATE TABLE IF NOT EXISTS customer_portal_auth_tokens (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  portal_user_id  uuid NOT NULL REFERENCES customer_portal_users(id) ON DELETE CASCADE,
  purpose         text NOT NULL,
  token_hash      text NOT NULL,
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_portal_auth_tokens DROP CONSTRAINT IF EXISTS customer_portal_auth_tokens_purpose_check;
ALTER TABLE customer_portal_auth_tokens ADD CONSTRAINT customer_portal_auth_tokens_purpose_check
  CHECK (purpose IN ('email_verification', 'password_reset'));

CREATE INDEX IF NOT EXISTS customer_portal_auth_tokens_hash_idx
  ON customer_portal_auth_tokens (token_hash);
CREATE INDEX IF NOT EXISTS customer_portal_auth_tokens_user_idx
  ON customer_portal_auth_tokens (tenant_id, portal_user_id);
CREATE INDEX IF NOT EXISTS customer_portal_auth_tokens_expires_idx
  ON customer_portal_auth_tokens (expires_at);

ALTER TABLE customer_portal_auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_portal_auth_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_portal_auth_tokens_tenant_isolation ON customer_portal_auth_tokens;
CREATE POLICY customer_portal_auth_tokens_tenant_isolation ON customer_portal_auth_tokens
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- portal_user_id must belong to the same tenant as the token.
CREATE OR REPLACE FUNCTION fn_customer_portal_tokens_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_user_tenant
  FROM customer_portal_users WHERE id = NEW.portal_user_id;
  IF v_user_tenant IS NULL THEN
    RAISE EXCEPTION 'customer_portal_auth_tokens: portal_user_id % does not exist', NEW.portal_user_id;
  END IF;
  IF v_user_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'customer_portal_auth_tokens: tenant_id (%) does not match customer_portal_users.tenant_id (%)',
      NEW.tenant_id, v_user_tenant;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_customer_portal_tokens_tenant_consistency ON customer_portal_auth_tokens;
CREATE TRIGGER trg_customer_portal_tokens_tenant_consistency
  BEFORE INSERT OR UPDATE ON customer_portal_auth_tokens
  FOR EACH ROW EXECUTE FUNCTION fn_customer_portal_tokens_tenant_consistency();

DROP TRIGGER IF EXISTS trg_audit_customer_portal_auth_tokens ON customer_portal_auth_tokens;
CREATE TRIGGER trg_audit_customer_portal_auth_tokens
  AFTER INSERT OR UPDATE OR DELETE ON customer_portal_auth_tokens
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
