-- =====================================================================
-- 0001_extensions.sql
-- Required Postgres extensions. Idempotent — safe to re-run.
--   - pgcrypto:   gen_random_uuid(), digest(), crypt() for ad-hoc tooling
--   - btree_gist: enables EXCLUDE constraints across composite ranges
--                 (we will need this for service-window scheduling)
--   - postgis:    geometry/geography for service zones and driver positions.
--                 Optional today: nothing in the schema depends on it yet.
--                 We wrap CREATE EXTENSION in an exception block so that
--                 Postgres images without PostGIS (Railway's stock image)
--                 don't fail the deploy. Once a column actually needs
--                 geometry, swap to a PostGIS-enabled image.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "postgis";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'postgis extension not available on this Postgres image; skipping (sqlstate=%)', SQLSTATE;
END
$$;
