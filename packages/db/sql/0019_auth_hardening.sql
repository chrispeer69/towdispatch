-- =====================================================================
-- 0019_auth_hardening.sql
-- Phase 0 hardening: per-IP failed-login telemetry + lockout escalation.
--
-- The existing users.failed_login_count + locked_until pair handles the
-- per-account streak but offers no visibility into distributed brute-force
-- across many emails, and no record of legitimate user lockouts over time.
-- This migration adds:
--
--   - login_attempts: append-only log of every login attempt (success or
--     failure) keyed by email, IP, and timestamp. Sliding-window queries
--     against this drive both per-IP rate-limits and account locks.
--
--   - users.lockout_streak: integer count of consecutive lockout events
--     for a single account. Drives the doubling-backoff lockout duration
--     (15m → 30m → 60m → max 24h) without burning a separate table.
--
--   - sessions.family_id: stable identifier for a refresh-token chain.
--     rotated_from_id already links each refresh to its parent, but a
--     family_id makes "revoke all in this lineage" a single UPDATE.
--
--   - login_alert_emails_sent: idempotency table for the new-device email.
--     Avoids spamming users when the same IP/user-agent fingerprint logs
--     in repeatedly.
-- =====================================================================

-- ---------- login_attempts ----------
CREATE TABLE IF NOT EXISTS login_attempts (
  id uuid PRIMARY KEY,
  email_hash text NOT NULL,
  -- The email is hashed (sha256, lowercase, salted) before storage so a
  -- compromised attempts log doesn't enumerate every user account.
  ip_address text,
  user_agent text,
  outcome text NOT NULL CHECK (outcome IN ('success', 'bad_password', 'unknown_user', 'locked', 'mfa_required', 'mfa_failed')),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  -- Optional ref to the matched user (NULL when outcome=unknown_user). No
  -- FK constraint because users can be soft-deleted and we want the log to
  -- outlive them.
  user_id uuid,
  tenant_id uuid
);

CREATE INDEX IF NOT EXISTS login_attempts_email_attempted_idx
  ON login_attempts (email_hash, attempted_at DESC);
CREATE INDEX IF NOT EXISTS login_attempts_ip_attempted_idx
  ON login_attempts (ip_address, attempted_at DESC)
  WHERE ip_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS login_attempts_user_attempted_idx
  ON login_attempts (user_id, attempted_at DESC)
  WHERE user_id IS NOT NULL;

-- login_attempts is global (covers attempts against unknown emails and
-- attempts across all tenants), so RLS is NOT enabled. The table is only
-- written by the auth service and never read by tenant-scoped code paths.

-- ---------- users: lockout_streak ----------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS lockout_streak integer NOT NULL DEFAULT 0;

-- ---------- sessions: family_id ----------
-- Backfill: each existing root session (rotated_from_id IS NULL) starts a
-- new family with family_id = id. Children inherit via a recursive update.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS family_id uuid;

UPDATE sessions SET family_id = id WHERE family_id IS NULL AND rotated_from_id IS NULL;

-- Walk the chain. Bounded depth: rotation chains are short in practice
-- (every refresh = one row) and any chain longer than 1000 entries
-- indicates a runaway loop worth aborting.
WITH RECURSIVE chain AS (
  SELECT id, id AS family
  FROM sessions
  WHERE rotated_from_id IS NULL
  UNION ALL
  SELECT s.id, c.family
  FROM sessions s
  JOIN chain c ON s.rotated_from_id = c.id
)
UPDATE sessions s
SET family_id = chain.family
FROM chain
WHERE s.id = chain.id AND s.family_id IS NULL;

CREATE INDEX IF NOT EXISTS sessions_family_idx
  ON sessions (tenant_id, family_id)
  WHERE family_id IS NOT NULL;

-- ---------- login_alert_emails_sent ----------
CREATE TABLE IF NOT EXISTS login_alert_emails_sent (
  user_id uuid NOT NULL,
  fingerprint_hash text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, fingerprint_hash)
);

-- =====================================================================
-- DOWN (manual): drops are not auto-generated. To revert, run:
--   DROP TABLE login_alert_emails_sent;
--   ALTER TABLE sessions DROP COLUMN family_id;
--   ALTER TABLE users DROP COLUMN lockout_streak;
--   DROP TABLE login_attempts;
-- =====================================================================
