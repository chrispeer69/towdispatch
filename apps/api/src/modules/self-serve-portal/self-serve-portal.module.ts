import { Module } from '@nestjs/common';
import { NotificationModule } from '../../integrations/notification/notification.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { SelfServePortalController } from './self-serve-portal.controller.js';
import { SelfServePortalService } from './self-serve-portal.service.js';

/**
 * Customer Self-Serve Portal (Session 55) — account-less, per-impound vehicle
 * lookup + ID self-attestation + Stripe pay + release initiation. Depends on
 * PaymentsModule (PAYMENT_PROVIDER), RedisModule (rate limiter) and
 * NotificationModule (SMS); DatabaseModule + ConfigModule are global. The
 * Stripe webhook → release-intent handoff lives in PaymentsService behind a
 * metadata.kind === 'self_serve_portal' branch (no circular dependency).
 */
@Module({
  imports: [PaymentsModule, RedisModule, NotificationModule],
  controllers: [SelfServePortalController],
  providers: [SelfServePortalService],
  exports: [SelfServePortalService],
})
export class SelfServePortalModule {}
