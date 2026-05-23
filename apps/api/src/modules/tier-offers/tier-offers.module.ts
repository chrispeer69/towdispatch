/**
 * TierOffersModule — Moat #3, Session 2.
 *
 * Wires the service + cron + admin layer on top of the schema laid down
 * in Session 1 (packages/db/sql/0034_tier_offer_composer.sql).
 *
 * What lives here:
 *   - TierOfferRepository       — RLS-scoped persistence
 *   - TierOfferTokenService     — HMAC-signed magic-link tokens
 *   - TierOfferComposerService  — offer lifecycle (compose/send/cancel/conclude)
 *   - TierOfferRecipientService — roster CRUD + accept/decline by token
 *   - TierOfferExpirySweepCron  — nightly sweep, gated by TIER_OFFER_CRON_ENABLED
 *   - TierOfferAdminController  — OWNER/ADMIN operator surface
 *   - TierOfferPublicController — token-resolved accept/decline (no auth)
 *
 * The email send + SendGrid webhook handler live in Session 3.
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '../../config/config.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { TierOfferAdminController } from './tier-offer-admin.controller.js';
import { TierOfferComposerService } from './tier-offer-composer.service.js';
import { TierOfferExpirySweepCron } from './tier-offer-expiry-sweep.cron.js';
import { TierOfferPublicController } from './tier-offer-public.controller.js';
import { TierOfferRecipientService } from './tier-offer-recipient.service.js';
import { TierOfferTokenService } from './tier-offer-token.service.js';
import { TierOfferRepository } from './tier-offer.repository.js';

@Module({
  imports: [
    // ScheduleModule.forRoot() is idempotent across modules (the dynamic-
    // pricing module already calls it). Co-locating here keeps the module
    // self-contained.
    ScheduleModule.forRoot(),
    ConfigModule,
    DatabaseModule,
  ],
  controllers: [TierOfferAdminController, TierOfferPublicController],
  providers: [
    TierOfferRepository,
    TierOfferTokenService,
    TierOfferComposerService,
    TierOfferRecipientService,
    TierOfferExpirySweepCron,
  ],
  exports: [TierOfferComposerService, TierOfferRecipientService],
})
export class TierOffersModule {}
