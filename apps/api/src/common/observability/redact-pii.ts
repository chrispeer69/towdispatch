/**
 * Free-text PII scrubber for log lines (Phase 0 hardening, Session 17).
 *
 * The pino logger already redacts known *structured* PII keys
 * (`*.password`, `req.headers.authorization`, …) via its `redact.paths`
 * config, and Sentry's `beforeSend` denylists custom PII fields. Neither
 * catches PII that ends up inline in a free-text error message — e.g. a
 * Postgres constraint error echoing a value, or a third-party SDK error
 * that interpolates a customer's email/phone. This pure helper closes
 * that gap: it is applied to `err.message` in the global exception filter
 * before the line is logged.
 *
 * Deliberately conservative — it only matches high-confidence PII shapes
 * (email, North-American/E.164 phone, SSN/TIN) so it never mangles UUIDs
 * (request ids), ISO timestamps, or money amounts. A bare 10-digit run
 * (e.g. `1234567890`) DOES match the phone pattern and is redacted — the
 * safe direction for an error log. In the global exception filter it is
 * applied to both the message and the stack of the LOG line only; Sentry
 * receives the original exception, so its own scrubbing + stack grouping
 * are unaffected.
 *
 * No I/O, no dependencies — unit-tested directly.
 */

// Order matters: emails are scrubbed first so the digits inside an email
// local-part/domain can't later be misread as a phone number.
const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// SSN / US TIN: 3-2-4 grouping. Scrubbed before phone so its shape isn't
// swallowed by the broader phone matcher.
const SSN_RX = /\b\d{3}-\d{2}-\d{4}\b/g;

// Phone: optional +country code, optional (area), then 3-4 digit groups
// separated by space/dot/hyphen. Requires the canonical 3-3-4 shape so it
// does not match arbitrary digit runs (cents totals, ids).
const PHONE_RX = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

/**
 * Replace high-confidence PII substrings with stable redaction markers.
 * Idempotent: running it twice yields the same string (markers contain no
 * PII shapes). Returns non-strings unchanged so it is safe to call on a
 * possibly-undefined `err.message`.
 */
export function redactPii<T>(value: T): T {
  if (typeof value !== 'string') return value;
  return value
    .replace(EMAIL_RX, '[redacted-email]')
    .replace(SSN_RX, '[redacted-ssn]')
    .replace(PHONE_RX, '[redacted-phone]') as unknown as T;
}
