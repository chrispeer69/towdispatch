/**
 * WebhookAdapter — outbound, HMAC-SHA-256 signed webhooks.
 *
 * Differences from the other channels:
 *   * The "recipient" is a tenant-level webhook_subscriptions row, not a
 *     user. The dispatcher pre-resolves the row and stuffs the endpoint URL
 *     into targetAddress and the decrypted secret into payload.__webhookSecret.
 *   * The rendered body is the literal JSON we POST. We never wrap or escape
 *     it — the template fully owns the wire format.
 *
 * Signature header:
 *   X-TowCommand-Signature: sha256=<hex(hmac(secret, rawBody))>
 *   X-TowCommand-Event: <eventType>
 *   X-TowCommand-Delivery-Id: <delivery uuid>
 *   X-TowCommand-Timestamp: <unix seconds>
 *
 * Receivers should reject anything older than 5 minutes to defeat replays.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import type {
  ChannelAdapter,
  ChannelSendInput,
  ChannelSendResult,
} from './channel-adapter.interface.js';

const WEBHOOK_TIMEOUT_MS = 10_000;

@Injectable()
export class WebhookAdapter implements ChannelAdapter {
  readonly channel = 'webhook' as const;
  readonly providerName = 'webhook';
  readonly isLive = true;
  private readonly log = new Logger(WebhookAdapter.name);

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    if (!input.targetAddress) {
      return {
        status: 'failed',
        providerMessageId: null,
        providerName: this.providerName,
        error: 'missing endpoint url',
        permanent: true,
      };
    }
    const secret = (input.payload.__webhookSecret as string | undefined) ?? '';
    if (!secret) {
      return {
        status: 'failed',
        providerMessageId: null,
        providerName: this.providerName,
        error: 'webhook secret unavailable',
        permanent: true,
      };
    }
    const bodyJson = input.renderedBody;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${bodyJson}`)
      .digest('hex');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const res = await fetch(input.targetAddress, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TowCommand-Signature': `sha256=${signature}`,
          'X-TowCommand-Event': input.eventType,
          'X-TowCommand-Delivery-Id': input.deliveryId,
          'X-TowCommand-Timestamp': timestamp,
          'User-Agent': 'TowCommand-Webhook/1.0',
        },
        body: bodyJson,
        signal: controller.signal,
      });
      const responseText = await res.text().catch(() => '');
      // 2xx → success. 4xx (other than 408/429) → permanent. 5xx + timeouts → retry.
      if (res.status >= 200 && res.status < 300) {
        return {
          status: 'sent',
          providerMessageId: res.headers.get('x-request-id'),
          providerName: this.providerName,
        };
      }
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
      return {
        status: 'failed',
        providerMessageId: null,
        providerName: this.providerName,
        error: `webhook_http_${res.status}: ${responseText.slice(0, 240)}`,
        permanent,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'webhook unknown';
      return {
        status: 'failed',
        providerMessageId: null,
        providerName: this.providerName,
        error: reason,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Helper used by the WebhookSubscriptionsService when rotating a secret.
   * Generated server-side, hex(32 bytes) = 64 chars.
   */
  static generateSecret(): string {
    return randomBytes(32).toString('hex');
  }
}
