/**
 * MarketplaceController — public + bidder-authenticated surface for the
 * Auction & Remarketing Marketplace (Session 33).
 *
 * Two tiers, both @Public() to bypass the global operator JwtAuthGuard:
 *   - browse  : GET /marketplace/t/:tenantSlug/listings[/:id] — anonymous,
 *               resolves the tenant by slug, returns only public fields.
 *   - bidder  : POST /marketplace/listings/:id/bids and
 *               GET /marketplace/my-bids — guarded by BidderJwtGuard, which
 *               establishes the tenant from the bidder token.
 */
import { Controller, Get, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import { type PlaceBidPayload, placeBidSchema } from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody, ZodParam } from '../../common/decorators/zod.decorator.js';
import { AuctionService, type BidderCtx } from './auction.service.js';
import { BidderJwtGuard } from './bidder-auth/bidder-jwt.guard.js';

const idParam = z.object({ id: z.string().uuid() });
const slugParam = z.object({ tenantSlug: z.string().min(1).max(64) });
const slugIdParam = z.object({ tenantSlug: z.string().min(1).max(64), id: z.string().uuid() });

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly service: AuctionService) {}

  @Get('t/:tenantSlug/listings')
  @Public()
  async browse(@ZodParam(slugParam) p: { tenantSlug: string }) {
    const tenantId = await this.service.resolveTenantIdBySlug(p.tenantSlug);
    if (!tenantId)
      throw new NotFoundException({ code: 'not_found', message: 'Unknown marketplace.' });
    return this.service.publicListLiveListings(tenantId);
  }

  @Get('t/:tenantSlug/listings/:id')
  @Public()
  async browseOne(@ZodParam(slugIdParam) p: { tenantSlug: string; id: string }) {
    const tenantId = await this.service.resolveTenantIdBySlug(p.tenantSlug);
    if (!tenantId)
      throw new NotFoundException({ code: 'not_found', message: 'Unknown marketplace.' });
    return this.service.publicGetListing(tenantId, p.id);
  }

  @Post('listings/:id/bids')
  @Public()
  @UseGuards(BidderJwtGuard)
  async placeBid(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(placeBidSchema) body: PlaceBidPayload,
  ) {
    return this.service.placeBid(this.bidderCtx(req), p.id, body.bidAmountCents);
  }

  @Get('my-bids')
  @Public()
  @UseGuards(BidderJwtGuard)
  async myBids(@Req() req: FastifyRequest) {
    return this.service.listBidderBids(this.bidderCtx(req));
  }

  private bidderCtx(req: FastifyRequest): BidderCtx {
    const a = req.bidderAuth;
    if (!a) {
      // BidderJwtGuard runs first and always sets this; defensive only.
      throw new NotFoundException({ code: 'not_found', message: 'Bidder context missing.' });
    }
    return {
      tenantId: a.tenantId,
      bidderId: a.bidderId,
      requestId: req.requestContext.requestId,
      ipAddress: req.ip,
    };
  }
}
