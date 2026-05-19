/**
 * TierOffersPublicController — unauthenticated, token-bearing surface
 * for motor-club account managers responding to a tier offer they
 * received in their inbox.
 *
 * The token IS the auth. We do not require a tenant header or a logged-
 * in session. Each handler validates the JWT signature, maps the token
 * to a recipient row, and confirms the row's tenant matches the JWT's
 * tenant. RLS is bypassed via TransactionRunner.runAsAdmin from inside
 * TierOfferService — these public reads/writes intentionally cross
 * tenants from the system's perspective because the token bearer does
 * not have a tenant identity.
 */
import { Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  type PublicAcceptTierOfferPayload,
  type PublicDeclineTierOfferPayload,
  publicAcceptTierOfferSchema,
  publicDeclineTierOfferSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { TierOfferService } from './tier-offer.service.js';

const tokenParam = z.object({ token: z.string().min(1).max(4096) });

interface PublicOfferView {
  status: 'active' | 'already_responded' | 'cancelled' | 'expired' | 'revoked' | 'invalid';
  recipient?: {
    id: string;
    name: string;
    role: string | null;
    email: string;
    status: string;
    respondedAt: string | null;
  };
  offer?: {
    id: string;
    title: string;
    narrative: string;
    eventWindowStart: string;
    eventWindowEnd: string;
    acceptanceDeadlineAt: string;
    committedTruckCount: number;
    defaultForNonResponders: string;
    status: string;
  };
  tenant?: { id: string; name: string };
}

@Public()
@Controller('public/tier-offers')
export class TierOffersPublicController {
  constructor(private readonly service: TierOfferService) {}

  @Get(':token')
  async preview(@ZodParam(tokenParam) p: { token: string }): Promise<PublicOfferView> {
    const result = await this.service.getTokenPayload(p.token);
    if (!result) return { status: 'invalid' };
    const { offer, recipient, tenant } = result;
    let viewStatus: PublicOfferView['status'] = 'active';
    if (offer.status === 'cancelled') viewStatus = 'cancelled';
    else if (recipient.status === 'revoked') viewStatus = 'revoked';
    else if (recipient.status === 'expired') viewStatus = 'expired';
    else if (recipient.status === 'accepted' || recipient.status === 'declined')
      viewStatus = 'already_responded';
    return {
      status: viewStatus,
      recipient: {
        id: recipient.id,
        name: recipient.recipientName,
        role: recipient.recipientRole,
        email: recipient.recipientEmail,
        status: recipient.status,
        respondedAt: recipient.respondedAt ? recipient.respondedAt.toISOString() : null,
      },
      offer: {
        id: offer.id,
        title: offer.title,
        narrative: offer.narrative,
        eventWindowStart: offer.eventWindowStart.toISOString(),
        eventWindowEnd: offer.eventWindowEnd.toISOString(),
        acceptanceDeadlineAt: offer.acceptanceDeadlineAt.toISOString(),
        committedTruckCount: offer.committedTruckCount,
        defaultForNonResponders: offer.defaultForNonResponders,
        status: offer.status,
      },
      tenant: { id: tenant.id, name: tenant.name },
    };
  }

  @Post(':token/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Req() req: FastifyRequest,
    @ZodParam(tokenParam) p: { token: string },
    @ZodBody(publicAcceptTierOfferSchema) _body: PublicAcceptTierOfferPayload,
  ): Promise<{ status: string }> {
    const ip = req.requestContext.ipAddress ?? null;
    const ua = req.requestContext.userAgent ?? null;
    return this.service.acceptByToken({ token: p.token, ipAddress: ip, userAgent: ua });
  }

  @Post(':token/decline')
  @HttpCode(HttpStatus.OK)
  async decline(
    @Req() req: FastifyRequest,
    @ZodParam(tokenParam) p: { token: string },
    @ZodBody(publicDeclineTierOfferSchema) body: PublicDeclineTierOfferPayload,
  ): Promise<{ status: string }> {
    const ip = req.requestContext.ipAddress ?? null;
    const ua = req.requestContext.userAgent ?? null;
    return this.service.declineByToken({
      token: p.token,
      ipAddress: ip,
      userAgent: ua,
      reason: body.reason ?? null,
    });
  }
}
