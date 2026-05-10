/**
 * NotificationService — the consumer-facing SMS/email send surface.
 *
 * Sits between the tracking module and the IntegrationRegistry so callers
 * don't reach for provider ids by hand. The active provider id is read from
 * ConfigService at call time (cheap; the registry handles the indirection).
 *
 * Tenant-scoped overrides (per-tenant Twilio credentials, per-tenant sender
 * number) are Phase 2 — this service threads the tenantId through but
 * currently uses platform-wide creds. The shape of the API does not need to
 * change when overrides land.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../config/config.service.js';
import { IntegrationRegistry } from '../types.js';
import type {
  NotificationCredentials,
  NotificationProvider,
  NotificationResult,
  SendNotificationInput,
} from './notification-provider.interface.js';

export interface SendSmsInput {
  tenantId: string;
  to: string;
  body: string;
  /** Used for idempotency / tracing. */
  clientReference?: string;
}

@Injectable()
export class NotificationService {
  private readonly log = new Logger(NotificationService.name);

  constructor(
    private readonly registry: IntegrationRegistry,
    private readonly config: ConfigService,
  ) {}

  activeProviderId(): string {
    return this.config.notification.activeProviderId;
  }

  async sendSms(input: SendSmsInput): Promise<NotificationResult> {
    const providerId = this.activeProviderId();
    const provider = this.registry.get<NotificationProvider>('notification', providerId);
    const creds = this.platformCreds(providerId);
    const send: SendNotificationInput = {
      channel: 'sms',
      to: input.to,
      body: input.body,
      ...(input.clientReference ? { clientReference: input.clientReference } : {}),
    };
    try {
      const result = await provider.send(creds, send);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.log.warn(`SMS send failed via ${providerId}: ${msg}`);
      return { externalId: '', channel: 'sms', status: 'failed', error: msg };
    }
  }

  async getStatus(providerId: string, externalId: string): Promise<NotificationResult | null> {
    const provider = this.registry.get<NotificationProvider>('notification', providerId);
    return provider.getStatus(this.platformCreds(providerId), externalId);
  }

  private platformCreds(providerId: string): NotificationCredentials {
    if (providerId === 'twilio') {
      const t = this.config.notification.twilio;
      return {
        config: {
          accountSid: t.accountSid,
          authToken: t.authToken,
          fromPhone: t.fromPhone,
        },
      };
    }
    return { config: {} };
  }
}
