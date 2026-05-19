/**
 * Auth endpoints.
 *
 *   POST /auth/signup                     public  → tenant + owner, tokens
 *   POST /auth/login                      public  → tokens | tenant pick | mfa_required | mfa_setup_required
 *   POST /auth/mfa/setup                  public  → provisions a TOTP secret + 10 recovery codes given a setupToken
 *   POST /auth/mfa/verify                 public  → completes enrollment (setupToken + TOTP) and returns full session tokens
 *   POST /auth/mfa/challenge              public  → exchanges challengeToken + TOTP|recovery code for session tokens
 *   POST /auth/refresh                    public  → rotated tokens
 *   POST /auth/logout                     auth    → revoke caller's session
 *   POST /auth/forgot-password            public  → always 200
 *   POST /auth/reset-password             public  → updates password, kills sessions
 *   POST /auth/verify-email               public  → toggles emailVerifiedAt
 *   POST /auth/resend-verification        auth    → re-sends verification email
 *   GET  /auth/me                         auth    → user + tenant + permissions
 *   POST /auth/mfa/disable                auth    → requires current password
 */
import { Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import {
  type AuthenticatedResponse,
  type ForgotPasswordPayload,
  type LoginPayload,
  type LoginResponse,
  type LogoutPayload,
  type MeResponse,
  type MfaChallengePayload,
  type MfaDisablePayload,
  type MfaSetupRequest,
  type MfaSetupResponse,
  type MfaVerifyEnrollmentPayload,
  type RefreshPayload,
  type ResetPasswordPayload,
  type SignupPayload,
  type VerifyEmailPayload,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  mfaChallengeSchema,
  mfaDisableSchema,
  mfaSetupRequestSchema,
  mfaVerifyEnrollmentSchema,
  refreshSchema,
  resetPasswordSchema,
  signupSchema,
  verifyEmailSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { z } from 'zod';
import { type AuthRequestMeta, AuthService } from './auth.service.js';

const checkSlugSchema = z
  .object({
    tenantSlug: z
      .string()
      .min(2)
      .max(40)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  })
  .strict();

interface AuthedUser {
  id: string;
  role: string;
  tenantId: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ burst: { limit: 5, ttl: seconds(60) }, sustained: { limit: 20, ttl: seconds(900) } })
  @Post('signup')
  async signup(
    @ZodBody(signupSchema) body: SignupPayload,
    @Req() req: FastifyRequest,
  ): Promise<AuthenticatedResponse> {
    return this.auth.signup(body, this.meta(req));
  }

  /**
   * Returns whether a given slug is currently free + a suggested
   * collision-free alternative. The signup form polls this as the
   * operator types so they almost never see a 409 collision.
   */
  @Public()
  @Throttle({ burst: { limit: 30, ttl: seconds(60) } })
  @Post('check-slug')
  @HttpCode(HttpStatus.OK)
  async checkSlug(
    @ZodBody(checkSlugSchema) body: { tenantSlug: string },
  ): Promise<{ available: boolean; suggested: string }> {
    return this.auth.checkSlugAvailability(body.tenantSlug);
  }

  @Public()
  @Throttle({ burst: { limit: 10, ttl: seconds(60) }, sustained: { limit: 60, ttl: seconds(900) } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @ZodBody(loginSchema) body: LoginPayload,
    @Req() req: FastifyRequest,
  ): Promise<LoginResponse> {
    return this.auth.login(body, this.meta(req));
  }

  // MFA — enrollment. Both endpoints are Public because the caller has not yet
  // received an access token; the setupToken from /auth/login proves the
  // password challenge already passed. Throttling is keyed on the IP via
  // @nestjs/throttler defaults.
  @Public()
  @Throttle({ burst: { limit: 5, ttl: seconds(60) } })
  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  async mfaSetup(@ZodBody(mfaSetupRequestSchema) body: MfaSetupRequest): Promise<MfaSetupResponse> {
    return this.auth.mfaSetupWithToken(body.setupToken);
  }

  @Public()
  @Throttle({ burst: { limit: 10, ttl: seconds(60) } })
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  async mfaVerify(
    @ZodBody(mfaVerifyEnrollmentSchema) body: MfaVerifyEnrollmentPayload,
    @Req() req: FastifyRequest,
  ): Promise<AuthenticatedResponse> {
    return this.auth.mfaVerifyEnrollment(body, this.meta(req));
  }

  @Public()
  @Throttle({ burst: { limit: 10, ttl: seconds(60) } })
  @Post('mfa/challenge')
  @HttpCode(HttpStatus.OK)
  async mfaChallenge(
    @ZodBody(mfaChallengeSchema) body: MfaChallengePayload,
    @Req() req: FastifyRequest,
  ): Promise<AuthenticatedResponse> {
    return this.auth.mfaChallenge(body, this.meta(req));
  }

  @Public()
  @Throttle({ burst: { limit: 30, ttl: seconds(60) } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @ZodBody(refreshSchema) body: RefreshPayload,
    @Req() req: FastifyRequest,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    return this.auth.refresh(body.refreshToken, this.meta(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @ZodBody(logoutSchema) body: LogoutPayload,
    @CurrentUser() user: AuthedUser,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.auth.logout(
      body.refreshToken,
      { tenantId: user.tenantId, userId: user.id, role: user.role },
      this.meta(req),
    );
  }

  @Public()
  @Throttle({ burst: { limit: 5, ttl: seconds(60) }, sustained: { limit: 30, ttl: seconds(3600) } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @ZodBody(forgotPasswordSchema) body: ForgotPasswordPayload,
  ): Promise<{ ok: true }> {
    await this.auth.forgotPassword(body);
    return { ok: true };
  }

  @Public()
  @Throttle({ burst: { limit: 5, ttl: seconds(60) }, sustained: { limit: 30, ttl: seconds(3600) } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @ZodBody(resetPasswordSchema) body: ResetPasswordPayload,
  ): Promise<{ ok: true }> {
    await this.auth.resetPassword(body);
    return { ok: true };
  }

  @Public()
  @Throttle({
    burst: { limit: 10, ttl: seconds(60) },
    sustained: { limit: 60, ttl: seconds(3600) },
  })
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@ZodBody(verifyEmailSchema) body: VerifyEmailPayload): Promise<{ ok: true }> {
    await this.auth.verifyEmail(body);
    return { ok: true };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(
    @CurrentUser() user: AuthedUser,
    @Req() req: FastifyRequest,
  ): Promise<{ ok: true }> {
    await this.auth.resendVerification(
      { tenantId: user.tenantId, userId: user.id, role: user.role },
      this.meta(req),
    );
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthedUser): Promise<MeResponse> {
    return this.auth.me({
      tenantId: user.tenantId,
      userId: user.id,
      role: user.role,
    });
  }

  @Post('mfa/disable')
  @HttpCode(HttpStatus.OK)
  async mfaDisable(
    @CurrentUser() user: AuthedUser,
    @ZodBody(mfaDisableSchema) body: MfaDisablePayload,
  ): Promise<{ enabled: false }> {
    return this.auth.mfaDisable(
      { tenantId: user.tenantId, userId: user.id, role: user.role },
      body.password,
    );
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
