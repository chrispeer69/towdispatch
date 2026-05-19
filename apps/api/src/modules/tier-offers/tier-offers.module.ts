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
import { DatabaseModule } from '../../database/database.module.js';
import { TierOfferEnforcementService } from './tier-offer-enforcement.service.js';
import { TierOfferReportsService } from './tier-offer-reports.service.js';
import { TierOfferService } from './tier-offer.service.js';
import { TierOffersPublicController } from './tier-offers-public.controller.js';
import { TierOffersController } from './tier-offers.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [TierOffersController, TierOffersPublicController],
  providers: [TierOfferService, TierOfferEnforcementService, TierOfferReportsService],
  exports: [TierOfferEnforcementService],
})
export class TierOffersModule {}
