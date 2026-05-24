/**
 * NotificationsWorkersService — registers one BullMQ Worker per channel queue.
 *
 * Each worker:
 *   1. Pulls a QueueEnqueueRequest job
 *   2. Looks up the channel adapter
 *   3. Invokes adapter.send()
 *   4. Hands the result to NotificationsService.recordChannelResult — which
 *      persists the outcome, decides retry vs DLQ, and rolls up the parent.
 *   5. Throws if the dispatcher said to retry, so BullMQ schedules the next
 *      attempt using the configured backoff. Otherwise returns cleanly.
 *
 * Worker concurrency is read from ConfigService.notifications.concurrency.
 */
import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { ConfigService } from '../../../config/config.service.js';
import { REDIS_CLIENT } from '../../redis/redis.tokens.js';
import type { ChannelAdapter } from '../channels/channel-adapter.interface.js';
import type { NotificationChannel } from '@ustowdispatch/shared';
import { CHANNEL_ADAPTERS } from '../notifications.tokens.js';
import {
  NOTIFY_QUEUE_NAMES,
  NotificationsQueueService,
  type QueueEnqueueRequest,
} from './notifications-queue.service.js';
import { NotificationsService } from '../notifications.service.js';

@Injectable()
export class NotificationsWorkersService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(NotificationsWorkersService.name);
  private readonly workers: Worker[] = [];

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(CHANNEL_ADAPTERS) private readonly adapters: ChannelAdapter[],
    private readonly queues: NotificationsQueueService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const concurrency = this.config.notifications.concurrency;
    for (const channel of Object.keys(NOTIFY_QUEUE_NAMES) as NotificationChannel[]) {
      const queueName = NOTIFY_QUEUE_NAMES[channel];
      const conc =
        channel === 'in_app' ? concurrency.inApp : (concurrency as Record<string, number>)[channel] ?? 4;
      const worker = new Worker<QueueEnqueueRequest>(
        queueName,
        (job) => this.handle(channel, job),
        {
          connection: this.redis.duplicate({ maxRetriesPerRequest: null }),
          concurrency: conc,
        },
      );
      worker.on('failed', (job, err) => {
        this.log.warn(
          `worker ${queueName} job=${job?.id ?? '?'} attempt=${job?.attemptsMade ?? '?'} failed: ${err.message}`,
        );
      });
      this.workers.push(worker);
    }
    this.log.log(`registered ${this.workers.length} notification workers`);
  }

  private async handle(channel: NotificationChannel, job: Job<QueueEnqueueRequest>): Promise<void> {
    const data = job.data;
    const adapter = this.adapters.find((a) => a.channel === channel);
    if (!adapter) {
      throw new Error(`no adapter registered for channel=${channel}`);
    }
    const attempt = (job.attemptsMade ?? 0) + 1;
    const maxAttempts = this.queues.retryConfigFor(channel).attempts;

    // Resolve the delivery row to pick up the rendered body / target / etc.
    // We fetch via admin pool so RLS doesn't get in the way of the worker
    // (workers don't run inside a tenant request).
    const delivery = await this.loadDelivery(data.deliveryId);
    if (!delivery) {
      this.log.warn(`delivery ${data.deliveryId} not found — skipping`);
      return;
    }

    const result = await adapter.send({
      tenantId: data.tenantId,
      notificationId: data.notificationId,
      deliveryId: data.deliveryId,
      recipientUserId: delivery.recipientUserId,
      targetAddress: delivery.targetAddress ?? '',
      renderedSubject: delivery.renderedSubject,
      renderedBody: delivery.renderedBody ?? '',
      renderedBodyPlain: null,
      payload: data.payload,
      eventType: data.eventType,
      priority: data.priority,
      idempotencyKey: data.deliveryId,
    });

    const outcome = await this.notifications.recordChannelResult({
      tenantId: data.tenantId,
      notificationId: data.notificationId,
      deliveryId: data.deliveryId,
      channel,
      attempt,
      maxAttempts,
      result,
    });
    if (outcome.shouldRetry) {
      // Throw so BullMQ schedules the next attempt with the configured backoff.
      throw new Error(`retryable failure: ${result.error ?? 'unknown'}`);
    }
  }

  private async loadDelivery(deliveryId: string): Promise<{
    recipientUserId: string | null;
    targetAddress: string | null;
    renderedSubject: string | null;
    renderedBody: string | null;
  } | null> {
    // Tiny direct query via ioredis-less path — go through TransactionRunner.
    const { TransactionRunner } = await import('../../../database/transaction-runner.service.js');
    const { notificationDeliveries } = await import('@ustowdispatch/db');
    const { eq } = await import('drizzle-orm');
    // Resolve via the injected NotificationsService → reach into admin pool.
    // We bypass DI here because this method is called from the worker context
    // which has no request scope; the admin pool runner is shared.
    const runner = (this.notifications as unknown as { admin: InstanceType<typeof TransactionRunner> }).admin;
    if (!runner) return null;
    return runner.runAsAdmin({}, async (tx) => {
      const rows = await tx
        .select({
          recipientUserId: notificationDeliveries.recipientUserId,
          targetAddress: notificationDeliveries.targetAddress,
          renderedSubject: notificationDeliveries.renderedSubject,
          renderedBody: notificationDeliveries.renderedBody,
        })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, deliveryId))
        .limit(1);
      return rows[0] ?? null;
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
  }
}
