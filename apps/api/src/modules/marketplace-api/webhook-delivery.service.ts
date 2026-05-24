/**
 * WebhookDeliveryService (Session 46) — records every app-lifecycle event in
 * marketplace_app_events AND best-effort delivers it to the app's registered
 * webhook URL.
 *
 * Self-contained because no shared outbound-webhook subsystem exists on master
 * (S29's public API is not merged). When that lands this should consolidate
 * onto it — see SESSION_46_DECISIONS.md. Until then:
 *   • The event row is ALWAYS written (the durable record / audit trail).
 *   • The HTTP POST is gated behind MARKETPLACE_WEBHOOK_DELIVERY_ENABLED so
 *     CI/dev make no network calls; failures never propagate to the caller
 *     (an install must not fail because a webhook endpoint is down).
 *   • Delivery is signed (HMAC-SHA256 over the raw body, keyed by the app's
 *     webhook_secret) and idempotency-keyed by the event id.
 */
import { Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from '@ustowdispatch/db';
import type { MarketplaceEventType } from '@ustowdispatch/shared';
import { ConfigService } from '../../config/config.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { signWebhookBody } from './marketplace-tokens.util.js';

export interface EmitEventParams {
  tenantId: string;
  appId: string;
  installId: string | null;
  eventType: MarketplaceEventType;
  payload: Record<string, unknown>;
  /** Target + signing material, when the caller already loaded the app row. */
  webhookUrl: string | null;
  webhookSecret: string | null;
  /** Operator/system actor for the audit trail; null for app-driven writes. */
  actorUserId: string | null;
}

const DELIVERY_TIMEOUT_MS = 5_000;

@Injectable()
export class WebhookDeliveryService {
  private readonly log = new Logger(WebhookDeliveryService.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly config: ConfigService,
  ) {}

  /**
   * Records the event (durable) and fires delivery (best-effort, fire-and-
   * forget). Returns the event id. Never throws on a delivery failure.
   */
  async emit(params: EmitEventParams): Promise<string> {
    const eventId = uuidv7();
    const body = {
      id: eventId,
      type: params.eventType,
      appId: params.appId,
      tenantId: params.tenantId,
      installId: params.installId,
      occurredAt: new Date().toISOString(),
      data: params.payload,
    };

    await this.admin.runAsAdmin(
      params.actorUserId ? { actorUserId: params.actorUserId } : {},
      async (_db, client) => {
        await client.query(
          `INSERT INTO marketplace_app_events
             (id, tenant_id, app_id, install_id, event_type, occurred_at, payload)
           VALUES ($1, $2, $3, $4, $5, now(), $6::jsonb)`,
          [
            eventId,
            params.tenantId,
            params.appId,
            params.installId,
            params.eventType,
            JSON.stringify(params.payload),
          ],
        );
      },
    );

    if (
      this.config.marketplaceWebhookDeliveryEnabled &&
      params.webhookUrl &&
      params.webhookSecret
    ) {
      // Fire-and-forget; deliberately not awaited into the caller's latency.
      void this.deliver(params.webhookUrl, params.webhookSecret, body);
    }
    return eventId;
  }

  private async deliver(
    url: string,
    secret: string,
    body: { id: string; type: string; [k: string]: unknown },
  ): Promise<void> {
    const raw = JSON.stringify(body);
    const signature = signWebhookBody(secret, raw);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ustow-event': body.type,
          'x-ustow-event-id': body.id,
          'x-ustow-signature': `sha256=${signature}`,
        },
        body: raw,
        signal: controller.signal,
      });
      if (!res.ok) {
        this.log.warn(`webhook delivery to app returned HTTP ${res.status} (event ${body.id})`);
      }
    } catch (err) {
      // Network error / timeout: record nothing sensitive, never rethrow.
      this.log.warn(
        `webhook delivery failed for event ${body.id}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
