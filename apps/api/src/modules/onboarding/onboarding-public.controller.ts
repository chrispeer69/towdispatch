/**
 * Public onboarding surface — composes the existing AuthService without
 * modifying it.
 *
 *   POST /onboarding/signup       @Public  → captcha gate + 5/hour-per-IP throttle,
 *                                            delegates to AuthService.signup, then
 *                                            seeds onboarding_progress + the
 *                                            account_created milestone. Returns the
 *                                            same AuthenticatedResponse as /auth/signup.
 *   POST /onboarding/verify-email @Public  → delegates to AuthService.verifyEmail.
 *
 * The production web flow currently signs up via the existing /api/auth/signup
 * BFF route (which sets the session cookies); this endpoint is the funnel entry
 * for API/non-web consumers and is independently exercised by the test suite.
 * See SESSION_25_DECISIONS.md D3.
 */
import { BadRequestException, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { type AuthenticatedResponse, ERROR_CODES } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { type AuthRequestMeta, AuthService } from '../auth/auth.service.js';
import { verifyCaptcha } from './captcha.js';
import {
  type OnboardingSignupPayload,
  type OnboardingVerifyEmailPayload,
  onboardingSignupSchema,
  onboardingVerifyEmailSchema,
} from './onboarding.contracts.js';
import { OnboardingService } from './onboarding.service.js';

@Controller('onboarding')
export class OnboardingPublicController {
  constructor(
    private readonly auth: AuthService,
    private readonly onboarding: OnboardingService,
  ) {}

  @Public()
  @Throttle({ sustained: { limit: 5, ttl: seconds(3600) } })
  @Post('signup')
  async signup(
    @ZodBody(onboardingSignupSchema) body: OnboardingSignupPayload,
    @Req() req: FastifyRequest,
  ): Promise<AuthenticatedResponse> {
    const { captchaToken, ...signup } = body;
    const ok = await verifyCaptcha(captchaToken);
    if (!ok) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Captcha verification failed',
      });
    }

    const result = await this.auth.signup(signup, this.meta(req));

    // Seed the wizard progress row + activation ledger for the new tenant.
    const c = req.requestContext;
    await this.onboarding.getState({
      tenantId: result.tenant.id,
      userId: result.user.id,
      requestId: c.requestId,
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
    });

    return result;
  }

  @Public()
  @Throttle({
    burst: { limit: 10, ttl: seconds(60) },
    sustained: { limit: 60, ttl: seconds(3600) },
  })
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @ZodBody(onboardingVerifyEmailSchema) body: OnboardingVerifyEmailPayload,
  ): Promise<{ ok: true }> {
    await this.auth.verifyEmail(body);
    return { ok: true };
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
