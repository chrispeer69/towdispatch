/**
 * LienProcessingController — operator-side REST surface for Lien Processing.
 *
 * RBAC mirrors the impound module (Session 22):
 *   OWNER, ADMIN, DISPATCHER            — full control (writes)
 *   OWNER, ADMIN, DISPATCHER, AUDITOR   — read access (list / detail / forms)
 *   MANAGER, ACCOUNTING, DRIVER         — no access
 *
 * Money is cents-as-integer; timestamps are UTC ISO-8601 over the wire.
 * The :id/forms/:formType route streams application/pdf via @Res.
 */
import { Controller, Get, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  type AdvanceLienCasePayload,
  type CloseLienCasePayload,
  type ListLienCasesFilter,
  type OpenLienCasePayload,
  ROLES,
  type RecordLienNoticePayload,
  type RecordLienResponsePayload,
  type UpdateLienCasePayload,
  advanceLienCaseSchema,
  closeLienCaseSchema,
  lienFormTypeValues,
  listLienCasesFilterSchema,
  openLienCaseSchema,
  recordLienNoticeSchema,
  recordLienResponseSchema,
  updateLienCaseSchema,
} from '@ustowdispatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { LienFormPdfService } from './forms/lien-form.renderer.js';
import { LienProcessingService } from './lien-processing.service.js';
import { getStateRules } from './state-rules.config.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER, ROLES.AUDITOR] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER] as const;

const idParam = z.object({ id: z.string().uuid() });
const noticeParam = z.object({ id: z.string().uuid(), noticeId: z.string().uuid() });
const formParam = z.object({
  id: z.string().uuid(),
  formType: z.enum(lienFormTypeValues),
});

@UseGuards(RolesGuard)
@Controller('lien-cases')
export class LienProcessingController {
  constructor(
    private readonly service: LienProcessingService,
    private readonly pdf: LienFormPdfService,
  ) {}

  // Static route registered before the parametric :id route.
  @Get('state-rules')
  @Roles(...READERS)
  async stateRules() {
    return this.service.listStateRules();
  }

  @Get()
  @Roles(...READERS)
  async list(
    @Req() req: FastifyRequest,
    @ZodQuery(listLienCasesFilterSchema) query: ListLienCasesFilter,
  ) {
    return this.service.listCases(this.ctx(req), query);
  }

  @Post()
  @Roles(...WRITERS)
  async open(@Req() req: FastifyRequest, @ZodBody(openLienCaseSchema) body: OpenLienCasePayload) {
    return this.service.openCase(this.ctx(req), body);
  }

  @Get(':id')
  @Roles(...READERS)
  async detail(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    return this.service.getCaseDetail(this.ctx(req), p.id);
  }

  @Patch(':id')
  @Roles(...WRITERS)
  async update(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(updateLienCaseSchema) body: UpdateLienCasePayload,
  ) {
    return this.service.updateCase(this.ctx(req), p.id, body);
  }

  @Post(':id/advance')
  @Roles(...WRITERS)
  async advance(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(advanceLienCaseSchema) body: AdvanceLienCasePayload,
  ) {
    return this.service.advanceCase(this.ctx(req), p.id, body);
  }

  @Post(':id/notices')
  @Roles(...WRITERS)
  async recordNotice(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(recordLienNoticeSchema) body: RecordLienNoticePayload,
  ) {
    return this.service.recordNotice(this.ctx(req), p.id, body);
  }

  @Post(':id/notices/:noticeId/response')
  @Roles(...WRITERS)
  async recordResponse(
    @Req() req: FastifyRequest,
    @ZodParam(noticeParam) p: { id: string; noticeId: string },
    @ZodBody(recordLienResponseSchema) body: RecordLienResponsePayload,
  ) {
    return this.service.recordResponse(this.ctx(req), p.id, p.noticeId, body);
  }

  @Post(':id/close')
  @Roles(...WRITERS)
  async close(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(closeLienCaseSchema) body: CloseLienCasePayload,
  ) {
    return this.service.closeCase(this.ctx(req), p.id, body);
  }

  @Get(':id/forms/:formType')
  @Roles(...READERS)
  async form(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @ZodParam(formParam) p: { id: string; formType: (typeof lienFormTypeValues)[number] },
  ): Promise<void> {
    const ctx = this.ctx(req);
    const { caseRow, impound } = await this.service.getCaseForForm(ctx, p.id);
    const rules = getStateRules(caseRow.state);
    if (!rules) {
      reply.status(409).send({
        code: 'INVALID_STATE',
        message: `Lien processing is not supported for ${caseRow.state}.`,
      });
      return;
    }
    const buf = await this.pdf.renderForm({
      formType: p.formType,
      state: caseRow.state,
      rules,
      tenantName: 'US Tow DISPATCH operator',
      caseId: caseRow.id,
      openedAt: caseRow.openedAt,
      vehicleValueTier: caseRow.vehicleValueTier,
      estimatedValueCents: caseRow.estimatedValueCents,
      impound,
    });
    reply
      .header('content-type', 'application/pdf')
      .header(
        'content-disposition',
        `attachment; filename="lien-${p.formType}-${caseRow.state}-${caseRow.id}.pdf"`,
      )
      .send(buf);
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
