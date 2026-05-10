/**
 * BillingController — REST surface for the Session 10 invoicing module.
 *
 * Endpoint groups follow the prompt's contract:
 *   /billing/invoices             list / create / get / update / actions
 *   /billing/invoices/:id/...     state transitions + line items
 *   /billing/payments             record / list / void
 *   /billing/credit-memos         create / list
 *   /billing/aging                A/R aging dashboard
 *   /billing/statements/:id       account statement PDF
 *   /billing/recurring            recurring storage schedules
 */
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type AgingFilters,
  type AgingResponse,
  type CreateCreditMemoPayload,
  type CreateInvoiceLineItemPayload,
  type CreateInvoicePayload,
  type CreateRecurringSchedulePayload,
  type CreditMemoDto,
  type InvoiceDto,
  type InvoiceFilters,
  type InvoiceWithDetailsDto,
  type PaymentDto,
  type PaymentFilters,
  ROLES,
  type RecordPaymentPayload,
  type RecurringScheduleDto,
  type VoidInvoicePayload,
  agingFiltersSchema,
  createCreditMemoSchema,
  createInvoiceLineItemSchema,
  createInvoiceSchema,
  createRecurringScheduleSchema,
  invoiceFiltersSchema,
  paymentFiltersSchema,
  recordPaymentSchema,
  updateInvoiceSchema,
  voidInvoiceSchema,
} from '@towcommand/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { BillingDeliveryService } from './billing-delivery.service.js';
import { InvoicesService } from './invoices.service.js';

const idSchema = z.object({ id: z.string().uuid() });
const lineItemPathSchema = z.object({ id: z.string().uuid(), lineItemId: z.string().uuid() });
const accountIdSchema = z.object({ accountId: z.string().uuid() });

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  role: string | null;
}

@UseGuards(RolesGuard)
@Controller('billing')
export class BillingController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly delivery: BillingDeliveryService,
  ) {}

  // ----- invoices -----

  @Get('invoices')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async list(
    @ZodQuery(invoiceFiltersSchema) query: InvoiceFilters,
    @Req() req: FastifyRequest,
  ): Promise<{ data: InvoiceDto[]; total: number; limit: number; offset: number }> {
    return this.invoices.list(this.ctx(req), query);
  }

  @Post('invoices')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async create(
    @ZodBody(createInvoiceSchema) body: CreateInvoicePayload,
    @Req() req: FastifyRequest,
  ): Promise<InvoiceWithDetailsDto> {
    return this.invoices.createManual(this.ctx(req), body);
  }

  @Get('invoices/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async get(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<InvoiceWithDetailsDto> {
    return this.invoices.get(this.ctx(req), params.id);
  }

  @Put('invoices/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async update(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(updateInvoiceSchema) body: z.infer<typeof updateInvoiceSchema>,
    @Req() req: FastifyRequest,
  ): Promise<InvoiceWithDetailsDto> {
    return this.invoices.update(this.ctx(req), params.id, body);
  }

  @Post('invoices/from-job/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async generateFromJob(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<{ invoice: InvoiceWithDetailsDto; created: boolean }> {
    return this.invoices.generateFromJob(this.ctx(req), params.id);
  }

  @Post('invoices/:id/issue')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async issue(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<InvoiceWithDetailsDto> {
    const ctx = this.ctx(req);
    const issued = await this.invoices.issue(ctx, params.id);
    // Best-effort delivery — failures don't reverse the issue.
    this.delivery
      .deliverInvoiceIssuedEmail(ctx, issued)
      .catch((err) => process.stderr.write(`[billing-delivery] ${String(err)}\n`));
    return issued;
  }

  @Post('invoices/:id/void')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async voidInvoice(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(voidInvoiceSchema) body: VoidInvoicePayload,
    @Req() req: FastifyRequest,
  ): Promise<InvoiceWithDetailsDto> {
    const ctx = this.ctx(req);
    return this.invoices.voidInvoice(ctx, params.id, body.reason, ctx.role);
  }

  @Post('invoices/:id/send')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async send(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<InvoiceWithDetailsDto> {
    const ctx = this.ctx(req);
    const inv = await this.invoices.markSent(ctx, params.id);
    this.delivery
      .deliverInvoiceIssuedEmail(ctx, inv)
      .catch((err) => process.stderr.write(`[billing-delivery] ${String(err)}\n`));
    return inv;
  }

  @Get('invoices/:id/pdf')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async pdf(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const ctx = this.ctx(req);
    const lang = (req.query as { lang?: 'en' | 'es' } | undefined)?.lang ?? 'en';
    const result = await this.delivery.renderInvoicePdf(ctx, params.id, lang);
    reply
      .header('content-type', 'application/pdf')
      .header(
        'content-disposition',
        `inline; filename="${result.invoice.invoiceNumber}.pdf"`,
      )
      .send(result.bytes);
  }

  // ----- line items -----

  @Post('invoices/:id/line-items')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async addLine(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(createInvoiceLineItemSchema) body: CreateInvoiceLineItemPayload,
    @Req() req: FastifyRequest,
  ): Promise<InvoiceWithDetailsDto> {
    return this.invoices.addLineItem(this.ctx(req), params.id, body);
  }

  @Patch('invoices/:id/line-items/:lineItemId')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async updateLine(
    @ZodParam(lineItemPathSchema) params: { id: string; lineItemId: string },
    @ZodBody(createInvoiceLineItemSchema.partial()) body: Partial<CreateInvoiceLineItemPayload>,
    @Req() req: FastifyRequest,
  ): Promise<InvoiceWithDetailsDto> {
    return this.invoices.updateLineItem(this.ctx(req), params.id, params.lineItemId, body);
  }

  @Delete('invoices/:id/line-items/:lineItemId')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async deleteLine(
    @ZodParam(lineItemPathSchema) params: { id: string; lineItemId: string },
    @Req() req: FastifyRequest,
  ): Promise<InvoiceWithDetailsDto> {
    return this.invoices.deleteLineItem(this.ctx(req), params.id, params.lineItemId);
  }

  // ----- payments -----

  @Post('payments')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async recordPayment(
    @ZodBody(recordPaymentSchema) body: RecordPaymentPayload,
    @Req() req: FastifyRequest,
  ): Promise<{ payment: PaymentDto; invoice: InvoiceWithDetailsDto }> {
    return this.invoices.recordPayment(this.ctx(req), body);
  }

  @Get('payments')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async listPayments(
    @ZodQuery(paymentFiltersSchema) query: PaymentFilters,
    @Req() req: FastifyRequest,
  ): Promise<{ data: PaymentDto[]; total: number }> {
    return this.invoices.listPayments(this.ctx(req), query);
  }

  @Delete('payments/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async voidPayment(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<InvoiceWithDetailsDto> {
    const ctx = this.ctx(req);
    return this.invoices.voidPayment(ctx, params.id, ctx.role);
  }

  // ----- credit memos -----

  @Post('credit-memos')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async createMemo(
    @ZodBody(createCreditMemoSchema) body: CreateCreditMemoPayload,
    @Req() req: FastifyRequest,
  ): Promise<{ memo: CreditMemoDto; invoice: InvoiceWithDetailsDto }> {
    const ctx = this.ctx(req);
    const result = await this.invoices.createCreditMemo(ctx, body);
    this.delivery
      .deliverCreditMemoEmail(ctx, result.memo, result.invoice)
      .catch((err) => process.stderr.write(`[billing-delivery] ${String(err)}\n`));
    return result;
  }

  @Get('credit-memos')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async listMemos(@Req() req: FastifyRequest): Promise<CreditMemoDto[]> {
    return this.invoices.listCreditMemos(this.ctx(req));
  }

  // ----- aging + statements -----

  @Get('aging')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async aging(
    @ZodQuery(agingFiltersSchema) query: AgingFilters,
    @Req() req: FastifyRequest,
  ): Promise<AgingResponse> {
    return this.invoices.aging(this.ctx(req), query);
  }

  @Get('statements/:accountId')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async statement(
    @ZodParam(accountIdSchema) params: { accountId: string },
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const ctx = this.ctx(req);
    const lang = (req.query as { lang?: 'en' | 'es' } | undefined)?.lang ?? 'en';
    const result = await this.delivery.renderStatementPdf(ctx, params.accountId, lang);
    reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="statement-${params.accountId}.pdf"`)
      .send(result.bytes);
  }

  @Post('statements/:accountId/email')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async emailStatement(
    @ZodParam(accountIdSchema) params: { accountId: string },
    @Req() req: FastifyRequest,
  ): Promise<{ ok: boolean; sentTo: string | null }> {
    return this.delivery.sendStatementEmail(this.ctx(req), params.accountId);
  }

  // ----- recurring schedules -----

  @Post('recurring')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async createSchedule(
    @ZodBody(createRecurringScheduleSchema) body: CreateRecurringSchedulePayload,
    @Req() req: FastifyRequest,
  ): Promise<RecurringScheduleDto> {
    return this.invoices.createRecurringSchedule(this.ctx(req), body);
  }

  @Get('recurring')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async listSchedules(@Req() req: FastifyRequest): Promise<RecurringScheduleDto[]> {
    return this.invoices.listRecurringSchedules(this.ctx(req));
  }

  @Delete('recurring/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async endSchedule(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<RecurringScheduleDto> {
    return this.invoices.endRecurringSchedule(this.ctx(req), params.id);
  }

  // ----- ops/cron -----

  @Post('ops/sweep-overdue')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async sweepOverdue(
    @Req() req: FastifyRequest,
  ): Promise<{ flipped: number; sentEmails: number }> {
    const ctx = this.ctx(req);
    const flipped = await this.invoices.markOverdueSweep(ctx);
    const sentEmails = await this.delivery.sendOverdueRemindersForTenant(ctx);
    return { flipped, sentEmails };
  }

  private ctx(req: FastifyRequest): CallerContext {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
      role: (c.role as string | null) ?? null,
    };
  }
}
