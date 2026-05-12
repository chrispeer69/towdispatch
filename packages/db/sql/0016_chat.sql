-- =====================================================================
-- 0016_chat.sql
--
-- Session 6.2 — driver↔dispatcher chat. RLS + check constraints + the
-- partial unique index that backs idempotency on chat_messages.
--
-- Invariants enforced here:
--   * tenant_id isolation on both chat_threads and chat_messages (FORCE RLS).
--   * author_role is constrained to the application enum.
--   * attachment_type is constrained to the application enum.
--   * A message has body or attachment (or both) — purely empty messages are
--     rejected at the DB layer as a belt to the service-layer suspenders.
--   * Per-(tenant, thread) idempotency on client_message_id when supplied.
-- =====================================================================

-- ---------- chat_threads ----------
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_threads FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_threads_tenant_isolation ON chat_threads;
CREATE POLICY chat_threads_tenant_isolation ON chat_threads
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

DROP TRIGGER IF EXISTS trg_audit_chat_threads ON chat_threads;
CREATE TRIGGER trg_audit_chat_threads
  AFTER INSERT OR UPDATE OR DELETE ON chat_threads
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- chat_messages ----------
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_messages_tenant_isolation ON chat_messages;
CREATE POLICY chat_messages_tenant_isolation ON chat_messages
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

ALTER TABLE chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_author_role_allowed;
ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_author_role_allowed
  CHECK (author_role IN ('driver', 'dispatcher', 'admin', 'manager'));

ALTER TABLE chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_attachment_type_allowed;
ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_attachment_type_allowed
  CHECK (attachment_type IN ('none', 'voice_memo', 'photo', 'video'));

-- Body or attachment must be present. An attachment_type other than 'none'
-- requires an attachment_url; conversely 'none' requires a non-empty body.
ALTER TABLE chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_body_or_attachment;
ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_body_or_attachment
  CHECK (
    (attachment_type = 'none' AND body IS NOT NULL AND length(body) BETWEEN 1 AND 4000)
    OR (attachment_type <> 'none' AND attachment_url IS NOT NULL)
  );

DROP TRIGGER IF EXISTS trg_audit_chat_messages ON chat_messages;
CREATE TRIGGER trg_audit_chat_messages
  AFTER INSERT OR UPDATE OR DELETE ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- Idempotency: a partial unique index ensures the same (tenant, thread,
-- client_message_id) is at most one row. Service layer reads back the
-- existing row when a dupe key arrives within the 24h retry window.
DROP INDEX IF EXISTS chat_messages_tenant_thread_client_unique;
CREATE UNIQUE INDEX chat_messages_tenant_thread_client_unique
  ON chat_messages (tenant_id, thread_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
