/**
 * CapacityController — operator REST surface for CADS.
 *
 * RBAC:
 *   OWNER, ADMIN               — settings + partner management
 *   OWNER, ADMIN, MANAGER,
 *   DISPATCHER                 — manual overrides (storm mode is a
 *                                dispatch-desk action)
 *   all authenticated roles    — read status / settings / broadcast log
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
  type CreateCapacityOverridePayload,
  type CreateCapacityPartnerPayload,
  type ListCapacityBroadcastsQuery,
  ROLES,
  type UpdateCapacityPartnerPayload,
  type UpdateCapacitySettingsPayload,
  createCapacityOverrideSchema,
  createCapacityPartnerSchema,
  listCapacityBroadcastsQuerySchema,
  updateCapacityPartnerSchema,
  updateCapacitySettingsSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { CapacityBroadcastService } from './capacity-broadcast.service.js';
import { CapacityPartnersService } from './capacity-partners.service.js';
import { CapacityService } from './capacity.service.js';

const idParam = z.object({ id: z.string().uuid() });
const overridesQuery = z.object({
  history: z.enum(['true', 'false']).default('false'),
});

@UseGuards(RolesGuard)
@Controller('capacity')
export class CapacityController {
  constructor(
    private readonly service: CapacityService,
    private readonly partners: CapacityPartnersService,
    private readonly broadcasts: CapacityBroadcastService,
  ) {}

  // ---------- live status ----------

  @Get('status')
  async status(@Req() req: FastifyRequest) {
    return this.service.getStatus(this.callerCtx(req));
  }

  // ---------- settings ----------

  @Get('settings')
  async getSettings(@Req() req: FastifyRequest) {
    return this.service.getSettings(this.callerCtx(req));
  }

  @Patch('settings')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async updateSettings(
    @ZodBody(updateCapacitySettingsSchema) body: UpdateCapacitySettingsPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.service.updateSettings(this.callerCtx(req), body);
  }

  // ---------- manual overrides ----------

  @Get('overrides')
  async listOverrides(
    @ZodQuery(overridesQuery) query: { history: 'true' | 'false' },
    @Req() req: FastifyRequest,
  ) {
    return this.service.listOverrides(this.callerCtx(req), query.history === 'true');
  }

  @Post('overrides')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async createOverride(
    @ZodBody(createCapacityOverrideSchema) body: CreateCapacityOverridePayload,
    @Req() req: FastifyRequest,
  ) {
    return this.service.createOverride(this.callerCtx(req), body);
  }

  @Delete('overrides/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async clearOverride(@ZodParam(idParam) params: { id: string }, @Req() req: FastifyRequest) {
    await this.service.clearOverride(this.callerCtx(req), params.id);
  }

  // ---------- partners ----------

  @Get('partners')
  async listPartners(@Req() req: FastifyRequest) {
    return this.partners.list(this.callerCtx(req));
  }

  @Post('partners')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async createPartner(
    @ZodBody(createCapacityPartnerSchema) body: CreateCapacityPartnerPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.partners.create(this.callerCtx(req), body);
  }

  @Patch('partners/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async updatePartner(
    @ZodParam(idParam) params: { id: string },
    @ZodBody(updateCapacityPartnerSchema) body: UpdateCapacityPartnerPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.partners.update(this.callerCtx(req), params.id, body);
  }

  @Delete('partners/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async deletePartner(@ZodParam(idParam) params: { id: string }, @Req() req: FastifyRequest) {
    await this.partners.softDelete(this.callerCtx(req), params.id);
  }

  @Post('partners/:id/rotate-secret')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async rotateSecret(@ZodParam(idParam) params: { id: string }, @Req() req: FastifyRequest) {
    return this.partners.rotateWebhookSecret(this.callerCtx(req), params.id);
  }

  @Post('partners/:id/rotate-key')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async rotateKey(@ZodParam(idParam) params: { id: string }, @Req() req: FastifyRequest) {
    return this.partners.rotateApiKey(this.callerCtx(req), params.id);
  }

  @Post('partners/:id/test-fire')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async testFire(@ZodParam(idParam) params: { id: string }, @Req() req: FastifyRequest) {
    return this.broadcasts.testFire(this.callerCtx(req).tenantId, params.id);
  }

  // ---------- broadcast log ----------

  @Get('broadcasts')
  async listBroadcasts(
    @ZodQuery(listCapacityBroadcastsQuerySchema) query: ListCapacityBroadcastsQuery,
    @Req() req: FastifyRequest,
  ) {
    return this.service.listBroadcasts(this.callerCtx(req), query);
  }

  private callerCtx(req: FastifyRequest): {
    tenantId: string;
    userId: string;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
  } {
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
