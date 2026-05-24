import { describe, expect, it } from 'vitest';
import { redactPii } from './redact-pii.js';

describe('redactPii', () => {
  it('redacts an email address', () => {
    expect(redactPii('user jane.doe@example.com not found')).toBe(
      'user [redacted-email] not found',
    );
  });

  it('redacts plus-addressed and subdomain emails', () => {
    expect(redactPii('to a.b+tag@mail.corp.co.uk')).toBe('to [redacted-email]');
  });

  it('redacts a US SSN', () => {
    expect(redactPii('ssn 123-45-6789 on file')).toBe('ssn [redacted-ssn] on file');
  });

  it('redacts phone numbers in common formats', () => {
    expect(redactPii('call (555) 123-4567')).toBe('call [redacted-phone]');
    expect(redactPii('call 555-123-4567')).toBe('call [redacted-phone]');
    expect(redactPii('call 555.123.4567')).toBe('call [redacted-phone]');
    expect(redactPii('call +1 555 123 4567')).toBe('call [redacted-phone]');
  });

  it('redacts multiple distinct PII types in one string', () => {
    expect(redactPii('contact bob@x.io or 555-123-4567')).toBe(
      'contact [redacted-email] or [redacted-phone]',
    );
  });

  it('is idempotent — running twice changes nothing further', () => {
    const once = redactPii('email a@b.com phone 555-123-4567');
    expect(redactPii(once)).toBe(once);
  });

  it('does NOT mangle a UUID / request id', () => {
    const uuid = '0190f8c2-7b3a-7e21-9c4d-1f2e3a4b5c6d';
    expect(redactPii(`requestId ${uuid}`)).toBe(`requestId ${uuid}`);
  });

  it('does NOT mangle ISO timestamps or money amounts', () => {
    expect(redactPii('at 2026-05-24T02:00:00.000Z total 1234567 cents')).toBe(
      'at 2026-05-24T02:00:00.000Z total 1234567 cents',
    );
  });

  it('returns non-string values unchanged', () => {
    expect(redactPii(42)).toBe(42);
    expect(redactPii(null)).toBe(null);
    expect(redactPii(undefined)).toBe(undefined);
    const obj = { a: 1 };
    expect(redactPii(obj)).toBe(obj);
  });

  it('handles a realistic Postgres constraint error message', () => {
    const msg =
      'duplicate key value violates unique constraint "users_email_key" Detail: Key (email)=(leak@corp.com) already exists.';
    expect(redactPii(msg)).toContain('[redacted-email]');
    expect(redactPii(msg)).not.toContain('leak@corp.com');
  });
});
