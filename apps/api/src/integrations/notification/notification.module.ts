/**
 * NotificationModule — boots the appropriate provider on startup.
 *
 * Selection is environment-driven:
 *   - If TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_PHONE are
 *     all set, register Twilio AND the stub.
 *   - Otherwise register the stub only. Dev / test paths land here.
 *
 * The NotificationService consumer reads the active provider id off
 * ConfigService.notification.activeProviderId (defaults to 'stub') and
 * resolves through the registry. A tenant-scoped credential override is a
 * Phase 2 concern; today the platform-wide creds are used.
 */
import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../../config/config.service.js';
import { IntegrationRegistry } from '../types.js';
import { NotificationService } from './notification.service.js';
import { PushMockController, PushMockService } from './push-mock.service.js';
import { StubNotificationProvider } from './stub.notification-provider.js';
import { TwilioNotificationProvider } from './twilio.notification-provider.js';

@Global()
@Module({
  controllers: [PushMockController],
  providers: [
    StubNotificationProvider,
    TwilioNotificationProvider,
    NotificationService,
    PushMockService,
  ],
  exports: [NotificationService, StubNotificationProvider, PushMockService],
})
export class NotificationModule implements OnModuleInit {
  constructor(
    private readonly registry: IntegrationRegistry,
    private readonly stub: StubNotificationProvider,
    private readonly twilio: TwilioNotificationProvider,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.registry.has('notification', this.stub.descriptor.id)) {
      this.registry.register('notification', this.stub);
    }
    if (this.config.notification.twilioConfigured) {
      if (!this.registry.has('notification', this.twilio.descriptor.id)) {
        this.registry.register('notification', this.twilio);
      }
    }
  }
}
