/**
 * TierOffersModule — Moat #3.
 *
 * Wires the operator-side controller, the public token-bearing
 * controller, the orchestration service, the read-only enforcement
 * service consumed by JobsService, and the reconciliation reports
 * service. The module re-exports the enforcement service so other
 * modules (notably JobsModule) can inject it.
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module.js';
import { TierOfferLifecycleCron } from './lifecycle-cron.service.js';
import { TierOfferWebhookController } from './sendgrid-webhook.controller.js';
import { TierOfferWebhookService } from './sendgrid-webhook.service.js';
import { TierOfferEnforcementService } from './tier-offer-enforcement.service.js';
import { TierOfferReportsService } from './tier-offer-reports.service.js';
import { TierOfferService } from './tier-offer.service.js';
import { TierOffersPublicController } from './tier-offers-public.controller.js';
import { TierOffersController } from './tier-offers.controller.js';
@Module({
  // ScheduleModule.forRoot() is idempotent across modules — already
  // imported by AR + DynamicPricing modules. Including it here keeps
  // tier-offer's lifecycle cron self-contained.
  imports: [DatabaseModule, ScheduleModule.forRoot()],
  controllers: [TierOffersController, TierOffersPublicController, TierOfferWebhookController],
  providers: [
    TierOfferService,
    TierOfferEnforcementService,
    TierOfferReportsService,
    TierOfferWebhookService,
    TierOfferLifecycleCron,
  ],
  exports: [TierOfferEnforcementService, TierOfferLifecycleCron],
})
export class TierOffersModule {}
