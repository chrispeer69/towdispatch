/**
 * SmsAdapter — Twilio.
 *
 * Re-uses the existing IntegrationRegistry-backed NotificationService for
 * the actual HTTP call so this module doesn't duplicate the Twilio client.
 * Live when twilio creds are configured; falls back to the stub provider
 * otherwise. Status callbacks land on the existing tracking-webhook path,
 * which is forwarded into delivery-tracking by the DeliveryTrackingService.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../../config/config.service.js';
import { NotificationService as TwilioBackedService } from '../../../integrations/notification/notification.service.js';
import type {
  ChannelAdapter,
  ChannelSendInput,
  ChannelSendResult,
} from './channel-adapter.interface.js';

@Injectable()
export class SmsAdapter implements ChannelAdapter {
  readonly channel = 'sms' as const;
  readonly providerName = 'twilio';

  constructor(
    private readonly config: ConfigService,
    private readonly twilio: TwilioBackedService,
  ) {}

  get isLive(): boolean {
    return this.config.notification.twilioConfigured;
  }

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    if (!input.targetAddress) {
      return {
        status: 'failed',
        providerMessageId: null,
        providerName: this.providerName,
        error: 'missing recipient phone',
        permanent: true,
      };
    }
    const res = await this.twilio.sendSms({
      tenantId: input.tenantId,
      to: input.targetAddress,
      body: input.renderedBody,
      clientReference: input.idempotencyKey ?? input.deliveryId,
    });
    if (res.status === 'failed') {
      return {
        status: 'failed',
        providerMessageId: res.externalId || null,
        providerName: this.providerName,
        error: res.error ?? 'twilio failed',
      };
    }
    return {
      status: res.status === 'delivered' ? 'delivered' : 'sent',
      providerMessageId: res.externalId || null,
      providerName: this.providerName,
    };
  }
}
