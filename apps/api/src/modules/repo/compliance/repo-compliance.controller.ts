/**
 * RepoComplianceController — operator-side REST surface for Repo Compliance
 * (Session 50).
 *
 * Routes live under /repo-compliance/* (NOT /repo-cases/*, which belongs to the
 * S49 RepoCaseService that is not on master yet — see SESSION_50_DECISIONS.md
 * D0). The case-bound GET /repo-cases/:id/forms/:type and the recordRecovery /
 * addPersonalProperty hooks land with the S49 integration (D4); here the form
 * route renders from a POST body (self-contained preview).
 *
 * RBAC mirrors the lien module (Session 23):
 *   OWNER, ADMIN, DISPATCHER            — writes
 *   OWNER, ADMIN, DISPATCHER, AUDITOR   — reads
 */
import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  type ListRepoNoticesFilter,
  ROLES,
  type RecordRepoNoticePayload,
  type RecordRepoNoticeResponsePayload,
  type RenderRepoFormPayload,
  type RepoAttemptFacts,
  type RepoCaseFacts,
  type RepoPersonalPropertyHoldRequest,
  listRepoNoticesFilterSchema,
  recordRepoNoticeResponseSchema,
  recordRepoNoticeSchema,
  renderRepoFormSchema,
  repoAttemptFactsSchema,
  repoCaseFactsSchema,
  repoFormTypeValues,
  repoPersonalPropertyHoldRequestSchema,
} from '@ustowdispatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { RepoFormPdfService } from '../forms/repo-form.renderer.js';
import { RepoComplianceService } from './repo-compliance.service.js';
import { getRepoStateRules } from './state-rules.config.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER, ROLES.AUDITOR] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER] as const;

const stateParam = z.object({ state: z.string().length(2) });
const noticeParam = z.object({ noticeId: z.string().uuid() });
const caseParam = z.object({ repoCaseId: z.string().uuid() });
const formParam = z.object({ formType: z.enum(repoFormTypeValues) });

@UseGuards(RolesGuard)
@Controller('repo-compliance')
export class RepoComplianceController {
  constructor(
    private readonly service: RepoComplianceService,
    private readonly pdf: RepoFormPdfService,
  ) {}

  @Get('state-rules')
  @Roles(...READERS)
  stateRules() {
    return this.service.listStateRules();
  }

  @Get('state-rules/:state')
  @Roles(...READERS)
  stateRule(@ZodParam(stateParam) p: { state: string }) {
    return this.service.getStateRule(p.state.toUpperCase());
  }

  @Post('next-action')
  @Roles(...READERS)
  nextAction(@ZodBody(repoCaseFactsSchema) body: RepoCaseFacts) {
    return this.service.previewNextAction(body);
  }

  @Post('validate-peaceful-repo')
  @Roles(...READERS)
  validatePeaceful(@ZodBody(repoAttemptFactsSchema) body: RepoAttemptFacts) {
    return this.service.previewPeacefulRepo(body);
  }

  @Post('personal-property-hold')
  @Roles(...READERS)
  personalPropertyHold(
    @ZodBody(repoPersonalPropertyHoldRequestSchema) body: RepoPersonalPropertyHoldRequest,
  ) {
    return this.service.previewPersonalPropertyHold(body);
  }

  @Get('notices')
  @Roles(...READERS)
  listNotices(
    @Req() req: FastifyRequest,
    @ZodQuery(listRepoNoticesFilterSchema) query: ListRepoNoticesFilter,
  ) {
    return this.service.listNotices(this.ctx(req), query);
  }

  @Post('notices')
  @Roles(...WRITERS)
  recordNotice(
    @Req() req: FastifyRequest,
    @ZodBody(recordRepoNoticeSchema) body: RecordRepoNoticePayload,
  ) {
    return this.service.recordNotice(this.ctx(req), body);
  }

  @Post('notices/:noticeId/response')
  @Roles(...WRITERS)
  recordResponse(
    @Req() req: FastifyRequest,
    @ZodParam(noticeParam) p: { noticeId: string },
    @ZodBody(recordRepoNoticeResponseSchema) body: RecordRepoNoticeResponsePayload,
  ) {
    return this.service.recordResponse(this.ctx(req), p.noticeId, body);
  }

  @Get('cases/:repoCaseId/timeline')
  @Roles(...READERS)
  timeline(@Req() req: FastifyRequest, @ZodParam(caseParam) p: { repoCaseId: string }) {
    return this.service.listTimeline(this.ctx(req), p.repoCaseId);
  }

  @Post('cases/:repoCaseId/breach-check')
  @Roles(...WRITERS)
  breachCheck(
    @Req() req: FastifyRequest,
    @ZodParam(caseParam) p: { repoCaseId: string },
    @ZodBody(repoAttemptFactsSchema) body: RepoAttemptFacts,
  ) {
    return this.service.flagBreachOfPeace(this.ctx(req), p.repoCaseId, body);
  }

  @Post('forms/:formType')
  @Roles(...READERS)
  async form(
    @Res() reply: FastifyReply,
    @ZodParam(formParam) p: { formType: (typeof repoFormTypeValues)[number] },
    @ZodBody(renderRepoFormSchema) body: RenderRepoFormPayload,
  ): Promise<void> {
    const rules = getRepoStateRules(body.state);
    if (!rules) {
      reply.status(409).send({
        code: 'INVALID_STATE',
        message: `Repo compliance is not supported for ${body.state}.`,
      });
      return;
    }
    const buf = await this.pdf.renderForm({
      formType: p.formType,
      state: body.state,
      rules,
      tenantName: body.tenantName ?? 'US Tow DISPATCH operator',
      repoCaseId: body.repoCaseId ?? 'preview',
      recoveredAt: new Date(body.recoveredAt),
      debtorName: body.debtorName ?? null,
      debtorAddress: body.debtorAddress ?? null,
      vehicleDescription: body.vehicleDescription ?? null,
      vehicleVin: body.vehicleVin ?? null,
      licensePlate: body.licensePlate ?? null,
      accruedChargesCents: body.accruedChargesCents ?? null,
    });
    reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="repo-${p.formType}-${body.state}.pdf"`)
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
