-- =====================================================================
-- 0020_mfa.sql
--
-- MFA enrollment hardening. The Session-2 scaffolding (mfa_enabled +
-- totp_secret_encrypted columns) only covers a single TOTP secret. The
-- post-Phase-0 MFA flow needs:
--
--   * mfa_enrolled_at      — when the user finished verify-setup. Lets
--                            us audit who has enrolled vs. who only
--                            generated a secret then bounced.
--   * mfa_recovery_codes   — text[] of 10 single-use codes, each stored
--                            as a sha256 hex digest. plaintext is shown
--                            to the user once, never persisted.
--   * mfa_failed_attempts  — counter for the challenge endpoint. A
--                            separate counter from the password
--                            lockout's failed_login_count so a bad
--                            TOTP doesn't burn a password attempt and
--                            vice versa.
--   * mfa_locked_until     — short MFA lock that expires automatically;
--                            5 failed challenges in 15m → lock 15m.
--
-- All columns are nullable / defaulted so existing rows continue to
-- work without a backfill. Idempotent — safe to re-run.
-- =====================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at timestamptz;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_recovery_codes text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_locked_until timestamptz;

CREATE INDEX IF NOT EXISTS users_mfa_locked_idx
  ON users (mfa_locked_until)
  WHERE mfa_locked_until IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Reset partial MFA state for the founder's account so the enrollment flow
-- starts clean. Without this, anyone who hit the half-broken setup endpoint
-- pre-fix carries a stale totp_secret_encrypted from a phantom enrollment.
--
-- Bounded to a single email; safe in shared / blank DBs because the WHERE
-- matches nothing in the blank case.
-- ---------------------------------------------------------------------------
UPDATE users
   SET mfa_enabled = false,
       totp_secret_encrypted = NULL,
       mfa_enrolled_at = NULL,
       mfa_recovery_codes = '{}'::text[],
       mfa_failed_attempts = 0,
       mfa_locked_until = NULL,
       updated_at = now()
 WHERE lower(email) = 'chrispeer69@yahoo.com';
