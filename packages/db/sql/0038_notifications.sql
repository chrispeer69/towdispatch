-- =====================================================================
-- 0038_notifications.sql  (Session 15)
--
-- Wires the Session 15 notification tables into the platform security model:
-- RLS, FORCE RLS, audit triggers, partial uniques the dispatcher/preferences
-- resolver / templates loader rely on.
--
-- Tables (created in drizzle/0011_notifications.sql):
--   * notifications, notification_deliveries, notification_preferences,
--     notification_quiet_hours, notification_templates,
--     webhook_subscriptions, webhook_deliveries, notification_dead_letters,
--     notification_device_tokens
--
-- Invariants:
--   * notifications.idempotency_key is unique per (tenant_id) inside the
--     dedup window — partial unique on (tenant_id, idempotency_key) where
--     idempotency_expires_at > now()
--   * notification_preferences row is unique per
--     (tenant_id, COALESCE(user_id,'0000…'), event_category, channel)
--   * notification_templates is unique per (tenant scope, template_key, channel):
--     two partial unique indexes — one for system templates (tenant_id IS NULL)
--     and one for tenant overrides (tenant_id IS NOT NULL).
--   * notification_device_tokens.token is unique per tenant. The cross-tenant
--     isolation rule ("a token registered under one tenant cannot receive
--     notifications targeted to another") is enforced by RLS on the
--     deliveries side, not by a global uniqueness constraint — a user who
--     belongs to two tenants legitimately has two rows.
-- =====================================================================

-- ---------- notifications ----------
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_priority_chk;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_priority_chk
  CHECK (priority IN ('emergency','high','normal','low'));

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_status_chk;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_status_chk
  CHECK (status IN ('pending','dispatched','partially_failed','failed','delivered','cancelled'));

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_recipient_present_chk;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_recipient_present_chk
  CHECK (recipient_user_id IS NOT NULL OR recipient_role_scope IS NOT NULL);

DROP INDEX IF EXISTS notifications_tenant_idempotency_active_unique;
CREATE UNIQUE INDEX notifications_tenant_idempotency_active_unique
  ON notifications (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND idempotency_expires_at IS NOT NULL
    AND idempotency_expires_at > now();

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_tenant_isolation ON notifications;
CREATE POLICY notifications_tenant_isolation ON notifications
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_notifications ON notifications;
CREATE TRIGGER trg_audit_notifications
  AFTER INSERT OR UPDATE OR DELETE ON notifications
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

GRANT SELECT, INSERT, UPDATE ON notifications TO app_user;

-- ---------- notification_deliveries ----------
ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_channel_chk;
ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_channel_chk
  CHECK (channel IN ('push','sms','email','in_app','webhook'));

ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_status_chk;
ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_status_chk
  CHECK (status IN ('queued','sent','delivered','failed','bounced','suppressed','dead_lettered'));

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_deliveries_tenant_isolation ON notification_deliveries;
CREATE POLICY notification_deliveries_tenant_isolation ON notification_deliveries
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_notification_deliveries ON notification_deliveries;
CREATE TRIGGER trg_audit_notification_deliveries
  AFTER INSERT OR UPDATE OR DELETE ON notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

GRANT SELECT, INSERT, UPDATE ON notification_deliveries TO app_user;

-- ---------- notification_preferences ----------
ALTER TABLE notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_channel_chk;
ALTER TABLE notification_preferences
  ADD CONSTRAINT notification_preferences_channel_chk
  CHECK (channel IN ('push','sms','email','in_app','webhook'));

-- Partial unique on the tenant-default rows (user_id IS NULL).
DROP INDEX IF EXISTS notification_preferences_tenant_default_unique;
CREATE UNIQUE INDEX notification_preferences_tenant_default_unique
  ON notification_preferences (tenant_id, event_category, channel)
  WHERE user_id IS NULL;

-- Partial unique on per-user overrides.
DROP INDEX IF EXISTS notification_preferences_user_unique;
CREATE UNIQUE INDEX notification_preferences_user_unique
  ON notification_preferences (tenant_id, user_id, event_category, channel)
  WHERE user_id IS NOT NULL;

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_preferences_tenant_isolation ON notification_preferences;
CREATE POLICY notification_preferences_tenant_isolation ON notification_preferences
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_notification_preferences ON notification_preferences;
CREATE TRIGGER trg_audit_notification_preferences
  AFTER INSERT OR UPDATE OR DELETE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

GRANT SELECT, INSERT, UPDATE, DELETE ON notification_preferences TO app_user;

-- ---------- notification_quiet_hours ----------
ALTER TABLE notification_quiet_hours
  DROP CONSTRAINT IF EXISTS notification_quiet_hours_local_format_chk;
ALTER TABLE notification_quiet_hours
  ADD CONSTRAINT notification_quiet_hours_local_format_chk
  CHECK (
    start_local ~ '^[0-2][0-9]:[0-5][0-9]$'
    AND end_local ~ '^[0-2][0-9]:[0-5][0-9]$'
  );

ALTER TABLE notification_quiet_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_quiet_hours FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_quiet_hours_tenant_isolation ON notification_quiet_hours;
CREATE POLICY notification_quiet_hours_tenant_isolation ON notification_quiet_hours
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON notification_quiet_hours TO app_user;

-- ---------- notification_templates ----------
ALTER TABLE notification_templates
  DROP CONSTRAINT IF EXISTS notification_templates_channel_chk;
ALTER TABLE notification_templates
  ADD CONSTRAINT notification_templates_channel_chk
  CHECK (channel IN ('push','sms','email','in_app','webhook'));

-- System defaults (tenant_id IS NULL): one row per (template_key, channel).
DROP INDEX IF EXISTS notification_templates_system_unique;
CREATE UNIQUE INDEX notification_templates_system_unique
  ON notification_templates (template_key, channel)
  WHERE tenant_id IS NULL;

-- Tenant overrides: one row per (tenant_id, template_key, channel).
DROP INDEX IF EXISTS notification_templates_tenant_unique;
CREATE UNIQUE INDEX notification_templates_tenant_unique
  ON notification_templates (tenant_id, template_key, channel)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates FORCE ROW LEVEL SECURITY;

-- System templates (tenant_id IS NULL) are readable by every tenant, but
-- only writable by app_admin. Tenant rows are read/write within tenant.
DROP POLICY IF EXISTS notification_templates_read ON notification_templates;
CREATE POLICY notification_templates_read ON notification_templates
  FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = fn_current_tenant_id());

DROP POLICY IF EXISTS notification_templates_write ON notification_templates;
CREATE POLICY notification_templates_write ON notification_templates
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_notification_templates ON notification_templates;
CREATE TRIGGER trg_audit_notification_templates
  AFTER INSERT OR UPDATE OR DELETE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

GRANT SELECT, INSERT, UPDATE, DELETE ON notification_templates TO app_user;

-- ---------- webhook_subscriptions ----------
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_subscriptions_tenant_isolation ON webhook_subscriptions;
CREATE POLICY webhook_subscriptions_tenant_isolation ON webhook_subscriptions
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_webhook_subscriptions ON webhook_subscriptions;
CREATE TRIGGER trg_audit_webhook_subscriptions
  AFTER INSERT OR UPDATE OR DELETE ON webhook_subscriptions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_subscriptions TO app_user;

-- ---------- webhook_deliveries ----------
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_deliveries_tenant_isolation ON webhook_deliveries;
CREATE POLICY webhook_deliveries_tenant_isolation ON webhook_deliveries
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON webhook_deliveries TO app_user;

-- ---------- notification_dead_letters ----------
ALTER TABLE notification_dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_dead_letters FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_dead_letters_tenant_isolation ON notification_dead_letters;
CREATE POLICY notification_dead_letters_tenant_isolation ON notification_dead_letters
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON notification_dead_letters TO app_user;

-- ---------- notification_device_tokens ----------
ALTER TABLE notification_device_tokens
  DROP CONSTRAINT IF EXISTS notification_device_tokens_platform_chk;
ALTER TABLE notification_device_tokens
  ADD CONSTRAINT notification_device_tokens_platform_chk
  CHECK (platform IN ('android','ios','web'));

ALTER TABLE notification_device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_device_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_device_tokens_tenant_isolation ON notification_device_tokens;
CREATE POLICY notification_device_tokens_tenant_isolation ON notification_device_tokens
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_notification_device_tokens ON notification_device_tokens;
CREATE TRIGGER trg_audit_notification_device_tokens
  AFTER INSERT OR UPDATE OR DELETE ON notification_device_tokens
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

GRANT SELECT, INSERT, UPDATE ON notification_device_tokens TO app_user;
