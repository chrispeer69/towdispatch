-- =====================================================================
-- 0001_extensions.sql
-- Required Postgres extensions. Idempotent — safe to re-run.
--   - pgcrypto:   gen_random_uuid(), digest(), crypt() for ad-hoc tooling
--   - postgis:    geometry/geography for service zones and driver positions
--   - btree_gist: enables EXCLUDE constraints across composite ranges
--                 (we will need this for service-window scheduling)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
