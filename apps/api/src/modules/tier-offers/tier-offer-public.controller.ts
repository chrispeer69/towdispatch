/**
 * TierOfferPublicController — the magic-link landing surface.
 *
 * No auth: the per-recipient signed token in the URL is the unit of
 * authorization (mirrors PaymentsPublicController). @Public() tells the
 * global JWT guard to skip these routes. TierOfferRecipientService verifies
 * the HMAC + expiry, resolves the tenant via the admin pool, then runs every
 * read/write under tenant scope so RLS + audit still apply.
 *
 * Routes:
 *   GET  /public/tier-offers/:token          — render offer to the recipient
 *   POST /public/tier-offers/:token/accept    — recipient accepts
 *   POST /public/tier-offers/:token/decline   — recipient declines
 */
import { Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { TierOfferRecipientService } from './tier-offer-recipient.service.js';
import {
  type PublicAcceptTierOfferPayload,
  type PublicDeclineTierOfferPayload,
  publicAcceptTierOfferSchema,
  publicDeclineTierOfferSchema,
} from './tier-offers.dtos.js';

// Token shape: v1.<b64url>.<digits>.<b64url>.<b64url> — base64url chars
// plus '.' separators. Bounded length to reject obviously-bogus input
// before it reaches the verifier.
const tokenParam = z.object({
  token: z
    .string()
    .min(20)
    .max(512)
    .regex(/^[A-Za-z0-9._-]+$/),
});

@Public()
@Controller('public/tier-offers')
export class TierOfferPublicController {
  constructor(private readonly recipients: TierOfferRecipientService) {}

  @Get(':token')
  async view(@ZodParam(tokenParam) params: { token: string }) {
    return this.recipients.resolvePublicView(params.token);
  }

  @Post(':token/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @ZodParam(tokenParam) params: { token: string },
    @ZodBody(publicAcceptTierOfferSchema) body: PublicAcceptTierOfferPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.recipients.acceptByToken(params.token, body.confirmName, {
      ipAddress: req.requestContext.ipAddress,
      userAgent: req.requestContext.userAgent,
    });
  }

  @Post(':token/decline')
  @HttpCode(HttpStatus.OK)
  async decline(
    @ZodParam(tokenParam) params: { token: string },
    @ZodBody(publicDeclineTierOfferSchema) body: PublicDeclineTierOfferPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.recipients.declineByToken(params.token, body.reason, {
      ipAddress: req.requestContext.ipAddress,
      userAgent: req.requestContext.userAgent,
    });
  }
}
