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
  type CreateCustomerPayload,
  type CustomerDto,
  type CustomerFilters,
  type CustomerSearchQuery,
  type CustomerSearchResult,
  type CustomerWithVehiclesDto,
  type FindOrCreateByContactPayload,
  type FindOrCreateByContactResult,
  type LinkCustomerVehiclePayload,
  type PaginatedCustomers,
  ROLES,
  type UpdateCustomerPayload,
  createCustomerSchema,
  customerFiltersSchema,
  customerSearchQuerySchema,
  findOrCreateByContactSchema,
  linkCustomerVehicleSchema,
  updateCustomerSchema,
} from '@towcommand/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { CustomersService } from './customers.service.js';

const idSchema = z.object({ id: z.string().uuid() });
const linkParamsSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
});

@UseGuards(RolesGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  async list(
    @ZodQuery(customerFiltersSchema) query: CustomerFilters,
    @Req() req: FastifyRequest,
  ): Promise<PaginatedCustomers> {
    return this.customers.list(this.callerCtx(req), query);
  }

  @Get('search')
  async search(
    @ZodQuery(customerSearchQuerySchema) query: CustomerSearchQuery,
    @Req() req: FastifyRequest,
  ): Promise<CustomerSearchResult[]> {
    return this.customers.search(this.callerCtx(req), query);
  }

  /**
   * Find a customer by phone in the caller's tenant; create one if none
   * exists. Used by the (future) call intake flow. Always returns 200 with
   * { customer, created } — even when the row is brand new — so callers
   * don't need to distinguish 200 from 201.
   */
  @Post('find-or-create-by-contact')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async findOrCreateByContact(
    @ZodBody(findOrCreateByContactSchema) body: FindOrCreateByContactPayload,
    @Req() req: FastifyRequest,
  ): Promise<FindOrCreateByContactResult> {
    return this.customers.findOrCreateByContact(this.callerCtx(req), body);
  }

  @Get(':id')
  async get(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<CustomerWithVehiclesDto> {
    return this.customers.get(this.callerCtx(req), params.id);
  }

  @Post()
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async create(
    @ZodBody(createCustomerSchema) body: CreateCustomerPayload,
    @Req() req: FastifyRequest,
  ): Promise<CustomerDto> {
    return this.customers.create(this.callerCtx(req), body);
  }

  @Patch(':id')
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING)
  async update(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(updateCustomerSchema) body: UpdateCustomerPayload,
    @Req() req: FastifyRequest,
  ): Promise<CustomerDto> {
    return this.customers.update(this.callerCtx(req), params.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER)
  async remove(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.customers.softDelete(this.callerCtx(req), params.id);
  }

  @Post(':id/vehicles/:vehicleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async linkVehicle(
    @ZodParam(linkParamsSchema) params: { id: string; vehicleId: string },
    @ZodBody(linkCustomerVehicleSchema.optional().default({}))
    body: LinkCustomerVehiclePayload | undefined,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.customers.linkVehicle(
      this.callerCtx(req),
      params.id,
      params.vehicleId,
      body ?? { relationship: 'owner' },
    );
  }

  @Delete(':id/vehicles/:vehicleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER)
  async unlinkVehicle(
    @ZodParam(linkParamsSchema) params: { id: string; vehicleId: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.customers.unlinkVehicle(this.callerCtx(req), params.id, params.vehicleId);
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
