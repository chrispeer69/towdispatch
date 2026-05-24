/**
 * Public HTTP surface for the Customer Self-Serve Portal (Session 55).
 *
 * Fully @Public() (no JWT realm). Tenant is resolved server-side from the
 * forwarded Host (X-Portal-Host / hostname) — clients never send a tenant id.
 * Authenticated endpoints carry a signed, HttpOnly session cookie (set on
 * magic-link verify, slid on each authenticated call). Throttled at the edge;
 * the service additionally enforces the documented per-IP / per-impound limits.
 */
import { Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import {
  type PortalBalance,
  type PortalIdAttestPayload,
  type PortalIdVerificationDto,
  type PortalLookupPayload,
  type PortalLookupResult,
  type PortalPayInitResult,
  type PortalReleaseIntentDto,
  type PortalSessionView,
  portalIdAttestSchema,
  portalLookupSchema,
  portalMagicLinkVerifySchema,
} from '@ustowdispatch/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody } from '../../common/decorators/zod.decorator.js';
import { SelfServePortalService } from './self-serve-portal.service.js';
import type { SessionTokenPayload } from './session/session-token.js';

const COOKIE_NAME = 'ssp_session';

function portalHost(req: FastifyRequest): string {
  const header = req.headers['x-portal-host'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  return (fromHeader ?? req.hostname ?? '').toString();
}

function readSessionCookie(req: FastifyRequest): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function setSessionCookie(reply: FastifyReply, value: string, maxAgeSeconds: number): void {
  reply.header(
    'set-cookie',
    `${COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`,
  );
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.header('set-cookie', `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

@Public()
@Controller('self-serve')
export class SelfServePortalController {
  constructor(private readonly svc: SelfServePortalService) {}

  // --- public lookup (no session) ---
  @Throttle({ burst: { limit: 10, ttl: seconds(60) }, sustained: { limit: 30, ttl: seconds(900) } })
  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  async lookup(
    @Req() req: FastifyRequest,
    @ZodBody(portalLookupSchema) body: PortalLookupPayload,
  ): Promise<PortalLookupResult> {
    const ip = req.requestContext?.ipAddress ?? req.ip ?? null;
    const ua = req.requestContext?.userAgent ?? null;
    return this.svc.lookup(portalHost(req), ip, ua, body);
  }

  // --- magic-link verify → set session cookie ---
  @Throttle({ sustained: { limit: 20, ttl: seconds(900) } })
  @Post('magic-link/verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @ZodBody(portalMagicLinkVerifySchema) body: { token: string },
  ): Promise<PortalSessionView> {
    const { cookie, view } = await this.svc.verifyMagicLink(portalHost(req), body.token);
    setSessionCookie(reply, cookie, this.cookieMaxAge());
    return view;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) reply: FastifyReply): { ok: true } {
    clearSessionCookie(reply);
    return { ok: true };
  }

  // --- authenticated (session cookie) ---
  @Get('session')
  async session(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PortalSessionView> {
    const payload = this.requireSession(req, reply);
    return this.svc.getSessionView(payload);
  }

  @Post('id')
  @HttpCode(HttpStatus.OK)
  async attestId(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @ZodBody(portalIdAttestSchema) body: PortalIdAttestPayload,
  ): Promise<PortalIdVerificationDto> {
    const payload = this.requireSession(req, reply);
    return this.svc.attestId(payload, body);
  }

  @Get('balance')
  async balance(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PortalBalance> {
    const payload = this.requireSession(req, reply);
    return this.svc.getBalance(payload);
  }

  @Post('pay')
  @HttpCode(HttpStatus.OK)
  async pay(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PortalPayInitResult> {
    const payload = this.requireSession(req, reply);
    return this.svc.initiatePayment(payload);
  }

  @Get('release-intent')
  async releaseIntent(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PortalReleaseIntentDto | null> {
    const payload = this.requireSession(req, reply);
    return this.svc.getReleaseIntent(payload);
  }

  /** Authenticate the cookie and refresh the sliding window on every hit. */
  private requireSession(req: FastifyRequest, reply: FastifyReply): SessionTokenPayload {
    const payload = this.svc.authenticate(readSessionCookie(req));
    setSessionCookie(reply, this.svc.slideCookie(payload), this.cookieMaxAge());
    return payload;
  }

  private cookieMaxAge(): number {
    return 60 * 60; // matches the default 60-min session TTL; service signs the authoritative exp
  }
}
