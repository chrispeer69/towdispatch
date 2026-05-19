-- =====================================================================
-- 0035_jobs_tier_offer_linkage.sql  (Tier Offer Composer — Session 2)
--
-- Threads the Tier Offer Composer (Moat #3) into the jobs table so
-- enforcement at job-creation time can record which offer (if any)
-- governed the dispatch and what the operator's required action is.
--
-- Three new columns:
--   * tier_offer_id                       — the offer the job was governed by
--   * tier_offer_recipient_id             — the per-recipient row (one offer can have many)
--   * tier_offer_enforcement_status       — { 'accepted' | 'declined' | 'pending' | 'none' }
--
-- 'accepted' means the motor club explicitly accepted the offer; the
-- existing tier-resolution flow auto-applies the elevated tier and the
-- dispatch board shows a green "Tier accepted" badge. 'declined' /
-- 'pending' means the dispatch board flags the job for operator review;
-- the operator can decline the dispatch with a structured reason or
-- accept it at the standard rate. 'none' is the default when no active
-- offer exists.
--
-- Patterns followed (mirrors 0034 + 0033):
--   * ADD COLUMN IF NOT EXISTS — fully idempotent on re-run.
--   * Foreign keys ON DELETE SET NULL — losing an offer should not
--     orphan jobs.
--   * Partial index on (tenant_id, tier_offer_enforcement_status)
--     WHERE tier_offer_enforcement_status <> 'none' — supports the
--     dispatch-board flagged-jobs filter without bloating the index for
--     unflagged jobs (the vast majority).
--   * RLS policy on jobs already exists; new columns are automatically
--     covered by the existing tenant_id-based policy.
--   * Audit trigger on jobs already exists; new columns are captured
--     by the existing fn_audit_log() trigger.
--
-- Down (rollback):
--   DROP INDEX IF EXISTS jobs_tenant_tier_offer_enforcement_idx;
--   ALTER TABLE jobs DROP COLUMN IF EXISTS tier_offer_enforcement_status;
--   ALTER TABLE jobs DROP COLUMN IF EXISTS tier_offer_recipient_id;
--   ALTER TABLE jobs DROP COLUMN IF EXISTS tier_offer_id;
-- =====================================================================
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS tier_offer_id uuid REFERENCES tier_offers(id) ON DELETE SET NULL;
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS tier_offer_recipient_id uuid REFERENCES tier_offer_recipients(id) ON DELETE SET NULL;
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS tier_offer_enforcement_status text NOT NULL DEFAULT 'none';

-- Whitelist allowed values. Constraint is dropped + re-added so the SQL
-- is idempotent; the literal whitelist matches the four possible
-- TierOfferEnforcementStatus values produced by TierOfferEnforcementService.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_tier_offer_enforcement_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_tier_offer_enforcement_status_check
  CHECK (tier_offer_enforcement_status IN ('accepted', 'declined', 'pending', 'none'));

CREATE INDEX IF NOT EXISTS jobs_tenant_tier_offer_enforcement_idx
  ON jobs (tenant_id, tier_offer_enforcement_status)
  WHERE tier_offer_enforcement_status <> 'none';
