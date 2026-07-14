/**
 * CapacityBroadcastWorker — HTTP delivery + retry bookkeeping for
 * capacity_broadcasts rows. Mirrors WebhookDeliveryWorker: lease the row in
 * one short transaction, POST outside any transaction, record the outcome
 * in a second one. Backoff reuses the public-api retry ladder
 * (1m/5m/30m/2h/12h, max 5 attempts) then the row goes 'dead_letter'.
 *
 * The lease: statuses here are pending|delivered|failed|dead_letter (no
 * 'delivering'), so a claim pushes next_retry_at forward by a lease window
 * inside `UPDATE ... WHERE status='pending' AND next_retry_at <= now`.
 * A competing worker's identical UPDATE matches zero rows.
 *
 * Signing matches the public-api webhooks exactly (partners verify all our
 * webhooks one way): X-TowCommand-Signature: t=<unix>,v1=HMAC-SHA256(secret,
 * `${t}.${rawBody}`), plus X-TowCommand-Delivery-Id as the per-delivery
 * nonce. The outbound URL is re-validated against private ranges on every
 * attempt (DNS rebinding).
 */
import { Injectable, Logger } from '@nestjs/common';
import { capacityBroadcasts, capacityPartners } from '@ustowdispatch/db';
import type { CapacityPayload } from '@ustowdispatch/shared';
import { DISPATCH_EVENTS } from '@ustowdispatch/shared';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { ConfigService } from '../../config/config.service.js';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { WebhookSecretCipher } from '../public-api/crypto/webhook-secret-cipher.service.js';
import {
  DELIVERY_ID_HEADER,
  EVENT_TYPE_HEADER,
  SIGNATURE_HEADER,
  buildSignatureHeader,
} from '../public-api/crypto/webhook-signature.js';
import { isSuccessStatus, planRetry } from '../public-api/webhooks/webhook-retry.logic.js';
import { CapacityAdapterRegistry } from './adapters/capacity-adapter.registry.js';
import { urlProblem } from './webhook-url.guard.js';

const BATCH_SIZE = 100;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ERROR_LEN = 2000;
const MAX_ATTEMPTS = 5;
/** Lease window while a POST is in flight. */
const CLAIM_LEASE_SECONDS = 120;

export interface BroadcastAttemptOutcome {
  delivered: boolean;
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
}

export interface BroadcastSweepResult {
  claimed: number;
  delivered: number;
  retried: number;
  deadLettered: number;
}

@Injectable()
export class CapacityBroadcastWorker {
  private readonly log = new Logger(CapacityBroadcastWorker.name);

  constructor(
    private readonly admin: TransactionRunner,
    private readonly cipher: WebhookSecretCipher,
    private readonly adapters: CapacityAdapterRegistry,
    private readonly config: ConfigService,
  ) {}

  /** Deliver every due pending broadcast (cron sweep). */
  async sweep(now: Date = new Date()): Promise<BroadcastSweepResult> {
    const result: BroadcastSweepResult = { claimed: 0, delivered: 0, retried: 0, deadLettered: 0 };
    const due = await this.admin.runAsAdmin({}, async (db) =>
      db.query.capacityBroadcasts.findMany({
        where: and(
          eq(capacityBroadcasts.status, 'pending'),
          isNull(capacityBroadcasts.deletedAt),
          lte(capacityBroadcasts.nextRetryAt, now),
        ),
        orderBy: [asc(capacityBroadcasts.nextRetryAt)],
        columns: { id: true },
        limit: BATCH_SIZE,
      }),
    );
    for (const { id } of due) {
      try {
        const outcome = await this.attempt(id, { now });
        if (outcome.skipped) continue;
        result.claimed += 1;
        if (outcome.delivered) result.delivered += 1;
        else if (outcome.terminal) result.deadLettered += 1;
        else result.retried += 1;
      } catch (err) {
        this.log.error({ msg: 'broadcast attempt threw', broadcastId: id, err: String(err) });
      }
    }
    if (result.claimed > 0) this.log.log({ msg: 'capacity broadcast sweep', ...result });
    return result;
  }

  /**
   * Claim + deliver one broadcast. singleShot (test-fire) never retries:
   * failure is terminal 'failed'.
   */
  async attempt(
    broadcastId: string,
    opts: { singleShot?: boolean; now?: Date } = {},
  ): Promise<BroadcastAttemptOutcome & { skipped?: boolean; terminal?: boolean }> {
    const now = opts.now ?? new Date();

    // Lease: push next_retry_at forward so a concurrent claimer misses.
    const claimed = await this.admin.runAsAdmin({}, async (db) => {
      const [row] = await db
        .update(capacityBroadcasts)
        .set({
          nextRetryAt: new Date(now.getTime() + CLAIM_LEASE_SECONDS * 1000),
          updatedAt: now,
        })
        .where(
          and(
            eq(capacityBroadcasts.id, broadcastId),
            eq(capacityBroadcasts.status, 'pending'),
            lte(capacityBroadcasts.nextRetryAt, now),
            isNull(capacityBroadcasts.deletedAt),
          ),
        )
        .returning();
      return row ?? null;
    });
    if (!claimed) {
      return { skipped: true, delivered: false, httpStatus: null, latencyMs: null, error: null };
    }

    const partner = await this.admin.runAsAdmin({}, async (db) =>
      db.query.capacityPartners.findFirst({
        where: and(eq(capacityPartners.id, claimed.partnerId), isNull(capacityPartners.deletedAt)),
      }),
    );

    const attemptNo = claimed.retryCount + 1;
    if (!partner || !partner.enabled || !partner.webhookUrl || !partner.webhookSecretEncrypted) {
      await this.finalize(broadcastId, {
        status: 'failed',
        retryCount: attemptNo,
        nextRetryAt: null,
        httpStatus: null,
        latencyMs: null,
        lastError: 'partner missing, disabled, or has no webhook configured',
        deliveredAt: null,
        now,
      });
      return {
        delivered: false,
        terminal: true,
        httpStatus: null,
        latencyMs: null,
        error: 'partner unavailable',
      };
    }

    // SSRF re-check on every attempt (DNS can change under us).
    const problem = await urlProblem(partner.webhookUrl, {
      allowLoopback: this.config.nodeEnv !== 'production',
    });
    if (problem) {
      await this.finalize(broadcastId, {
        status: 'failed',
        retryCount: attemptNo,
        nextRetryAt: null,
        httpStatus: null,
        latencyMs: null,
        lastError: `webhook URL rejected: ${problem}`,
        deliveredAt: null,
        now,
      });
      return {
        delivered: false,
        terminal: true,
        httpStatus: null,
        latencyMs: null,
        error: problem,
      };
    }

    const adapter = this.adapters.resolve(partner.networkCode);
    const request = adapter.buildRequest(claimed.payload as CapacityPayload);
    const secret = this.cipher.decrypt(partner.webhookSecretEncrypted);
    const ts = Math.floor(now.getTime() / 1000);

    const started = Date.now();
    let httpStatus: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(partner.webhookUrl, {
        method: 'POST',
        headers: {
          ...request.headers,
          [SIGNATURE_HEADER]: buildSignatureHeader(secret, request.rawBody, ts),
          [DELIVERY_ID_HEADER]: claimed.id,
          [EVENT_TYPE_HEADER]: DISPATCH_EVENTS.CAPACITY_STATUS_CHANGED,
        },
        body: request.rawBody,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      httpStatus = res.status;
      await res.arrayBuffer().catch(() => undefined); // drain
    } catch (err) {
      error = String(err).slice(0, MAX_ERROR_LEN);
    }
    const latencyMs = Date.now() - started;

    if (isSuccessStatus(httpStatus)) {
      await this.finalize(broadcastId, {
        status: 'delivered',
        retryCount: attemptNo,
        nextRetryAt: null,
        httpStatus,
        latencyMs,
        lastError: null,
        deliveredAt: now,
        now,
      });
      await this.admin.runAsAdmin({}, async (db) => {
        await db
          .update(capacityPartners)
          .set({ lastBroadcastAt: now, updatedAt: now })
          .where(eq(capacityPartners.id, partner.id));
      });
      return { delivered: true, httpStatus, latencyMs, error: null };
    }

    const failureText = error ?? (httpStatus !== null ? `HTTP ${httpStatus}` : 'no response');
    if (opts.singleShot) {
      await this.finalize(broadcastId, {
        status: 'failed',
        retryCount: attemptNo,
        nextRetryAt: null,
        httpStatus,
        latencyMs,
        lastError: failureText,
        deliveredAt: null,
        now,
      });
      return { delivered: false, terminal: true, httpStatus, latencyMs, error: failureText };
    }

    const decision = planRetry(attemptNo, MAX_ATTEMPTS, now);
    await this.finalize(broadcastId, {
      status: decision.exhausted ? 'dead_letter' : 'pending',
      retryCount: attemptNo,
      nextRetryAt: decision.nextRetryAt,
      httpStatus,
      latencyMs,
      lastError: failureText,
      deliveredAt: null,
      now,
    });
    return {
      delivered: false,
      terminal: decision.exhausted,
      httpStatus,
      latencyMs,
      error: failureText,
    };
  }

  private async finalize(
    broadcastId: string,
    patch: {
      status: 'pending' | 'delivered' | 'failed' | 'dead_letter';
      retryCount: number;
      nextRetryAt: Date | null;
      httpStatus: number | null;
      latencyMs: number | null;
      lastError: string | null;
      deliveredAt: Date | null;
      now: Date;
    },
  ): Promise<void> {
    await this.admin.runAsAdmin({}, async (db) => {
      await db
        .update(capacityBroadcasts)
        .set({
          status: patch.status,
          retryCount: patch.retryCount,
          nextRetryAt: patch.nextRetryAt,
          httpStatus: patch.httpStatus,
          latencyMs: patch.latencyMs,
          lastError: patch.lastError,
          deliveredAt: patch.deliveredAt,
          updatedAt: patch.now,
        })
        .where(eq(capacityBroadcasts.id, broadcastId));
    });
  }
}
