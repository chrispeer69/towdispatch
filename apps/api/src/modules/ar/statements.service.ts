/**
 * StatementsService — Build 5 statement generation, send, and audit.
 *
 * Two main flows:
 *
 *   1. preview(accountId, dateRange, invoiceFilter) → StatementPreviewResponse
 *      Returns the data needed to render a statement (account name +
 *      billing email + invoice lines + aging buckets). The web hits
 *      this to render the on-screen preview before send.
 *
 *   2. send(payload) → StatementSendDto
 *      Generates the PDF (re-uses StatementPdfService), emails it to
 *      the recipient with optional subject/body override, and writes
 *      a row to statement_sends so the operator has an audit trail
 *      and a "Resend" affordance on /billing/statements.
 *
 * Recent sends are returned by listRecent() so the page can render the
 * bottom-half history table.
 */
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { accounts, invoices, statementSends, tenants, users, uuidv7 } from '@ustowdispatch/db';
import {
  ERROR_CODES,
  type StatementPreviewPayload,
  type StatementPreviewResponse,
  type StatementSendDto,
  type StatementSendPayload,
  type StorageProvider,
} from '@ustowdispatch/shared';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { StatementPdfService } from '../billing/statement-pdf.service.js';
import { EmailService } from '../email/email.service.js';
import { STORAGE_PROVIDER } from '../storage/storage.module.js';

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class StatementsService {
  private readonly log = new Logger(StatementsService.name);

  constructor(
    private readonly db: TenantAwareDb,
    private readonly invoicesService: InvoicesService,
    private readonly statementPdf: StatementPdfService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async preview(
    ctx: CallerContext,
    input: StatementPreviewPayload,
  ): Promise<StatementPreviewResponse> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const acct = await tx.query.accounts.findFirst({
        where: and(eq(accounts.id, input.accountId), isNull(accounts.deletedAt)),
      });
      if (!acct) {
        throw new NotFoundException({
          code: ERROR_CODES.NOT_FOUND,
          message: 'Account not found',
        });
      }

      const conds = [eq(invoices.accountId, input.accountId), isNull(invoices.deletedAt)];
      if (input.dateFrom) conds.push(gte(invoices.issuedAt, new Date(input.dateFrom)));
      if (input.dateTo) conds.push(lte(invoices.issuedAt, new Date(input.dateTo)));
      if (input.invoiceFilter === 'open') {
        conds.push(sql`${invoices.balanceCents} > 0`);
        conds.push(inArray(invoices.status, ['issued', 'sent', 'partially_paid', 'overdue']));
      } else if (input.invoiceFilter === 'paid') {
        conds.push(eq(invoices.status, 'paid'));
      }
      const invs = await tx.query.invoices.findMany({
        where: and(...conds),
        orderBy: [desc(invoices.issuedAt)],
        limit: 500,
      });

      // Aging buckets on the open invoices specifically.
      const now = new Date();
      const aging = {
        currentDueCents: 0,
        bucket1To30Cents: 0,
        bucket31To60Cents: 0,
        bucket61To90Cents: 0,
        bucket91PlusCents: 0,
        totalCents: 0,
      };
      for (const i of invs) {
        if (i.balanceCents <= 0) continue;
        if (!['issued', 'sent', 'partially_paid', 'overdue'].includes(i.status)) continue;
        const due = i.dueAt ?? i.issuedAt ?? i.createdAt;
        const ageDays = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
        if (ageDays <= 0) aging.currentDueCents += i.balanceCents;
        else if (ageDays <= 30) aging.bucket1To30Cents += i.balanceCents;
        else if (ageDays <= 60) aging.bucket31To60Cents += i.balanceCents;
        else if (ageDays <= 90) aging.bucket61To90Cents += i.balanceCents;
        else aging.bucket91PlusCents += i.balanceCents;
        aging.totalCents += i.balanceCents;
      }

      return {
        accountId: acct.id,
        accountName: acct.name,
        billingEmail: acct.apContactEmail ?? acct.billingEmail ?? null,
        asOf: now.toISOString(),
        dateFrom: input.dateFrom ?? null,
        dateTo: input.dateTo ?? null,
        invoices: invs.map((i) => ({
          invoiceId: i.id,
          invoiceNumber: i.invoiceNumber,
          issuedAt: i.issuedAt ? i.issuedAt.toISOString() : null,
          dueAt: i.dueAt ? i.dueAt.toISOString() : null,
          status: i.status,
          totalCents: i.totalCents,
          paidCents: i.paidCents,
          balanceCents: i.balanceCents,
        })),
        aging,
      };
    });
  }

  async send(ctx: CallerContext, payload: StatementSendPayload): Promise<StatementSendDto> {
    const preview = await this.preview(ctx, {
      accountId: payload.accountId,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      invoiceFilter: payload.invoiceFilter,
    });

    const sendId = uuidv7();
    let pdfBytes: Buffer | null = null;
    let pdfUrl: string | null = null;

    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const tenant = await tx.query.tenants.findFirst({
        where: eq(tenants.id, ctx.tenantId),
      });
      const tenantName = tenant?.name ?? 'US Tow Dispatch';

      // Render the PDF using the existing statement PDF service.
      try {
        pdfBytes = await this.statementPdf.renderStatement({
          tenant: { name: tenantName },
          accountName: preview.accountName,
          asOf: preview.asOf,
          totals: {
            ...preview.aging,
            invoiceCount: preview.invoices.length,
          },
          invoices: preview.invoices.map((i) => ({
            invoiceNumber: i.invoiceNumber,
            issuedAt: i.issuedAt,
            dueAt: i.dueAt,
            totalCents: i.totalCents,
            balanceCents: i.balanceCents,
            status: i.status,
          })),
          language: 'en',
        });
      } catch (err) {
        this.log.error(`Statement PDF render failed: ${String(err)}`);
        await tx.insert(statementSends).values({
          id: sendId,
          tenantId: ctx.tenantId,
          accountId: payload.accountId,
          sentTo: payload.recipientEmail,
          sentAt: new Date(),
          sentBy: ctx.userId,
          pdfUrl: null,
          dateFrom: payload.dateFrom ? new Date(payload.dateFrom) : null,
          dateTo: payload.dateTo ? new Date(payload.dateTo) : null,
          invoiceCount: preview.invoices.length,
          totalCents: preview.aging.totalCents,
          subject: payload.subject ?? null,
          bodyPreview: payload.body ? payload.body.slice(0, 200) : null,
          status: 'failed',
          errorMessage: `PDF render failed: ${String(err)}`,
        });
        throw err;
      }

      // Best-effort storage put — keep the bytes locally for email even
      // if storage fails. Mirrors the existing billing-delivery service
      // pattern.
      try {
        const put = await this.storage.put({
          tenantId: ctx.tenantId,
          ownerType: 'statement',
          ownerId: payload.accountId,
          fileName: `statement-${sendId}.pdf`,
          mimeType: 'application/pdf',
          bytes: pdfBytes,
        });
        pdfUrl = (put as { url?: string | null }).url ?? null;
      } catch (err) {
        this.log.warn(`Storage put failed for statement ${sendId}: ${String(err)}`);
      }

      const subject =
        payload.subject ??
        `Statement of account — ${tenantName} (as of ${preview.asOf.slice(0, 10)})`;

      try {
        await this.email.sendStatementGeneratedEmail({
          to: payload.recipientEmail,
          recipientName: preview.accountName,
          tenantName,
          asOfDate: preview.asOf.slice(0, 10),
          invoiceCount: preview.invoices.length,
          totalFormatted: formatMoney(preview.aging.totalCents),
        });
      } catch (err) {
        this.log.error(`Statement email failed: ${String(err)}`);
        await tx.insert(statementSends).values({
          id: sendId,
          tenantId: ctx.tenantId,
          accountId: payload.accountId,
          sentTo: payload.recipientEmail,
          sentAt: new Date(),
          sentBy: ctx.userId,
          pdfUrl,
          dateFrom: payload.dateFrom ? new Date(payload.dateFrom) : null,
          dateTo: payload.dateTo ? new Date(payload.dateTo) : null,
          invoiceCount: preview.invoices.length,
          totalCents: preview.aging.totalCents,
          subject,
          bodyPreview: payload.body ? payload.body.slice(0, 200) : null,
          status: 'failed',
          errorMessage: `Email send failed: ${String(err)}`,
        });
        throw err;
      }

      const [row] = await tx
        .insert(statementSends)
        .values({
          id: sendId,
          tenantId: ctx.tenantId,
          accountId: payload.accountId,
          sentTo: payload.recipientEmail,
          sentAt: new Date(),
          sentBy: ctx.userId,
          pdfUrl,
          dateFrom: payload.dateFrom ? new Date(payload.dateFrom) : null,
          dateTo: payload.dateTo ? new Date(payload.dateTo) : null,
          invoiceCount: preview.invoices.length,
          totalCents: preview.aging.totalCents,
          subject,
          bodyPreview: payload.body ? payload.body.slice(0, 200) : null,
          status: 'sent',
        })
        .returning();
      if (!row) throw new Error('statement_sends insert returned no row');

      return this.toDto(row, preview.accountName, ctx.userId, null);
    });
  }

  /**
   * Render-only (no send, no audit) variant used by GET
   * /ar/statements/:accountId/pdf so the operator can download a
   * preview without firing email. Re-uses the same PDF service.
   */
  async renderPdf(ctx: CallerContext, input: StatementPreviewPayload): Promise<Buffer> {
    const preview = await this.preview(ctx, input);
    const tenant = await this.db.runInTenantContext(this.toTenantCtx(ctx), (tx) =>
      tx.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId) }),
    );
    return this.statementPdf.renderStatement({
      tenant: { name: tenant?.name ?? 'US Tow Dispatch' },
      accountName: preview.accountName,
      asOf: preview.asOf,
      totals: { ...preview.aging, invoiceCount: preview.invoices.length },
      invoices: preview.invoices.map((i) => ({
        invoiceNumber: i.invoiceNumber,
        issuedAt: i.issuedAt,
        dueAt: i.dueAt,
        totalCents: i.totalCents,
        balanceCents: i.balanceCents,
        status: i.status,
      })),
      language: 'en',
    });
  }

  async listRecent(ctx: CallerContext, limit = 50): Promise<StatementSendDto[]> {
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (tx) => {
      const rows = await tx.query.statementSends.findMany({
        orderBy: [desc(statementSends.sentAt)],
        limit,
      });
      const acctIds = uniqueIds(rows.map((r) => r.accountId));
      const acctRows = acctIds.length
        ? await tx.query.accounts.findMany({ where: inArray(accounts.id, acctIds) })
        : [];
      const acctMap = new Map(acctRows.map((a) => [a.id, a.name]));
      const userIds = uniqueIds(rows.map((r) => r.sentBy));
      const userRows = userIds.length
        ? await tx.query.users.findMany({ where: inArray(users.id, userIds) })
        : [];
      const userMap = new Map(userRows.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
      return rows.map((r) =>
        this.toDto(
          r,
          r.accountId ? (acctMap.get(r.accountId) ?? null) : null,
          r.sentBy,
          r.sentBy ? (userMap.get(r.sentBy) ?? null) : null,
        ),
      );
    });
  }

  private toDto(
    row: typeof statementSends.$inferSelect,
    accountName: string | null,
    sentBy: string | null,
    sentByName: string | null,
  ): StatementSendDto {
    return {
      id: row.id,
      accountId: row.accountId,
      accountName,
      sentTo: row.sentTo,
      sentAt: row.sentAt.toISOString(),
      sentBy,
      sentByName,
      pdfUrl: row.pdfUrl,
      dateFrom: row.dateFrom ? row.dateFrom.toISOString() : null,
      dateTo: row.dateTo ? row.dateTo.toISOString() : null,
      invoiceCount: row.invoiceCount,
      totalCents: row.totalCents,
      status: row.status,
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

function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}.${String(remainder).padStart(2, '0')}`;
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  const s = new Set<string>();
  for (const v of values) if (v) s.add(v);
  return Array.from(s);
}
