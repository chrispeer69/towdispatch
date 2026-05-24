/**
 * ChannelAdapter — the contract every outbound channel implementation honors.
 *
 * Adapters are deliberately dumb: receive a fully-resolved delivery row +
 * rendered template + target address, produce a result. The dispatcher owns
 * the retry policy, status transitions, and dead-letter routing.
 */
import type { NotificationChannel } from '@ustowdispatch/shared';

export interface ChannelSendInput {
  tenantId: string;
  notificationId: string;
  deliveryId: string;
  recipientUserId: string | null;
  targetAddress: string;
  /** Rendered subject (email title / push title) — may be null. */
  renderedSubject: string | null;
  /** Rendered body — channel-specific format. */
  renderedBody: string;
  /** Plain-text alternative — email only. */
  renderedBodyPlain: string | null;
  /** Original event payload — passed through for adapters that build data blocks. */
  payload: Record<string, unknown>;
  eventType: string;
  priority: 'emergency' | 'high' | 'normal' | 'low';
  /** Idempotency hint for upstream providers that honor it (SendGrid x-message-id). */
  idempotencyKey: string | null;
}

export interface ChannelSendResult {
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'bounced';
  providerMessageId: string | null;
  providerName: string;
  error?: string;
  /** When true, the dispatcher should NOT retry. Used when the recipient
   * address is bad / token is invalid — retrying will only burn API quota. */
  permanent?: boolean;
}

export interface ChannelAdapter {
  readonly channel: NotificationChannel;
  readonly providerName: string;
  /** Whether the adapter has real creds wired. False adapters use stubs. */
  readonly isLive: boolean;
  send(input: ChannelSendInput): Promise<ChannelSendResult>;
}
