-- =====================================================================
-- 0023_seed_demo_motor_clubs.sql  (visual seed)
--
-- Inserts 4 demo motor club accounts (AGEROx, NSDx, GEICOx, URGENTLYx)
-- for every existing tenant so the Motor Clubs surface in
-- /accounts?type=motor_club doesn't render empty during client demos.
-- (AAAx was originally part of the seed; it was removed at user
-- request — the cleanup UPDATE below soft-deletes any AAAx row that
-- the initial seed already wrote.)
--
-- Names carry a trailing "x" to mark them as seeded placeholders (vs.
-- real integrations). Only 'agero' has a wired MotorClubProvider in
-- apps/api/src/integrations today; the other network codes are
-- presentational only. When a real motor club integration ships,
-- strip the "x" from the name and the seed row becomes the production
-- record without renaming.
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
--      AND name IN ('AGEROx','NSDx','GEICOx','URGENTLYx');
--   DROP FUNCTION IF EXISTS fn_seed_demo_motor_clubs(uuid);
-- =====================================================================

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
    (gen_random_uuid(), p_tenant_id, 'URGENTLYx', 'MC-URGENTLY', 'net_30', 'dispatch+urgently@example.com', '+18005551005', TRUE, 'urgently', TRUE, NOW(), NOW())
  ON CONFLICT (tenant_id, name) WHERE deleted_at IS NULL DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

ALTER FUNCTION fn_seed_demo_motor_clubs(uuid) OWNER TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION fn_seed_demo_motor_clubs(uuid) TO app_user, app_admin;

-- ---------- backfill existing tenants ----------
-- Every existing tenant gets the 4 demo motor clubs the moment this
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

-- ---------- AAAx cleanup ----------
-- AAAx was part of the original 5-row seed and got inserted on the
-- previous successful migration run. The user asked to remove it.
-- Soft-delete every AAAx motor-club row across all tenants — uses
-- deleted_at because of the FK references from invoices / jobs /
-- recurring_billing_schedules (most are ON DELETE SET NULL but a hard
-- DELETE would still null those FKs unnecessarily for a demo row).
-- The partial unique index on (tenant_id, name) WHERE deleted_at IS
-- NULL means a future tenant could legitimately create an "AAAx"
-- account once this row is soft-deleted; that's fine.
--
-- Idempotent — re-running this UPDATE is a no-op once the rows are
-- already tombstoned.
UPDATE accounts
   SET deleted_at = NOW(), updated_at = NOW()
 WHERE is_motor_club = TRUE
   AND name = 'AAAx'
   AND deleted_at IS NULL;
