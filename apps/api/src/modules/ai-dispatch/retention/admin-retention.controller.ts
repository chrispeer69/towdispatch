/**
 * AdminRetentionController — manual control surface for ai-dispatch retention
 * (chore/ai-dispatch-retention).
 *
 *   POST /admin/ai-dispatch/retention/run   { dryRun?: boolean }
 *   GET  /admin/ai-dispatch/retention/stats
 *
 * OWNER only (RolesGuard; JwtAuthGuard is the global APP_GUARD so these routes
 * are authenticated by default). Deliberately TENANT-SCOPED: it runs/reports
 * for the caller's own tenant via runInTenantContext — an OWNER is a
 * tenant-scoped role and must never purge another tenant's data. The
 * cross-tenant sweep is the cron's job (admin pool + system actor).
 *
 * Request/response shapes are defined locally (Zod) rather than in
 * @ustowdispatch/shared: retention is an internal ops surface and the brief
 * scopes shared ai-dispatch contracts as off-limits.
 */
import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ROLES } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodBody } from '../../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import type { RetentionCallerCtx } from './retention.service.js';
import { RetentionService } from './retention.service.js';

const runBodySchema = z.object({
  dryRun: z.boolean().optional().default(false),
});
type RunBody = z.infer<typeof runBodySchema>;

@UseGuards(RolesGuard)
@Controller('admin/ai-dispatch/retention')
export class AdminRetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Post('run')
  @Roles(ROLES.OWNER)
  @HttpCode(HttpStatus.OK)
  async run(@Req() req: FastifyRequest, @ZodBody(runBodySchema) body: RunBody) {
    return this.retention.runForTenant(this.ctx(req), {
      now: new Date(),
      dryRun: body.dryRun,
    });
  }

  @Get('stats')
  @Roles(ROLES.OWNER)
  async stats(@Req() req: FastifyRequest) {
    return this.retention.statsForTenant(this.ctx(req));
  }

  private ctx(req: FastifyRequest): RetentionCallerCtx {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
    };
  }
}
