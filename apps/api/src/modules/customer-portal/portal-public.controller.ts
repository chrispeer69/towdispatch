/**
 * Portal public (unauthenticated) endpoints (Session 32).
 *
 *   GET  /portal/public/resolve     → branding for a Host (pre-login)
 *   POST /portal/signup             → always { ok: true } (email-gated, no leak)
 *   POST /portal/login              → portal session token
 *   POST /portal/verify-email       → consume email-verification token
 *   POST /portal/forgot-password    → always { ok: true } (no leak)
 *   POST /portal/reset-password     → consume reset token, set new password
 *
 * The customer-facing portal is served from the tenant's own host, but the
 * web BFF — not the browser — calls this API, so the browser's Host is
 * forwarded explicitly in the `X-Portal-Host` header (falling back to the
 * request hostname / a ?host= query for the resolve probe). The tenant is
 * resolved from that host server-side; clients never send a tenant id.
 */
import { Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import {
  type PortalAuthResponse,
  type PortalBrandingDto,
  type PortalForgotPasswordPayload,
  type PortalGenericOk,
  type PortalLoginPayload,
  type PortalResetPasswordPayload,
  type PortalSignupPayload,
  portalForgotPasswordSchema,
  portalLoginSchema,
  portalResetPasswordSchema,
  portalSignupSchema,
  portalVerifyEmailSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { PortalAuthService } from './portal-auth.service.js';

@Public()
@Controller('portal')
export class PortalPublicController {
  constructor(private readonly auth: PortalAuthService) {}

  @Get('public/resolve')
  async resolve(
    @Req() req: FastifyRequest,
    @Query('host') hostQuery?: string,
  ): Promise<{ branding: PortalBrandingDto }> {
    const branding = await this.auth.branding(hostQuery || portalHost(req));
    return { branding };
  }

  @Throttle({ sustained: { limit: 10, ttl: seconds(900) } })
  @Post('signup')
  @HttpCode(HttpStatus.OK)
  async signup(
    @Req() req: FastifyRequest,
    @ZodBody(portalSignupSchema) body: PortalSignupPayload,
  ): Promise<PortalGenericOk> {
    return this.auth.signup(portalHost(req), body);
  }

  @Throttle({ burst: { limit: 10, ttl: seconds(60) }, sustained: { limit: 60, ttl: seconds(900) } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Req() req: FastifyRequest,
    @ZodBody(portalLoginSchema) body: PortalLoginPayload,
  ): Promise<PortalAuthResponse> {
    return this.auth.login(portalHost(req), body);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @ZodBody(portalVerifyEmailSchema) body: { token: string },
  ): Promise<PortalGenericOk> {
    return this.auth.verifyEmail(body.token);
  }

  @Throttle({ sustained: { limit: 5, ttl: seconds(3600) } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Req() req: FastifyRequest,
    @ZodBody(portalForgotPasswordSchema) body: PortalForgotPasswordPayload,
  ): Promise<PortalGenericOk> {
    return this.auth.forgotPassword(portalHost(req), body);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @ZodBody(portalResetPasswordSchema) body: PortalResetPasswordPayload,
  ): Promise<PortalGenericOk> {
    return this.auth.resetPassword(body);
  }
}

/**
 * The customer-facing portal host. The web BFF forwards the browser's Host as
 * X-Portal-Host; we fall back to the request hostname so direct calls (and the
 * resolve probe) still work in dev.
 */
function portalHost(req: FastifyRequest): string {
  const header = req.headers['x-portal-host'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  return (fromHeader ?? req.hostname ?? '').toString();
}
