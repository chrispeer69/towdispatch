/**
 * NotificationsModule — Session 15. Wires the dispatcher, channel adapters,
 * queue/worker, provider webhooks, preferences, templates, webhook
 * subscriptions, dead-letter sweep, and in-app feed.
 *
 * Channel adapter registration: the CHANNEL_ADAPTERS token is bound to an
 * array of every adapter class so the dispatcher can fan out by channel
 * without N constructor parameters. The factory keeps ordering stable so
 * `adapters.find(c => c.channel === 'push')` is O(N) over a small N.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '../../config/config.service.js';
import { EmailAdapter } from './channels/email.adapter.js';
import { InAppAdapter } from './channels/in-app.adapter.js';
import { PushAdapter } from './channels/push.adapter.js';
import { SmsAdapter } from './channels/sms.adapter.js';
import { WebhookAdapter } from './channels/webhook.adapter.js';
import { DeadLettersService } from './dead-letters.service.js';
import { DeliveryMetricsService } from './delivery-tracking/delivery-metrics.service.js';
import { DeliveryTrackingService } from './delivery-tracking/delivery-tracking.service.js';
import { ProviderWebhooksController } from './delivery-tracking/provider-webhooks.controller.js';
import { DeviceTokensService } from './device-tokens.service.js';
import { NotificationFeedService } from './notification-feed.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { CHANNEL_ADAPTERS } from './notifications.tokens.js';
import { PreferencesResolverService } from './preferences/preferences-resolver.service.js';
import { PreferencesService } from './preferences/preferences.service.js';
import { TemplateLoaderService } from './templates/template-loader.service.js';
import { TemplatesAdminService } from './templates/templates-admin.service.js';
import { WebhookSecretService } from './webhooks/webhook-secret.service.js';
import { WebhookSubscriptionsService } from './webhooks/webhook-subscriptions.service.js';
import { NotificationsQueueService } from './workers/notifications-queue.service.js';
import { NotificationsWorkersService } from './workers/notifications-workers.service.js';

@Module({
  controllers: [NotificationsController, ProviderWebhooksController],
  providers: [
    NotificationsService,
    NotificationFeedService,
    PreferencesService,
    PreferencesResolverService,
    TemplateLoaderService,
    TemplatesAdminService,
    WebhookSecretService,
    WebhookSubscriptionsService,
    DeadLettersService,
    DeliveryTrackingService,
    DeliveryMetricsService,
    DeviceTokensService,
    NotificationsQueueService,
    NotificationsWorkersService,
    // Channel adapters
    EmailAdapter,
    SmsAdapter,
    PushAdapter,
    InAppAdapter,
    WebhookAdapter,
    {
      provide: CHANNEL_ADAPTERS,
      useFactory: (
        email: EmailAdapter,
        sms: SmsAdapter,
        push: PushAdapter,
        inApp: InAppAdapter,
        webhook: WebhookAdapter,
      ) => [push, sms, email, inApp, webhook],
      inject: [EmailAdapter, SmsAdapter, PushAdapter, InAppAdapter, WebhookAdapter],
    },
  ],
  exports: [NotificationsService, DeliveryTrackingService],
})
export class NotificationsModule {}
