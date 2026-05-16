-- =====================================================================
-- 0023_seed_demo_motor_clubs.sql  (visual seed)
--
-- Inserts 5 demo motor club accounts for every existing tenant so the
-- Motor Clubs surface in /accounts?type=motor_club doesn't render empty
-- during client demos.
--
-- Naming convention:
--   - 4 rows carry a trailing "x" (AGEROx, NSDx, GEICOx, URGENTLYx) to
--     mark them as seeded placeholders for not-yet-wired integrations.
--   - 1 row is plain "AAA" (no x) at user request — promoted from the
--     placeholder bucket. Only 'agero' has a wired MotorClubProvider
--     today; the rest including AAA are presentational only until a
--     real integration ships.
--
-- AAA history: this row was originally seeded as "AAAx" and then
-- soft-deleted at user request in an earlier revision of this same
-- migration. The user then asked to bring it back, renamed. The
-- migration now (a) restores any AAAx row whose deleted_at was set
-- by the prior cleanup AND renames it to "AAA", AND (b) ships "AAA"
-- in the seed VALUES for any tenant that never had AAAx in the
-- first place. Idempotent — re-running is a no-op once the rename
-- is in place.
--
-- Idempotent via the partial (tenant_id, name) WHERE deleted_at IS NULL
-- unique index on accounts: ON CONFLICT (tenant_id, name) WHERE deleted_at
-- IS NULL DO NOTHING. The WHERE clause is REQUIRED because the unique
-- index is partial — without it Postgres throws "there is no unique or
-- exclusion constraint matching the ON CONFLICT specification" and the
-- whole migration transaction rolls back.
--
-- Safe to re-run with every migration cycle — the SQL migration runner
-- does not version-track raw .sql files.
--
-- Down (rollback) — run by hand if these need to come out:
--   DELETE FROM accounts
--    WHERE is_motor_club = TRUE
--      AND name IN ('AGEROx','NSDx','GEICOx','URGENTLYx','AAA');
--   DROP FUNCTION IF EXISTS fn_seed_demo_motor_clubs(uuid);
-- =====================================================================

-- ---------- AAA rename / restore ----------
-- Run BEFORE the seed function so the AAA row exists by the time
-- ON CONFLICT runs. Two-step because the partial unique index is on
-- (tenant_id, name) WHERE deleted_at IS NULL: restoring deleted_at to
-- NULL on a row that still says "AAAx" would not conflict with the
-- "AAA" we'd then INSERT, but renaming first keeps the data path
-- linear (one row per tenant, no duplicate insert paths).
UPDATE accounts
   SET name = 'AAA',
       account_number = 'MC-AAA',
       deleted_at = NULL,
       updated_at = NOW()
 WHERE is_motor_club = TRUE
   AND name = 'AAAx';

CREATE OR REPLACE FUNCTION fn_seed_demo_motor_clubs(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO accounts (
    id, tenant_id, name, account_number,
    billing_terms, billing_email, billing_phone,
    is_motor_club, motor_club_network_code,
    active, created_at, updated_at
  )
  VALUES
    (gen_random_uuid(), p_tenant_id, 'AGEROx',    'MC-AGERO',    'net_30', 'dispatch+agero@example.com',    '+18005551001', TRUE, 'agero',    TRUE, NOW(), NOW()),
    (gen_random_uuid(), p_tenant_id, 'NSDx',      'MC-NSD',      'net_30', 'dispatch+nsd@example.com',      '+18005551002', TRUE, 'nsd',      TRUE, NOW(), NOW()),
    (gen_random_uuid(), p_tenant_id, 'GEICOx',    'MC-GEICO',    'net_30', 'dispatch+geico@example.com',    '+18005551003', TRUE, 'geico',    TRUE, NOW(), NOW()),
    (gen_random_uuid(), p_tenant_id, 'AAA',       'MC-AAA',      'net_30', 'dispatch+aaa@example.com',      '+18005551004', TRUE, 'aaa',      TRUE, NOW(), NOW()),
    (gen_random_uuid(), p_tenant_id, 'URGENTLYx', 'MC-URGENTLY', 'net_30', 'dispatch+urgently@example.com', '+18005551005', TRUE, 'urgently', TRUE, NOW(), NOW())
  ON CONFLICT (tenant_id, name) WHERE deleted_at IS NULL DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

ALTER FUNCTION fn_seed_demo_motor_clubs(uuid) OWNER TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION fn_seed_demo_motor_clubs(uuid) TO app_user, app_admin;

-- ---------- backfill existing tenants ----------
-- Every existing tenant gets the 5 demo motor clubs the moment this
-- migration applies. New tenants do NOT auto-receive them; the seed
-- is intentionally a one-shot visual placeholder, not a default for
-- new accounts.
DO $$
DECLARE
  t record;
  inserted integer;
BEGIN
  FOR t IN SELECT id, slug FROM tenants WHERE deleted_at IS NULL LOOP
    SELECT fn_seed_demo_motor_clubs(t.id) INTO inserted;
    RAISE NOTICE 'demo motor club seed for tenant % (%): % rows', t.slug, t.id, inserted;
  END LOOP;
END
$$;
