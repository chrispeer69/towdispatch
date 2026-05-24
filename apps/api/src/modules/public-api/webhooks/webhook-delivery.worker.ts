/**
 * WebhookDeliveryWorker — performs the actual HTTP delivery + retry
 * bookkeeping for webhook_deliveries rows. Cron-driven for the background
 * sweep; also called directly by the management controller for explicit
 * test-send / retry actions.
 *
 * A row is claimed (status pending -> delivering) in one short transaction,
 * the POST happens OUTSIDE any DB transaction (never hold a connection across
 * the network), and the outcome is written in a second transaction. Backoff
 * is the fixed ladder in webhook-retry.logic.ts.
 */
import { Injectable, Logger } from '@nestjs/common';
import { webhookDeliveries, webhookEndpoints } from '@ustowdispatch/db';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { TransactionRunner } from '../../../database/transaction-runner.service.js';
import { WebhookSecretCipher } from '../crypto/webhook-secret-cipher.service.js';
import {
  DELIVERY_ID_HEADER,
  EVENT_TYPE_HEADER,
  SIGNATURE_HEADER,
  buildSignatureHeader,
} from '../crypto/webhook-signature.js';
import { isSuccessStatus, planRetry } from './webhook-retry.logic.js';

export interface SweepResult {
  claimed: number;
  delivered: number;
  failed: number;
  retried: number;
}

const BATCH_SIZE = 100;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BODY = 2000;

interface PostResult {
  status: number | null;
  body: string | null;
  error: string | null;
}

@Injectable()
export class WebhookDeliveryWorker {
  private readonly log = new Logger(WebhookDeliveryWorker.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly cipher: WebhookSecretCipher,
  ) {}

  /** Deliver every due (pending, next_retry_at <= now) delivery. */
  async sweep(now: Date = new Date()): Promise<SweepResult> {
    const result: SweepResult = { claimed: 0, delivered: 0, failed: 0, retried: 0 };
    const due = await this.admin.runAsAdmin({}, async (db) =>
      db.query.webhookDeliveries.findMany({
        where: and(
          eq(webhookDeliveries.status, 'pending'),
          isNull(webhookDeliveries.deletedAt),
          lte(webhookDeliveries.nextRetryAt, now),
        ),
        orderBy: [asc(webhookDeliveries.nextRetryAt)],
        columns: { id: true },
        limit: BATCH_SIZE,
      }),
    );

    for (const { id } of due) {
      try {
        const outcome = await this.attempt(id, now);
        if (outcome === 'delivered') result.delivered += 1;
        else if (outcome === 'failed') result.failed += 1;
        else if (outcome === 'retry') result.retried += 1;
        if (outcome !== 'skipped') result.claimed += 1;
      } catch (err) {
        this.log.error({ msg: 'webhook delivery attempt threw', deliveryId: id, err: String(err) });
      }
    }
    this.log.log({ msg: 'webhook delivery sweep', ...result });
    return result;
  }

  /**
   * Force a single delivery to be due and attempt it now. Used by the manual
   * retry button — always performs one POST regardless of prior exhaustion.
   */
  async retryNow(deliveryId: string, now: Date = new Date()): Promise<void> {
    await this.admin.runAsAdmin({}, async (db) => {
      await db
        .update(webhookDeliveries)
        .set({ status: 'pending', nextRetryAt: now, updatedAt: now })
        .where(and(eq(webhookDeliveries.id, deliveryId), isNull(webhookDeliveries.deletedAt)));
    });
    await this.attempt(deliveryId, now);
  }

  /**
   * Claim + deliver one row. Returns the outcome so the sweep can tally.
   * 'skipped' means another worker already claimed it.
   */
  async attempt(
    deliveryId: string,
    now: Date = new Date(),
  ): Promise<'delivered' | 'retry' | 'failed' | 'skipped'> {
    // Atomic claim: only one worker flips pending -> delivering.
    const claimed = await this.admin.runAsAdmin({}, async (db) => {
      const [row] = await db
        .update(webhookDeliveries)
        .set({ status: 'delivering', updatedAt: now })
        .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.status, 'pending')))
        .returning();
      return row ?? null;
    });
    if (!claimed) return 'skipped';

    const endpoint = await this.admin.runAsAdmin({}, async (db) =>
      db.query.webhookEndpoints.findFirst({
        where: and(eq(webhookEndpoints.id, claimed.endpointId), isNull(webhookEndpoints.deletedAt)),
      }),
    );

    const attemptNo = claimed.attempt + 1;

    if (!endpoint) {
      await this.finalize(deliveryId, {
        status: 'failed',
        attempt: attemptNo,
        nextRetryAt: null,
        responseCode: null,
        responseBody: null,
        lastError: 'endpoint no longer exists',
        deliveredAt: null,
        now,
      });
      return 'failed';
    }

    const secret = this.cipher.decrypt(endpoint.secretEncrypted);
    const rawBody = JSON.stringify(claimed.payload);
    const post = await this.post(endpoint.url, rawBody, secret, claimed.id, claimed.eventType, now);

    if (isSuccessStatus(post.status)) {
      await this.finalize(deliveryId, {
        status: 'delivered',
        attempt: attemptNo,
        nextRetryAt: null,
        responseCode: post.status,
        responseBody: post.body,
        lastError: null,
        deliveredAt: now,
        now,
      });
      await this.stampEndpoint(endpoint.id, 'success', now);
      return 'delivered';
    }

    const decision = planRetry(attemptNo, claimed.maxAttempts, now);
    await this.finalize(deliveryId, {
      status: decision.exhausted ? 'failed' : 'pending',
      attempt: attemptNo,
      nextRetryAt: decision.nextRetryAt,
      responseCode: post.status,
      responseBody: post.body,
      lastError: post.error ?? (post.status !== null ? `HTTP ${post.status}` : 'no response'),
      deliveredAt: null,
      now,
    });
    await this.stampEndpoint(endpoint.id, 'failure', now);
    return decision.exhausted ? 'failed' : 'retry';
  }

  private async post(
    url: string,
    rawBody: string,
    secret: string,
    deliveryId: string,
    eventType: string,
    now: Date,
  ): Promise<PostResult> {
    const ts = Math.floor(now.getTime() / 1000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: buildSignatureHeader(secret, rawBody, ts),
          [DELIVERY_ID_HEADER]: deliveryId,
          [EVENT_TYPE_HEADER]: eventType,
        },
        body: rawBody,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = (await res.text().catch(() => '')).slice(0, MAX_RESPONSE_BODY);
      return { status: res.status, body: text, error: null };
    } catch (err) {
      return { status: null, body: null, error: String(err).slice(0, MAX_RESPONSE_BODY) };
    }
  }

  private async finalize(
    deliveryId: string,
    patch: {
      status: 'pending' | 'delivered' | 'failed';
      attempt: number;
      nextRetryAt: Date | null;
      responseCode: number | null;
      responseBody: string | null;
      lastError: string | null;
      deliveredAt: Date | null;
      now: Date;
    },
  ): Promise<void> {
    await this.admin.runAsAdmin({}, async (db) => {
      await db
        .update(webhookDeliveries)
        .set({
          status: patch.status,
          attempt: patch.attempt,
          nextRetryAt: patch.nextRetryAt,
          responseCode: patch.responseCode,
          responseBody: patch.responseBody,
          lastError: patch.lastError,
          deliveredAt: patch.deliveredAt,
          updatedAt: patch.now,
        })
        .where(eq(webhookDeliveries.id, deliveryId));
    });
  }

  private async stampEndpoint(
    endpointId: string,
    kind: 'success' | 'failure',
    now: Date,
  ): Promise<void> {
    await this.admin.runAsAdmin({}, async (db) => {
      await db
        .update(webhookEndpoints)
        .set(kind === 'success' ? { lastSuccessAt: now } : { lastFailureAt: now })
        .where(eq(webhookEndpoints.id, endpointId));
    });
  }
}
