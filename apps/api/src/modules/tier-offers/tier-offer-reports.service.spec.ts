/**
 * Unit tests for TierOfferReportsService.toCsv. The DB-bound
 * getReconciliation path is exercised via the integration spec in
 * Session 4 once the e2e harness is in place; here we cover the pure
 * CSV escaping rules so the export is robust against names that
 * contain commas, quotes, or newlines.
 */
import { describe, expect, it } from 'vitest';
import {
  type ReconciliationReport,
  TierOfferReportsService,
} from './tier-offer-reports.service.js';

function buildService(): TierOfferReportsService {
  // biome-ignore lint/suspicious/noExplicitAny: pure-function tests don't need the DB
  return new TierOfferReportsService(undefined as any);
}

function buildReport(
  rows: ReconciliationReport['rows'] = [],
  overrides: Partial<ReconciliationReport> = {},
): ReconciliationReport {
  return {
    offerId: '00000000-0000-0000-0000-00000000cccc',
    status: 'event_concluded',
    eventWindowStart: '2026-12-21T18:00:00.000Z',
    eventWindowEnd: '2026-12-21T22:00:00.000Z',
    defaultForNonResponders: 'opt_out',
    rows,
    disclaimer: null,
    ...overrides,
  };
}

describe('TierOfferReportsService.toCsv', () => {
  const svc = buildService();

  it('emits the canonical header row even when empty', () => {
    const csv = svc.toCsv(buildReport());
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'recipient_name,recipient_email,account_name,status,responded_at,jobs_completed,total_billed_cents,estimated_standard_cents,uplift_cents',
    );
    expect(lines[1]).toBe('');
  });

  it('serializes a happy-path row with no escaping needed', () => {
    const csv = svc.toCsv(
      buildReport([
        {
          recipientId: 'r1',
          recipientName: 'Sarah Lopez',
          recipientEmail: 'sarah@agero.com',
          accountId: 'a1',
          accountName: 'Agero',
          status: 'accepted',
          respondedAt: '2026-12-21T18:13:11.000Z',
          jobsCompleted: 4,
          totalBilledCents: 124000,
          estimatedStandardCents: 80000,
          upliftCents: 44000,
        },
      ]),
    );
    const lines = csv.trim().split('\n');
    expect(lines[1]).toBe(
      'Sarah Lopez,sarah@agero.com,Agero,accepted,2026-12-21T18:13:11.000Z,4,124000,80000,44000',
    );
  });

  it('quotes values with embedded commas, quotes, or newlines', () => {
    const csv = svc.toCsv(
      buildReport([
        {
          recipientId: 'r1',
          recipientName: 'Smith, Jane "Janie"',
          recipientEmail: 'jane@example.com',
          accountId: null,
          accountName: 'Acme,\nInc.',
          status: 'declined',
          respondedAt: null,
          jobsCompleted: 0,
          totalBilledCents: 0,
          estimatedStandardCents: 0,
          upliftCents: 0,
        },
      ]),
    );
    // The newline inside accountName legitimately wraps onto a second
    // physical line in the CSV — a quoted field can span lines per
    // RFC 4180. Compare against the full output rather than splitting
    // on \n.
    expect(csv).toContain('"Smith, Jane ""Janie"""');
    expect(csv).toContain('"Acme,\nInc."');
  });
});
