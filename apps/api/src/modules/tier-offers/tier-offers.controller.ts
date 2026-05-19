/**
 * TierOffersController — operator-side REST surface for the Tier Offer
 * Composer (Moat #3). RBAC follows the spec:
 *
 *   OWNER, ADMIN, MANAGER  — full control (compose, send, cancel)
 *   DISPATCHER             — read-only on list/detail (no compose / send)
 *   ACCOUNTING, AUDITOR    — read-only on list/detail + reconciliation
 *   DRIVER                 — no API access
 *
 * Public, token-bearing endpoints (recipient accept / decline / preview)
 * live in tier-offers-public.controller.ts under @Public().
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type CancelTierOfferPayload,
  type CreateTierOfferPayload,
  type CreateTierOfferRecipientPayload,
  ROLES,
  type UpdateTierOfferPayload,
  type UpdateTierOfferRecipientPayload,
  cancelTierOfferSchema,
  createTierOfferRecipientSchema,
  createTierOfferSchema,
  tierOfferStatusValues,
  updateTierOfferRecipientSchema,
  updateTierOfferSchema,
} from '@ustowdispatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TierOfferReportsService } from './tier-offer-reports.service.js';
import { TierOfferService } from './tier-offer.service.js';

const idParam = z.object({ id: z.string().uuid() });
const idAndRecipientParam = z.object({
  id: z.string().uuid(),
  recipientId: z.string().uuid(),
});
const listFilter = z
  .object({
    status: z.enum(tierOfferStatusValues).optional(),
  })
  .strict();

@UseGuards(RolesGuard)
@Controller('tier-offers')
export class TierOffersController {
  constructor(
    private readonly service: TierOfferService,
    private readonly reports: TierOfferReportsService,
  ) {}

  @Get()
  async list(@Req() req: FastifyRequest, @ZodQuery(listFilter) query: { status?: string }) {
    return this.service.list(this.callerCtx(req), query);
  }

  @Get(':id')
  async getOne(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    return this.service.getOne(this.callerCtx(req), p.id);
  }

  @Post()
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async createDraft(
    @Req() req: FastifyRequest,
    @ZodBody(createTierOfferSchema) body: CreateTierOfferPayload,
  ) {
    return this.service.createDraft(this.callerCtx(req), body);
  }

  @Patch(':id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async updateDraft(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(updateTierOfferSchema) body: UpdateTierOfferPayload,
  ) {
    return this.service.updateDraft(this.callerCtx(req), p.id, body);
  }

  @Delete(':id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDraft(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    await this.service.softDeleteDraft(this.callerCtx(req), p.id);
  }

  @Post(':id/recipients')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async addRecipient(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(createTierOfferRecipientSchema) body: CreateTierOfferRecipientPayload,
  ) {
    // Coerce the offerId from the URL — the request body's offerId field
    // (if present) must match for the safety of misclicked clients.
    if (body.offerId !== p.id) {
      // Surfaced as a 400 rather than silent overwrite.
      throw new Error(
        `Path id ${p.id} does not match body offerId ${body.offerId}; refusing to add recipient.`,
      );
    }
    return this.service.addRecipient(this.callerCtx(req), p.id, body);
  }

  @Patch(':id/recipients/:recipientId')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async updateRecipient(
    @Req() req: FastifyRequest,
    @ZodParam(idAndRecipientParam) p: { id: string; recipientId: string },
    @ZodBody(updateTierOfferRecipientSchema) body: UpdateTierOfferRecipientPayload,
  ) {
    return this.service.updateRecipient(this.callerCtx(req), p.recipientId, body);
  }

  @Delete(':id/recipients/:recipientId')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeRecipient(
    @Req() req: FastifyRequest,
    @ZodParam(idAndRecipientParam) p: { id: string; recipientId: string },
  ) {
    await this.service.removeRecipient(this.callerCtx(req), p.recipientId);
  }

  @Post(':id/send')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async send(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    return this.service.send(this.callerCtx(req), p.id);
  }

  @Post(':id/cancel')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async cancel(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(cancelTierOfferSchema) body: CancelTierOfferPayload,
  ) {
    return this.service.cancel(this.callerCtx(req), p.id, body.reason ?? null);
  }

  @Get(':id/reconciliation')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async reconciliation(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    return this.reports.getReconciliation(this.callerCtx(req), p.id);
  }

  @Get(':id/reconciliation.csv')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.ACCOUNTING, ROLES.AUDITOR)
  async reconciliationCsv(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
    @ZodParam(idParam) p: { id: string },
  ) {
    const report = await this.reports.getReconciliation(this.callerCtx(req), p.id);
    const csv = this.reports.toCsv(report);
    res.header('content-type', 'text/csv; charset=utf-8');
    res.header(
      'content-disposition',
      `attachment; filename="tier-offer-${p.id}-reconciliation.csv"`,
    );
    res.send(csv);
  }

  private callerCtx(req: FastifyRequest): { tenantId: string; userId: string; requestId: string } {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
    };
  }
}
