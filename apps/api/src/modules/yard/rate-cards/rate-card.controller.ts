/**
 * RateCardController — storage rate cards per facility (Yard Management,
 * Session 54). Same RBAC + YardEnabledGuard as the rest of the yard surface.
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
  type CreateStorageRateCardPayload,
  ROLES,
  type StorageVehicleClass,
  type UpdateStorageRateCardPayload,
  createStorageRateCardSchema,
  storageVehicleClassValues,
  updateStorageRateCardSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { YardEnabledGuard } from '../yard-enabled.guard.js';
import { RateCardService } from './rate-card.service.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER, ROLES.AUDITOR] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER] as const;

const facilityParam = z.object({ facilityId: z.string().uuid() });
const cardParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({ vehicleClass: z.enum(storageVehicleClassValues).optional() });

@UseGuards(RolesGuard, YardEnabledGuard)
@Controller('yard')
export class RateCardController {
  constructor(private readonly service: RateCardService) {}

  @Get('facilities/:facilityId/rate-cards')
  @Roles(...READERS)
  async list(
    @Req() req: FastifyRequest,
    @ZodParam(facilityParam) p: { facilityId: string },
    @ZodQuery(listQuery) q: { vehicleClass?: StorageVehicleClass },
  ) {
    return this.service.listForFacility(this.ctx(req), p.facilityId, q.vehicleClass);
  }

  @Post('facilities/:facilityId/rate-cards')
  @Roles(...WRITERS)
  async create(
    @Req() req: FastifyRequest,
    @ZodParam(facilityParam) p: { facilityId: string },
    @ZodBody(createStorageRateCardSchema) body: CreateStorageRateCardPayload,
  ) {
    return this.service.create(this.ctx(req), p.facilityId, body);
  }

  @Patch('rate-cards/:id')
  @Roles(...WRITERS)
  async update(
    @Req() req: FastifyRequest,
    @ZodParam(cardParam) p: { id: string },
    @ZodBody(updateStorageRateCardSchema) body: UpdateStorageRateCardPayload,
  ) {
    return this.service.update(this.ctx(req), p.id, body);
  }

  @Delete('rate-cards/:id')
  @Roles(...WRITERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: FastifyRequest, @ZodParam(cardParam) p: { id: string }) {
    await this.service.softDelete(this.ctx(req), p.id);
  }

  private ctx(req: FastifyRequest): { tenantId: string; userId: string; requestId: string } {
    const c = req.requestContext;
    return { tenantId: c.tenantId as string, userId: c.userId as string, requestId: c.requestId };
  }
}
