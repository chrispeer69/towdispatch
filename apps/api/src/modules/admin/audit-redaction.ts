/**
 * Secret redaction for audit_log row snapshots (Session 31 — SOC 2).
 *
 * audit_log.before_state / after_state are full `to_jsonb(row)` blobs. For
 * audited tables that hold secrets — users (password_hash, totp_secret_encrypted,
 * mfa_recovery_codes), the *_tokens tables (token_hash), driver_pins (pin_hash) —
 * returning the blob verbatim from GET /admin/audit-log would leak those secrets
 * to anyone with the admin/auditor role. That would make the very control we are
 * shipping ("auditability WITHOUT exposing secrets") fail its own evidence.
 *
 * We redact by field name, safe-by-default: any key whose (lowercased) name ends
 * in `_hash`, or contains `secret`, `password`, `recovery_codes`, or
 * `backup_codes`, is replaced with REDACTED. This covers every known secret
 * column and any future one that follows the repo's naming conventions, without
 * an allowlist to keep in sync. Redaction recurses into nested objects/arrays so
 * jsonb columns (and array columns like mfa_recovery_codes) are covered too.
 *
 * Pure + dependency-free so it can be unit-tested without a database.
 */
export const REDACTED = '[REDACTED]';

/** True when a field name should never be exposed in the audit reader. */
export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.endsWith('_hash') ||
    k.includes('secret') ||
    k.includes('password') ||
    k.includes('recovery_codes') ||
    k.includes('backup_codes')
  );
}

/**
 * Returns a deep copy of `state` with every sensitive value replaced by
 * REDACTED. Non-sensitive values pass through untouched. `null` in, `null` out.
 */
export function redactState(state: Record<string, unknown> | null): Record<string, unknown> | null {
  if (state === null) return null;
  return redactRecord(state);
}

function redactValue(key: string, value: unknown): unknown {
  if (isSensitiveKey(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redactNested(v));
  if (value !== null && typeof value === 'object') {
    return redactRecord(value as Record<string, unknown>);
  }
  return value;
}

function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = redactValue(key, value);
  }
  return out;
}

// Array elements have no key of their own; recurse into objects, pass scalars.
function redactNested(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => redactNested(v));
  if (value !== null && typeof value === 'object') {
    return redactRecord(value as Record<string, unknown>);
  }
  return value;
}
