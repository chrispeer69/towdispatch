/**
 * PortalAccountService — read surface for an authenticated portal customer
 * (Session 32): their jobs, those jobs' detail, their invoices, and a
 * pay-link for an open invoice.
 *
 * Every query is double-scoped: tenant via RLS (runInTenantContext) AND
 * customer via an explicit `customer_id = ctx.customerId` filter. The
 * customerId comes from the verified portal JWT (PortalAuthGuard), never from
 * the request — this is what enforces cross-customer isolation within a
 * tenant (RLS only isolates by tenant). See the cross-customer service test.
 *
 * Staff-only fields (internal notes, dispatch comments, driver phone, the
 * rate breakdown) are never selected into the portal DTOs.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { drivers, invoices, jobs } from '@ustowdispatch/db';
import {
  ERROR_CODES,
  type PortalInvoiceSummaryDto,
  type PortalJobDetailDto,
  type PortalJobListResponse,
  type PortalJobSummaryDto,
  type PortalPayLinkResponse,
} from '@ustowdispatch/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { generatePlainToken } from '../auth/auth-tokens.util.js';
import type { PortalCallerCtx } from './portal-auth.service.js';

/** Invoice statuses with an online-payable balance. */
const PAYABLE_STATUSES = new Set(['issued', 'sent', 'overdue', 'partially_paid']);

@Injectable()
export class PortalAccountService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly config: ConfigService,
  ) {}

  async listJobs(ctx: PortalCallerCtx): Promise<PortalJobListResponse> {
    const rows = await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) =>
      tx.query.jobs.findMany({
        where: and(eq(jobs.customerId, ctx.customerId), isNull(jobs.deletedAt)),
        orderBy: [desc(jobs.createdAt)],
        limit: 200,
      }),
    );
    return { jobs: rows.map(toJobSummary) };
  }

  async getJob(ctx: PortalCallerCtx, jobId: string): Promise<PortalJobDetailDto> {
    return this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const job = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, jobId), eq(jobs.customerId, ctx.customerId), isNull(jobs.deletedAt)),
      });
      if (!job) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Job not found' });
      }

      let driver: PortalJobDetailDto['driver'] = null;
      if (job.assignedDriverId) {
        const d = await tx.query.drivers.findFirst({
          where: and(eq(drivers.id, job.assignedDriverId), isNull(drivers.deletedAt)),
          columns: { firstName: true, lastName: true, preferredName: true },
        });
        if (d) {
          const name = d.preferredName?.trim()
            ? d.preferredName
            : `${d.firstName} ${d.lastName}`.trim();
          // Driver photo + evidence photo sharing deferred (no driver.photo
          // column; evidence is S3-presigned via a separate provider). See
          // SESSION_32_DECISIONS.md. Fields are present so the contract is stable.
          driver = { name, photoUrl: null };
        }
      }

      const invoice = await this.latestInvoiceForJob(tx, ctx.customerId, jobId);

      const summary = toJobSummary(job);
      return {
        ...summary,
        driver,
        evidencePhotoUrls: [],
        invoice,
      };
    });
  }

  async listInvoices(ctx: PortalCallerCtx): Promise<{ invoices: PortalInvoiceSummaryDto[] }> {
    const rows = await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) =>
      tx.query.invoices.findMany({
        where: and(eq(invoices.customerId, ctx.customerId), isNull(invoices.deletedAt)),
        orderBy: [desc(invoices.createdAt)],
        limit: 200,
      }),
    );
    return { invoices: rows.map(toInvoiceSummary) };
  }

  /**
   * Ensure the invoice (which must belong to the caller's customer) has a
   * public payment_token, then return the absolute URL of the EXISTING public
   * pay page. That page renders Stripe Elements and honors PAYMENTS_PROVIDER;
   * the portal never talks to Stripe directly.
   */
  async payLink(ctx: PortalCallerCtx, invoiceId: string): Promise<PortalPayLinkResponse> {
    const token = await this.db.runInTenantContext(toTenantCtx(ctx), async (tx) => {
      const inv = await tx.query.invoices.findFirst({
        where: and(
          eq(invoices.id, invoiceId),
          eq(invoices.customerId, ctx.customerId),
          isNull(invoices.deletedAt),
        ),
      });
      if (!inv) {
        throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'Invoice not found' });
      }
      if (!isPayable(inv.status, inv.balanceCents)) {
        throw new BadRequestException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: 'This invoice is not open for online payment.',
        });
      }
      if (inv.paymentToken) return inv.paymentToken;
      const fresh = generatePlainToken();
      await tx
        .update(invoices)
        .set({ paymentToken: fresh, updatedAt: new Date() })
        .where(eq(invoices.id, inv.id));
      return fresh;
    });

    return { payUrl: `${this.config.webPublicUrl}/pay/${token}` };
  }

  private async latestInvoiceForJob(
    tx: Tx,
    customerId: string,
    jobId: string,
  ): Promise<PortalInvoiceSummaryDto | null> {
    const inv = await tx.query.invoices.findFirst({
      where: and(
        eq(invoices.jobId, jobId),
        eq(invoices.customerId, customerId),
        isNull(invoices.deletedAt),
      ),
      orderBy: [desc(invoices.createdAt)],
    });
    return inv ? toInvoiceSummary(inv) : null;
  }
}

function toTenantCtx(ctx: PortalCallerCtx): { tenantId: string; userId: string } {
  return { tenantId: ctx.tenantId, userId: ctx.portalUserId };
}

function toJobSummary(job: typeof jobs.$inferSelect): PortalJobSummaryDto {
  return {
    id: job.id,
    jobNumber: job.jobNumber,
    status: job.status,
    serviceType: job.serviceType,
    pickupAddress: job.pickupAddress,
    dropoffAddress: job.dropoffAddress ?? null,
    createdAt: job.createdAt.toISOString(),
    assignedAt: job.assignedAt ? job.assignedAt.toISOString() : null,
  };
}

function isPayable(status: string, balanceCents: number): boolean {
  return PAYABLE_STATUSES.has(status) && balanceCents > 0;
}

function toInvoiceSummary(inv: typeof invoices.$inferSelect): PortalInvoiceSummaryDto {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    totalCents: inv.totalCents,
    paidCents: inv.paidCents,
    balanceCents: inv.balanceCents,
    currency: inv.currency,
    issuedAt: inv.issuedAt ? inv.issuedAt.toISOString() : null,
    dueAt: inv.dueAt ? inv.dueAt.toISOString() : null,
    payable: isPayable(inv.status, inv.balanceCents),
  };
}
