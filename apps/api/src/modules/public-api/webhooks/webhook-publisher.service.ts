/**
 * WebhookPublisher — bridges in-process domain events to webhook deliveries.
 *
 * Subscribes once (at boot) to the existing DispatchEventsService. When a
 * domain event whose name is in the webhook catalog fires, it fans out one
 * webhook_deliveries row per active endpoint subscribed to that event type.
 * The delivery cron does the actual HTTP work.
 *
 * Timing: the dispatch emit happens INSIDE the originating request's
 * transaction, before COMMIT. We defer the fan-out with setImmediate so the
 * caller's transaction commits first — otherwise a rolled-back write could
 * enqueue a delivery for a phantom resource. This makes publish best-effort
 * (at-most-once), not transactionally atomic with the domain write; a true
 * outbox is a v2 conversation (see SESSION_29_DECISIONS.md).
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { uuidv7, webhookDeliveries, webhookEndpoints } from '@ustowdispatch/db';
import { type WebhookEventType, webhookEventTypeValues } from '@ustowdispatch/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { TransactionRunner } from '../../../database/transaction-runner.service.js';
import {
  type DispatchEventPayload,
  DispatchEventsService,
} from '../../dispatch/dispatch-events.service.js';

const WEBHOOK_EVENT_SET = new Set<string>(webhookEventTypeValues);

@Injectable()
export class WebhookPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WebhookPublisher.name);
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly admin: TransactionRunner,
    private readonly dispatchEvents: DispatchEventsService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.dispatchEvents.subscribe((tenantId, event) => {
      if (!WEBHOOK_EVENT_SET.has(event.name)) return;
      // Defer past the originating transaction's COMMIT.
      setImmediate(() => {
        this.publish(tenantId, event).catch((err) => {
          this.log.error({
            msg: 'webhook publish failed',
            tenantId,
            event: event.name,
            err: String(err),
          });
        });
      });
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Enqueue a delivery per subscribed, active endpoint. Public so an
   * integration test can drive it synchronously.
   */
  async publish(tenantId: string, event: DispatchEventPayload): Promise<number> {
    const eventType = event.name as WebhookEventType;
    const data = event.payload as Record<string, unknown>;
    const now = new Date();

    return this.admin.runAsAdmin({}, async (db) => {
      const endpoints = await db.query.webhookEndpoints.findMany({
        where: and(
          eq(webhookEndpoints.tenantId, tenantId),
          eq(webhookEndpoints.active, true),
          isNull(webhookEndpoints.deletedAt),
          sql`${webhookEndpoints.events} @> ARRAY[${eventType}]::text[]`,
        ),
        columns: { id: true },
      });
      if (endpoints.length === 0) return 0;

      const eventId = extractEventId(data);
      const rows = endpoints.map((ep) => {
        const deliveryId = uuidv7();
        return {
          id: deliveryId,
          tenantId,
          endpointId: ep.id,
          eventType,
          eventId,
          payload: buildEnvelope(deliveryId, eventType, data, now),
          status: 'pending' as const,
          attempt: 0,
          nextRetryAt: now,
        };
      });
      await db.insert(webhookDeliveries).values(rows);
      return rows.length;
    });
  }
}

/** The stable on-the-wire envelope the consumer receives. */
function buildEnvelope(
  deliveryId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  now: Date,
): Record<string, unknown> {
  return {
    id: deliveryId,
    type: eventType,
    createdAt: now.toISOString(),
    data,
  };
}

function extractEventId(data: Record<string, unknown>): string | null {
  const job = data.job as { id?: unknown } | undefined;
  const candidate =
    (typeof job?.id === 'string' && job.id) ||
    (typeof data.jobId === 'string' && data.jobId) ||
    (typeof data.impoundRecordId === 'string' && data.impoundRecordId) ||
    null;
  return candidate || null;
}
