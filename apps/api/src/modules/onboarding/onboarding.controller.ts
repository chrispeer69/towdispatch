/**
 * Onboarding endpoints.
 *
 *   POST /onboarding/start                   public  → signup + progress
 *   GET  /onboarding/progress                auth    → wizard state + checklist
 *   POST /onboarding/steps/company-info      auth    → company info step
 *   POST /onboarding/steps/first-user        auth    → invite first teammate
 *   POST /onboarding/steps/first-truck       auth    → create first truck
 *   POST /onboarding/steps/first-driver      auth    → create first driver
 *   POST /onboarding/skip                    auth    → skip a step
 *   POST /onboarding/complete                auth    → finish the wizard
 *
 * Public endpoints carry @Public() + @Throttle(); the 5/hour/IP signup limit
 * is enforced in the service via the Redis rate limiter. Everything else is
 * tenant-scoped and runs after login.
 */
import { Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import {
  type CompanyInfoStepPayload,
  type FirstDriverStepPayload,
  type FirstTruckStepPayload,
  type FirstUserStepPayload,
  type OnboardingProgressDto,
  type OnboardingStartPayload,
  type OnboardingStartResponse,
  type SkipStepPayload,
  companyInfoStepSchema,
  firstDriverStepSchema,
  firstTruckStepSchema,
  firstUserStepSchema,
  onboardingStartSchema,
  skipStepSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import type { AuthRequestMeta } from '../auth/auth.service.js';
import type { CallerContext } from './caller-context.js';
import { OnboardingService } from './onboarding.service.js';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Public()
  @Throttle({ burst: { limit: 5, ttl: seconds(60) }, sustained: { limit: 20, ttl: seconds(900) } })
  @Post('start')
  async start(
    @ZodBody(onboardingStartSchema) body: OnboardingStartPayload,
    @Req() req: FastifyRequest,
  ): Promise<OnboardingStartResponse> {
    return this.onboarding.start(body, this.meta(req));
  }

  @Get('progress')
  async progress(@Req() req: FastifyRequest): Promise<OnboardingProgressDto> {
    return this.onboarding.getProgress(this.callerCtx(req));
  }

  @Post('steps/company-info')
  @HttpCode(HttpStatus.OK)
  async companyInfo(
    @ZodBody(companyInfoStepSchema) body: CompanyInfoStepPayload,
    @Req() req: FastifyRequest,
  ): Promise<OnboardingProgressDto> {
    return this.onboarding.submitCompanyInfo(this.callerCtx(req), body);
  }

  @Post('steps/first-user')
  @HttpCode(HttpStatus.OK)
  async firstUser(
    @ZodBody(firstUserStepSchema) body: FirstUserStepPayload,
    @Req() req: FastifyRequest,
  ): Promise<OnboardingProgressDto> {
    return this.onboarding.submitFirstUser(this.callerCtx(req), body);
  }

  @Post('steps/first-truck')
  @HttpCode(HttpStatus.OK)
  async firstTruck(
    @ZodBody(firstTruckStepSchema) body: FirstTruckStepPayload,
    @Req() req: FastifyRequest,
  ): Promise<OnboardingProgressDto> {
    return this.onboarding.submitFirstTruck(this.callerCtx(req), body);
  }

  @Post('steps/first-driver')
  @HttpCode(HttpStatus.OK)
  async firstDriver(
    @ZodBody(firstDriverStepSchema) body: FirstDriverStepPayload,
    @Req() req: FastifyRequest,
  ): Promise<OnboardingProgressDto> {
    return this.onboarding.submitFirstDriver(this.callerCtx(req), body);
  }

  @Post('skip')
  @HttpCode(HttpStatus.OK)
  async skip(
    @ZodBody(skipStepSchema) body: SkipStepPayload,
    @Req() req: FastifyRequest,
  ): Promise<OnboardingProgressDto> {
    return this.onboarding.skipStep(this.callerCtx(req), body.step);
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  async complete(@Req() req: FastifyRequest): Promise<OnboardingProgressDto> {
    return this.onboarding.complete(this.callerCtx(req));
  }

  private callerCtx(req: FastifyRequest): CallerContext {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      role: c.role,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
    };
  }

  private meta(req: FastifyRequest): AuthRequestMeta {
    const c = req.requestContext;
    return {
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
      requestId: c.requestId,
    };
  }
}
