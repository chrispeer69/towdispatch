/**
 * NotificationProvider — outbound SMS, email, and push.
 *
 * Channel is part of the input rather than per-provider type because most
 * vendors (Twilio, AWS SNS, SendGrid) cover overlapping channels. A tenant
 * may have one provider for SMS and a different one for email; the registry
 * resolves by category + provider id, and the consumer picks the channel.
 */
import type { IntegrationProvider } from '../types.js';

export type NotificationChannel = 'sms' | 'email' | 'push' | 'voice';

export interface NotificationCredentials {
  config: Record<string, unknown>;
}

export interface SendNotificationInput {
  channel: NotificationChannel;
  to: string;
  /** Optional templated id; falls back to body if not supported. */
  templateId?: string;
  templateData?: Record<string, unknown>;
  body?: string;
  subject?: string;
  /** Idempotency key. Provider should dedupe within a sensible window. */
  clientReference?: string;
}

export interface NotificationResult {
  externalId: string;
  channel: NotificationChannel;
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  error?: string;
}

export interface NotificationProvider extends IntegrationProvider {
  readonly supportedChannels: readonly NotificationChannel[];
  send(creds: NotificationCredentials, input: SendNotificationInput): Promise<NotificationResult>;
  getStatus(creds: NotificationCredentials, externalId: string): Promise<NotificationResult | null>;
}
