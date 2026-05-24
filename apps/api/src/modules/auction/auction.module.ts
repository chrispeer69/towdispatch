/**
 * AuctionModule — Auction & Remarketing Marketplace (Session 33).
 *
 * Wires the operator controller, the public/bidder marketplace controller,
 * the bidder-auth surface (separate JWT keyspace), and the env-gated
 * lifecycle cron. ScheduleModule.forRoot() is idempotent across modules.
 * AuthModule provides JwtService + PasswordService (bidder auth reuses
 * the operator argon2id hasher and jose signer). The lifecycle cron is
 * exported so integration tests can drive tick() directly.
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuctionLifecycleCron } from './auction-lifecycle.cron.js';
import { AuctionController } from './auction.controller.js';
import { AuctionService } from './auction.service.js';
import { BidderAuthController } from './bidder-auth/bidder-auth.controller.js';
import { BidderAuthService } from './bidder-auth/bidder-auth.service.js';
import { BidderJwtGuard } from './bidder-auth/bidder-jwt.guard.js';
import { MarketplaceController } from './marketplace.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule, ScheduleModule.forRoot()],
  controllers: [AuctionController, MarketplaceController, BidderAuthController],
  providers: [AuctionService, BidderAuthService, AuctionLifecycleCron, BidderJwtGuard],
  exports: [AuctionService, AuctionLifecycleCron],
})
export class AuctionModule {}
