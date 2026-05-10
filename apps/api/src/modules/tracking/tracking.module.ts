/**
 * TrackingModule — owns the tracking_links lifecycle, the public /track surface,
 * and the /track Socket.IO namespace.
 */
import { Module } from '@nestjs/common';
import { NotificationModule } from '../../integrations/notification/notification.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TrackingPublicController } from './tracking-public.controller.js';
import { TrackingRateLimitService } from './tracking-rate-limit.service.js';
import { TrackingWebhookController } from './tracking-webhook.controller.js';
import { TrackingController } from './tracking.controller.js';
import { TrackingGateway } from './tracking.gateway.js';
import { TrackingService } from './tracking.service.js';

@Module({
  imports: [AuthModule, NotificationModule],
  controllers: [TrackingController, TrackingPublicController, TrackingWebhookController],
  providers: [TrackingService, TrackingRateLimitService, TrackingGateway],
  exports: [TrackingService, TrackingGateway],
})
export class TrackingModule {}
