/**
 * /marketplace-admin/* (Session 46) — platform-admin app review (v1: manual,
 * no auto-approval). Authenticated by MARKETPLACE_ADMIN_TOKEN via
 * PlatformAdminGuard (no platform-admin RBAC role exists yet). @Public so the
 * operator JwtAuthGuard doesn't intercept; the shared-secret guard does the
 * auth. Behind MARKETPLACE_API_ENABLED.
 */
import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  type MarketplaceAppDto,
  type ReviewActionPayload,
  type ReviewQuery,
  reviewActionSchema,
  reviewQuerySchema,
} from '@ustowdispatch/shared';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodBody, ZodQuery } from '../../common/decorators/zod.decorator.js';
import { AdminReviewService } from './admin-review.service.js';
import { MarketplaceEnabledGuard } from './marketplace-enabled.guard.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';

@Public()
@UseGuards(MarketplaceEnabledGuard, PlatformAdminGuard)
@Controller('marketplace-admin')
export class AdminController {
  constructor(private readonly review: AdminReviewService) {}

  @Get('apps')
  async list(@ZodQuery(reviewQuerySchema) query: ReviewQuery): Promise<MarketplaceAppDto[]> {
    return this.review.listForReview(query.status);
  }

  @Post('apps/:id/review')
  async reviewApp(
    @Param('id') id: string,
    @ZodBody(reviewActionSchema) body: ReviewActionPayload,
  ): Promise<MarketplaceAppDto> {
    return this.review.review(id, body);
  }
}
