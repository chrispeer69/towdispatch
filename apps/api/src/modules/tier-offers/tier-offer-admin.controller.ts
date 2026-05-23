/**
 * TierOfferAdminController — operator-facing surface for Moat #3.
 *
 * RBAC:
 *   OWNER, ADMIN   — full control (compose, edit, send, cancel, conclude,
 *                    manage roster)
 *   MANAGER        — send / conclude / mark manual response (operational)
 *   everyone authenticated — read (list + detail)
 *
 * All errors render as RFC 9457 problem+json via the global exception
 * filter (NestJS HttpExceptions carry our ERROR_CODES in the `code` field).
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
  UseGuards,
} from '@nestjs/common';
import {
  type CreateTierOfferPayload,
  type CreateTierOfferRecipientPayload,
  ROLES,
  type UpdateTierOfferPayload,
  type UpdateTierOfferRecipientPayload,
  createTierOfferRecipientSchema,
  createTierOfferSchema,
  updateTierOfferRecipientSchema,
  updateTierOfferSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { type CallerCtx, TierOfferComposerService } from './tier-offer-composer.service.js';
import { TierOfferRecipientService } from './tier-offer-recipient.service.js';
import {
  type CancelTierOfferPayload,
  type MarkRecipientResponsePayload,
  cancelTierOfferSchema,
  markRecipientResponseSchema,
} from './tier-offers.dtos.js';

const idParam = z.object({ id: z.string().uuid() });
const recipientParam = z.object({ recipientId: z.string().uuid() });

@UseGuards(RolesGuard)
@Controller('tier-offers')
export class TierOfferAdminController {
  constructor(
    private readonly composer: TierOfferComposerService,
    private readonly recipients: TierOfferRecipientService,
  ) {}

  // ---------- offers ----------

  @Get()
  async list(@Req() req: FastifyRequest) {
    return this.composer.list(this.ctx(req));
  }

  @Get(':id')
  async detail(@ZodParam(idParam) params: { id: string }, @Req() req: FastifyRequest) {
    return this.composer.getDetail(this.ctx(req), params.id);
  }

  @Post()
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async compose(
    @ZodBody(createTierOfferSchema) body: CreateTierOfferPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.composer.compose(this.ctx(req), body);
  }

  @Patch(':id')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async update(
    @ZodParam(idParam) params: { id: string },
    @ZodBody(updateTierOfferSchema) body: UpdateTierOfferPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.composer.updateDraft(this.ctx(req), params.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async remove(@ZodParam(idParam) params: { id: string }, @Req() req: FastifyRequest) {
    await this.composer.softDelete(this.ctx(req), params.id);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async send(@ZodParam(idParam) params: { id: string }, @Req() req: FastifyRequest) {
    return this.composer.send(this.ctx(req), params.id);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async activate(@ZodParam(idParam) params: { id: string }, @Req() req: FastifyRequest) {
    return this.composer.markEventActive(this.ctx(req), params.id);
  }

  @Post(':id/conclude')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async conclude(@ZodParam(idParam) params: { id: string }, @Req() req: FastifyRequest) {
    return this.composer.conclude(this.ctx(req), params.id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async cancel(
    @ZodParam(idParam) params: { id: string },
    @ZodBody(cancelTierOfferSchema) body: CancelTierOfferPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.composer.cancel(this.ctx(req), params.id, body.reason);
  }

  // ---------- recipients (roster) ----------

  @Get(':id/recipients')
  async listRecipients(@ZodParam(idParam) params: { id: string }, @Req() req: FastifyRequest) {
    return this.recipients.listForOffer(this.ctx(req), params.id);
  }

  @Post(':id/recipients')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async addRecipient(
    @ZodParam(idParam) params: { id: string },
    @ZodBody(createTierOfferRecipientSchema) body: CreateTierOfferRecipientPayload,
    @Req() req: FastifyRequest,
  ) {
    // The offerId in the path is authoritative — overwrite any body value
    // so a recipient can't be slipped onto a different offer.
    return this.recipients.addRecipient(this.ctx(req), { ...body, offerId: params.id });
  }

  @Patch('recipients/:recipientId')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async updateRecipient(
    @ZodParam(recipientParam) params: { recipientId: string },
    @ZodBody(updateTierOfferRecipientSchema) body: UpdateTierOfferRecipientPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.recipients.updateRecipient(this.ctx(req), params.recipientId, body);
  }

  @Post('recipients/:recipientId/revoke')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async revokeRecipient(
    @ZodParam(recipientParam) params: { recipientId: string },
    @Req() req: FastifyRequest,
  ) {
    return this.recipients.revokeRecipient(this.ctx(req), params.recipientId);
  }

  @Post('recipients/:recipientId/mark-response')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async markResponse(
    @ZodParam(recipientParam) params: { recipientId: string },
    @ZodBody(markRecipientResponseSchema) body: MarkRecipientResponsePayload,
    @Req() req: FastifyRequest,
  ) {
    return this.recipients.markManualResponse(this.ctx(req), params.recipientId, body);
  }

  private ctx(req: FastifyRequest): CallerCtx {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
    };
  }
}
