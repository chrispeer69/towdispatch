-- =====================================================================
-- 0023_seed_demo_motor_clubs.sql  (visual seed)
--
-- Inserts 5 demo motor club accounts (AGEROx, NSDx, GEICOx, AAAx,
-- URGENTLYx) for every existing tenant so the Motor Clubs surface in
-- /accounts?type=motor_club doesn't render empty during client demos.
--
-- AAA / AAAx history — this migration flipped several times at user
-- request:
--   r1: seeded 5 rows including AAAx
--   r2: removed AAAx via soft-delete
--   r3: renamed AAAx → AAA (drop the placeholder x suffix)
--   r4: rename AAA back to AAAx then soft-delete
--   r5: bring AAAx BACK visible, with lowercase 'x' (this revision)
--
-- The cleanup block below handles every prior state idempotently:
--   - any 'AAAX' (uppercase X) row is soft-deleted — same thing as
--     AAAx visually; keep lowercase canonical only
--   - any 'AAA' (no suffix, from r3) row is soft-deleted — also a
--     duplicate of AAAx
--   - any tombstoned 'AAAx' has its deleted_at restored to NULL so
--     the canonical row becomes visible again (keeps row identity
--     and FK references)
-- AAAx is also back in the seed VALUES so any tenant that never had
-- one gets a fresh row.
--
-- NOTE on rename vs delete: prior revisions of this migration tried
-- to UPDATE 'AAAX' → 'AAAx'. That fails the partial unique index
-- when both an active AAAX AND an active AAAx exist in the same
-- tenant (the rename would create a duplicate active row). Soft-
-- delete is the safe equivalent.
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
--      AND name IN ('AGEROx','NSDx','GEICOx','URGENTLYx','AAAx','AAA','AAAX');
--   DROP FUNCTION IF EXISTS fn_seed_demo_motor_clubs(uuid);
-- =====================================================================

-- ---------- AAA / AAAX / AAAx rename cleanup ----------
-- Runs BEFORE the seed so the seed's ON CONFLICT skip behaves
-- correctly.
--
-- IMPORTANT: 'AAAx' (lowercase x) is the canonical name. 'AAAX'
-- (uppercase X) and 'AAA' (no suffix) are treated as DUPLICATES of
-- AAAx and removed — they are NOT renamed, because the partial
-- unique index would block the rename when an active AAAx already
-- exists in the same tenant (which is the common case after r5
-- seeded AAAx).
--
-- Step A: soft-delete 'AAAX' (uppercase X) — same thing as AAAx
-- visually; keep the lowercase canonical row only.
UPDATE accounts
   SET deleted_at = NOW(),
       updated_at = NOW()
 WHERE is_motor_club = TRUE
   AND name = 'AAAX'
   AND deleted_at IS NULL;

-- Step B: soft-delete 'AAA' (no suffix) — duplicate of AAAx from
-- the r3 intermediate state. Same reasoning as Step A.
UPDATE accounts
   SET deleted_at = NOW(),
       updated_at = NOW()
 WHERE is_motor_club = TRUE
   AND name = 'AAA'
   AND deleted_at IS NULL;

-- Step C: restore any soft-deleted 'AAAx' row to active so the
-- canonical name is visible. Guard against creating two active
-- AAAx rows in the same tenant — only un-tombstone when no active
-- AAAx exists.
UPDATE accounts AS target
   SET deleted_at = NULL,
       updated_at = NOW()
 WHERE target.is_motor_club = TRUE
   AND target.name = 'AAAx'
   AND target.deleted_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM accounts AS active
      WHERE active.tenant_id = target.tenant_id
        AND active.is_motor_club = TRUE
        AND active.name = 'AAAx'
        AND active.deleted_at IS NULL
   );

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
    (gen_random_uuid(), p_tenant_id, 'AAAx',      'MC-AAA',      'net_30', 'dispatch+aaa@example.com',      '+18005551004', TRUE, 'aaa',      TRUE, NOW(), NOW()),
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
