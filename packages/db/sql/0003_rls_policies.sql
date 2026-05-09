-- =====================================================================
-- 0003_rls_policies.sql
-- Row Level Security policies. FORCE ROW LEVEL SECURITY on every tenant
-- table so that even the table owner cannot accidentally bypass isolation.
--
-- The application connects as app_user and runs at the start of each
-- transaction:
--     SET LOCAL app.current_tenant_id = '<uuid>';
--     SET LOCAL app.current_user_id   = '<uuid>';
-- Policies read these GUCs via current_setting().
--
-- We use a SECURITY DEFINER helper fn_current_tenant_id() that returns NULL
-- when the GUC isn't set, instead of raising. NULL never matches tenant_id,
-- so unset context = zero rows visible (fail-closed).
-- =====================================================================

-- ---------- helper ----------
CREATE OR REPLACE FUNCTION fn_current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v text;
BEGIN
  v := current_setting('app.current_tenant_id', true);
  IF v IS NULL OR v = '' THEN
    RETURN NULL;
  END IF;
  RETURN v::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION fn_current_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v text;
BEGIN
  v := current_setting('app.current_user_id', true);
  IF v IS NULL OR v = '' THEN
    RETURN NULL;
  END IF;
  RETURN v::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END
$$;

GRANT EXECUTE ON FUNCTION fn_current_tenant_id() TO app_user, app_admin;
GRANT EXECUTE ON FUNCTION fn_current_user_id() TO app_user, app_admin;

-- ---------- tenants ----------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_self_read ON tenants;
CREATE POLICY tenant_self_read ON tenants
  FOR SELECT
  USING (id = fn_current_tenant_id());

DROP POLICY IF EXISTS tenant_self_write ON tenants;
CREATE POLICY tenant_self_write ON tenants
  FOR UPDATE
  USING (id = fn_current_tenant_id())
  WITH CHECK (id = fn_current_tenant_id());

-- New tenant creation goes through a SECURITY DEFINER function (signup) or as
-- app_admin. There is no INSERT policy here on purpose.

-- ---------- users ----------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_tenant_isolation ON users;
CREATE POLICY users_tenant_isolation ON users
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- ---------- sessions ----------
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sessions_tenant_isolation ON sessions;
CREATE POLICY sessions_tenant_isolation ON sessions
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- ---------- audit_log ----------
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

-- Read-only from the app's perspective. INSERTs come from the trigger
-- with SECURITY DEFINER privilege.
DROP POLICY IF EXISTS audit_log_tenant_read ON audit_log;
CREATE POLICY audit_log_tenant_read ON audit_log
  FOR SELECT
  USING (tenant_id = fn_current_tenant_id());

-- Block direct writes from app_user even with SECURITY DEFINER bypass:
-- there is no INSERT/UPDATE/DELETE policy here, so any direct write fails.
