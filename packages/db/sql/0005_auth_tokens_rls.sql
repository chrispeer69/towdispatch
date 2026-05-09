-- =====================================================================
-- 0005_auth_tokens_rls.sql
-- RLS + audit wiring for the auth-token tables introduced in Session 2.0:
--   - email_verification_tokens
--   - password_reset_tokens
--
-- Same isolation policy as users/sessions: tenant_id = fn_current_tenant_id().
-- Audit trigger so token issuance and consumption are logged.
-- =====================================================================

-- ---------- email_verification_tokens ----------
ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verification_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS evt_tenant_isolation ON email_verification_tokens;
CREATE POLICY evt_tenant_isolation ON email_verification_tokens
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_email_verification_tokens ON email_verification_tokens;
CREATE TRIGGER trg_audit_email_verification_tokens
  AFTER INSERT OR UPDATE OR DELETE ON email_verification_tokens
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- password_reset_tokens ----------
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prt_tenant_isolation ON password_reset_tokens;
CREATE POLICY prt_tenant_isolation ON password_reset_tokens
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_password_reset_tokens ON password_reset_tokens;
CREATE TRIGGER trg_audit_password_reset_tokens
  AFTER INSERT OR UPDATE OR DELETE ON password_reset_tokens
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();
