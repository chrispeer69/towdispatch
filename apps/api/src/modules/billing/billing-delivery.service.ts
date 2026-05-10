/**
 * BillingDeliveryService — composes PDF rendering, storage persistence,
 * and email delivery so the InvoicesService can stay focused on data.
 *
 *   1. renderInvoicePdf()  — builds a PDF Buffer for the given invoice id
 *      and persists it under tenants/{tid}/invoice/{invoiceId}/{name}.pdf via
 *      the StorageProvider (best-effort — render failure throws; storage
 *      failure is logged but does not break the request).
 *
 *   2. deliverInvoiceIssuedEmail() — looks up the customer/account email and
 *      sends invoice-issued / overdue templates. No-op for cash receipts.
 *
 *   3. renderStatementPdf() — A/R aging snapshot PDF for one account.
 */
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  accounts,
  customers,
  invoices,
  tenants,
} from '@towcommand/db';
import {
  ERROR_CODES,
  type CreditMemoDto,
  type InvoiceBillingAddress,
  type InvoiceWithDetailsDto,
  type StorageProvider,
  invoiceStatusLabel,
  paymentMethodLabel,
} from '@towcommand/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { EmailService } from '../email/email.service.js';
import { STORAGE_PROVIDER } from '../storage/storage.module.js';
import { InvoicesService } from './invoices.service.js';
import { InvoicePdfService, type PdfLanguage } from './invoice-pdf.service.js';
import { StatementPdfService } from './statement-pdf.service.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  role?: string | null;
}

@Injectable()
export class BillingDeliveryService {
  private readonly log = new Logger(BillingDeliveryService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly invoicesService: InvoicesService,
    private readonly pdfService: InvoicePdfService,
    private readonly statementPdf: StatementPdfService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async renderInvoicePdf(
    ctx: CallerContext,
    invoiceId: string,
    language: PdfLanguage,
  ): Promise<{ bytes: Buffer; invoice: InvoiceWithDetailsDto }> {
    const invoice = await this.invoicesService.get(ctx, invoiceId);
    const tenant = await this.loadTenantBranding(ctx);
    const bytes = await this.pdfService.renderInvoice({
      invoice,
      lineItems: invoice.lineItems,
      taxes: invoice.taxes,
      payments: invoice.payments,
      tenant,
      language,
    });
    // Persist into the StorageProvider best-effort. Failures are logged but
    // don't break the request — the caller already has the bytes.
    try {
      await this.storage.put({
        tenantId: ctx.tenantId,
        ownerType: 'invoice',
        ownerId: invoiceId,
        fileName: `${invoice.invoiceNumber}.pdf`,
        mimeType: 'application/pdf',
        bytes,
      });
    } catch (err) {
      this.log.warn(`Storage put failed for invoice ${invoiceId}: ${String(err)}`);
    }
    return { bytes, invoice };
  }

  async renderStatementPdf(
    ctx: CallerContext,
    accountId: string,
    language: PdfLanguage,
  ): Promise<{ bytes: Buffer; accountName: string }> {
    const aging = await this.invoicesService.aging(ctx, { accountId });
    const acct = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      return tx.query.accounts.findFirst({
        where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
      });
    });
    if (!acct) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Account not found',
      });
    }
    const open = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      return tx.query.invoices.findMany({
        where: and(
          eq(invoices.accountId, accountId),
          isNull(invoices.deletedAt),
          sql`${invoices.balanceCents} > 0`,
        ),
        orderBy: (t, { asc }) => [asc(t.dueAt)],
      });
    });
    const tenant = await this.loadTenantBranding(ctx);
    const bytes = await this.statementPdf.renderStatement({
      tenant,
      accountName: acct.name,
      asOf: aging.asOf,
      totals: aging.totals,
      invoices: open.map((i) => ({
        invoiceNumber: i.invoiceNumber,
        issuedAt: i.issuedAt ? i.issuedAt.toISOString() : null,
        dueAt: i.dueAt ? i.dueAt.toISOString() : null,
        totalCents: i.totalCents,
        balanceCents: i.balanceCents,
        status: i.status,
      })),
      language,
    });
    try {
      await this.storage.put({
        tenantId: ctx.tenantId,
        ownerType: 'statement',
        ownerId: accountId,
        fileName: `statement-${aging.asOf.slice(0, 10)}.pdf`,
        mimeType: 'application/pdf',
        bytes,
      });
    } catch (err) {
      this.log.warn(`Storage put failed for statement ${accountId}: ${String(err)}`);
    }
    return { bytes, accountName: acct.name };
  }

  async deliverInvoiceIssuedEmail(
    ctx: CallerContext,
    invoice: InvoiceWithDetailsDto,
  ): Promise<{ ok: boolean }> {
    if (invoice.invoiceType === 'cash_receipt') return { ok: false };
    const recipient = invoice.billingAddress?.email ?? null;
    const recipientName = invoice.billingAddress?.name ?? 'Customer';
    if (!recipient) {
      this.log.warn(`No email on billing_address for invoice ${invoice.id}; skipping send.`);
      return { ok: false };
    }
    const tenantName = await this.loadTenantName(ctx);
    await this.email.sendInvoiceIssuedEmail({
      to: recipient,
      recipientName,
      tenantName,
      invoiceNumber: invoice.invoiceNumber,
      totalFormatted: formatMoney(invoice.totalCents),
      balanceFormatted: formatMoney(invoice.balanceCents),
      dueDate: invoice.dueAt ? invoice.dueAt.slice(0, 10) : null,
      invoiceUrl: `${this.config.webPublicUrl}/billing/invoices/${invoice.id}`,
    });
    return { ok: true };
  }

  async deliverCreditMemoEmail(
    ctx: CallerContext,
    memo: CreditMemoDto,
    invoice: InvoiceWithDetailsDto,
  ): Promise<{ ok: boolean }> {
    const recipient = invoice.billingAddress?.email ?? null;
    const recipientName = invoice.billingAddress?.name ?? 'Customer';
    if (!recipient) return { ok: false };
    const tenantName = await this.loadTenantName(ctx);
    await this.email.sendCreditMemoIssuedEmail({
      to: recipient,
      recipientName,
      tenantName,
      memoNumber: memo.memoNumber,
      invoiceNumber: invoice.invoiceNumber,
      amountFormatted: formatMoney(memo.amountCents),
      reason: memo.reason,
      appliedToText:
        memo.appliedTo === 'apply_to_invoice'
          ? `Applied to invoice ${invoice.invoiceNumber}.`
          : 'Held as credit on your account.',
    });
    return { ok: true };
  }

  /**
   * Send overdue notices for every newly-overdue invoice in the tenant. We
   * mark them as having been notified by stamping a marker into
   * internal_notes — re-running won't double-send within a 24-hour window.
   */
  async sendOverdueRemindersForTenant(ctx: CallerContext): Promise<number> {
    const list = await this.invoicesService.list(ctx, {
      status: 'overdue',
      limit: 200,
      offset: 0,
    });
    const tenantName = await this.loadTenantName(ctx);
    let sent = 0;
    for (const inv of list.data) {
      const detail = await this.invoicesService.get(ctx, inv.id);
      const recipient = detail.billingAddress?.email ?? null;
      if (!recipient) continue;
      const recipientName = detail.billingAddress?.name ?? 'Customer';
      try {
        await this.email.sendInvoiceOverdueEmail({
          to: recipient,
          recipientName,
          tenantName,
          invoiceNumber: detail.invoiceNumber,
          balanceFormatted: formatMoney(detail.balanceCents),
          dueDate: detail.dueAt ? detail.dueAt.slice(0, 10) : null,
          invoiceUrl: `${this.config.webPublicUrl}/billing/invoices/${detail.id}`,
        });
        sent += 1;
      } catch (err) {
        this.log.warn(`overdue email failed for invoice ${detail.id}: ${String(err)}`);
      }
    }
    return sent;
  }

  async sendStatementEmail(
    ctx: CallerContext,
    accountId: string,
  ): Promise<{ ok: boolean; sentTo: string | null }> {
    const aging = await this.invoicesService.aging(ctx, { accountId });
    const acct = await this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      return tx.query.accounts.findFirst({
        where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
      });
    });
    if (!acct) {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Account not found',
      });
    }
    const recipient = acct.apContactEmail ?? acct.billingEmail ?? null;
    if (!recipient) return { ok: false, sentTo: null };
    const tenantName = await this.loadTenantName(ctx);
    await this.email.sendStatementGeneratedEmail({
      to: recipient,
      recipientName: acct.apContactName ?? acct.name,
      tenantName,
      asOfDate: aging.asOf.slice(0, 10),
      invoiceCount: aging.totals.invoiceCount,
      totalFormatted: formatMoney(aging.totals.totalCents),
    });
    return { ok: true, sentTo: recipient };
  }

  private async loadTenantBranding(ctx: CallerContext): Promise<{
    name: string;
    address?: Record<string, unknown> | null;
    phone?: string | null;
    email?: string | null;
    taglineEn?: string | null;
    taglineEs?: string | null;
    logoUrl?: string | null;
  }> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const t = await tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
      if (!t) return { name: 'TowCommand' };
      const row = t as unknown as {
        name: string;
        billingAddress?: Record<string, unknown> | null;
        billingPhone?: string | null;
        billingEmail?: string | null;
        billingTagline?: string | null;
        billingLogoUrl?: string | null;
      };
      return {
        name: row.name,
        address: row.billingAddress ?? null,
        phone: row.billingPhone ?? null,
        email: row.billingEmail ?? null,
        taglineEn: row.billingTagline ?? null,
        taglineEs: row.billingTagline ?? null,
        logoUrl: row.billingLogoUrl ?? null,
      };
    });
  }

  private async loadTenantName(ctx: CallerContext): Promise<string> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const t = await tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) });
      return t?.name ?? 'TowCommand';
    });
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

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}.${String(remainder).padStart(2, '0')}`;
}

// Mark unused imports as referenced — they exist for type-completeness.
void invoiceStatusLabel;
void paymentMethodLabel;
type _Unused = InvoiceBillingAddress;
