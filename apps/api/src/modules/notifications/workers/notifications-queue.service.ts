/**
 * NotificationsQueueService — BullMQ producer.
 *
 * One queue per channel: notify:push, notify:sms, notify:email,
 * notify:webhook, notify:in_app. Each carries the same job payload
 * (`QueueEnqueueRequest`) and is consumed by a worker registered in
 * NotificationsWorkersService.
 *
 * Retry math lives here on the producer side: we set BullMQ's `attempts`
 * and `backoff` per channel based on the policy described in
 * docs/notifications.md. The dispatcher's `recordChannelResult` is the
 * authoritative state machine — the worker re-throws to trigger the next
 * attempt, but only if the dispatcher said `shouldRetry`.
 */
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { NotificationChannel, NotificationPriority } from '@ustowdispatch/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { ConfigService } from '../../../config/config.service.js';
import { REDIS_CLIENT } from '../../redis/redis.tokens.js';

export const NOTIFY_QUEUE_NAMES: Record<NotificationChannel, string> = {
  push: 'notify-push',
  sms: 'notify-sms',
  email: 'notify-email',
  webhook: 'notify-webhook',
  in_app: 'notify-in_app',
};

export interface QueueEnqueueRequest {
  channel: NotificationChannel;
  tenantId: string;
  notificationId: string;
  deliveryId: string;
  eventType: string;
  priority: NotificationPriority;
  scheduledFor: Date | null;
  /** Per-delivery payload (includes webhook secret for webhook deliveries). */
  payload: Record<string, unknown>;
}

interface RetryConfig {
  attempts: number;
  backoff: { type: 'exponential' | 'fixed'; delay: number };
}

export const NOTIFY_RETRY_CONFIG: Record<NotificationChannel, RetryConfig> = {
  push: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
  sms: { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } },
  email: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  webhook: { attempts: 5, backoff: { type: 'exponential', delay: 60_000 } },
  in_app: { attempts: 1, backoff: { type: 'fixed', delay: 0 } },
};

@Injectable()
export class NotificationsQueueService implements OnApplicationShutdown {
  private readonly queues = new Map<NotificationChannel, Queue>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    for (const channel of Object.keys(NOTIFY_QUEUE_NAMES) as NotificationChannel[]) {
      this.queues.set(
        channel,
        new Queue(NOTIFY_QUEUE_NAMES[channel], {
          connection: this.redis.duplicate({ maxRetriesPerRequest: null }),
          defaultJobOptions: {
            removeOnComplete: { age: 24 * 3600, count: 5_000 },
            removeOnFail: { age: 7 * 24 * 3600 },
            ...NOTIFY_RETRY_CONFIG[channel],
          },
        }),
      );
    }
  }

  queueFor(channel: NotificationChannel): Queue | undefined {
    return this.queues.get(channel);
  }

  retryConfigFor(channel: NotificationChannel): RetryConfig {
    return NOTIFY_RETRY_CONFIG[channel];
  }

  async enqueue(req: QueueEnqueueRequest): Promise<void> {
    const q = this.queueFor(req.channel);
    if (!q) return;
    const delay = req.scheduledFor ? Math.max(0, req.scheduledFor.getTime() - Date.now()) : 0;
    await q.add(`${req.eventType}:${req.deliveryId}`, req, {
      jobId: req.deliveryId,
      ...(delay ? { delay } : {}),
      priority: this.bullPriorityFor(req.priority),
    });
  }

  async enqueueMany(reqs: QueueEnqueueRequest[]): Promise<void> {
    if (reqs.length === 0) return;
    const byChannel = new Map<NotificationChannel, QueueEnqueueRequest[]>();
    for (const r of reqs) {
      const list = byChannel.get(r.channel) ?? [];
      list.push(r);
      byChannel.set(r.channel, list);
    }
    await Promise.all(
      [...byChannel.entries()].map(async ([channel, list]) => {
        const q = this.queueFor(channel);
        if (!q) return;
        await q.addBulk(
          list.map((r) => {
            const delay = r.scheduledFor ? Math.max(0, r.scheduledFor.getTime() - Date.now()) : 0;
            return {
              name: `${r.eventType}:${r.deliveryId}`,
              data: r,
              opts: {
                jobId: r.deliveryId,
                ...(delay ? { delay } : {}),
                priority: this.bullPriorityFor(r.priority),
              },
            };
          }),
        );
      }),
    );
  }

  /**
   * BullMQ priority is 1=highest, larger=lower. Map the human enum to a small
   * integer range so emergency cuts in front of normal/low.
   */
  private bullPriorityFor(p: NotificationPriority): number {
    switch (p) {
      case 'emergency':
        return 1;
      case 'high':
        return 2;
      case 'normal':
        return 5;
      case 'low':
        return 10;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
