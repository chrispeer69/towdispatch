/**
 * InvoiceReviewService — backs the dispatcher Invoice Review screen
 * (Admin Settings build 4 of 6).
 *
 * Three concerns:
 *   1. GET review payload — joined view of a draft invoice + its lines +
 *      its assigned drivers (from job_driver_assignments) + the existing
 *      commission ledger. Only draft invoices are served here; the
 *      regular /invoices/:id endpoint owns posted invoices.
 *   2. PATCH review — edits lines and commissions inside one atomic
 *      transaction. Per-line commission % sums are validated client-side
 *      and at the DB (trg_invoice_line_commission_sum_check); this layer
 *      also pre-checks for a friendly error message.
 *   3. POST invoice — atomically transitions draft → posted (via the
 *      existing InvoicesService.issue flow), freezes commission_amount_cents
 *      for every commission row at line.lineTotalCents × pct / 100, and
 *      audit-logs the transition. Idempotent: returns 409 if already
 *      past draft.
 *
 * Auto-draft hook: createDraftCommissionsForJob() is called by
 * InvoicesService.generateFromJob() after it has inserted line items.
 * It reads the job's assigned drivers (job_driver_assignments) and seeds
 * one commission row per (line, driver) with the driver's
 * default_commission_pct (split evenly if multiple drivers and no
 * default is set). Idempotent — skips lines that already have
 * commissions, so re-running generateFromJob on the same job is safe.
 *
 * Driver visibility wall: every read path here is gated by the
 * BillingController's @Roles guard (owner / admin / manager /
 * dispatcher / accounting). Driver-role callers never touch this
 * service.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  accounts,
  customers,
  drivers,
  invoiceLineCommissions,
  invoiceLineItems,
  invoices,
  jobDriverAssignments,
  jobs,
  uuidv7,
} from '@towdispatch/db';
import {
  type AccountSummaryDto,
  type CustomerSummaryDto,
  type DriverSummaryDto,
  ERROR_CODES,
  type InvoiceLineCommissionDto,
  type InvoiceReviewDto,
  type PostInvoiceResponse,
  type ReviewJobSummaryDto,
  type UpdateInvoiceReviewPayload,
} from '@towdispatch/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import { InvoicesService } from './invoices.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class InvoiceReviewService {
  constructor(
    private readonly db: TenantAwareDb,
    private readonly invoicesService: InvoicesService,
  ) {}

  // =====================================================================
  // GET /invoices/:id/review
  // =====================================================================

  async getReview(ctx: CallerContext, invoiceId: string): Promise<InvoiceReviewDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const inv = await tx.query.invoices.findFirst({
        where: and(eq(invoices.id, invoiceId), isNull(invoices.deletedAt)),
      });
      if (!inv) throw notFound('Invoice not found');
      if (inv.status !== 'draft') {
        throw new BadRequestException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: 'Only draft invoices have a review payload. Posted invoices use /invoices/:id.',
        });
      }
      return this.assembleReview(tx, inv.id);
    });
  }

  // =====================================================================
  // PATCH /invoices/:id/review
  // =====================================================================

  async updateReview(
    ctx: CallerContext,
    invoiceId: string,
    body: UpdateInvoiceReviewPayload,
  ): Promise<InvoiceReviewDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const inv = await tx.query.invoices.findFirst({
        where: and(eq(invoices.id, invoiceId), isNull(invoices.deletedAt)),
      });
      if (!inv) throw notFound('Invoice not found');
      if (inv.status !== 'draft') {
        throw new BadRequestException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: 'Only draft invoices can be edited',
        });
      }

      // --- 1. Notes ---
      if (body.notes !== undefined || body.internalNotes !== undefined) {
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (body.notes !== undefined) patch.notes = body.notes;
        if (body.internalNotes !== undefined) patch.internalNotes = body.internalNotes;
        await tx.update(invoices).set(patch).where(eq(invoices.id, invoiceId));
      }

      // --- 2. Line item edits ---
      if (body.lineItems && body.lineItems.length > 0) {
        const lineRows = await tx.query.invoiceLineItems.findMany({
          where: eq(invoiceLineItems.invoiceId, invoiceId),
        });
        const byId = new Map(lineRows.map((r) => [r.id, r]));
        for (const li of body.lineItems) {
          const existing = byId.get(li.id);
          if (!existing) {
            throw notFound(`Line item ${li.id} not on invoice ${invoiceId}`);
          }
          const patch: Record<string, unknown> = { updatedAt: new Date() };
          const nextQty =
            li.quantity !== undefined ? String(li.quantity) : (existing.quantity as string);
          const nextUnit = li.unit ?? existing.unit;
          const nextUnitPrice = li.unitPriceCents ?? existing.unitPriceCents;
          if (li.description !== undefined) patch.description = li.description;
          if (li.quantity !== undefined) patch.quantity = nextQty;
          if (li.unit !== undefined) patch.unit = nextUnit;
          if (li.unitPriceCents !== undefined) patch.unitPriceCents = nextUnitPrice;
          if (li.taxable !== undefined) patch.taxable = li.taxable;
          if (li.taxRatePct !== undefined) patch.taxRatePct = String(li.taxRatePct);

          const finalTotal =
            li.lineTotalCents !== undefined
              ? li.lineTotalCents
              : Math.round(Number(nextQty) * Number(nextUnitPrice));
          patch.lineTotalCents = finalTotal;

          await tx.update(invoiceLineItems).set(patch).where(eq(invoiceLineItems.id, li.id));
        }
        // Recompute totals + taxes after line edits.
        await this.invoicesService.recomputeTotals(tx, ctx.tenantId, invoiceId);
      }

      // --- 3. Ensure additional drivers are assigned to the job ---
      if (body.assignedDriverIds && body.assignedDriverIds.length > 0 && inv.jobId) {
        await this.ensureDriversAssignedToJob(tx, ctx, inv.jobId, body.assignedDriverIds);
      }

      // --- 4. Commission replacement (per-line full overwrite of referenced lines) ---
      if (body.commissions) {
        await this.replaceCommissions(tx, ctx, inv, body.commissions);
      }

      return this.assembleReview(tx, invoiceId);
    });
  }

  // =====================================================================
  // POST /invoices/:id/post
  // =====================================================================

  async postInvoice(ctx: CallerContext, invoiceId: string): Promise<PostInvoiceResponse> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const inv = await tx.query.invoices.findFirst({
        where: and(eq(invoices.id, invoiceId), isNull(invoices.deletedAt)),
      });
      if (!inv) throw notFound('Invoice not found');
      if (inv.status !== 'draft') {
        throw new ConflictException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: `Invoice ${invoiceId} is already ${inv.status}; cannot post again`,
        });
      }

      // Freeze commission amounts now (line.lineTotalCents × pct / 100).
      const lineRows = await tx.query.invoiceLineItems.findMany({
        where: eq(invoiceLineItems.invoiceId, invoiceId),
      });
      const lineTotalById = new Map(lineRows.map((l) => [l.id, l.lineTotalCents]));

      const commRows = await tx.query.invoiceLineCommissions.findMany({
        where: eq(invoiceLineCommissions.invoiceId, invoiceId),
      });

      // Validate per-line sum ≤ 100. The DB trigger will also catch this,
      // but a service-layer check yields a friendlier error and avoids the
      // transaction roll-back path.
      const byLine = new Map<string, number>();
      for (const c of commRows) {
        const pct = Number(c.commissionPct);
        byLine.set(c.invoiceLineItemId, (byLine.get(c.invoiceLineItemId) ?? 0) + pct);
      }
      for (const [lineId, sum] of byLine.entries()) {
        if (sum > 100 + 1e-6) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_FAILED,
            message: `Commission percentages for line ${lineId} sum to ${sum}, exceeding 100`,
          });
        }
      }

      for (const c of commRows) {
        const lineTotal = lineTotalById.get(c.invoiceLineItemId) ?? 0;
        const amount = Math.round((lineTotal * Number(c.commissionPct)) / 100);
        if (amount !== c.commissionAmountCents) {
          await tx
            .update(invoiceLineCommissions)
            .set({ commissionAmountCents: amount, updatedAt: new Date() })
            .where(eq(invoiceLineCommissions.id, c.id));
        }
      }

      // Hand off to the existing issue() path which allocates the
      // INV-YYYY-NNNN number and flips draft → issued (or → sent for
      // cash receipts). This is "post" in the UI vocabulary.
      const issued = await this.invoicesService.issue(ctx, invoiceId);

      const finalComms = await tx.query.invoiceLineCommissions.findMany({
        where: eq(invoiceLineCommissions.invoiceId, invoiceId),
      });
      const driverIds = Array.from(new Set(finalComms.map((c) => c.driverId)));
      const driverRows =
        driverIds.length > 0
          ? await tx.query.drivers.findMany({ where: inArray(drivers.id, driverIds) })
          : [];
      const driverById = new Map(driverRows.map((d) => [d.id, d]));

      return {
        invoice: {
          id: issued.id,
          tenantId: issued.tenantId,
          invoiceNumber: issued.invoiceNumber,
          invoiceType: issued.invoiceType,
          status: issued.status,
          customerId: issued.customerId,
          accountId: issued.accountId,
          jobId: issued.jobId,
          rateSheetId: issued.rateSheetId,
          issuedAt: issued.issuedAt,
          dueAt: issued.dueAt,
          paidAt: issued.paidAt,
          voidedAt: issued.voidedAt,
          subtotalCents: issued.subtotalCents,
          taxCents: issued.taxCents,
          totalCents: issued.totalCents,
          paidCents: issued.paidCents,
          balanceCents: issued.balanceCents,
          currency: issued.currency,
          terms: issued.terms,
          notes: issued.notes,
          internalNotes: issued.internalNotes,
          billingAddress: issued.billingAddress,
          voidReason: issued.voidReason,
          createdBy: issued.createdBy,
          createdAt: issued.createdAt,
          updatedAt: issued.updatedAt,
        },
        commissions: finalComms.map((c) =>
          commissionToDto(
            c,
            driverById.get(c.driverId)?.firstName,
            driverById.get(c.driverId)?.lastName,
          ),
        ),
      };
    });
  }

  // =====================================================================
  // Auto-draft hook: called by InvoicesService.generateFromJob() after
  // it has inserted line items. Idempotent — skip lines that already
  // have any commissions.
  // =====================================================================

  async createDraftCommissionsForJob(
    tx: Tx,
    ctx: CallerContext,
    invoiceId: string,
    jobId: string,
  ): Promise<void> {
    // 1) Resolve assigned driver IDs — union of:
    //    - jobs.assigned_driver_id  (primary)
    //    - job_driver_assignments   (full crew, including primary if seeded)
    const job = await tx.query.jobs.findFirst({
      where: eq(jobs.id, jobId),
    });
    if (!job) return;

    const crew = await tx.query.jobDriverAssignments.findMany({
      where: eq(jobDriverAssignments.jobId, jobId),
    });

    const driverIds = new Set<string>();
    if (job.assignedDriverId) driverIds.add(job.assignedDriverId);
    for (const c of crew) driverIds.add(c.driverId);

    if (driverIds.size === 0) return;

    // Ensure the primary driver is recorded in job_driver_assignments so
    // future reviews see the full crew.
    if (job.assignedDriverId && !crew.some((c) => c.driverId === job.assignedDriverId)) {
      try {
        await tx.insert(jobDriverAssignments).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          jobId,
          driverId: job.assignedDriverId,
          role: 'primary',
        });
      } catch {
        // Race-safe: another caller may have inserted concurrently.
      }
    }

    const driverList = await tx.query.drivers.findMany({
      where: inArray(drivers.id, Array.from(driverIds)),
    });
    if (driverList.length === 0) return;

    // 2) Resolve invoice lines and find ones without commissions yet.
    const lineRows = await tx.query.invoiceLineItems.findMany({
      where: eq(invoiceLineItems.invoiceId, invoiceId),
    });
    if (lineRows.length === 0) return;

    const existingComms = await tx.query.invoiceLineCommissions.findMany({
      where: eq(invoiceLineCommissions.invoiceId, invoiceId),
    });
    const linesWithComms = new Set(existingComms.map((c) => c.invoiceLineItemId));

    // 3) Per missing line, seed commissions. Per the prompt:
    //    "If multiple drivers assigned: split EVENLY by default
    //     (100 / N drivers per line). Operator overrides during review."
    //    Each driver's default_commission_pct is informational at the
    //    individual driver level; for multi-driver splits we *override*
    //    with an even split so the line is fully allocated by default.
    //    Single-driver lines use the driver's own default if set,
    //    otherwise 100%.
    const N = driverList.length;
    for (const line of lineRows) {
      if (linesWithComms.has(line.id)) continue;

      if (N === 1) {
        const [d] = driverList;
        if (!d) continue;
        const pct =
          d.defaultCommissionPct !== null && d.defaultCommissionPct !== undefined
            ? Number(d.defaultCommissionPct)
            : 100;
        await tx.insert(invoiceLineCommissions).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          invoiceId,
          invoiceLineItemId: line.id,
          driverId: d.id,
          commissionPct: String(pct.toFixed(2)),
          commissionAmountCents: 0,
          createdBy: ctx.userId,
        });
      } else {
        const evenPct = Math.floor((100 / N) * 100) / 100;
        // Remainder goes to the first driver so the row sum lands exactly
        // at 100 instead of being short by rounding cents.
        const remainder = Math.round((100 - evenPct * N) * 100) / 100;
        let first = true;
        for (const d of driverList) {
          const pct = evenPct + (first ? remainder : 0);
          first = false;
          await tx.insert(invoiceLineCommissions).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            invoiceId,
            invoiceLineItemId: line.id,
            driverId: d.id,
            commissionPct: String(pct.toFixed(2)),
            commissionAmountCents: 0,
            createdBy: ctx.userId,
          });
        }
      }
    }
  }

  // =====================================================================
  // Internals
  // =====================================================================

  private async ensureDriversAssignedToJob(
    tx: Tx,
    ctx: CallerContext,
    jobId: string,
    driverIds: string[],
  ): Promise<void> {
    if (driverIds.length === 0) return;
    const existing = await tx.query.jobDriverAssignments.findMany({
      where: eq(jobDriverAssignments.jobId, jobId),
    });
    const have = new Set(existing.map((e) => e.driverId));
    for (const driverId of driverIds) {
      if (have.has(driverId)) continue;
      // Validate the driver belongs to this tenant — the BEFORE trigger
      // also catches it, but a clean 404 beats a generic 500.
      const d = await tx.query.drivers.findFirst({ where: eq(drivers.id, driverId) });
      if (!d) throw notFound(`Driver ${driverId} not found`);
      await tx.insert(jobDriverAssignments).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        jobId,
        driverId,
        role: 'support',
      });
    }
  }

  private async replaceCommissions(
    tx: Tx,
    ctx: CallerContext,
    inv: typeof invoices.$inferSelect,
    incoming: NonNullable<UpdateInvoiceReviewPayload['commissions']>,
  ): Promise<void> {
    // Group incoming by lineItemId so we delete + re-insert per line.
    const byLine = new Map<string, Array<{ driverId: string; commissionPct: number }>>();
    for (const c of incoming) {
      const list = byLine.get(c.lineItemId) ?? [];
      list.push({ driverId: c.driverId, commissionPct: c.commissionPct });
      byLine.set(c.lineItemId, list);
    }

    // Validate each line sum ≤ 100.
    for (const [lineId, rows] of byLine.entries()) {
      const sum = rows.reduce((a, r) => a + r.commissionPct, 0);
      if (sum > 100 + 1e-6) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: `Commission percentages for line ${lineId} sum to ${sum}, exceeding 100`,
        });
      }
      // Reject duplicate (lineId, driverId) in the same payload.
      const seenDrivers = new Set<string>();
      for (const r of rows) {
        if (seenDrivers.has(r.driverId)) {
          throw new BadRequestException({
            code: ERROR_CODES.VALIDATION_FAILED,
            message: `Driver ${r.driverId} appears more than once on line ${lineId}`,
          });
        }
        seenDrivers.add(r.driverId);
      }
    }

    // Validate each line belongs to this invoice.
    const lineRows = await tx.query.invoiceLineItems.findMany({
      where: eq(invoiceLineItems.invoiceId, inv.id),
    });
    const lineIds = new Set(lineRows.map((l) => l.id));
    for (const lineId of byLine.keys()) {
      if (!lineIds.has(lineId)) {
        throw notFound(`Line item ${lineId} not on invoice ${inv.id}`);
      }
    }

    // Validate drivers exist + belong to tenant. The BEFORE trigger also
    // covers this, but a clean error path beats a generic 500.
    const allDriverIds = new Set<string>();
    for (const rows of byLine.values()) for (const r of rows) allDriverIds.add(r.driverId);
    if (allDriverIds.size > 0) {
      const dRows = await tx.query.drivers.findMany({
        where: inArray(drivers.id, Array.from(allDriverIds)),
      });
      const have = new Set(dRows.map((d) => d.id));
      for (const id of allDriverIds) {
        if (!have.has(id)) throw notFound(`Driver ${id} not found`);
      }
    }

    // Delete old commissions for these lines, then insert the new set.
    for (const [lineId, rows] of byLine.entries()) {
      await tx
        .delete(invoiceLineCommissions)
        .where(eq(invoiceLineCommissions.invoiceLineItemId, lineId));
      for (const r of rows) {
        await tx.insert(invoiceLineCommissions).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          invoiceId: inv.id,
          invoiceLineItemId: lineId,
          driverId: r.driverId,
          commissionPct: String(r.commissionPct.toFixed(2)),
          commissionAmountCents: 0,
          createdBy: ctx.userId,
        });
      }
    }
  }

  private async assembleReview(tx: Tx, invoiceId: string): Promise<InvoiceReviewDto> {
    const detailed = await this.invoicesService.assembleWithDetails(tx, invoiceId);

    // Pull commissions + drivers (joined) + job + assigned drivers + customer + account.
    const commRows = await tx.query.invoiceLineCommissions.findMany({
      where: eq(invoiceLineCommissions.invoiceId, invoiceId),
    });
    const job = detailed.jobId
      ? await tx.query.jobs.findFirst({ where: eq(jobs.id, detailed.jobId) })
      : null;
    const assignedRows = job
      ? await tx.query.jobDriverAssignments.findMany({
          where: eq(jobDriverAssignments.jobId, job.id),
        })
      : [];

    const driverIds = new Set<string>([
      ...commRows.map((c) => c.driverId),
      ...assignedRows.map((a) => a.driverId),
    ]);
    const driverRows =
      driverIds.size > 0
        ? await tx.query.drivers.findMany({ where: inArray(drivers.id, Array.from(driverIds)) })
        : [];
    const driverById = new Map(driverRows.map((d) => [d.id, d]));

    const customer = detailed.customerId
      ? await tx.query.customers.findFirst({ where: eq(customers.id, detailed.customerId) })
      : null;
    const account = detailed.accountId
      ? await tx.query.accounts.findFirst({ where: eq(accounts.id, detailed.accountId) })
      : null;

    const commissions: InvoiceLineCommissionDto[] = commRows.map((c) =>
      commissionToDto(
        c,
        driverById.get(c.driverId)?.firstName,
        driverById.get(c.driverId)?.lastName,
      ),
    );

    const assignedDrivers: DriverSummaryDto[] = assignedRows.map((a) => {
      const d = driverById.get(a.driverId);
      return {
        id: a.driverId,
        name: d ? formatName(d.firstName, d.lastName, d.preferredName) : 'Unknown driver',
        defaultCommissionPct:
          d?.defaultCommissionPct !== null && d?.defaultCommissionPct !== undefined
            ? Number(d.defaultCommissionPct)
            : null,
      };
    });

    const customerSummary: CustomerSummaryDto | null = customer
      ? { id: customer.id, name: customer.name }
      : null;
    const accountSummary: AccountSummaryDto | null = account
      ? { id: account.id, name: account.name }
      : null;
    const jobSummary: ReviewJobSummaryDto | null = job
      ? {
          id: job.id,
          jobNumber: job.jobNumber,
          // The job table doesn't have a dedicated completed_at column; we
          // approximate by reading status='completed' updates' timestamp.
          // The audit log has the row; for the UI we just use updated_at
          // when the status is completed and null otherwise.
          completedAt: job.status === 'completed' ? job.updatedAt.toISOString() : null,
        }
      : null;

    return {
      invoice: {
        id: detailed.id,
        tenantId: detailed.tenantId,
        invoiceNumber: detailed.invoiceNumber,
        invoiceType: detailed.invoiceType,
        status: detailed.status,
        customerId: detailed.customerId,
        accountId: detailed.accountId,
        jobId: detailed.jobId,
        rateSheetId: detailed.rateSheetId,
        issuedAt: detailed.issuedAt,
        dueAt: detailed.dueAt,
        paidAt: detailed.paidAt,
        voidedAt: detailed.voidedAt,
        subtotalCents: detailed.subtotalCents,
        taxCents: detailed.taxCents,
        totalCents: detailed.totalCents,
        paidCents: detailed.paidCents,
        balanceCents: detailed.balanceCents,
        currency: detailed.currency,
        terms: detailed.terms,
        notes: detailed.notes,
        internalNotes: detailed.internalNotes,
        billingAddress: detailed.billingAddress,
        voidReason: detailed.voidReason,
        createdBy: detailed.createdBy,
        createdAt: detailed.createdAt,
        updatedAt: detailed.updatedAt,
      },
      lineItems: detailed.lineItems,
      taxes: detailed.taxes,
      commissions,
      assignedDrivers,
      job: jobSummary,
      customer: customerSummary,
      account: accountSummary,
    };
  }

  private toTenantCtx(ctx: CallerContext): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | undefined;
    userAgent: string | undefined;
  } {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    };
  }
}

function commissionToDto(
  c: typeof invoiceLineCommissions.$inferSelect,
  firstName: string | undefined,
  lastName: string | undefined,
): InvoiceLineCommissionDto {
  return {
    id: c.id,
    invoiceId: c.invoiceId,
    invoiceLineItemId: c.invoiceLineItemId,
    driverId: c.driverId,
    driverName: formatName(firstName ?? null, lastName ?? null, null) || 'Driver',
    commissionPct: Number(c.commissionPct),
    commissionAmountCents: c.commissionAmountCents,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function formatName(
  firstName: string | null,
  lastName: string | null,
  preferredName: string | null,
): string {
  const first = preferredName ?? firstName ?? '';
  return [first, lastName ?? ''].filter(Boolean).join(' ').trim();
}

const notFound = (msg: string): NotFoundException =>
  new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: msg });
