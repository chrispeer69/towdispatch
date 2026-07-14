/**
 * CapacityModule — Capacity-Aware Dispatch Signaling (CADS, Session 58).
 *
 * Event-driven load-ratio engine + operator surface (/capacity/*) +
 * partner pull API (/v1/capacity*) + outbound signed webhooks.
 *
 * WebhookSecretCipher is provided here as well as in PublicApiModule — it
 * is a stateless AES helper keyed from config; a second instance is
 * cheaper than importing the whole public-api surface for it.
 * DispatchEventsService and REDIS_CLIENT are global providers.
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module.js';
import { WebhookSecretCipher } from '../public-api/crypto/webhook-secret-cipher.service.js';
import { CapacityAdapterRegistry } from './adapters/capacity-adapter.registry.js';
import { GenericWebhookAdapter } from './adapters/generic-webhook.adapter.js';
import {
  AgeroCapacityStubAdapter,
  NsdCapacityStubAdapter,
  UrgentlyCapacityStubAdapter,
} from './adapters/network-stubs.js';
import { CapacityBroadcastService } from './capacity-broadcast.service.js';
import { CapacityBroadcastWorker } from './capacity-broadcast.worker.js';
import { CapacityComputeService } from './capacity-compute.service.js';
import { CapacityEventsListener } from './capacity-events.listener.js';
import { CapacityPartnersService } from './capacity-partners.service.js';
import { CapacityController } from './capacity.controller.js';
import { CapacityCron } from './capacity.cron.js';
import { CapacityService } from './capacity.service.js';
import { CapacityPartnerKeyGuard } from './pull/capacity-partner-key.guard.js';
import { CapacityPullController } from './pull/capacity-pull.controller.js';

@Module({
  imports: [DatabaseModule, ScheduleModule.forRoot()],
  controllers: [CapacityController, CapacityPullController],
  providers: [
    CapacityComputeService,
    CapacityEventsListener,
    CapacityBroadcastService,
    CapacityBroadcastWorker,
    CapacityService,
    CapacityPartnersService,
    CapacityCron,
    CapacityPartnerKeyGuard,
    WebhookSecretCipher,
    GenericWebhookAdapter,
    AgeroCapacityStubAdapter,
    NsdCapacityStubAdapter,
    UrgentlyCapacityStubAdapter,
    CapacityAdapterRegistry,
  ],
  exports: [CapacityComputeService, CapacityEventsListener],
})
export class CapacityModule {}
