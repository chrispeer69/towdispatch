-- =====================================================================
-- 0026_user_invites_and_yard_scoping.sql  (Admin Settings — build 7 of 7)
--
-- Two changes in one migration:
--
--   1. users.yard_ids (uuid[] NULL).
--      The locked spec scopes Manager/Dispatcher/Driver to specific
--      yards; Owner/Admin/Accounting/Auditor are global. NULL means
--      "no yard restriction" (global-scope roles, or yard-scoped roles
--      while yards aren't wired yet). When a yards table lands later,
--      this column is the link.
--
--   2. user_invites table + supporting machinery.
--      The existing POST /users requires a password, which means admins
--      hand-type passwords for new users. The standard SaaS pattern —
--      email an invite link, recipient sets their own password — is
--      what this table backs.
--
--      Flow:
--        a. OWNER/ADMIN POSTs /users/invite { email, role, ... } → row
--           inserted here, token emailed to recipient.
--        b. Recipient clicks the link → web /accept-invite page POSTs
--           the token + their chosen password to /users/accept-invite.
--        c. API resolves the invite via fn_lookup_invite_by_token (a
--           SECURITY DEFINER function that bypasses RLS for the single
--           token lookup — because the accepter is unauthenticated, no
--           tenant_id GUC is set), creates the user row inside that
--           tenant_id's context, and marks the invite consumed.
--
--      The unique constraint on (tenant_id, email) WHERE consumed_at IS
--      NULL prevents two pending invites racing to the same email.
--
-- Down (rollback):
--   DROP TRIGGER IF EXISTS trg_audit_user_invites ON user_invites;
--   DROP FUNCTION IF EXISTS fn_lookup_invite_by_token(text);
--   DROP TABLE IF EXISTS user_invites;
--   ALTER TABLE users DROP COLUMN IF EXISTS yard_ids;
-- =====================================================================

-- ---------- 1. users.yard_ids ----------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS yard_ids uuid[];

-- ---------- 2. user_invites ----------
CREATE TABLE IF NOT EXISTS user_invites (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  email         text NOT NULL,
  role          text NOT NULL,
  yard_ids      uuid[],
  -- Optional pre-fill for the accepter's name (shown on the accept page).
  full_name     text,
  invited_by    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash    text NOT NULL,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- The 7-role enum matches userRoles in packages/db schema. CHECK keeps the
-- column honest at the storage layer even if the API forgets to validate.
ALTER TABLE user_invites
  DROP CONSTRAINT IF EXISTS user_invites_role_chk;
ALTER TABLE user_invites
  ADD CONSTRAINT user_invites_role_chk
  CHECK (role IN ('owner', 'admin', 'manager', 'dispatcher', 'driver', 'accounting', 'auditor'));

-- ---------- indexes ----------
-- One pending invite per (tenant, email). Consumed invites are kept as a
-- ledger (they prove the invite was accepted) — only the pending ones
-- conflict. Partial unique index gives us exactly that.
DROP INDEX IF EXISTS user_invites_tenant_email_pending_unique;
CREATE UNIQUE INDEX user_invites_tenant_email_pending_unique
  ON user_invites (tenant_id, lower(email))
  WHERE consumed_at IS NULL;

-- Token lookup at accept-invite time. The hash is what's stored — the
-- plain token is only in the recipient's email. Unique so a hash
-- collision can't masquerade as a different invite.
DROP INDEX IF EXISTS user_invites_token_hash_unique;
CREATE UNIQUE INDEX user_invites_token_hash_unique
  ON user_invites (token_hash);

-- Listing pending invites (most-recent-first).
CREATE INDEX IF NOT EXISTS user_invites_tenant_pending_idx
  ON user_invites (tenant_id, created_at DESC)
  WHERE consumed_at IS NULL;

-- ---------- RLS ----------
ALTER TABLE user_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invites FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_invites_tenant_isolation ON user_invites;
CREATE POLICY user_invites_tenant_isolation ON user_invites
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- ---------- audit ----------
DROP TRIGGER IF EXISTS trg_audit_user_invites ON user_invites;
CREATE TRIGGER trg_audit_user_invites
  AFTER INSERT OR UPDATE OR DELETE ON user_invites
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- updated_at trigger ----------
-- Stays in sync when consumed_at flips or the token is regenerated on resend.
CREATE OR REPLACE FUNCTION fn_user_invites_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_user_invites_set_updated_at ON user_invites;
CREATE TRIGGER trg_user_invites_set_updated_at
  BEFORE UPDATE ON user_invites
  FOR EACH ROW EXECUTE FUNCTION fn_user_invites_set_updated_at();

-- ---------- fn_lookup_invite_by_token ----------
-- The accept-invite endpoint is public — the recipient has no session yet,
-- so there is no app.current_tenant_id GUC to set. RLS on user_invites is
-- FORCED, so even a raw SELECT from app_user would return zero rows. We
-- need a single, narrow bypass for "look up this one invite by its token".
--
-- SECURITY DEFINER + ownership by the bootstrap superuser (the default
-- owner for objects created during migrations) means the function runs
-- with the superuser's privileges, which include bypassing RLS. The body
-- accepts a plain token, hashes it via the digest function, and returns
-- the invite plus the tenant name so the accept page can render
-- "Welcome to <tenantName>" before the recipient submits.
--
-- The function only RETURNS data — it does not consume the invite or
-- create the user. Those writes happen in the calling service, inside a
-- runInTenantContext block that sets the GUC to the resolved tenant_id.
-- Splitting lookup from mutation keeps the RLS bypass surface tiny.
CREATE OR REPLACE FUNCTION fn_lookup_invite_by_token(p_token_hash text)
RETURNS TABLE (
  invite_id     uuid,
  tenant_id     uuid,
  tenant_name   text,
  tenant_slug   text,
  email         text,
  role          text,
  yard_ids      uuid[],
  full_name     text,
  invited_by    uuid,
  inviter_name  text,
  expires_at    timestamptz,
  consumed_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id            AS invite_id,
    i.tenant_id     AS tenant_id,
    t.name          AS tenant_name,
    t.slug          AS tenant_slug,
    i.email         AS email,
    i.role          AS role,
    i.yard_ids      AS yard_ids,
    i.full_name     AS full_name,
    i.invited_by    AS invited_by,
    coalesce(u.first_name || ' ' || u.last_name, u.email) AS inviter_name,
    i.expires_at    AS expires_at,
    i.consumed_at   AS consumed_at
  FROM user_invites i
  JOIN tenants t ON t.id = i.tenant_id
  LEFT JOIN users u ON u.id = i.invited_by
  WHERE i.token_hash = p_token_hash
  LIMIT 1;
END
$$;

GRANT EXECUTE ON FUNCTION fn_lookup_invite_by_token(text) TO app_user, app_admin;
