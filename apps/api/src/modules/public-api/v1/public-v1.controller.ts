/**
 * PublicV1Controller — the consumer-facing /v1 REST surface (Session 29).
 *
 * Auth: @Public() opts out of the global session JwtAuthGuard; ApiKeyGuard
 * authenticates the Bearer key and ScopeGuard authorizes per-route scopes.
 * Do NOT add @Roles here — the session role grid does not apply to
 * key-authenticated traffic; authorization is scope-based.
 *
 * All reads are cursor-paginated and tenant-isolated (RLS via the context the
 * guard set). Writes delegate to JobsService so domain events — and therefore
 * webhooks — fire.
 */
import { createHash } from 'node:crypto';
import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type CreateJobIntakePayload,
  type CursorQuery,
  ERROR_CODES,
  type PublicJobListQuery,
  type PublicJobStatusPatch,
  createJobIntakeSchema,
  cursorQuerySchema,
  publicJobListQuerySchema,
  publicJobStatusPatchSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../../common/decorators/public.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../../common/decorators/zod.decorator.js';
import { ApiKeyGuard } from '../auth/api-key.guard.js';
import { Scopes } from '../auth/scopes.decorator.js';
import { ScopeGuard } from '../auth/scopes.guard.js';
import { IdempotencyService } from './idempotency.service.js';
import { type PublicCallerCtx, PublicV1Service } from './public-v1.service.js';

const idParam = z.object({ id: z.string().uuid() });

@Public()
@UseGuards(ApiKeyGuard, ScopeGuard)
@Controller('v1')
export class PublicV1Controller {
  constructor(
    private readonly svc: PublicV1Service,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ---------------- jobs ----------------

  @Get('jobs')
  @Scopes('jobs:read')
  async listJobs(
    @Req() req: FastifyRequest,
    @ZodQuery(publicJobListQuerySchema) query: PublicJobListQuery,
  ) {
    return this.svc.listJobs(this.ctx(req), query);
  }

  @Get('jobs/:id')
  @Scopes('jobs:read')
  async getJob(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    const job = await this.svc.getJob(this.ctx(req), p.id);
    if (!job) throw notFound('Job');
    return job;
  }

  @Post('jobs')
  @Scopes('jobs:write')
  async createJob(
    @Req() req: FastifyRequest,
    @ZodBody(createJobIntakeSchema) body: CreateJobIntakePayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const ctx = this.ctx(req);
    const apiKeyId = req.apiKey?.id ?? 'unknown';
    const fingerprint = fingerprintOf('POST', '/v1/jobs', body);
    return this.idempotency.run(ctx, apiKeyId, idempotencyKey, fingerprint, 201, () =>
      this.svc.createJob(ctx, body),
    );
  }

  @Patch('jobs/:id/status')
  @Scopes('jobs:write')
  async patchJobStatus(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(publicJobStatusPatchSchema) body: PublicJobStatusPatch,
  ) {
    return this.svc.patchJobStatus(this.ctx(req), p.id, body.status, body.reason);
  }

  // ---------------- trucks ----------------

  @Get('trucks')
  @Scopes('trucks:read')
  async listTrucks(@Req() req: FastifyRequest, @ZodQuery(cursorQuerySchema) query: CursorQuery) {
    return this.svc.listTrucks(this.ctx(req), query);
  }

  @Get('trucks/:id')
  @Scopes('trucks:read')
  async getTruck(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    const truck = await this.svc.getTruck(this.ctx(req), p.id);
    if (!truck) throw notFound('Truck');
    return truck;
  }

  // ---------------- drivers ----------------

  @Get('drivers')
  @Scopes('drivers:read')
  async listDrivers(@Req() req: FastifyRequest, @ZodQuery(cursorQuerySchema) query: CursorQuery) {
    return this.svc.listDrivers(this.ctx(req), query);
  }

  @Get('drivers/:id')
  @Scopes('drivers:read')
  async getDriver(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    const driver = await this.svc.getDriver(this.ctx(req), p.id);
    if (!driver) throw notFound('Driver');
    return driver;
  }

  // ---------------- impound ----------------

  @Get('impound')
  @Scopes('impound:read')
  async listImpound(@Req() req: FastifyRequest, @ZodQuery(cursorQuerySchema) query: CursorQuery) {
    return this.svc.listImpound(this.ctx(req), query);
  }

  @Get('impound/:id')
  @Scopes('impound:read')
  async getImpound(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    const record = await this.svc.getImpound(this.ctx(req), p.id);
    if (!record) throw notFound('Impound record');
    return record;
  }

  private ctx(req: FastifyRequest): PublicCallerCtx {
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

function fingerprintOf(method: string, path: string, body: unknown): string {
  return createHash('sha256').update(JSON.stringify({ method, path, body })).digest('hex');
}

function notFound(resource: string): NotFoundException {
  return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: `${resource} not found` });
}
