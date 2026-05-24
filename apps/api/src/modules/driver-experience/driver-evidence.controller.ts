/**
 * /job-evidence/* — driver-app uploads, driver-app + operator finalizes,
 * and a list-by-job endpoint that returns presigned GET URLs for
 * playback. Every route accepts both driver and operator JWTs via
 * DriverOrOperatorAuthGuard.
 */
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type JobEvidenceDto,
  type JobEvidenceWithUrlDto,
  ROLES,
  jobEvidenceKindValues,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { DriverEvidenceService } from './driver-evidence.service.js';
import { DriverOrOperatorAuthGuard } from './driver-or-operator-auth.guard.js';

const presignSchema = z
  .object({
    jobId: z.string().uuid(),
    kind: z.enum(jobEvidenceKindValues),
    contentType: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9.+_-]+\/[a-z0-9.+_-]+$/i, 'invalid contentType'),
    sizeBytes: z.number().int().min(1).max(5_000_000_000),
  })
  .strict();

const finalizeSchema = z
  .object({
    width: z.number().int().min(1).max(50_000).optional(),
    height: z.number().int().min(1).max(50_000).optional(),
    durationSeconds: z.number().min(0).max(7200).optional(),
    capturedLat: z.number().min(-90).max(90).optional(),
    capturedLng: z.number().min(-180).max(180).optional(),
  })
  .strict();

const failSchema = z.object({ reason: z.string().min(1).max(2000) }).strict();
const idSchema = z.object({ id: z.string().uuid() }).strict();
const jobIdSchema = z.object({ jobId: z.string().uuid() }).strict();

@Public()
@UseGuards(DriverOrOperatorAuthGuard)
@Controller('job-evidence')
export class DriverEvidenceController {
  constructor(private readonly evidence: DriverEvidenceService) {}

  @Post('presign')
  @HttpCode(HttpStatus.CREATED)
  async presign(
    @ZodBody(presignSchema) body: z.infer<typeof presignSchema>,
    @Req() req: FastifyRequest,
  ): Promise<{
    evidence: JobEvidenceDto;
    upload: {
      url: string;
      key: string;
      expiresAt: number;
      requiredHeaders?: Record<string, string>;
    };
  }> {
    return this.evidence.presign(actorFromRequest(req), body);
  }

  @Post(':id/finalize')
  @HttpCode(HttpStatus.OK)
  async finalize(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(finalizeSchema) body: z.infer<typeof finalizeSchema>,
    @Req() req: FastifyRequest,
  ): Promise<JobEvidenceDto> {
    return this.evidence.finalize(actorFromRequest(req), params.id, body);
  }

  @Post(':id/fail')
  @HttpCode(HttpStatus.OK)
  async fail(
    @ZodParam(idSchema) params: { id: string },
    @ZodBody(failSchema) body: z.infer<typeof failSchema>,
    @Req() req: FastifyRequest,
  ): Promise<JobEvidenceDto> {
    return this.evidence.fail(actorFromRequest(req), params.id, body);
  }
}

/**
 * Separate controller so the list-for-job route lives at the spec'd path
 * (`GET /jobs/:jobId/evidence`) without colliding with the existing
 * JobsController @Controller('jobs') base — Nest auto-routes by class.
 * We mount this controller at `jobs/:jobId/evidence` directly.
 */
@Public()
@UseGuards(DriverOrOperatorAuthGuard)
@Controller('jobs')
export class JobEvidenceListController {
  constructor(private readonly evidence: DriverEvidenceService) {}

  @Get(':jobId/evidence')
  async listForJob(
    @ZodParam(jobIdSchema) params: { jobId: string },
    @Req() req: FastifyRequest,
  ): Promise<JobEvidenceWithUrlDto[]> {
    return this.evidence.listForJob(actorFromRequest(req), params.jobId);
  }
}

/**
 * Operator-only mutations on evidence. Unlike the controllers above this
 * is NOT @Public(): the global JwtAuthGuard enforces an operator JWT, and
 * RolesGuard narrows it to the back-office roles. Mounted at the same
 * `job-evidence` base path — Nest routes by method+path, so DELETE :id
 * here does not collide with the POST routes above.
 */
@UseGuards(RolesGuard)
@Roles(ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER)
@Controller('job-evidence')
export class JobEvidenceAdminController {
  constructor(private readonly evidence: DriverEvidenceService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @ZodParam(idSchema) params: { id: string },
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.evidence.delete(actorFromRequest(req), params.id);
  }
}

function actorFromRequest(req: FastifyRequest): {
  tenantId: string;
  actorId: string;
  driverId: string | null;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
} {
  const c = req.requestContext;
  const driverId = req.driverAuth?.driverId ?? null;
  return {
    tenantId: c.tenantId as string,
    actorId: (c.userId as string) ?? (driverId as string),
    driverId,
    requestId: c.requestId,
    ipAddress: c.ipAddress,
    userAgent: c.userAgent,
  };
}
