/**
 * YardController — operator REST surface for facilities, the stall map, and
 * gate search (Yard Management, Session 54).
 *
 * RBAC mirrors impound: OWNER/ADMIN/DISPATCHER write; AUDITOR also reads.
 * The whole surface is gated by YardEnabledGuard (YARD_MANAGEMENT_ENABLED).
 * Cents are integers; timestamps are UTC ISO-8601 over the wire.
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
  type AssignStallPayload,
  type BulkStallLayoutPayload,
  type CreateYardFacilityPayload,
  type CreateYardStallPayload,
  type GateSearchQuery,
  ROLES,
  type RegisterStallPhotoPayload,
  type UpdateYardFacilityPayload,
  type UpdateYardStallPayload,
  assignStallSchema,
  bulkStallLayoutSchema,
  createYardFacilitySchema,
  createYardStallSchema,
  gateSearchQuerySchema,
  registerStallPhotoSchema,
  updateYardFacilitySchema,
  updateYardStallSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { GateSearchService } from './gate-search.service.js';
import { YardEnabledGuard } from './yard-enabled.guard.js';
import { YardFacilityService } from './yard-facility.service.js';
import { YardStallService } from './yard-stall.service.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER, ROLES.AUDITOR] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER] as const;

const idParam = z.object({ id: z.string().uuid() });
const stallParam = z.object({ stallId: z.string().uuid() });

@UseGuards(RolesGuard, YardEnabledGuard)
@Controller('yard')
export class YardController {
  constructor(
    private readonly facilities: YardFacilityService,
    private readonly stalls: YardStallService,
    private readonly gateSearch: GateSearchService,
  ) {}

  // ---------------- Facilities ----------------

  @Get('facilities')
  @Roles(...READERS)
  async listFacilities(@Req() req: FastifyRequest) {
    return this.facilities.list(this.ctx(req));
  }

  @Post('facilities')
  @Roles(...WRITERS)
  async createFacility(
    @Req() req: FastifyRequest,
    @ZodBody(createYardFacilitySchema) body: CreateYardFacilityPayload,
  ) {
    return this.facilities.create(this.ctx(req), body);
  }

  @Get('facilities/:id')
  @Roles(...READERS)
  async getFacility(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    return this.facilities.get(this.ctx(req), p.id);
  }

  @Patch('facilities/:id')
  @Roles(...WRITERS)
  async updateFacility(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(updateYardFacilitySchema) body: UpdateYardFacilityPayload,
  ) {
    return this.facilities.update(this.ctx(req), p.id, body);
  }

  @Delete('facilities/:id')
  @Roles(...WRITERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteFacility(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    await this.facilities.softDelete(this.ctx(req), p.id);
  }

  // ---------------- Stalls (scoped to a facility) ----------------

  @Get('facilities/:id/stalls')
  @Roles(...READERS)
  async listStalls(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    return this.stalls.listForFacility(this.ctx(req), p.id);
  }

  @Post('facilities/:id/stalls')
  @Roles(...WRITERS)
  async createStall(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(createYardStallSchema) body: CreateYardStallPayload,
  ) {
    return this.stalls.create(this.ctx(req), p.id, body);
  }

  @Post('facilities/:id/stalls/bulk-layout')
  @Roles(...WRITERS)
  async bulkLayout(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(bulkStallLayoutSchema) body: BulkStallLayoutPayload,
  ) {
    return this.stalls.bulkLayout(this.ctx(req), p.id, body);
  }

  // ---------------- Stalls (by id) ----------------

  @Get('stalls/:stallId')
  @Roles(...READERS)
  async getStall(@Req() req: FastifyRequest, @ZodParam(stallParam) p: { stallId: string }) {
    return this.stalls.getDetail(this.ctx(req), p.stallId);
  }

  @Patch('stalls/:stallId')
  @Roles(...WRITERS)
  async updateStall(
    @Req() req: FastifyRequest,
    @ZodParam(stallParam) p: { stallId: string },
    @ZodBody(updateYardStallSchema) body: UpdateYardStallPayload,
  ) {
    return this.stalls.update(this.ctx(req), p.stallId, body);
  }

  @Delete('stalls/:stallId')
  @Roles(...WRITERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteStall(@Req() req: FastifyRequest, @ZodParam(stallParam) p: { stallId: string }) {
    await this.stalls.softDelete(this.ctx(req), p.stallId);
  }

  @Post('stalls/:stallId/assign')
  @Roles(...WRITERS)
  async assignStall(
    @Req() req: FastifyRequest,
    @ZodParam(stallParam) p: { stallId: string },
    @ZodBody(assignStallSchema) body: AssignStallPayload,
  ) {
    return this.stalls.assignVehicle(this.ctx(req), p.stallId, body.impoundId);
  }

  @Post('stalls/:stallId/release')
  @Roles(...WRITERS)
  async releaseStall(@Req() req: FastifyRequest, @ZodParam(stallParam) p: { stallId: string }) {
    return this.stalls.releaseStall(this.ctx(req), p.stallId);
  }

  @Post('stalls/:stallId/photos')
  @Roles(...WRITERS)
  async registerPhoto(
    @Req() req: FastifyRequest,
    @ZodParam(stallParam) p: { stallId: string },
    @ZodBody(registerStallPhotoSchema) body: RegisterStallPhotoPayload,
  ) {
    return this.stalls.registerPhoto(this.ctx(req), p.stallId, body);
  }

  // ---------------- Gate search ----------------

  @Get('gate-search')
  @Roles(...READERS)
  async gate(@Req() req: FastifyRequest, @ZodQuery(gateSearchQuerySchema) query: GateSearchQuery) {
    return this.gateSearch.search(this.ctx(req), query.q);
  }

  private ctx(req: FastifyRequest): { tenantId: string; userId: string; requestId: string } {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
    };
  }
}
