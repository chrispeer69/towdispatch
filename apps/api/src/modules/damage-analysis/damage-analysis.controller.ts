/**
 * DamageAnalysisController — operator REST surface for Photo Damage
 * Analysis (Session 42).
 *
 * RBAC mirrors Impound:
 *   OWNER, ADMIN, DISPATCHER            — request / override / compare (writes)
 *   OWNER, ADMIN, DISPATCHER, AUDITOR   — list / detail (reads)
 *
 * All timestamps are UTC ISO-8601; confidence is a whole percent (0-100).
 */
import { Controller, Get, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  type CompareAnalysesPayload,
  type ListAnalysesQuery,
  type OverrideFindingPayload,
  ROLES,
  type RequestAnalysisPayload,
  compareAnalysesSchema,
  listAnalysesQuerySchema,
  overrideFindingSchema,
  requestAnalysisSchema,
} from '@ustowdispatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { DamageAnalysisService } from './damage-analysis.service.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER, ROLES.AUDITOR] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER] as const;

const idParam = z.object({ id: z.string().uuid() });
const findingParam = z.object({ id: z.string().uuid(), findingId: z.string().uuid() });
const langQuery = z.object({ lang: z.enum(['en', 'es']).default('en') });

@UseGuards(RolesGuard)
@Controller('damage-analysis')
export class DamageAnalysisController {
  constructor(private readonly service: DamageAnalysisService) {}

  @Get()
  @Roles(...READERS)
  async list(
    @Req() req: FastifyRequest,
    @ZodQuery(listAnalysesQuerySchema) query: ListAnalysesQuery,
  ) {
    return this.service.listAnalyses(this.ctx(req), query);
  }

  @Post()
  @Roles(...WRITERS)
  async request(
    @Req() req: FastifyRequest,
    @ZodBody(requestAnalysisSchema) body: RequestAnalysisPayload,
  ) {
    return this.service.requestAnalysis(this.ctx(req), body);
  }

  // Declared before ':id' so the literal path wins regardless of ordering.
  @Post('compare')
  @Roles(...WRITERS)
  async compare(
    @Req() req: FastifyRequest,
    @ZodBody(compareAnalysesSchema) body: CompareAnalysesPayload,
  ) {
    return this.service.compareAnalyses(this.ctx(req), body);
  }

  // Literal segment — declared before ':id' routes.
  @Get('comparisons/:id/report.pdf')
  @Roles(...READERS)
  async comparisonPdf(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
    @ZodParam(idParam) p: { id: string },
    @ZodQuery(langQuery) q: { lang: 'en' | 'es' },
  ): Promise<void> {
    const { bytes, filename } = await this.service.renderComparisonPdf(this.ctx(req), p.id, q.lang);
    await res
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${filename}"`)
      .send(bytes);
  }

  @Get(':id')
  @Roles(...READERS)
  async detail(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    return this.service.getAnalysisDetail(this.ctx(req), p.id);
  }

  @Get(':id/report.pdf')
  @Roles(...READERS)
  async analysisPdf(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
    @ZodParam(idParam) p: { id: string },
    @ZodQuery(langQuery) q: { lang: 'en' | 'es' },
  ): Promise<void> {
    const { bytes, filename } = await this.service.renderAnalysisPdf(this.ctx(req), p.id, q.lang);
    await res
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${filename}"`)
      .send(bytes);
  }

  @Patch(':id/findings/:findingId')
  @Roles(...WRITERS)
  async override(
    @Req() req: FastifyRequest,
    @ZodParam(findingParam) p: { id: string; findingId: string },
    @ZodBody(overrideFindingSchema) body: OverrideFindingPayload,
  ) {
    return this.service.overrideFinding(this.ctx(req), p.id, p.findingId, body);
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
