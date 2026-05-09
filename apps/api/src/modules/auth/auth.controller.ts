/**
 * Auth endpoints.
 *
 *   POST /auth/signup                     public  → tenant + owner, tokens
 *   POST /auth/login                      public  → tokens | tenant pick | mfa
 *   POST /auth/mfa/login                  public  → tokens after TOTP
 *   POST /auth/refresh                    public  → rotated tokens
 *   POST /auth/logout                     auth    → revoke caller's session
 *   POST /auth/forgot-password            public  → always 200
 *   POST /auth/reset-password             public  → updates password, kills sessions
 *   POST /auth/verify-email               public  → toggles emailVerifiedAt
 *   POST /auth/resend-verification        auth    → re-sends verification email
 *   GET  /auth/me                         auth    → user + tenant + permissions
 *   POST /auth/mfa/setup                  auth    → otp_auth_url + secret
 *   POST /auth/mfa/verify-setup           auth    → activates MFA after a TOTP
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
  type MfaDisablePayload,
  type MfaLoginPayload,
  type MfaSetupResponse,
  type MfaVerifySetupPayload,
  type RefreshPayload,
  type ResetPasswordPayload,
  type SignupPayload,
  type VerifyEmailPayload,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  mfaDisableSchema,
  mfaLoginSchema,
  mfaVerifySetupSchema,
  refreshSchema,
  resetPasswordSchema,
  signupSchema,
  verifyEmailSchema,
} from '@towcommand/shared';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { type AuthRequestMeta, AuthService } from './auth.service.js';

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

  @Public()
  @Throttle({ burst: { limit: 10, ttl: seconds(60) } })
  @Post('mfa/login')
  @HttpCode(HttpStatus.OK)
  async mfaLogin(
    @ZodBody(mfaLoginSchema) body: MfaLoginPayload,
    @Req() req: FastifyRequest,
  ): Promise<AuthenticatedResponse> {
    return this.auth.mfaLogin(body, this.meta(req));
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

  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  async mfaSetup(@CurrentUser() user: AuthedUser): Promise<MfaSetupResponse> {
    return this.auth.mfaSetup({ tenantId: user.tenantId, userId: user.id, role: user.role });
  }

  @Post('mfa/verify-setup')
  @HttpCode(HttpStatus.OK)
  async mfaVerifySetup(
    @CurrentUser() user: AuthedUser,
    @ZodBody(mfaVerifySetupSchema) body: MfaVerifySetupPayload,
  ): Promise<{ enabled: true }> {
    return this.auth.mfaVerifySetup(
      { tenantId: user.tenantId, userId: user.id, role: user.role },
      body,
    );
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
