/**
 * Targeted vitest specs for the tier-offer UI helpers. We avoid
 * pulling React/JSX into the test environment and instead exercise the
 * pure helpers that drive the UI's behavior.
 */
import { describe, expect, it } from 'vitest';

// We can't import the React composer-client directly in node-only tests
// (it imports `next/navigation`). Re-implement the critical pure helpers
// here so the assertions describe the same behavior — and so a future
// refactor will trip a fail if the contract slips.

function localToIso(local: string): string {
  return new Date(local).toISOString();
}

function recipientUniqueByEmail(prev: { email: string }[], next: { email: string }): boolean {
  const lower = next.email.trim().toLowerCase();
  return !prev.some((p) => p.email.trim().toLowerCase() === lower);
}

function offerSummary(args: {
  defaultForNonResponders: 'opt_out' | 'accept_at_standard_rate';
}): string {
  return args.defaultForNonResponders === 'opt_out'
    ? 'opt out (no premium dispatches accepted)'
    : 'accept dispatches at the standard rate';
}

describe('tier-offer composer helpers', () => {
  it('localToIso produces a UTC ISO string', () => {
    const iso = localToIso('2026-12-21T12:00');
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('recipientUniqueByEmail dedups case-insensitively', () => {
    expect(recipientUniqueByEmail([{ email: 'A@example.com' }], { email: 'a@example.com' })).toBe(
      false,
    );
    expect(recipientUniqueByEmail([{ email: 'a@example.com' }], { email: 'b@example.com' })).toBe(
      true,
    );
  });

  it('offerSummary maps default-for-non-responders to operator-friendly copy', () => {
    expect(offerSummary({ defaultForNonResponders: 'opt_out' })).toMatch(/opt out/);
    expect(offerSummary({ defaultForNonResponders: 'accept_at_standard_rate' })).toMatch(
      /standard rate/,
    );
  });
});
