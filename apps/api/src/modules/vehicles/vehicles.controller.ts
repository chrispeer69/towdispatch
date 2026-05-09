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
  type CreateVehiclePayload,
  type PaginatedVehicles,
  ROLES,
  type UpdateVehiclePayload,
  type VehicleDto,
  type VehicleFilters,
  type VehicleLookupQuery,
  type VehicleSearchQuery,
  type VehicleWithCustomersDto,
  createVehicleSchema,
  updateVehicleSchema,
  vehicleFiltersSchema,
  vehicleLookupSchema,
  vehicleSearchQuerySchema,
} from '@towcommand/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { VehiclesService } from './vehicles.service.js';

const idSchema = z.object({ id: z.string().uuid() });

@UseGuards(RolesGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  async list(
    @ZodQuery(vehicleFiltersSchema) query: VehicleFilters,
    @Req() req: FastifyRequest,
  ): Promise<PaginatedVehicles> {
    return this.vehicles.list(this.callerCtx(req), query);
  }

  @Get('lookup')
  async lookup(
    @ZodQuery(vehicleLookupSchema) query: VehicleLookupQuery,
    @Req() req: FastifyRequest,
  ): Promise<VehicleDto> {
    return this.vehicles.lookup(this.callerCtx(req), query);
  }

  @Get('search')
  async search(
    @ZodQuery(vehicleSearchQuerySchema) query: VehicleSearchQuery,
    @Req() req: FastifyRequest,
  ): Promise<
    Array<Pick<VehicleDto, 'id' | 'year' | 'make' | 'model' | 'vin' | 'plate' | 'plateState'>>
  > {
    return this.vehicles.search(this.callerCtx(req), query);
  }

  @Get(':id')
  async get(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<VehicleWithCustomersDto> {
    return this.vehicles.get(this.callerCtx(req), params.id);
  }

  @Post()
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async create(
    @ZodBody(createVehicleSchema) body: CreateVehiclePayload,
    @Req() req: FastifyRequest,
  ): Promise<VehicleDto> {
    return this.vehicles.create(this.callerCtx(req), body);
  }

  @Patch(':id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async update(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(updateVehicleSchema) body: UpdateVehiclePayload,
    @Req() req: FastifyRequest,
  ): Promise<VehicleDto> {
    return this.vehicles.update(this.callerCtx(req), params.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async remove(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.vehicles.softDelete(this.callerCtx(req), params.id);
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
