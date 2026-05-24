/**
 * Tenant-scoped onboarding wizard surface. Owner/admin only; the global
 * JwtAuthGuard enforces authentication and RolesGuard the role.
 *
 *   GET   /onboarding/progress      → current state + recomputed activation ledger
 *   POST  /onboarding/recompute     → re-observe real state, emit new milestones
 *   PATCH /onboarding/steps/:step   → persist a step's resumable data + advance
 *   POST  /onboarding/activate      → activate a pricing tier (self-serve: free)
 *   POST  /onboarding/complete      → finish the wizard
 */
import { Controller, Get, HttpCode, HttpStatus, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ROLES } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import {
  type ActivateTierPayload,
  type EditableStep,
  type OnboardingStateDto,
  type SaveStepPayload,
  activateTierSchema,
  saveStepSchema,
  stepParamSchema,
} from './onboarding.contracts.js';
import { type CallerContext, OnboardingService } from './onboarding.service.js';

// Step ORDERING is owned by the wizard (server-driven `nextStep`). These
// endpoints are individually idempotent and intentionally do not enforce that
// steps run in sequence — only `complete` requires `company_info` first. A
// direct caller could therefore activate a tier with no prior progress; that's
// acceptable (the row is created on demand and the cap still applies).
@UseGuards(RolesGuard)
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('progress')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async progress(@Req() req: FastifyRequest): Promise<OnboardingStateDto> {
    return this.onboarding.getState(this.callerCtx(req));
  }

  @Post('recompute')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async recompute(@Req() req: FastifyRequest): Promise<OnboardingStateDto> {
    return this.onboarding.recomputeState(this.callerCtx(req));
  }

  @Patch('steps/:step')
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async saveStep(
    @ZodParam(stepParamSchema) params: { step: EditableStep },
    @ZodBody(saveStepSchema) body: SaveStepPayload,
    @Req() req: FastifyRequest,
  ): Promise<OnboardingStateDto> {
    return this.onboarding.saveStep(this.callerCtx(req), params.step, body);
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async activate(
    @ZodBody(activateTierSchema) body: ActivateTierPayload,
    @Req() req: FastifyRequest,
  ): Promise<OnboardingStateDto> {
    return this.onboarding.activateTier(this.callerCtx(req), body);
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @Roles(ROLES.OWNER, ROLES.ADMIN)
  async complete(@Req() req: FastifyRequest): Promise<OnboardingStateDto> {
    return this.onboarding.complete(this.callerCtx(req));
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
}
