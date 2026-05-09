-- =====================================================================
-- 0002_roles.sql
-- Two operational roles:
--   - app_user:  the runtime application connects as this role. CANNOT
--                bypass RLS. Has DML on application tables only.
--   - app_admin: ops/migrations/seeds. Bypasses RLS as table owner.
--                Use is intended to be rare and audited (see fn_audit_log).
--
-- The bootstrap superuser owns the schema and the tables; we GRANT to
-- app_user explicitly. We DO NOT make app_user the table owner: doing so
-- would let it bypass FORCE ROW LEVEL SECURITY.
-- =====================================================================

-- ---------- app_user ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE format(
      'CREATE ROLE app_user WITH LOGIN PASSWORD %L NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE',
      coalesce(current_setting('app.app_user_password', true), 'app_user_dev_pw')
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE app_user WITH LOGIN PASSWORD %L NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE',
      coalesce(current_setting('app.app_user_password', true), 'app_user_dev_pw')
    );
  END IF;
END
$$;

-- ---------- app_admin ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    EXECUTE format(
      'CREATE ROLE app_admin WITH LOGIN PASSWORD %L NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE',
      coalesce(current_setting('app.app_admin_password', true), 'app_admin_dev_pw')
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE app_admin WITH LOGIN PASSWORD %L NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE',
      coalesce(current_setting('app.app_admin_password', true), 'app_admin_dev_pw')
    );
  END IF;
END
$$;

-- Both roles get CONNECT on the current database.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_admin', current_database());
END
$$;

-- Schema usage.
GRANT USAGE ON SCHEMA public TO app_user;
GRANT USAGE ON SCHEMA public TO app_admin;

-- Table-level grants. SELECT/INSERT/UPDATE on application tables; never DELETE
-- (we soft-delete at the application layer). Hard purge runs as app_admin.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

GRANT ALL ON ALL TABLES IN SCHEMA public TO app_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_admin;

-- Default privileges so future tables created by the bootstrap user
-- automatically pick up the right grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO app_admin;

-- Lock down the public schema's PUBLIC defaults — no anonymous CREATE.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
