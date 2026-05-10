-- =====================================================================
-- 0012_tracking.sql
--
-- Session 9 — customer-facing live tracking (SMS link + public page).
-- Adds: tracking_links, tracking_messages, job_ratings.
--
-- FORCE RLS on every new table. Audit triggers on tracking_links so
-- generated/revoked/SMS-status changes land in audit_log. Partial unique
-- index enforces "one active token per (tenant, job)" — rotating cycles
-- through revoked rows so we can see the history.
--
-- Token validation runs against this table BEFORE any tenant context is
-- established (the public route looks up tenant_id from the token row),
-- so the lookup uses the app_admin pool — see TrackingService.
-- =====================================================================

-- ---------- tracking_links ----------
ALTER TABLE tracking_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_links FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tracking_links_tenant_isolation ON tracking_links;
CREATE POLICY tracking_links_tenant_isolation ON tracking_links
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- One LIVE (non-revoked, non-expired) tracking link per job. Revoked rows
-- linger so we keep the history; only the live token can be active.
DROP INDEX IF EXISTS tracking_links_tenant_job_active_unique;
CREATE UNIQUE INDEX tracking_links_tenant_job_active_unique
  ON tracking_links (tenant_id, job_id)
  WHERE revoked_at IS NULL;

DROP TRIGGER IF EXISTS trg_audit_tracking_links ON tracking_links;
CREATE TRIGGER trg_audit_tracking_links
  AFTER INSERT OR UPDATE OR DELETE ON tracking_links
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- ---------- tracking_messages ----------
ALTER TABLE tracking_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tracking_messages_tenant_isolation ON tracking_messages;
CREATE POLICY tracking_messages_tenant_isolation ON tracking_messages
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

-- Bound message length at the DB layer so the public route can't be used
-- to write 1MB rows. Service layer enforces a tighter ceiling (1000 chars).
ALTER TABLE tracking_messages
  DROP CONSTRAINT IF EXISTS tracking_messages_body_length;
ALTER TABLE tracking_messages
  ADD CONSTRAINT tracking_messages_body_length
  CHECK (length(body) BETWEEN 1 AND 4000);

-- ---------- job_ratings ----------
ALTER TABLE job_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_ratings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_ratings_tenant_isolation ON job_ratings;
CREATE POLICY job_ratings_tenant_isolation ON job_ratings
  FOR ALL
  USING (tenant_id = fn_current_tenant_id())
  WITH CHECK (tenant_id = fn_current_tenant_id());

ALTER TABLE job_ratings
  DROP CONSTRAINT IF EXISTS job_ratings_stars_range;
ALTER TABLE job_ratings
  ADD CONSTRAINT job_ratings_stars_range
  CHECK (stars BETWEEN 1 AND 5);
