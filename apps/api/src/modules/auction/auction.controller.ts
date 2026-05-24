/**
 * AuctionController — operator-side REST surface for the Auction &
 * Remarketing Marketplace (Session 33).
 *
 * RBAC mirrors the impound module:
 *   OWNER, ADMIN, DISPATCHER            — full control (writes)
 *   OWNER, ADMIN, DISPATCHER, AUDITOR   — read access
 *   MANAGER, ACCOUNTING, DRIVER         — no access
 *
 * Money is cents-as-integer; timestamps are UTC ISO-8601 over the wire.
 */
import { Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
  type AwardAuctionListingPayload,
  type CreateAuctionListingPayload,
  type ListAuctionListingsFilter,
  type PublishAuctionListingPayload,
  ROLES,
  type UpdateAuctionListingPayload,
  awardAuctionListingSchema,
  createAuctionListingSchema,
  listAuctionListingsFilterSchema,
  publishAuctionListingSchema,
  updateAuctionListingSchema,
} from '@ustowdispatch/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AuctionService } from './auction.service.js';

const READERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER, ROLES.AUDITOR] as const;
const WRITERS = [ROLES.OWNER, ROLES.ADMIN, ROLES.DISPATCHER] as const;

const idParam = z.object({ id: z.string().uuid() });

@UseGuards(RolesGuard)
@Controller('auction')
export class AuctionController {
  constructor(private readonly service: AuctionService) {}

  @Get('listings')
  @Roles(...READERS)
  async listListings(
    @Req() req: FastifyRequest,
    @ZodQuery(listAuctionListingsFilterSchema) query: ListAuctionListingsFilter,
  ) {
    return this.service.listListings(this.ctx(req), query);
  }

  @Get('eligible-vehicles')
  @Roles(...READERS)
  async eligibleVehicles(@Req() req: FastifyRequest) {
    return this.service.listEligibleVehicles(this.ctx(req));
  }

  @Get('listings/:id')
  @Roles(...READERS)
  async getListing(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    return this.service.getListingDetail(this.ctx(req), p.id);
  }

  @Post('listings')
  @Roles(...WRITERS)
  async createListing(
    @Req() req: FastifyRequest,
    @ZodBody(createAuctionListingSchema) body: CreateAuctionListingPayload,
  ) {
    return this.service.createListing(this.ctx(req), body);
  }

  @Patch('listings/:id')
  @Roles(...WRITERS)
  async updateListing(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(updateAuctionListingSchema) body: UpdateAuctionListingPayload,
  ) {
    return this.service.updateListing(this.ctx(req), p.id, body);
  }

  @Post('listings/:id/publish')
  @Roles(...WRITERS)
  async publishListing(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(publishAuctionListingSchema) body: PublishAuctionListingPayload,
  ) {
    return this.service.publishListing(this.ctx(req), p.id, body);
  }

  @Post('listings/:id/withdraw')
  @Roles(...WRITERS)
  async withdrawListing(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    return this.service.withdrawListing(this.ctx(req), p.id);
  }

  @Post('listings/:id/end')
  @Roles(...WRITERS)
  async endListing(@Req() req: FastifyRequest, @ZodParam(idParam) p: { id: string }) {
    return this.service.endListing(this.ctx(req), p.id);
  }

  @Post('listings/:id/award')
  @Roles(...WRITERS)
  async awardListing(
    @Req() req: FastifyRequest,
    @ZodParam(idParam) p: { id: string },
    @ZodBody(awardAuctionListingSchema) body: AwardAuctionListingPayload,
  ) {
    return this.service.awardWinner(this.ctx(req), p.id, body);
  }

  private ctx(req: FastifyRequest): { tenantId: string; userId: string; requestId: string } {
    const c = req.requestContext;
    return {
      tenantId: c.tenantId as string,
      userId: c.userId as string,
      requestId: c.requestId,
    };
  }
}
