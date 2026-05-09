-- =====================================================================
-- 0004_audit_trigger.sql
-- Generic audit trigger function. SECURITY DEFINER so it can write to
-- audit_log even when invoked by app_user (which has no policy permitting
-- direct writes to audit_log). This makes "forgot to log it" impossible.
--
-- Captures:
--   - tenant_id from NEW (fallback OLD) — required, NOT NULL audit.tenant_id
--   - actor_id  from app.current_user_id GUC (NULL allowed — system mutations)
--   - action    from TG_OP
--   - resource_type from TG_TABLE_NAME
--   - resource_id   from NEW.id (fallback OLD.id)
--   - before_state  to_jsonb(OLD) on UPDATE/DELETE
--   - after_state   to_jsonb(NEW) on INSERT/UPDATE
--   - request_id, ip_address, user_agent from optional GUCs
--
-- The function is generic. To audit a new table:
--   CREATE TRIGGER trg_audit_<table>
--     AFTER INSERT OR UPDATE OR DELETE ON <table>
--     FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id   uuid;
  v_actor_id    uuid;
  v_resource_id uuid;
  v_before      jsonb;
  v_after       jsonb;
  v_request_id  text;
  v_ip          text;
  v_user_agent  text;
BEGIN
  -- tenant_id resolution: prefer NEW, fall back to OLD.
  IF TG_OP = 'DELETE' THEN
    v_tenant_id := (to_jsonb(OLD)->>'tenant_id')::uuid;
  ELSE
    v_tenant_id := (to_jsonb(NEW)->>'tenant_id')::uuid;
  END IF;

  -- For the tenants table itself, the row's own id IS the tenant_id.
  IF v_tenant_id IS NULL AND TG_TABLE_NAME = 'tenants' THEN
    IF TG_OP = 'DELETE' THEN
      v_tenant_id := (to_jsonb(OLD)->>'id')::uuid;
    ELSE
      v_tenant_id := (to_jsonb(NEW)->>'id')::uuid;
    END IF;
  END IF;

  -- Fail-closed: if we still have no tenant_id, refuse to audit silently.
  -- This will surface as an error and force the developer to fix the table.
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION
      'fn_audit_log: cannot determine tenant_id for table %', TG_TABLE_NAME;
  END IF;

  v_actor_id   := fn_current_user_id();
  v_request_id := current_setting('app.request_id', true);
  v_ip         := current_setting('app.request_ip', true);
  v_user_agent := current_setting('app.user_agent', true);

  IF TG_OP = 'INSERT' THEN
    v_after       := to_jsonb(NEW);
    v_resource_id := (v_after->>'id')::uuid;
  ELSIF TG_OP = 'UPDATE' THEN
    v_before      := to_jsonb(OLD);
    v_after       := to_jsonb(NEW);
    v_resource_id := (v_after->>'id')::uuid;
  ELSE
    v_before      := to_jsonb(OLD);
    v_resource_id := (v_before->>'id')::uuid;
  END IF;

  INSERT INTO audit_log (
    id, tenant_id, actor_id, action, resource_type, resource_id,
    before_state, after_state, request_id, ip_address, user_agent, created_at
  )
  VALUES (
    gen_random_uuid(),
    v_tenant_id,
    v_actor_id,
    TG_OP,
    TG_TABLE_NAME,
    v_resource_id,
    v_before,
    v_after,
    NULLIF(v_request_id, ''),
    NULLIF(v_ip, ''),
    NULLIF(v_user_agent, ''),
    now()
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

ALTER FUNCTION fn_audit_log() OWNER TO CURRENT_USER;
GRANT EXECUTE ON FUNCTION fn_audit_log() TO app_user, app_admin;

-- Wire the trigger up to tables we want audited at this layer.
DROP TRIGGER IF EXISTS trg_audit_tenants ON tenants;
CREATE TRIGGER trg_audit_tenants
  AFTER INSERT OR UPDATE OR DELETE ON tenants
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_audit_users ON users;
CREATE TRIGGER trg_audit_users
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
