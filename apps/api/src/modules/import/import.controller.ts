/**
 * ImportController — HTTP surface for the Towbook importer.
 *
 *   POST /import/runs          admin/owner       upload bundle + start run (dry_run | live)
 *   POST /import/reconcile     admin/owner       diff bundle vs DB
 *   GET  /import/runs          admin/owner       paginated list for the tenant
 *   GET  /import/runs/:id      admin/owner       single run + totals
 *   POST /import/runs/:id/cancel  admin/owner    cooperatively cancel a running import
 *   GET  /import/runs/:id/events  admin/owner    paginated event log
 *
 * Bundle upload format: application/zip POST body. The route declares a
 * per-route bodyLimit of 2GiB. We deliberately use raw `application/zip`
 * rather than multipart so we don't take a new dependency for this session;
 * the web UI POSTs the file body directly with progress events via
 * XMLHttpRequest.upload.onprogress.
 */
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ROLES } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { ImportRunService } from './import-run.service.js';
import { type ReconciliationDiff, ReconciliationService } from './reconciliation.service.js';
import type { ImportMode } from './types.js';

const runQuerySchema = z.object({
  mode: z.enum(['dry_run', 'live']),
  tenantId: z.string().uuid(),
});

interface CallerContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@UseGuards(RolesGuard)
@Controller('import')
export class ImportController {
  constructor(
    private readonly runs: ImportRunService,
    private readonly recon: ReconciliationService,
    private readonly db: TenantAwareDb,
  ) {}

  /**
   * Bundle upload + run. The client posts the raw ZIP as the request body
   * with content-type=application/zip and the run parameters in the query
   * string. Larger-than-default body limit is set on the Fastify route.
   */
  @Post('runs')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async startRun(
    @Query() query: { mode?: string; tenantId?: string },
    @Req() req: FastifyRequest,
  ): Promise<{ runId: string; status: string; totals: unknown; message?: string }> {
    const params = runQuerySchema.parse({ mode: query.mode, tenantId: query.tenantId });
    if ((req.headers['content-type'] ?? '').toLowerCase() !== 'application/zip') {
      throw new BadRequestException('content-type must be application/zip');
    }
    const buf = req.body as Buffer | undefined;
    if (!buf || buf.byteLength === 0) {
      throw new BadRequestException('empty body');
    }
    const ctx = this.callerCtx(req);
    // Tenant scoping: an admin can only initiate runs against tenants they
    // belong to. The RolesGuard already verified the role. The tenantId in
    // the query must match the caller's session tenantId.
    if (params.tenantId !== ctx.tenantId) {
      throw new BadRequestException('tenantId mismatch with session tenant');
    }
    const result = await this.runs.start({
      tenantId: params.tenantId,
      userId: ctx.userId,
      mode: params.mode as ImportMode,
      bundle: buf,
    });
    return result;
  }

  @Post('reconcile')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  @HttpCode(HttpStatus.OK)
  async reconcile(
    @Query() query: { tenantId?: string },
    @Req() req: FastifyRequest,
  ): Promise<{ diffs: ReconciliationDiff[] }> {
    const parsed = z.object({ tenantId: z.string().uuid() }).parse(query);
    if ((req.headers['content-type'] ?? '').toLowerCase() !== 'application/zip') {
      throw new BadRequestException('content-type must be application/zip');
    }
    const buf = req.body as Buffer | undefined;
    if (!buf || buf.byteLength === 0) throw new BadRequestException('empty body');
    const ctx = this.callerCtx(req);
    if (parsed.tenantId !== ctx.tenantId) {
      throw new BadRequestException('tenantId mismatch with session tenant');
    }
    const diffs = await this.recon.reconcile({
      tenantId: parsed.tenantId,
      userId: ctx.userId,
      bundle: buf,
    });
    return { diffs };
  }

  @Get('runs')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async listRuns(@Req() req: FastifyRequest): Promise<{ runs: unknown[] }> {
    const ctx = this.callerCtx(req);
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (_db, client) => {
      const r = await client.query(
        `SELECT id, mode, status, totals, started_at, completed_at, message
         FROM import_runs
         WHERE tenant_id = $1
         ORDER BY started_at DESC
         LIMIT 50`,
        [ctx.tenantId],
      );
      return { runs: r.rows };
    });
  }

  @Get('runs/:id')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async getRun(@Param('id') id: string, @Req() req: FastifyRequest): Promise<{ run: unknown }> {
    const ctx = this.callerCtx(req);
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (_db, client) => {
      const r = await client.query(
        `SELECT id, tenant_id, mode, status, totals, started_at, completed_at,
                message, bundle_storage_key, errors_storage_key
         FROM import_runs WHERE id = $1`,
        [id],
      );
      return { run: r.rows[0] ?? null };
    });
  }

  @Get('runs/:id/events')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async getEvents(
    @Param('id') id: string,
    @Query() query: { action?: string },
    @Req() req: FastifyRequest,
  ): Promise<{ events: unknown[] }> {
    const ctx = this.callerCtx(req);
    return this.db.runInTenantContext(this.toTenantCtx(ctx), async (_db, client) => {
      const where = ['run_id = $1'];
      const params: unknown[] = [id];
      if (query.action) {
        params.push(query.action);
        where.push(`action = $${params.length}`);
      }
      const r = await client.query(
        `SELECT record_type, action, external_id, towcommand_id, error_message, occurred_at
         FROM import_run_events
         WHERE ${where.join(' AND ')}
         ORDER BY occurred_at ASC
         LIMIT 5000`,
        params,
      );
      return { events: r.rows };
    });
  }

  @Post('runs/:id/cancel')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancelRun(@Param('id') id: string): Promise<void> {
    this.runs.requestCancel(id);
  }

  private callerCtx(req: FastifyRequest): CallerContext {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
    };
  }

  private toTenantCtx(ctx: CallerContext) {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    };
  }
}
