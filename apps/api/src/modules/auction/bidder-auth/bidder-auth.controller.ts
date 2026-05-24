/**
 * BidderAuthController — public auth surface for auction bidders
 * (Session 33). All routes are @Public() so the global operator
 * JwtAuthGuard skips them; the bidder JWT is minted by /bidder-auth/login.
 */
import { Controller, Post } from '@nestjs/common';
import {
  type BidderLoginPayload,
  type BidderRegisterPayload,
  type BidderVerifyEmailPayload,
  bidderLoginSchema,
  bidderRegisterSchema,
  bidderVerifyEmailSchema,
} from '@ustowdispatch/shared';
import { Public } from '../../../common/decorators/public.decorator.js';
import { ZodBody } from '../../../common/decorators/zod.decorator.js';
import { BidderAuthService } from './bidder-auth.service.js';

@Controller('bidder-auth')
export class BidderAuthController {
  constructor(private readonly service: BidderAuthService) {}

  @Post('register')
  @Public()
  async register(@ZodBody(bidderRegisterSchema) body: BidderRegisterPayload) {
    return this.service.register(body);
  }

  @Post('verify-email')
  @Public()
  async verifyEmail(@ZodBody(bidderVerifyEmailSchema) body: BidderVerifyEmailPayload) {
    return this.service.verifyEmail(body.token);
  }

  @Post('login')
  @Public()
  async login(@ZodBody(bidderLoginSchema) body: BidderLoginPayload) {
    return this.service.login(body);
  }
}
