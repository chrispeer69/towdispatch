/**
 * PublicApiModule — the tenant-facing programmable surface (Session 29).
 *
 * Three cooperating surfaces:
 *   - /v1 consumer REST API (API-key auth via ApiKeyGuard + ScopeGuard)
 *   - operator management (session auth) for keys + webhook endpoints
 *   - webhook publisher (subscribes to DispatchEventsService) + delivery cron
 *
 * JobsModule is imported so /v1 writes delegate to JobsService (state machine
 * + domain-event emission). DispatchEventsService is global, so the publisher
 * injects it without importing the dispatch module. ScheduleModule.forRoot()
 * is idempotent across modules.
 */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { ApiKeyAuthService } from './auth/api-key-auth.service.js';
import { ApiKeyGuard } from './auth/api-key.guard.js';
import { ScopeGuard } from './auth/scopes.guard.js';
import { WebhookSecretCipher } from './crypto/webhook-secret-cipher.service.js';
import { ApiKeysService } from './management/public-api-keys.service.js';
import { PublicApiManagementController } from './management/public-api-management.controller.js';
import { WebhooksService } from './management/webhooks.service.js';
import { IdempotencyService } from './v1/idempotency.service.js';
import { PublicV1Controller } from './v1/public-v1.controller.js';
import { PublicV1Service } from './v1/public-v1.service.js';
import { WebhookDeliveryCron } from './webhooks/webhook-delivery.cron.js';
import { WebhookDeliveryWorker } from './webhooks/webhook-delivery.worker.js';
import { WebhookPublisher } from './webhooks/webhook-publisher.service.js';

@Module({
  imports: [DatabaseModule, ScheduleModule.forRoot(), JobsModule],
  controllers: [PublicV1Controller, PublicApiManagementController],
  providers: [
    ApiKeyAuthService,
    ApiKeyGuard,
    ScopeGuard,
    PublicV1Service,
    IdempotencyService,
    ApiKeysService,
    WebhooksService,
    WebhookSecretCipher,
    WebhookPublisher,
    WebhookDeliveryWorker,
    WebhookDeliveryCron,
  ],
  exports: [WebhookPublisher, WebhookDeliveryWorker],
})
export class PublicApiModule {}
