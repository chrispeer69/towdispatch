import { BadRequestException, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  ERROR_CODES,
  ROLES,
  type ServiceRateDto,
  type ServiceRatesBulkUpsertPayload,
  type ServiceRatesBulkUpsertResponse,
  serviceRatesBulkUpsertSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ServiceRatesService } from './service-rates.service.js';

/**
 * RBAC mirrors /service-catalog: Owner/Admin/Manager mutate; everyone above
 * driver reads. Pricing is sensitive enough to keep Driver out entirely.
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
@Controller('service-rates')
export class ServiceRatesController {
  constructor(private readonly svc: ServiceRatesService) {}

  @Get()
  @Roles(...READ_ROLES)
  async list(@Req() req: FastifyRequest): Promise<ServiceRateDto[]> {
    return this.svc.list(this.callerCtx(req));
  }

  @Post('bulk')
  @Roles(...WRITE_ROLES)
  async bulkUpsert(
    @ZodBody(serviceRatesBulkUpsertSchema) body: ServiceRatesBulkUpsertPayload,
    @Req() req: FastifyRequest,
  ): Promise<ServiceRatesBulkUpsertResponse> {
    try {
      return await this.svc.bulkUpsert(this.callerCtx(req), body);
    } catch (err) {
      // Domain validation in the service layer throws plain Errors. Promote
      // them to 400s so the UI surfaces the precise message instead of a
      // generic 500.
      const message = err instanceof Error ? err.message : 'service_rates upsert failed';
      if (message.startsWith('service_rates upsert:')) {
        throw new BadRequestException({
          code: ERROR_CODES.VALIDATION_FAILED,
          message,
        });
      }
      throw err;
    }
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
