/**
 * ReleaseController — the gated vehicle-release wizard surface (Yard
 * Management, Session 54). Each step is its own POST so the web wizard's
 * back/forward + retry is safe. Same RBAC + YardEnabledGuard as the rest.
 */
import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  type AuthorizeLienholderPayload,
  type CancelReleasePayload,
  type CollectReleasePaymentPayload,
  type InitiateReleasePayload,
  ROLES,
  type VerifyReleaseIdPayload,
  authorizeLienholderSchema,
  cancelReleaseSchema,
  collectReleasePaymentSchema,
  initiateReleaseSchema,
  verifyReleaseIdSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam } from '../../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { YardEnabledGuard } from '../yard-enabled.guard.js';
import { ReleaseWorkflowService } from './release-workflow.service.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER, ROLES.AUDITOR] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER] as const;

const impoundParam = z.object({ impoundId: z.string().uuid() });
const workflowParam = z.object({ workflowId: z.string().uuid() });

@UseGuards(RolesGuard, YardEnabledGuard)
@Controller('yard/release')
export class ReleaseController {
  constructor(private readonly service: ReleaseWorkflowService) {}

  @Get(':impoundId')
  @Roles(...READERS)
  async getForImpound(
    @Req() req: FastifyRequest,
    @ZodParam(impoundParam) p: { impoundId: string },
  ) {
    return this.service.getForImpound(this.ctx(req), p.impoundId);
  }

  @Post()
  @Roles(...WRITERS)
  async initiate(
    @Req() req: FastifyRequest,
    @ZodBody(initiateReleaseSchema) body: InitiateReleasePayload,
  ) {
    return this.service.initiate(this.ctx(req), body.impoundId);
  }

  @Post(':workflowId/verify-id')
  @Roles(...WRITERS)
  async verifyId(
    @Req() req: FastifyRequest,
    @ZodParam(workflowParam) p: { workflowId: string },
    @ZodBody(verifyReleaseIdSchema) body: VerifyReleaseIdPayload,
  ) {
    return this.service.verifyId(this.ctx(req), p.workflowId, body);
  }

  @Post(':workflowId/authorize-lienholder')
  @Roles(...WRITERS)
  async authorizeLienholder(
    @Req() req: FastifyRequest,
    @ZodParam(workflowParam) p: { workflowId: string },
    @ZodBody(authorizeLienholderSchema) body: AuthorizeLienholderPayload,
  ) {
    return this.service.authorizeLienholder(this.ctx(req), p.workflowId, body);
  }

  @Post(':workflowId/collect-payment')
  @Roles(...WRITERS)
  async collectPayment(
    @Req() req: FastifyRequest,
    @ZodParam(workflowParam) p: { workflowId: string },
    @ZodBody(collectReleasePaymentSchema) body: CollectReleasePaymentPayload,
  ) {
    return this.service.collectPayment(this.ctx(req), p.workflowId, body);
  }

  @Post(':workflowId/gate-release')
  @Roles(...WRITERS)
  async gateRelease(
    @Req() req: FastifyRequest,
    @ZodParam(workflowParam) p: { workflowId: string },
  ) {
    return this.service.gateRelease(this.ctx(req), p.workflowId);
  }

  @Post(':workflowId/cancel')
  @Roles(...WRITERS)
  async cancel(
    @Req() req: FastifyRequest,
    @ZodParam(workflowParam) p: { workflowId: string },
    @ZodBody(cancelReleaseSchema) body: CancelReleasePayload,
  ) {
    return this.service.cancel(this.ctx(req), p.workflowId, body);
  }

  private ctx(req: FastifyRequest): { tenantId: string; userId: string; requestId: string } {
    const c = req.requestContext;
    return { tenantId: c.tenantId as string, userId: c.userId as string, requestId: c.requestId };
  }
}
