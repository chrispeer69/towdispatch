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
  type CreateServiceCatalogPayload,
  ROLES,
  type SeedDefaultServiceCatalogResponse,
  type ServiceCatalogEntryDto,
  type ServiceCatalogFilters,
  type UpdateServiceCatalogPayload,
  createServiceCatalogSchema,
  serviceCatalogFiltersSchema,
  updateServiceCatalogSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ServiceCatalogService } from './service-catalog.service.js';

const idSchema = z.object({ id: z.string().uuid() });

/**
 * RBAC: Owner / Admin / Manager can mutate; Dispatcher / Accounting / Auditor
 * are read-only. Driver has no access — read endpoints still pass the role
 * gate because reading the catalog is permitted for everyone above driver.
 */
const READ_ROLES = [
  ROLES.OWNER,
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.DISPATCHER,
  ROLES.ACCOUNTING,
  ROLES.AUDITOR,
] as const;
const WRITE_ROLES = [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER] as const;

@UseGuards(RolesGuard)
@Controller('service-catalog')
export class ServiceCatalogController {
  constructor(private readonly svc: ServiceCatalogService) {}

  @Get()
  @Roles(...READ_ROLES)
  async list(
    @ZodQuery(serviceCatalogFiltersSchema) query: ServiceCatalogFilters,
    @Req() req: FastifyRequest,
  ): Promise<ServiceCatalogEntryDto[]> {
    return this.svc.list(this.callerCtx(req), query);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  async get(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<ServiceCatalogEntryDto> {
    return this.svc.get(this.callerCtx(req), params.id);
  }

  @Post()
  @Roles(...WRITE_ROLES)
  async create(
    @ZodBody(createServiceCatalogSchema) body: CreateServiceCatalogPayload,
    @Req() req: FastifyRequest,
  ): Promise<ServiceCatalogEntryDto> {
    return this.svc.create(this.callerCtx(req), body);
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  async update(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(updateServiceCatalogSchema) body: UpdateServiceCatalogPayload,
    @Req() req: FastifyRequest,
  ): Promise<ServiceCatalogEntryDto> {
    return this.svc.update(this.callerCtx(req), params.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...WRITE_ROLES)
  async remove(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.svc.softDelete(this.callerCtx(req), params.id);
  }

  /**
   * Empty-state recovery: invokes the SECURITY DEFINER seed function which
   * inserts the 45 default services only if the tenant currently has zero
   * rows. Safe to retry — second call returns inserted=0.
   */
  @Post('seed-defaults')
  @Roles(...WRITE_ROLES)
  async seedDefaults(@Req() req: FastifyRequest): Promise<SeedDefaultServiceCatalogResponse> {
    return this.svc.seedDefaults(this.callerCtx(req));
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
