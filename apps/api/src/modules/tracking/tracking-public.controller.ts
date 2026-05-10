/**
 * Public tracking controller — no auth, no session.
 *
 * The token in the URL is the unit of authorization. TrackingService.resolveToken
 * runs against the admin pool ONLY to look up the (tenant_id, job_id) tuple
 * for the token; every subsequent read/write runs under tenant scope so RLS
 * still applies.
 *
 * SECURITY NOTES
 *
 * - The route is marked @Public so the global JWT guard skips it.
 * - Rate limits live in TrackingService (per-IP for views, per-token for
 *   messages and ratings).
 * - 410 Gone is returned for revoked or expired tokens (NOT 404 — we want to
 *   distinguish "the token never existed" from "this token was killed").
 * - Phone numbers are never echoed back (driver phone, customer phone, etc.).
 */
import { Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  type SubmitJobRatingPayload,
  type TrackingLanguage,
  type TrackingMessageDto,
  type TrackingPublicView,
  sendTrackingMessageSchema,
  submitJobRatingSchema,
  trackingTokenSchema,
} from '@towcommand/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { TrackingService } from './tracking.service.js';

const tokenParam = z.object({ token: trackingTokenSchema });

const messageBody = sendTrackingMessageSchema;
const ratingBody = submitJobRatingSchema;

@Public()
@Controller('public/track')
export class TrackingPublicController {
  constructor(private readonly tracking: TrackingService) {}

  @Get(':token')
  async view(
    @ZodParam(tokenParam) params: { token: string },
    @Req() req: FastifyRequest,
  ): Promise<TrackingPublicView> {
    const lang = pickLanguage(req);
    return this.tracking.publicView(params.token, ipFromReq(req), userAgentFromReq(req), lang);
  }

  @Get(':token/messages')
  async messages(
    @ZodParam(tokenParam) params: { token: string },
  ): Promise<{ messages: TrackingMessageDto[] }> {
    const messages = await this.tracking.listMessagesForToken(params.token);
    return { messages };
  }

  @Post(':token/messages')
  @HttpCode(HttpStatus.CREATED)
  async sendMessage(
    @ZodParam(tokenParam) params: { token: string },
    @ZodBody(messageBody) body: { body: string },
    @Req() req: FastifyRequest,
  ): Promise<TrackingMessageDto> {
    return this.tracking.submitCustomerMessage(params.token, body.body, ipFromReq(req));
  }

  @Post(':token/rating')
  @HttpCode(HttpStatus.CREATED)
  async rating(
    @ZodParam(tokenParam) params: { token: string },
    @ZodBody(ratingBody) body: SubmitJobRatingPayload,
    @Req() req: FastifyRequest,
  ): Promise<{ ok: true }> {
    return this.tracking.submitRating(
      params.token,
      body.stars,
      body.comment ?? null,
      ipFromReq(req),
    );
  }
}

function pickLanguage(req: FastifyRequest): TrackingLanguage {
  // ?lang=es overrides; otherwise sniff Accept-Language for "es".
  const url = req.url ?? '';
  const m = /[?&]lang=([a-zA-Z-]+)/.exec(url);
  if (m?.[1]?.toLowerCase().startsWith('es')) return 'es';
  if (m?.[1]?.toLowerCase().startsWith('en')) return 'en';
  const accept = (req.headers['accept-language'] as string | undefined) ?? '';
  if (/(^|,|\s)es(-|;|,|$)/i.test(accept)) return 'es';
  return 'en';
}

function ipFromReq(req: FastifyRequest): string | null {
  const xff = (req.headers['x-forwarded-for'] as string | undefined) ?? '';
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? null;
}

function userAgentFromReq(req: FastifyRequest): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : null;
}
