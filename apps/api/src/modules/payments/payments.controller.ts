/**
 * PaymentsController — Session 11 authenticated REST surface.
 *
 *   /payments/connect/status            owner+admin (GET)
 *   /payments/connect/start             owner+admin (POST)
 *   /payments/connect/refresh-link      owner+admin (POST)
 *   /payments/connect/sync              owner+admin (POST)
 *   /payments/connect/margin            owner+admin (PUT)
 *   /payments/intents                   any billing role (POST)
 *   /payments/pay-link                  any billing role (POST)
 *   /payments/customers/:id/card        any billing role (GET)
 *   /payments/customers/:id/setup-intent any billing role (POST)
 *   /payments/customers/:id/auto-charge owner/admin/manager/accounting (PUT)
 *   /payments/customers/:id/card        owner/admin (DELETE)
 *   /billing/payments/:id/refund        owner/admin (POST)  [registered here]
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type CardOnFileDto,
  type CreateInvoicePaymentIntentPayload,
  type IssuePayLinkPayload,
  type PayLinkDto,
  type PaymentIntentDto,
  ROLES,
  type RefundPaymentPayload,
  type RemoveCardOnFileResponse,
  type SetAutoChargePayload,
  type StripeConnectRefreshResponse,
  type StripeConnectStartResponse,
  type StripeConnectStatusDto,
  type UpdatePlatformMarginPayload,
  createInvoicePaymentIntentSchema,
  issuePayLinkSchema,
  refundPaymentSchema,
  setAutoChargeSchema,
  updatePlatformMarginSchema,
} from '@towdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PaymentsService } from './payments.service.js';

const idParam = z.object({ id: z.string().uuid() });

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  role: string | null;
}

@UseGuards(RolesGuard)
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // ===== Connect =====

  @Get('payments/connect/status')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async connectStatus(@Req() req: FastifyRequest): Promise<StripeConnectStatusDto> {
    return this.payments.getConnectStatus(this.ctx(req));
  }

  @Post('payments/connect/start')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async connectStart(@Req() req: FastifyRequest): Promise<StripeConnectStartResponse> {
    return this.payments.startConnectOnboarding(this.ctx(req));
  }

  @Post('payments/connect/refresh-link')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async refreshLink(@Req() req: FastifyRequest): Promise<StripeConnectRefreshResponse> {
    return this.payments.refreshConnectOnboardingLink(this.ctx(req));
  }

  @Post('payments/connect/sync')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async syncConnect(@Req() req: FastifyRequest): Promise<StripeConnectStatusDto> {
    return this.payments.syncConnectAccount(this.ctx(req));
  }

  @Put('payments/connect/margin')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async setMargin(
    @ZodBody(updatePlatformMarginSchema) body: UpdatePlatformMarginPayload,
    @Req() req: FastifyRequest,
  ): Promise<StripeConnectStatusDto> {
    return this.payments.setPlatformMargin(this.ctx(req), body.platformMarginBps);
  }

  // ===== Pay link / intents =====

  @Post('payments/intents')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async createIntent(
    @ZodBody(createInvoicePaymentIntentSchema) body: CreateInvoicePaymentIntentPayload,
    @Req() req: FastifyRequest,
  ): Promise<PaymentIntentDto> {
    return this.payments.createInvoicePaymentIntent(this.ctx(req), body);
  }

  @Post('payments/pay-link')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async issuePayLink(
    @ZodBody(issuePayLinkSchema) body: IssuePayLinkPayload,
    @Req() req: FastifyRequest,
  ): Promise<PayLinkDto> {
    return this.payments.issuePayLink(this.ctx(req), body.invoiceId);
  }

  // ===== Card on file =====

  @Get('payments/customers/:id/card')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async getCard(
    @ZodParam(idParam) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<CardOnFileDto> {
    return this.payments.getCardOnFile(this.ctx(req), params.id);
  }

  @Post('payments/customers/:id/setup-intent')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.DISPATCHER)
  async createCustomerSetupIntent(
    @ZodParam(idParam) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<{ clientSecret: string; setupIntentId: string }> {
    return this.payments.createCustomerSetupIntent(this.ctx(req), params.id);
  }

  @Put('payments/customers/:id/auto-charge')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING)
  async setAutoCharge(
    @ZodParam(idParam) params: { id: string },
    @ZodBody(setAutoChargeSchema) body: SetAutoChargePayload,
    @Req() req: FastifyRequest,
  ): Promise<CardOnFileDto> {
    return this.payments.setAutoCharge(this.ctx(req), params.id, body.enabled);
  }

  @Delete('payments/customers/:id/card')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async removeCard(
    @ZodParam(idParam) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<RemoveCardOnFileResponse> {
    return this.payments.removeCardOnFile(this.ctx(req), params.id);
  }

  // ===== Refund (registered under /billing for symmetry with Session 10) =====

  @Post('billing/payments/:id/refund')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async refund(
    @ZodParam(idParam) params: { id: string },
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ ok: true; refundedCents: number; refundId: string }> {
    const parsed: RefundPaymentPayload = refundPaymentSchema.parse(body ?? {});
    return this.payments.refundPayment(this.ctx(req), params.id, parsed);
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
