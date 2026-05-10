/**
 * InvoicesService — owns the invoice / line-item / tax / payment / credit-memo
 * lifecycle.
 *
 * State invariants worth keeping in your head while reading:
 *
 *   - Money is integer cents end-to-end. Quantities are PostgreSQL NUMERIC
 *     strings (passed through Drizzle as strings to avoid float drift).
 *   - paid_cents / balance_cents are derived from the sum of cleared payments
 *     and credit-memo applications, recomputed inside every state-changing
 *     method. We never accept paid/balance from the wire.
 *   - draft → issued is the only place we allocate an invoice_number. Issuing
 *     twice is a no-op (idempotent — service early-returns when status is
 *     already ≥ issued).
 *   - The audit_log trigger captures the row mutation; we don't emit duplicate
 *     audit entries from the service.
 *
 * Auto-generation from a completed job is wired in modules/billing/job-completion.listener.ts;
 * this service exposes generateFromJob() so the listener stays small.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  accounts,
  creditMemos,
  customers,
  invoiceLineItems,
  invoiceTaxes,
  invoices,
  jobs,
  payments,
  recurringBillingSchedules,
  uuidv7,
} from '@towcommand/db';
import {
  type AgingFilters,
  type AgingResponse,
  type AgingRow,
  type CreateCreditMemoPayload,
  type CreateInvoiceLineItemPayload,
  type CreateInvoicePayload,
  type CreateRecurringSchedulePayload,
  type CreditMemoDto,
  ERROR_CODES,
  type InvoiceBillingAddress,
  type InvoiceDto,
  type InvoiceFilters,
  type InvoiceLineItemDto,
  type InvoiceLineItemType,
  type InvoiceStatus,
  type InvoiceTaxDto,
  type InvoiceTerms,
  type InvoiceType,
  type InvoiceWithDetailsDto,
  type PaymentDto,
  type PaymentFilters,
  type PaymentMethod,
  type PaymentStatus,
  type RecordPaymentPayload,
  type RecurringScheduleDto,
  dueDaysForTerms,
  termsFromAccountBilling,
} from '@towcommand/shared';
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { TenantAwareDb, type Tx } from '../../database/tenant-aware-db.service.js';
import {
  billingAddressFromAccount,
  billingAddressFromCustomer,
  rateQuoteToInvoiceLineItems,
  serviceTypeLabel,
} from './billing-line-items.js';
import { allocateInvoiceNumber, allocateMemoNumber } from './invoice-number.js';
import {
  InvalidInvoiceTransitionError,
  assertCanTransition,
  statusAfterPayment,
} from './invoice-state-machine.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class InvoicesService {
  constructor(private readonly db: TenantAwareDb) {}

  // =====================================================================
  // Invoice CRUD
  // =====================================================================

  async list(ctx: CallerContext, filters: InvoiceFilters): Promise<{
    data: InvoiceDto[];
    total: number;
    limit: number;
    offset: number;
  }> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(invoices.deletedAt)];
      if (filters.status) conds.push(eq(invoices.status, filters.status));
      if (filters.invoiceType) conds.push(eq(invoices.invoiceType, filters.invoiceType));
      if (filters.customerId) conds.push(eq(invoices.customerId, filters.customerId));
      if (filters.accountId) conds.push(eq(invoices.accountId, filters.accountId));
      if (filters.jobId) conds.push(eq(invoices.jobId, filters.jobId));
      if (filters.issuedFrom) conds.push(gte(invoices.issuedAt, new Date(filters.issuedFrom)));
      if (filters.issuedTo) conds.push(lte(invoices.issuedAt, new Date(filters.issuedTo)));
      if (filters.search) {
        const pat = `%${filters.search.toLowerCase()}%`;
        conds.push(
          or(
            sql`lower(${invoices.invoiceNumber}) LIKE ${pat}`,
            sql`lower(coalesce(${invoices.notes}, '')) LIKE ${pat}`,
          ) as ReturnType<typeof eq>,
        );
      }
      const whereExpr = and(...conds);
      const totalRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(invoices)
        .where(whereExpr);
      const total = totalRows[0]?.count ?? 0;
      const rows = await tx.query.invoices.findMany({
        where: whereExpr,
        orderBy: [desc(invoices.createdAt)],
        limit: filters.limit,
        offset: filters.offset,
      });
      return {
        data: rows.map(toInvoiceDto),
        total,
        limit: filters.limit,
        offset: filters.offset,
      };
    });
  }

  async get(ctx: CallerContext, id: string): Promise<InvoiceWithDetailsDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const invoice = await tx.query.invoices.findFirst({
        where: and(eq(invoices.id, id), isNull(invoices.deletedAt)),
      });
      if (!invoice) throw notFound('Invoice not found');
      const details = await this.loadInvoiceDetails(tx, invoice.id);
      return {
        ...toInvoiceDto(invoice),
        ...details,
      };
    });
  }

  async createManual(
    ctx: CallerContext,
    payload: CreateInvoicePayload,
  ): Promise<InvoiceWithDetailsDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const billingAddr = await this.resolveBillingAddress(
        tx,
        payload.billingAddress ?? null,
        payload.customerId ?? null,
        payload.accountId ?? null,
      );
      const terms = await this.resolveTerms(
        tx,
        payload.terms,
        payload.accountId ?? null,
        payload.customerId ?? null,
      );
      const id = uuidv7();
      const inv = await this.insertDraftInvoice(tx, ctx.tenantId, ctx.userId, {
        id,
        invoiceType: payload.invoiceType,
        customerId: payload.customerId ?? null,
        accountId: payload.accountId ?? null,
        jobId: payload.jobId ?? null,
        rateSheetId: null,
        terms,
        notes: payload.notes ?? null,
        internalNotes: payload.internalNotes ?? null,
        billingAddress: billingAddr,
      });

      // Insert provided line items, if any.
      let lineNumber = 1;
      for (const li of payload.lineItems) {
        await this.insertLineItem(tx, ctx.tenantId, inv.id, lineNumber++, li);
      }
      const totals = await this.recomputeTotals(tx, ctx.tenantId, inv.id);
      return this.assembleWithDetails(tx, totals.id);
    });
  }

  /**
   * Create a draft invoice from a completed job. Idempotent — if a non-void
   * invoice for this job already exists, returns it untouched.
   */
  async generateFromJob(
    ctx: CallerContext,
    jobId: string,
  ): Promise<{ invoice: InvoiceWithDetailsDto; created: boolean }> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const job = await tx.query.jobs.findFirst({
        where: and(eq(jobs.id, jobId), isNull(jobs.deletedAt)),
      });
      if (!job) throw notFound('Job not found');

      const existing = await tx.query.invoices.findFirst({
        where: and(
          eq(invoices.jobId, jobId),
          isNull(invoices.deletedAt),
          sql`${invoices.status} <> 'void'`,
        ),
      });
      if (existing) {
        return { invoice: await this.assembleWithDetails(tx, existing.id), created: false };
      }

      const invoiceType = await this.invoiceTypeFromJob(tx, job);
      const customerId = job.customerId;
      const accountId = job.accountId;
      const billingAddr = await this.resolveBillingAddress(tx, null, customerId, accountId);
      const terms = await this.resolveTerms(tx, null, accountId, customerId);

      const id = uuidv7();
      const inv = await this.insertDraftInvoice(tx, ctx.tenantId, ctx.userId, {
        id,
        invoiceType,
        customerId,
        accountId,
        jobId,
        rateSheetId:
          (job.rateBreakdown as { rateSheetId?: string | null } | null)?.rateSheetId ?? null,
        terms,
        notes:
          job.serviceType === 'tow'
            ? `${serviceTypeLabel(job.serviceType)} — ${job.pickupAddress}` +
              (job.dropoffAddress ? ` → ${job.dropoffAddress}` : '')
            : `${serviceTypeLabel(job.serviceType)} — ${job.pickupAddress}`,
        internalNotes: `Auto-generated from job ${job.jobNumber}`,
        billingAddress: billingAddr,
      });

      // Build line items from rateBreakdown (the persisted RateQuote).
      const breakdown = job.rateBreakdown as
        | {
            lineItems: Array<{
              code: string;
              label: string;
              amountCents: number;
              quantity?: number;
              unit?: string;
            }>;
            subtotalCents: number;
            totalCents: number;
            calculationTrace?: string[];
          }
        | null;
      if (breakdown && Array.isArray(breakdown.lineItems) && breakdown.lineItems.length > 0) {
        // Reuse the helper. We treat the breakdown as a RateQuote for typing.
        const draftLines = rateQuoteToInvoiceLineItems(
          {
            serviceType: job.serviceType,
            vehicleClass: 'unknown',
            rateSheetId:
              (job.rateBreakdown as { rateSheetId?: string | null } | null)?.rateSheetId ?? null,
            rateSheetName: null,
            source: 'tenant_default',
            distanceMiles: 0,
            lineItems: breakdown.lineItems,
            subtotalCents: breakdown.subtotalCents,
            totalCents: breakdown.totalCents,
            calculationTrace: breakdown.calculationTrace ?? [],
            currency: 'USD',
          },
          { taxable: false, taxRatePct: '0' },
        );
        for (const dl of draftLines) {
          await tx.insert(invoiceLineItems).values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            invoiceId: inv.id,
            lineNumber: dl.lineNumber,
            lineType: dl.lineType,
            description: dl.description,
            quantity: dl.quantity,
            unit: dl.unit,
            unitPriceCents: dl.unitPriceCents,
            lineTotalCents: dl.lineTotalCents,
            taxable: dl.taxable,
            taxRatePct: dl.taxRatePct,
            rateRuleId: dl.rateRuleId,
          });
        }
      } else {
        // Fallback: single-line invoice with the quoted total.
        await tx.insert(invoiceLineItems).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          invoiceId: inv.id,
          lineNumber: 1,
          lineType: 'service',
          description: serviceTypeLabel(job.serviceType),
          quantity: '1',
          unit: 'each',
          unitPriceCents: job.rateQuotedCents,
          lineTotalCents: job.rateQuotedCents,
          taxable: false,
          taxRatePct: '0',
          rateRuleId: null,
        });
      }

      const totals = await this.recomputeTotals(tx, ctx.tenantId, inv.id);
      const final = await this.assembleWithDetails(tx, totals.id);
      return { invoice: final, created: true };
    });
  }

  async update(
    ctx: CallerContext,
    invoiceId: string,
    patch: {
      customerId?: string | null;
      accountId?: string | null;
      terms?: InvoiceTerms;
      notes?: string | null;
      internalNotes?: string | null;
      billingAddress?: InvoiceBillingAddress;
    },
  ): Promise<InvoiceWithDetailsDto> {
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
      const next: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.customerId !== undefined) next.customerId = patch.customerId;
      if (patch.accountId !== undefined) next.accountId = patch.accountId;
      if (patch.terms !== undefined) next.terms = patch.terms;
      if (patch.notes !== undefined) next.notes = patch.notes;
      if (patch.internalNotes !== undefined) next.internalNotes = patch.internalNotes;
      if (patch.billingAddress !== undefined) next.billingAddress = patch.billingAddress;
      await tx.update(invoices).set(next).where(eq(invoices.id, invoiceId));
      return this.assembleWithDetails(tx, invoiceId);
    });
  }

  async addLineItem(
    ctx: CallerContext,
    invoiceId: string,
    payload: CreateInvoiceLineItemPayload,
  ): Promise<InvoiceWithDetailsDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const inv = await this.requireDraft(tx, invoiceId);
      const last = await tx.query.invoiceLineItems.findFirst({
        where: eq(invoiceLineItems.invoiceId, invoiceId),
        orderBy: [desc(invoiceLineItems.lineNumber)],
      });
      const lineNumber = (last?.lineNumber ?? 0) + 1;
      await this.insertLineItem(tx, ctx.tenantId, inv.id, lineNumber, payload);
      await this.recomputeTotals(tx, ctx.tenantId, invoiceId);
      return this.assembleWithDetails(tx, invoiceId);
    });
  }

  async updateLineItem(
    ctx: CallerContext,
    invoiceId: string,
    lineItemId: string,
    patch: Partial<CreateInvoiceLineItemPayload>,
  ): Promise<InvoiceWithDetailsDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      await this.requireDraft(tx, invoiceId);
      const li = await tx.query.invoiceLineItems.findFirst({
        where: and(eq(invoiceLineItems.id, lineItemId), eq(invoiceLineItems.invoiceId, invoiceId)),
      });
      if (!li) throw notFound('Line item not found');
      const next: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.lineType !== undefined) next.lineType = patch.lineType;
      if (patch.description !== undefined) next.description = patch.description;
      if (patch.quantity !== undefined) next.quantity = String(patch.quantity);
      if (patch.unit !== undefined) next.unit = patch.unit;
      if (patch.unitPriceCents !== undefined) next.unitPriceCents = patch.unitPriceCents;
      if (patch.taxable !== undefined) next.taxable = patch.taxable;
      if (patch.taxRatePct !== undefined) next.taxRatePct = String(patch.taxRatePct);
      if (patch.rateRuleId !== undefined) next.rateRuleId = patch.rateRuleId;

      const newQuantity = patch.quantity !== undefined ? Number(patch.quantity) : Number(li.quantity);
      const newUnitPrice = patch.unitPriceCents ?? li.unitPriceCents;
      next.lineTotalCents = Math.round(newQuantity * newUnitPrice);

      await tx
        .update(invoiceLineItems)
        .set(next)
        .where(eq(invoiceLineItems.id, lineItemId));
      await this.recomputeTotals(tx, ctx.tenantId, invoiceId);
      return this.assembleWithDetails(tx, invoiceId);
    });
  }

  async deleteLineItem(
    ctx: CallerContext,
    invoiceId: string,
    lineItemId: string,
  ): Promise<InvoiceWithDetailsDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      await this.requireDraft(tx, invoiceId);
      await tx
        .delete(invoiceLineItems)
        .where(
          and(
            eq(invoiceLineItems.id, lineItemId),
            eq(invoiceLineItems.invoiceId, invoiceId),
          ),
        );
      await this.recomputeTotals(tx, ctx.tenantId, invoiceId);
      return this.assembleWithDetails(tx, invoiceId);
    });
  }

  async issue(ctx: CallerContext, invoiceId: string): Promise<InvoiceWithDetailsDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const inv = await tx.query.invoices.findFirst({
        where: and(eq(invoices.id, invoiceId), isNull(invoices.deletedAt)),
      });
      if (!inv) throw notFound('Invoice not found');
      // Idempotency: already-issued invoices return as-is, no re-allocation,
      // no audit duplication.
      if (inv.status !== 'draft') {
        return this.assembleWithDetails(tx, invoiceId);
      }
      try {
        assertCanTransition(inv.status, 'issued');
      } catch (err) {
        if (err instanceof InvalidInvoiceTransitionError) {
          throw new BadRequestException({
            code: ERROR_CODES.INVALID_STATE_TRANSITION,
            message: err.message,
          });
        }
        throw err;
      }
      // Allocate the per-tenant invoice_number — this is the only place we
      // burn a number, and only at first transition out of draft.
      const invoiceNumber = await allocateInvoiceNumber(tx, ctx.tenantId);
      const due = computeDueAt(new Date(), inv.terms);
      // For cash receipts, mark sent immediately so the dashboard isn't full
      // of "issued, not yet sent" rows. Email delivery is a no-op for cash.
      const status: InvoiceStatus = inv.invoiceType === 'cash_receipt' ? 'sent' : 'issued';
      await tx
        .update(invoices)
        .set({
          invoiceNumber,
          status,
          issuedAt: new Date(),
          dueAt: due,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoiceId));
      return this.assembleWithDetails(tx, invoiceId);
    });
  }

  async markSent(ctx: CallerContext, invoiceId: string): Promise<InvoiceWithDetailsDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const inv = await tx.query.invoices.findFirst({
        where: and(eq(invoices.id, invoiceId), isNull(invoices.deletedAt)),
      });
      if (!inv) throw notFound('Invoice not found');
      // Idempotent: anywhere past 'issued' just returns. We only flip the
      // status if currently issued.
      if (inv.status === 'issued') {
        await tx
          .update(invoices)
          .set({ status: 'sent', updatedAt: new Date() })
          .where(eq(invoices.id, invoiceId));
      }
      return this.assembleWithDetails(tx, invoiceId);
    });
  }

  async voidInvoice(
    ctx: CallerContext,
    invoiceId: string,
    reason: string,
    actorRole: string | null,
  ): Promise<InvoiceWithDetailsDto> {
    if (actorRole !== 'owner' && actorRole !== 'admin') {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Only owner/admin can void invoices',
      });
    }
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const inv = await tx.query.invoices.findFirst({
        where: and(eq(invoices.id, invoiceId), isNull(invoices.deletedAt)),
      });
      if (!inv) throw notFound('Invoice not found');
      try {
        assertCanTransition(inv.status, 'void');
      } catch (err) {
        if (err instanceof InvalidInvoiceTransitionError) {
          throw new BadRequestException({
            code: ERROR_CODES.INVALID_STATE_TRANSITION,
            message: err.message,
          });
        }
        throw err;
      }
      await tx
        .update(invoices)
        .set({
          status: 'void',
          voidedAt: new Date(),
          voidReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoiceId));
      return this.assembleWithDetails(tx, invoiceId);
    });
  }

  // =====================================================================
  // Payments
  // =====================================================================

  async recordPayment(
    ctx: CallerContext,
    payload: RecordPaymentPayload,
  ): Promise<{ payment: PaymentDto; invoice: InvoiceWithDetailsDto }> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const inv = await tx.query.invoices.findFirst({
        where: and(eq(invoices.id, payload.invoiceId), isNull(invoices.deletedAt)),
      });
      if (!inv) throw notFound('Invoice not found');
      if (inv.status === 'draft') {
        throw new BadRequestException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: 'Cannot record payment against a draft invoice — issue it first',
        });
      }
      if (inv.status === 'void') {
        throw new BadRequestException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: 'Invoice is void',
        });
      }
      const id = uuidv7();
      const status: PaymentStatus = payload.status ?? 'cleared';
      const [payRow] = await tx
        .insert(payments)
        .values({
          id,
          tenantId: ctx.tenantId,
          invoiceId: inv.id,
          amountCents: payload.amountCents,
          paymentMethod: payload.paymentMethod,
          referenceNumber: payload.referenceNumber ?? null,
          receivedAt: payload.receivedAt ? new Date(payload.receivedAt) : new Date(),
          recordedBy: ctx.userId,
          status,
          notes: payload.notes ?? null,
        })
        .returning();
      if (!payRow) throw new Error('insert payments .. returning() yielded no row');

      await this.recomputeTotals(tx, ctx.tenantId, inv.id);
      const final = await this.assembleWithDetails(tx, inv.id);
      return { payment: paymentToDto(payRow), invoice: final };
    });
  }

  async listPayments(ctx: CallerContext, filters: PaymentFilters): Promise<{
    data: PaymentDto[];
    total: number;
  }> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const conds = [isNull(payments.deletedAt)];
      if (filters.invoiceId) conds.push(eq(payments.invoiceId, filters.invoiceId));
      if (filters.paymentMethod) conds.push(eq(payments.paymentMethod, filters.paymentMethod));
      if (filters.receivedFrom) conds.push(gte(payments.receivedAt, new Date(filters.receivedFrom)));
      if (filters.receivedTo) conds.push(lte(payments.receivedAt, new Date(filters.receivedTo)));
      const whereExpr = and(...conds);
      const totalRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(payments)
        .where(whereExpr);
      const rows = await tx.query.payments.findMany({
        where: whereExpr,
        orderBy: [desc(payments.receivedAt)],
        limit: filters.limit,
        offset: filters.offset,
      });
      return {
        data: rows.map(paymentToDto),
        total: totalRows[0]?.count ?? 0,
      };
    });
  }

  async voidPayment(
    ctx: CallerContext,
    paymentId: string,
    actorRole: string | null,
  ): Promise<InvoiceWithDetailsDto> {
    if (actorRole !== 'owner' && actorRole !== 'admin') {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Only owner/admin can void payments',
      });
    }
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const pay = await tx.query.payments.findFirst({
        where: and(eq(payments.id, paymentId), isNull(payments.deletedAt)),
      });
      if (!pay) throw notFound('Payment not found');
      await tx
        .update(payments)
        .set({ status: 'refunded', deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(payments.id, paymentId));
      await this.recomputeTotals(tx, ctx.tenantId, pay.invoiceId);
      return this.assembleWithDetails(tx, pay.invoiceId);
    });
  }

  // =====================================================================
  // Credit memos
  // =====================================================================

  async createCreditMemo(
    ctx: CallerContext,
    payload: CreateCreditMemoPayload,
  ): Promise<{ memo: CreditMemoDto; invoice: InvoiceWithDetailsDto }> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const inv = await tx.query.invoices.findFirst({
        where: and(eq(invoices.id, payload.originalInvoiceId), isNull(invoices.deletedAt)),
      });
      if (!inv) throw notFound('Original invoice not found');
      if (inv.status === 'draft') {
        throw new BadRequestException({
          code: ERROR_CODES.INVALID_STATE_TRANSITION,
          message: 'Cannot issue a credit memo against a draft invoice',
        });
      }
      const memoNumber = await allocateMemoNumber(tx, ctx.tenantId);
      const id = uuidv7();
      const [row] = await tx
        .insert(creditMemos)
        .values({
          id,
          tenantId: ctx.tenantId,
          memoNumber,
          originalInvoiceId: inv.id,
          amountCents: payload.amountCents,
          reasonCode: payload.reasonCode,
          reason: payload.reason,
          appliedTo: payload.appliedTo,
          issuedBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('insert credit_memos .. returning() yielded no row');

      // If applied to invoice, write an offsetting payment row so balance falls.
      if (payload.appliedTo === 'apply_to_invoice') {
        await tx.insert(payments).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          invoiceId: inv.id,
          amountCents: payload.amountCents,
          paymentMethod: 'write_off',
          referenceNumber: memoNumber,
          recordedBy: ctx.userId,
          status: 'cleared',
          notes: `Credit memo ${memoNumber}: ${payload.reason}`,
        });
        await this.recomputeTotals(tx, ctx.tenantId, inv.id);
      }
      const final = await this.assembleWithDetails(tx, inv.id);
      return { memo: creditMemoToDto(row), invoice: final };
    });
  }

  async listCreditMemos(ctx: CallerContext): Promise<CreditMemoDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.creditMemos.findMany({
        where: isNull(creditMemos.deletedAt),
        orderBy: [desc(creditMemos.issuedAt)],
        limit: 200,
      });
      return rows.map(creditMemoToDto);
    });
  }

  // =====================================================================
  // A/R aging
  // =====================================================================

  async aging(ctx: CallerContext, filters: AgingFilters): Promise<AgingResponse> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const asOf = filters.asOf ? new Date(filters.asOf) : new Date();
      const conds = [
        isNull(invoices.deletedAt),
        sql`${invoices.balanceCents} > 0`,
        sql`${invoices.status} IN ('issued','sent','partially_paid','overdue')`,
      ];
      if (filters.accountId) conds.push(eq(invoices.accountId, filters.accountId));
      if (filters.customerId) conds.push(eq(invoices.customerId, filters.customerId));
      const rows = await tx.query.invoices.findMany({ where: and(...conds) });

      const byKey = new Map<
        string,
        {
          accountId: string | null;
          customerId: string | null;
          currentDueCents: number;
          bucket1To30Cents: number;
          bucket31To60Cents: number;
          bucket61To90Cents: number;
          bucket91PlusCents: number;
          totalCents: number;
          oldestDueAt: Date | null;
          invoiceCount: number;
        }
      >();
      for (const inv of rows) {
        const key = inv.accountId ?? `c:${inv.customerId ?? 'unknown'}`;
        const bucket = byKey.get(key) ?? {
          accountId: inv.accountId ?? null,
          customerId: inv.customerId ?? null,
          currentDueCents: 0,
          bucket1To30Cents: 0,
          bucket31To60Cents: 0,
          bucket61To90Cents: 0,
          bucket91PlusCents: 0,
          totalCents: 0,
          oldestDueAt: null as Date | null,
          invoiceCount: 0,
        };
        const dueAt = inv.dueAt ?? inv.issuedAt ?? inv.createdAt;
        const ageDays = Math.floor((asOf.getTime() - dueAt.getTime()) / (1000 * 60 * 60 * 24));
        const balance = inv.balanceCents;
        if (ageDays <= 0) bucket.currentDueCents += balance;
        else if (ageDays <= 30) bucket.bucket1To30Cents += balance;
        else if (ageDays <= 60) bucket.bucket31To60Cents += balance;
        else if (ageDays <= 90) bucket.bucket61To90Cents += balance;
        else bucket.bucket91PlusCents += balance;
        bucket.totalCents += balance;
        bucket.invoiceCount += 1;
        if (!bucket.oldestDueAt || dueAt < bucket.oldestDueAt) bucket.oldestDueAt = dueAt;
        byKey.set(key, bucket);
      }

      // Resolve names for accounts/customers.
      const accountIds = Array.from(
        new Set(Array.from(byKey.values()).map((b) => b.accountId).filter((x): x is string => Boolean(x))),
      );
      const customerIds = Array.from(
        new Set(Array.from(byKey.values()).map((b) => b.customerId).filter((x): x is string => Boolean(x))),
      );
      const accountNames = new Map<string, string>();
      const customerNames = new Map<string, string>();
      if (accountIds.length) {
        const accts = await tx.query.accounts.findMany({
          where: sql`${accounts.id} = ANY(${accountIds}::uuid[])`,
        });
        for (const a of accts) accountNames.set(a.id, a.name);
      }
      if (customerIds.length) {
        const cust = await tx.query.customers.findMany({
          where: sql`${customers.id} = ANY(${customerIds}::uuid[])`,
        });
        for (const c of cust) customerNames.set(c.id, c.name);
      }
      const out: AgingRow[] = Array.from(byKey.values())
        .map((b) => ({
          accountId: b.accountId,
          accountName: b.accountId ? accountNames.get(b.accountId) ?? null : null,
          customerId: b.customerId,
          customerName: b.customerId ? customerNames.get(b.customerId) ?? null : null,
          currentDueCents: b.currentDueCents,
          bucket1To30Cents: b.bucket1To30Cents,
          bucket31To60Cents: b.bucket31To60Cents,
          bucket61To90Cents: b.bucket61To90Cents,
          bucket91PlusCents: b.bucket91PlusCents,
          totalCents: b.totalCents,
          oldestDueAt: b.oldestDueAt ? b.oldestDueAt.toISOString() : null,
          invoiceCount: b.invoiceCount,
        }))
        .sort((a, b) => b.totalCents - a.totalCents);

      const totals = out.reduce(
        (acc, r) => {
          acc.currentDueCents += r.currentDueCents;
          acc.bucket1To30Cents += r.bucket1To30Cents;
          acc.bucket31To60Cents += r.bucket31To60Cents;
          acc.bucket61To90Cents += r.bucket61To90Cents;
          acc.bucket91PlusCents += r.bucket91PlusCents;
          acc.totalCents += r.totalCents;
          acc.invoiceCount += r.invoiceCount;
          return acc;
        },
        {
          currentDueCents: 0,
          bucket1To30Cents: 0,
          bucket31To60Cents: 0,
          bucket61To90Cents: 0,
          bucket91PlusCents: 0,
          totalCents: 0,
          invoiceCount: 0,
        },
      );
      return { asOf: asOf.toISOString(), rows: out, totals };
    });
  }

  /**
   * Daily sweep: any non-paid, non-void invoice with due_at < now and a
   * positive balance flips to overdue. Idempotent — safe to call repeatedly.
   * Returns the count flipped.
   */
  async markOverdueSweep(ctx: CallerContext): Promise<number> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const result = await tx.execute<{ id: string }>(
        sql`UPDATE invoices
            SET status = 'overdue', updated_at = now()
            WHERE deleted_at IS NULL
              AND status IN ('issued', 'sent', 'partially_paid')
              AND balance_cents > 0
              AND due_at IS NOT NULL
              AND due_at < now()
            RETURNING id`,
      );
      return result.rows.length;
    });
  }

  // =====================================================================
  // Recurring schedules
  // =====================================================================

  async createRecurringSchedule(
    ctx: CallerContext,
    payload: CreateRecurringSchedulePayload,
  ): Promise<RecurringScheduleDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const id = uuidv7();
      const [row] = await tx
        .insert(recurringBillingSchedules)
        .values({
          id,
          tenantId: ctx.tenantId,
          customerId: payload.customerId ?? null,
          accountId: payload.accountId ?? null,
          jobId: payload.jobId ?? null,
          description: payload.description,
          dailyRateCents: payload.dailyRateCents,
          startedAt: new Date(payload.startedAt),
          nextInvoiceAt: nextMonthFirstUtc(new Date(payload.startedAt)),
          createdBy: ctx.userId,
        })
        .returning();
      if (!row) throw new Error('insert recurring_billing_schedules .. returning() yielded no row');
      return recurringScheduleToDto(row);
    });
  }

  async listRecurringSchedules(ctx: CallerContext): Promise<RecurringScheduleDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.recurringBillingSchedules.findMany({
        where: isNull(recurringBillingSchedules.deletedAt),
        orderBy: [desc(recurringBillingSchedules.startedAt)],
      });
      return rows.map(recurringScheduleToDto);
    });
  }

  async endRecurringSchedule(ctx: CallerContext, id: string): Promise<RecurringScheduleDto> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const row = await tx.query.recurringBillingSchedules.findFirst({
        where: and(
          eq(recurringBillingSchedules.id, id),
          isNull(recurringBillingSchedules.deletedAt),
        ),
      });
      if (!row) throw notFound('Schedule not found');
      const [updated] = await tx
        .update(recurringBillingSchedules)
        .set({ endedAt: new Date(), updatedAt: new Date() })
        .where(eq(recurringBillingSchedules.id, id))
        .returning();
      if (!updated) throw notFound('Schedule not found');
      return recurringScheduleToDto(updated);
    });
  }

  // =====================================================================
  // Internals
  // =====================================================================

  private async insertDraftInvoice(
    tx: Tx,
    tenantId: string,
    userId: string,
    args: {
      id: string;
      invoiceType: InvoiceType;
      customerId: string | null;
      accountId: string | null;
      jobId: string | null;
      rateSheetId: string | null;
      terms: InvoiceTerms;
      notes: string | null;
      internalNotes: string | null;
      billingAddress: Record<string, unknown> | null;
    },
  ): Promise<typeof invoices.$inferSelect> {
    // Drafts hold a unique placeholder invoice_number ('INV-DRAFT-<hex>') so
    // the per-tenant unique index never collides while the draft is being
    // edited. The real INV-YYYY-NNNN is allocated at issue time.
    const draftNumber = `INV-DRAFT-${args.id.replace(/-/g, '').slice(0, 16)}`;
    const [row] = await tx
      .insert(invoices)
      .values({
        id: args.id,
        tenantId,
        invoiceNumber: draftNumber,
        invoiceType: args.invoiceType,
        status: 'draft',
        customerId: args.customerId,
        accountId: args.accountId,
        jobId: args.jobId,
        rateSheetId: args.rateSheetId,
        terms: args.terms,
        notes: args.notes,
        internalNotes: args.internalNotes,
        billingAddress: args.billingAddress,
        createdBy: userId,
      })
      .returning();
    if (!row) throw new Error('insert invoices .. returning() yielded no row');
    return row;
  }

  private async insertLineItem(
    tx: Tx,
    tenantId: string,
    invoiceId: string,
    lineNumber: number,
    payload: CreateInvoiceLineItemPayload,
  ): Promise<void> {
    const quantity = Number(payload.quantity);
    const lineTotal = Math.round(quantity * payload.unitPriceCents);
    await tx.insert(invoiceLineItems).values({
      id: uuidv7(),
      tenantId,
      invoiceId,
      lineNumber,
      lineType: payload.lineType,
      description: payload.description,
      quantity: String(payload.quantity),
      unit: payload.unit,
      unitPriceCents: payload.unitPriceCents,
      lineTotalCents: lineTotal,
      taxable: payload.taxable,
      taxRatePct: String(payload.taxRatePct),
      rateRuleId: payload.rateRuleId ?? null,
    });
  }

  private async requireDraft(tx: Tx, invoiceId: string): Promise<typeof invoices.$inferSelect> {
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
    return inv;
  }

  private async resolveBillingAddress(
    tx: Tx,
    explicit: InvoiceBillingAddress | null | undefined,
    customerId: string | null,
    accountId: string | null,
  ): Promise<Record<string, unknown> | null> {
    if (explicit) return explicit as unknown as Record<string, unknown>;
    if (accountId) {
      const a = await tx.query.accounts.findFirst({
        where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
      });
      if (a) return billingAddressFromAccount(a);
    }
    if (customerId) {
      const c = await tx.query.customers.findFirst({
        where: and(eq(customers.id, customerId), isNull(customers.deletedAt)),
      });
      if (c) return billingAddressFromCustomer(c);
    }
    return null;
  }

  private async resolveTerms(
    tx: Tx,
    explicit: InvoiceTerms | null | undefined,
    accountId: string | null,
    _customerId: string | null,
  ): Promise<InvoiceTerms> {
    if (explicit) return explicit;
    if (accountId) {
      const a = await tx.query.accounts.findFirst({
        where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
        columns: { billingTerms: true },
      });
      if (a?.billingTerms) return termsFromAccountBilling(a.billingTerms);
    }
    return 'due_on_receipt';
  }

  private async invoiceTypeFromJob(
    tx: Tx,
    job: typeof jobs.$inferSelect,
  ): Promise<InvoiceType> {
    if (job.accountId) {
      const a = await tx.query.accounts.findFirst({
        where: and(eq(accounts.id, job.accountId), isNull(accounts.deletedAt)),
        columns: { isMotorClub: true },
      });
      if (a?.isMotorClub) return 'motor_club_submission';
      return 'account_invoice';
    }
    return 'cash_receipt';
  }

  private async recomputeTotals(
    tx: Tx,
    _tenantId: string,
    invoiceId: string,
  ): Promise<typeof invoices.$inferSelect> {
    const inv = await tx.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
    });
    if (!inv) throw notFound('Invoice not found');
    const lineRows = await tx.query.invoiceLineItems.findMany({
      where: eq(invoiceLineItems.invoiceId, invoiceId),
    });
    const subtotal = lineRows.reduce((acc, li) => acc + li.lineTotalCents, 0);
    // Compute taxes by rolling up taxable lines per tax-rate-pct.
    type TaxAcc = { taxable: number; rate: number; jurisdiction: string; name: string };
    const taxBucket = new Map<string, TaxAcc>();
    for (const li of lineRows) {
      if (!li.taxable) continue;
      const ratePct = Number(li.taxRatePct);
      if (ratePct === 0) continue;
      const key = `${ratePct.toFixed(4)}`;
      const acc = taxBucket.get(key) ?? {
        taxable: 0,
        rate: ratePct,
        jurisdiction: 'default',
        name: `Sales tax ${ratePct}%`,
      };
      acc.taxable += li.lineTotalCents;
      taxBucket.set(key, acc);
    }
    const taxesArr: Array<{
      jurisdiction: string;
      name: string;
      ratePct: number;
      taxable: number;
      tax: number;
    }> = [];
    let totalTax = 0;
    for (const acc of taxBucket.values()) {
      const taxCents = Math.round(acc.taxable * (acc.rate / 100));
      totalTax += taxCents;
      taxesArr.push({
        jurisdiction: acc.jurisdiction,
        name: acc.name,
        ratePct: acc.rate,
        taxable: acc.taxable,
        tax: taxCents,
      });
    }
    // Replace the invoice_taxes rows.
    await tx.delete(invoiceTaxes).where(eq(invoiceTaxes.invoiceId, invoiceId));
    for (const t of taxesArr) {
      await tx.insert(invoiceTaxes).values({
        id: uuidv7(),
        tenantId: inv.tenantId,
        invoiceId,
        taxJurisdiction: t.jurisdiction,
        taxName: t.name,
        taxRatePct: String(t.ratePct),
        taxableAmountCents: t.taxable,
        taxAmountCents: t.tax,
      });
    }
    const total = subtotal + totalTax;

    // Sum cleared payments (excluding soft-deleted).
    const payRows = await tx.query.payments.findMany({
      where: and(
        eq(payments.invoiceId, invoiceId),
        isNull(payments.deletedAt),
        eq(payments.status, 'cleared'),
      ),
    });
    const paid = payRows.reduce((acc, p) => acc + p.amountCents, 0);
    const balance = total - paid;

    const isOverdue = inv.dueAt ? inv.dueAt.getTime() < Date.now() && balance > 0 : false;
    const newStatus = statusAfterPayment({
      current: inv.status,
      totalCents: total,
      newPaidCents: paid,
      isOverdue,
    });

    const [updated] = await tx
      .update(invoices)
      .set({
        subtotalCents: subtotal,
        taxCents: totalTax,
        totalCents: total,
        paidCents: paid,
        balanceCents: balance,
        status: newStatus,
        paidAt: newStatus === 'paid' && !inv.paidAt ? new Date() : inv.paidAt,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId))
      .returning();
    if (!updated) throw notFound('Invoice not found');
    return updated;
  }

  private async loadInvoiceDetails(
    tx: Tx,
    invoiceId: string,
  ): Promise<{
    lineItems: InvoiceLineItemDto[];
    taxes: InvoiceTaxDto[];
    payments: PaymentDto[];
  }> {
    const lineRows = await tx.query.invoiceLineItems.findMany({
      where: eq(invoiceLineItems.invoiceId, invoiceId),
      orderBy: [asc(invoiceLineItems.lineNumber)],
    });
    const taxRows = await tx.query.invoiceTaxes.findMany({
      where: eq(invoiceTaxes.invoiceId, invoiceId),
    });
    const payRows = await tx.query.payments.findMany({
      where: and(eq(payments.invoiceId, invoiceId), isNull(payments.deletedAt)),
      orderBy: [desc(payments.receivedAt)],
    });
    return {
      lineItems: lineRows.map(lineItemToDto),
      taxes: taxRows.map(taxToDto),
      payments: payRows.map(paymentToDto),
    };
  }

  private async assembleWithDetails(tx: Tx, invoiceId: string): Promise<InvoiceWithDetailsDto> {
    const inv = await tx.query.invoices.findFirst({
      where: and(eq(invoices.id, invoiceId), isNull(invoices.deletedAt)),
    });
    if (!inv) throw notFound('Invoice not found');
    const details = await this.loadInvoiceDetails(tx, invoiceId);
    return { ...toInvoiceDto(inv), ...details };
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

// ----- helpers -----

function computeDueAt(issuedAt: Date, terms: InvoiceTerms): Date {
  const days = dueDaysForTerms(terms);
  const d = new Date(issuedAt.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function nextMonthFirstUtc(from: Date): Date {
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return next;
}

function toInvoiceDto(r: typeof invoices.$inferSelect): InvoiceDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    invoiceNumber: r.invoiceNumber,
    invoiceType: r.invoiceType,
    status: r.status,
    customerId: r.customerId,
    accountId: r.accountId,
    jobId: r.jobId,
    rateSheetId: r.rateSheetId,
    issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
    dueAt: r.dueAt ? r.dueAt.toISOString() : null,
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    voidedAt: r.voidedAt ? r.voidedAt.toISOString() : null,
    subtotalCents: r.subtotalCents,
    taxCents: r.taxCents,
    totalCents: r.totalCents,
    paidCents: r.paidCents,
    balanceCents: r.balanceCents,
    currency: r.currency,
    terms: r.terms,
    notes: r.notes,
    internalNotes: r.internalNotes,
    billingAddress: (r.billingAddress as InvoiceBillingAddress) ?? null,
    voidReason: r.voidReason,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function lineItemToDto(li: typeof invoiceLineItems.$inferSelect): InvoiceLineItemDto {
  return {
    id: li.id,
    invoiceId: li.invoiceId,
    lineNumber: li.lineNumber,
    lineType: li.lineType as InvoiceLineItemType,
    description: li.description,
    quantity: String(li.quantity),
    unit: li.unit,
    unitPriceCents: li.unitPriceCents,
    lineTotalCents: li.lineTotalCents,
    taxable: li.taxable,
    taxRatePct: String(li.taxRatePct),
    rateRuleId: li.rateRuleId,
    createdAt: li.createdAt.toISOString(),
    updatedAt: li.updatedAt.toISOString(),
  };
}

function taxToDto(t: typeof invoiceTaxes.$inferSelect): InvoiceTaxDto {
  return {
    id: t.id,
    taxJurisdiction: t.taxJurisdiction,
    taxName: t.taxName,
    taxRatePct: String(t.taxRatePct),
    taxableAmountCents: t.taxableAmountCents,
    taxAmountCents: t.taxAmountCents,
  };
}

function paymentToDto(p: typeof payments.$inferSelect): PaymentDto {
  return {
    id: p.id,
    invoiceId: p.invoiceId,
    amountCents: p.amountCents,
    paymentMethod: p.paymentMethod as PaymentMethod,
    referenceNumber: p.referenceNumber,
    receivedAt: p.receivedAt.toISOString(),
    recordedBy: p.recordedBy,
    status: p.status as PaymentStatus,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
  };
}

function creditMemoToDto(m: typeof creditMemos.$inferSelect): CreditMemoDto {
  return {
    id: m.id,
    memoNumber: m.memoNumber,
    originalInvoiceId: m.originalInvoiceId,
    amountCents: m.amountCents,
    reasonCode: m.reasonCode,
    reason: m.reason,
    appliedTo: m.appliedTo,
    issuedAt: m.issuedAt.toISOString(),
    issuedBy: m.issuedBy,
    createdAt: m.createdAt.toISOString(),
  };
}

function recurringScheduleToDto(
  r: typeof recurringBillingSchedules.$inferSelect,
): RecurringScheduleDto {
  return {
    id: r.id,
    customerId: r.customerId,
    accountId: r.accountId,
    jobId: r.jobId,
    description: r.description,
    dailyRateCents: r.dailyRateCents,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    lastInvoicedThrough: r.lastInvoicedThrough ? r.lastInvoicedThrough.toISOString() : null,
    nextInvoiceAt: r.nextInvoiceAt ? r.nextInvoiceAt.toISOString() : null,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  };
}

const notFound = (msg: string): NotFoundException =>
  new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: msg });
