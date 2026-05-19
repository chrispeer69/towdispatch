/**
 * TierOfferReportsService — reconciliation report for a single tier
 * offer. Per-recipient outcome (accepted / declined / pending) plus the
 * actual jobs each motor-club account ran during the offer's event
 * window, with billed totals and an estimated standard-rate baseline so
 * the operator can see uplift / shortfall.
 *
 * The CSV export uses the same data shape so accounting can pull it
 * straight into a spreadsheet.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { accounts, invoices, jobs, tierOfferRecipients, tierOffers } from '@ustowdispatch/db';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';

interface CallerCtx {
  tenantId: string;
  userId: string;
  requestId: string;
}

export interface ReconciliationRow {
  recipientId: string;
  recipientName: string;
  recipientEmail: string;
  accountId: string | null;
  accountName: string | null;
  status: string;
  respondedAt: string | null;
  jobsCompleted: number;
  totalBilledCents: number;
  estimatedStandardCents: number;
  upliftCents: number;
}

export interface ReconciliationReport {
  offerId: string;
  status: string;
  eventWindowStart: string;
  eventWindowEnd: string;
  defaultForNonResponders: string;
  rows: ReconciliationRow[];
  /** Set when the offer was cancelled before send so the caller can render a friendly note. */
  disclaimer: string | null;
}

@Injectable()
export class TierOfferReportsService {
  constructor(private readonly db: TenantAwareDb) {}

  async getReconciliation(ctx: CallerCtx, offerId: string): Promise<ReconciliationReport> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const offer = await tx.query.tierOffers.findFirst({
        where: and(eq(tierOffers.id, offerId), isNull(tierOffers.deletedAt)),
      });
      if (!offer) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Offer not found' });
      }
      const recipients = await tx.query.tierOfferRecipients.findMany({
        where: and(eq(tierOfferRecipients.offerId, offerId), isNull(tierOfferRecipients.deletedAt)),
      });
      const rows: ReconciliationRow[] = [];
      for (const r of recipients) {
        let accountName: string | null = null;
        if (r.accountId) {
          const a = await tx.query.accounts.findFirst({
            where: eq(accounts.id, r.accountId),
          });
          accountName = a?.name ?? null;
        }
        // Jobs completed during the event window for this account. We
        // count only `completed` jobs; cancelled/goa rows are excluded.
        let jobsCompleted = 0;
        let totalBilledCents = 0;
        let estimatedStandardCents = 0;
        if (r.accountId) {
          const jobRows = await tx.query.jobs.findMany({
            where: and(
              eq(jobs.tenantId, ctx.tenantId),
              eq(jobs.accountId, r.accountId),
              eq(jobs.status, 'completed'),
              gte(jobs.createdAt, offer.eventWindowStart),
              lte(jobs.createdAt, offer.eventWindowEnd),
            ),
          });
          for (const j of jobRows) {
            jobsCompleted += 1;
            // Use the matching invoice's total when present, else fall
            // back to the rate quoted at intake.
            const inv = await tx.query.invoices.findFirst({
              where: and(eq(invoices.tenantId, ctx.tenantId), eq(invoices.jobId, j.id)),
            });
            const billed = inv?.totalCents ?? j.rateQuotedCents ?? 0;
            totalBilledCents += billed;
            // Estimated standard: billed divided by the offer's tier
            // multiplier when this row was the elevated rate. The breakdown
            // jsonb captures the multiplier; we read it defensively.
            const breakdown = j.rateBreakdown as { multiplier?: number } | null;
            const mult =
              r.status === 'accepted' &&
              j.tierOfferId === offer.id &&
              typeof breakdown?.multiplier === 'number' &&
              breakdown.multiplier > 0
                ? breakdown.multiplier
                : 1;
            estimatedStandardCents += Math.round(billed / mult);
          }
        }
        rows.push({
          recipientId: r.id,
          recipientName: r.recipientName,
          recipientEmail: r.recipientEmail,
          accountId: r.accountId,
          accountName,
          status: r.status,
          respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
          jobsCompleted,
          totalBilledCents,
          estimatedStandardCents,
          upliftCents: totalBilledCents - estimatedStandardCents,
        });
      }
      const disclaimer =
        offer.status === 'cancelled'
          ? 'Offer was cancelled before send. Reconciliation is empty by design.'
          : offer.status === 'draft'
            ? 'Offer is still a draft. Reconciliation will populate after send + event conclusion.'
            : null;
      return {
        offerId: offer.id,
        status: offer.status,
        eventWindowStart: offer.eventWindowStart.toISOString(),
        eventWindowEnd: offer.eventWindowEnd.toISOString(),
        defaultForNonResponders: offer.defaultForNonResponders,
        rows,
        disclaimer,
      };
    });
  }

  toCsv(report: ReconciliationReport): string {
    const head = [
      'recipient_name',
      'recipient_email',
      'account_name',
      'status',
      'responded_at',
      'jobs_completed',
      'total_billed_cents',
      'estimated_standard_cents',
      'uplift_cents',
    ];
    const csvCell = (v: string | number | null): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const lines = [head.join(',')];
    for (const r of report.rows) {
      lines.push(
        [
          csvCell(r.recipientName),
          csvCell(r.recipientEmail),
          csvCell(r.accountName),
          csvCell(r.status),
          csvCell(r.respondedAt),
          csvCell(r.jobsCompleted),
          csvCell(r.totalBilledCents),
          csvCell(r.estimatedStandardCents),
          csvCell(r.upliftCents),
        ].join(','),
      );
    }
    return `${lines.join('\n')}\n`;
  }

  private toTenantCtx(ctx: CallerCtx): { tenantId: string; userId: string; requestId: string } {
    return { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId };
  }
}
